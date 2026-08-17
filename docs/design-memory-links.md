# Design note: `memory_links` — a typed relationship edge for memories

**Status:** proposal — not yet approved for implementation
**Date:** 2026-08-17 · **Baseline:** v0.37.2
**Scope of this note:** one additive SQLite table that generalizes the existing
`superseded_by` edge into typed links between memories, plus an optional one-hop
expansion in retrieval. **No LLM, no new runtime dependency, no graph DB.**
Deliberately *not* a mem0-style knowledge graph — see
`docs/comparison-mem0.md` for why that is over-engineered for this corpus.

---

## 1. Goal

Recall already knows how memories relate to each other — but it throws almost all
of that structure away. Today the only persisted edge is `memories.superseded_by`
(one column, overloaded), and several relationships we *compute at write time*
(fuzzy near-duplicates, failure→fix pairings, promotion provenance) are either
collapsed into a single value blob or discarded after a boolean/sentinel is set.

The goal is a **single typed-edge table** that:
- generalizes the one existing edge (`supersedes`) into a small relation
  vocabulary,
- **persists structure we already derive** rather than recomputing or losing it,
- enables a bounded **one-hop expansion** at retrieval ("show the current rule
  *and* what it replaced"; "this failure *and* its fix"),

all with **zero new dependency**, additive and inert by default, and a
non-destructive rollback — the same discipline as the FTS5 note.

**Non-goals:** LLM triple extraction, entity-relationship modeling, multi-hop
traversal, a graph database backend. If a traversal consumer never materializes,
this table is cheap to drop.

## 2. What relationships exist today, precisely

### 2.1 The one real edge: `superseded_by`

The old row carries the edge: `MemoryStorage.markSuperseded`
(`src/memory/storage.ts:949-956`) sets `is_active=0, superseded_by=<winning key>,
superseded_at=<now>`. It is driven from two places:
- **Preference override** — `MemoryService.storePreferenceWithOverride`
  (`src/services/memory.ts:407-451`) → `markSupersededPreferences`
  (`memory.ts:479-497`), joining old→new rows by `preference_key`.
- **Fuzzy newest-wins / hygiene** — but here `superseded_by` is **overloaded**
  with *sentinel strings* rather than a key: `'auto-demote'`
  (`storage.ts:1029`), `'auto-dedup'` (`storage.ts:1198`), `'janitor'`
  (`storage.ts:1062-1068`), enumerated as `REVIVABLE_SENTINELS`
  (`storage.ts:316`). `promoteRule` (`storage.ts:1218-1228`) revives only
  sentinel-superseded rows, refusing rows superseded by a real key.

So `superseded_by` conflates two meanings (a real old→new pointer vs. a
"demoted-by-process" tag) on one column. That overloading is exactly why a
*separate* typed-edge table is cleaner than adding more columns here.

### 2.2 Relationships we compute but do not persist as edges

- **Fuzzy near-duplicate** — `findFuzzyDuplicate` (Jaccard ≥ 0.65,
  `storage.ts:324-353`, used in `save()` at `:459-468`) and retroactive
  `dedupSimilar` (`storage.ts:1121-1210`). `dedupSimilar` computes
  `{winnerKey, loserKey, similarity}` per collapse **but returns it only** — the
  loser is marked `superseded_by='auto-dedup'` and the graded similarity is lost.
- **Failure → fix pairing** — `tool-outcome-watcher.ts` pairs a later Bash
  success to a pending failure (Jaccard ≥ 0.3 within a 5-min window,
  `:276-309`) and **merges the fix into the failure's own value blob**
  (`mergeIntoValue(pf.memoryKey, { what_should_do: 'Fix: …' })`, `:293-295`).
  The pairing state lives in an **ephemeral session JSON file**
  (`<sessionId>-failures.json`, `:49-74`), never a DB edge.
- **Promotion provenance** — `PromotionEngine.promote`
  (`src/services/promotion-engine.ts:73-112`) mints a `promoted_<ts>_<rand>`
  memory and writes its key back to `candidate_lessons.promoted_memory_key`
  (`updateLessonStatus`, `src/services/outcome-storage.ts:180-185`). This is a
  soft lesson→memory FK; the promoted memory has **no** column pointing to its
  source evidence — only `evidence_count`/`source` embedded in its JSON value.

### 2.3 The soft-FK neighborhood a links table would join

`outcome-storage.ts` already maintains several key/id references to
`memories.key` with no SQL `REFERENCES` constraint (all created in
`storage.ts:172-280`): `candidate_lessons.promoted_memory_key`,
`memory_stats.memory_key`, `rule_injection_events.rule_key`, plus
`*.episode_id → episodes.id`. A `memory_links` table would live beside these and
follow the same soft-FK convention.

**Content-hash is exact-equality only** (`computeContentHash`,
`storage.ts:292-305`; checked in `save()` at `:408-434`) — there is no existing
notion of *graded* similarity surviving anywhere. That is the gap §3.2 fills for
`refines`/`duplicate-of`.

## 3. Proposed design

### 3.1 The table

One table, alongside the outcome-storage tables, created in the same
`migrateSchema()` block:

```sql
CREATE TABLE IF NOT EXISTS memory_links (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  from_key    TEXT NOT NULL,          -- soft FK -> memories.key
  to_key      TEXT NOT NULL,          -- soft FK -> memories.key
  relation    TEXT NOT NULL,          -- see vocabulary below
  strength    REAL,                   -- e.g. Jaccard for refines/duplicate-of; NULL otherwise
  source      TEXT NOT NULL,          -- which mechanism created it (override|dedup|fix-pairing|promotion)
  created_at  INTEGER NOT NULL,
  UNIQUE(from_key, to_key, relation)
);

CREATE INDEX IF NOT EXISTS idx_memory_links_from ON memory_links(from_key);
CREATE INDEX IF NOT EXISTS idx_memory_links_to   ON memory_links(to_key);
CREATE INDEX IF NOT EXISTS idx_memory_links_rel  ON memory_links(relation);
```

**Directed edges.** `from_key → to_key`. Read "`from` *relation* `to`":
`old supersedes-> new` is stored as `from_key=new, to_key=old, relation='supersedes'`
(the *new* memory supersedes the old), matching the natural query direction
("given the memory I surfaced, what did it replace?").

**Relation vocabulary (v1, closed set — validate on insert):**

| relation | meaning | source signal (already computed) |
|---|---|---|
| `supersedes` | A replaces B (versioning) | preference override / real-key `markSuperseded` (§2.1) |
| `duplicate-of` | A collapsed B (near-identical) | `dedupSimilar` winner→loser, `strength`=Jaccard (§2.2) |
| `refines` | A is a fuzzy relative of B, kept | `findFuzzyDuplicate` near-miss below the collapse threshold |
| `fixed-by` | failure A resolved by B | fix pairing (§2.2) — **needs a target**, see §3.3 |
| `promoted-from` | lesson memory A promoted from source B | promotion provenance (§2.2) |

`contradicts` and `depends-on` are **deferred** — we have no non-LLM signal for
them today (see §7). Keep the set closed so retrieval can reason about it.

### 3.2 Populating links — persist, don't recompute

Each link comes from a mechanism that **already runs**; we add a single insert
next to work already being done. No new scans, no LLM.

- **`supersedes`** — in `markSuperseded` (`storage.ts:949-956`), when
  `supersededBy` is a **real key** (not a `REVIVABLE_SENTINELS` value), also
  insert `(from=supersededBy, to=key, relation='supersedes', source='override')`.
  Sentinel supersessions are skipped — they are process hygiene, not semantic
  edges. This is the migration of the one existing edge onto the new table.
- **`duplicate-of`** — in `dedupSimilar` (`storage.ts:1121-1210`), where
  `{winnerKey, loserKey, similarity}` is *already computed and currently
  discarded*, insert `(from=winnerKey, to=loserKey, relation='duplicate-of',
  strength=similarity, source='dedup')` before marking the loser.
- **`refines`** — in `findFuzzyDuplicate`'s caller in `save()`
  (`storage.ts:459-468`): when a candidate is a near-match but *above* the
  keep-threshold (not collapsed), record `refines` with the Jaccard strength
  instead of throwing the score away.
- **`promoted-from`** — in `PromotionEngine.promote` (`promotion-engine.ts:110`),
  right where it already calls `updateLessonStatus(candidateId, 'promoted',
  key)`: insert `(from=key, to=<best source memory key>, relation='promoted-from',
  source='promotion')`. Note the source is a *lesson/evidence* reference, so this
  one may point at a `candidate_lessons.id` rather than a `memories.key`; see §7.
- **`fixed-by`** — see §3.3 (the only source that needs a shape change first).

All inserts are best-effort and wrapped so a link failure never blocks the
underlying write — links are an optimization, exactly like the FTS5 mirror.

### 3.3 The `fixed-by` caveat

Today the fix is **merged into the failure's own value blob**
(`what_should_do`), so there is no second memory to point at — `from=failure,
to=fix` has no `to`. Two honest options:
1. **v1: skip `fixed-by`.** The fix already lives in the failure memory; a
   self-link adds nothing. Lowest effort, no behavior change.
2. **later: stop merging, store the fix as its own `solution`-type memory** and
   link `failure --fixed-by--> solution`. This is a capture-path change with real
   value (the fix becomes independently retrievable) but is out of scope here and
   should be its own proposal.

Recommend option 1 for v1: `fixed-by` stays in the vocabulary but is not emitted
until the capture side is reworked.

### 3.4 Consuming links — optional one-hop expansion, off the hot path

Retrieval stays exactly as it is (`src/core/retrieval.ts` — keyword × decay ×
strength × evidence × …, top-5). Links are consumed **after** ranking, not inside
the scoring loop, so the hot path is untouched:

```ts
// after findRelevant() returns the top-5, before formatting for load_rules:
for (const m of top) {
  m.related = storage.getLinks(m.key, ['supersedes', 'refines']); // one indexed lookup
}
```

The MCP `load_rules` / rule-injector formatter can then optionally append
"↳ replaces: <old snippet>" under a surfaced rule. This is **presentation-layer
enrichment**, gated behind a flag (§5), and never changes ranking or the top-5
selection — bounding the blast radius to the formatter.

## 4. Migration & backfill

In `migrateSchema()` (`storage.ts`, alongside the outcome-storage table
migrations `:172-280`):

1. Create `memory_links` + indexes (idempotent).
2. **Backfill `supersedes` once** from existing data:
   `INSERT OR IGNORE INTO memory_links(from_key, to_key, relation, source, created_at)
   SELECT superseded_by, key, 'supersedes', 'override', superseded_at
   FROM memories
   WHERE superseded_by IS NOT NULL
     AND superseded_by NOT IN ('auto-demote','auto-dedup','janitor')`
   — i.e. only real-key supersessions, sentinels excluded. Guard with "only if
   `memory_links` is empty." Trivial at the 10k-row cap.
3. No backfill is possible for `duplicate-of`/`refines`/`promoted-from` (the
   graded signal was never stored) — those accrue going forward.

## 5. Feature detection, config, rollback

- **Opt-in:** `CLAUDE_RECALL_MEMORY_LINKS = off | write | expand`.
  `off` (default on upgrade) = no inserts, no reads — fully inert.
  `write` = populate links but don't consume them (lets the table accrue data
  and be inspected via CLI before trusting it in retrieval).
  `expand` = also do the §3.4 one-hop enrichment.
  Ships **`off` by default**, mirroring how the janitor / AUTO_DEMOTE / the
  proposed FTS5 flag shipped.
- **Rollback is non-destructive:** the table is derived, redundant data.
  `DROP TABLE memory_links;` reverts with zero risk to `memories` — the
  authoritative `superseded_by` column is untouched (we mirror it, never replace
  it).
- **Retention:** add `memory_links` to `pruneOldData`
  (`outcome-storage.ts:391-417`) — delete edges whose `from_key`/`to_key` no
  longer exist in `memories` (orphan sweep), same pattern as the `memory_stats`
  orphan cleanup (`:408-410`).

## 6. Why this is worth doing (and where it stops)

- It **captures signal already computed and currently discarded**
  (`dedupSimilar` similarity, `findFuzzyDuplicate` near-misses) — near-zero
  marginal cost, since the work already happens.
- It **de-overloads `superseded_by`** by giving semantic edges a typed home,
  without a destructive migration.
- It delivers the concretely useful query — "current rule + what it replaced",
  "promoted lesson + its provenance" — that mem0's graph is credited for, at a
  fraction of the cost and with **no LLM and no new dependency**.

It stops short of a knowledge graph on purpose: no entity extraction, no
multi-hop, no `contradicts`/`depends-on` until a non-LLM signal exists. If the
one-hop expansion proves unused, the table is dropped and nothing else changes.

## 7. Risks / open questions

- **`superseded_by` overloading** must be respected in the `supersedes` emitter
  and backfill — never mirror a sentinel value as a semantic edge. The
  `REVIVABLE_SENTINELS` list (`storage.ts:316`) is the single source of truth for
  the exclusion.
- **`promoted-from` target type.** Promotion provenance points at a
  *candidate_lesson*/evidence, not always a `memories.key`. Either (a) point
  `to_key` at the source memory when one exists, or (b) give the table a
  nullable `to_kind` discriminator. Recommend deferring `promoted-from` to a
  second pass and shipping v1 with just `supersedes` + `duplicate-of` + `refines`.
- **Edge staleness.** A `to_key` can be pruned/superseded after the link is
  written; the §5 orphan sweep handles deletion, but a link to a now-*inactive*
  memory should be filtered at read time (join `is_active` in `getLinks`).
- **No demand yet.** The rule-injector asks single-hop, relevance-ranked
  questions; until `load_rules`/injector formatting actually renders related
  edges, the `expand` mode has no reader. Ship `write` mode first, inspect the
  accrued edges via a CLI (`claude-recall links <key>`), and only wire `expand`
  once the data looks useful — same "measure before flipping the default"
  discipline as the FTS5 benchmark.
- **Directionality bugs.** `supersedes` is stored new→old; the backfill maps
  `superseded_by`(=winner) → `from_key` and `key`(=loser) → `to_key`. Get this
  wrong and expansion shows the *old* text as current. One focused unit test on
  the backfill direction is mandatory.

## 8. Suggested PR breakdown

1. `memory_links` table + indexes + migration + backfill of real-key
   `supersedes` + orphan sweep in `pruneOldData`. Pure additive, inert
   (`MEMORY_LINKS=off`). Includes the backfill-direction unit test.
2. Emit `supersedes` (real-key branch of `markSuperseded`) and `duplicate-of` /
   `refines` (from `dedupSimilar` / `findFuzzyDuplicate`), behind
   `MEMORY_LINKS=write`. + `getLinks()` accessor and a `claude-recall links <key>`
   CLI for inspection.
3. One-hop `expand` enrichment in the `load_rules` / rule-injector formatter,
   behind `MEMORY_LINKS=expand`. Presentation only; no ranking change.
4. (separate proposal) Rework failure→fix capture to store the fix as its own
   `solution` memory and emit `fixed-by`; add `promoted-from` with a resolved
   target. Only after 1–3 prove the model useful.

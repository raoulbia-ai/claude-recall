# Design note: FTS5 / BM25 hybrid retrieval

**Status:** ✅ implemented behind `CLAUDE_RECALL_RETRIEVAL=fts` (default `like`).
PRs 1 & 3 of §10 shipped together — vtable + triggers + feature-detect +
backfill, and the MATCH candidate fetch + sanitization + BM25 fusion. Still open:
the benchmark harness (PR 2) and flipping the default (PR 4), which is gated on
that benchmark showing a win.
**Date:** 2026-07-22 (proposal) · implemented 2026-08-17 · **Baseline:** v0.37.2
**Scope of this note:** lexical BM25 ranking via SQLite FTS5. Local embeddings /
semantic similarity are a deliberately-separate later phase (§9).

**Implementation notes (deltas from the proposal below):**
- FTS terms are wrapped as **prefix** tokens (`"auth"*`), not plain phrases, so a
  short keyword still reaches a longer token (`auth` → `authentication`) —
  preserving the LIKE `%kw%` substring reach. Sanitizer:
  `MemoryStorage.sanitizeFtsMatch` (`src/memory/storage.ts`).
- Backfill uses FTS5's canonical `INSERT INTO memories_fts(memories_fts)
  VALUES('rebuild')`, gated on whether the vtable **existed before startup** (via
  `sqlite_master`). The proposal's "only if the FTS table is empty" guard is
  **wrong for external-content tables** — `count(*)` there proxies to the content
  table and reads non-zero even with an empty index (would silently skip the
  legacy-upgrade backfill; covered by a regression test).
- Fusion is `score *= 1 + W_LEXICAL * bm25Score` with `W_LEXICAL = 3.0`
  (`src/core/retrieval.ts`); `bm25Score ∈ [0,1]` is min-max normalized in
  `MemoryStorage.searchByContextFts` and carried on `Memory.bm25Score`.
- Tests: `tests/unit/storage-fts.test.ts` (7 cases: match+score, prefix recall,
  scope isolation, trigger sync on update/delete, sanitize-to-empty safety,
  legacy backfill, and no-bm25Score-on-`like`).

---

## 1. Goal

Replace the crude `LIKE '%kw%'` candidate filter + `includes()` keyword boost
with real **BM25 ranking** from SQLite's built-in FTS5 — improving recall for
paraphrase and ranking quality as the corpus grows, **without adding a single
dependency and without giving up the local-only / offline promise.**

Non-goals: embeddings, vector search, entity graphs (see §9).

## 2. Current retrieval, precisely

Two stages, both in-process:

1. **Candidate fetch** — `MemoryStorage.searchByContext()` (`src/memory/storage.ts:666`).
   When keywords are present it hard-filters rows with `value LIKE ?` per keyword
   (`storage.ts:698-713`): ≥3 keywords → require ≥2 matches; <3 → match any. The
   match is against the **raw JSON string of the `value` column** — so it matches
   field names as well as content, and misses any paraphrase.
2. **Re-rank** — `MemoryRetrieval.calculateRelevance()` (`src/core/retrieval.ts:141`).
   A multiplicative pipeline: base `relevance_score` × keyword boost
   (`retrieval.ts:150-174`, up to ~6× via `String.includes`) × time-decay
   forgetting curve (`:176-181`) × project/file boosts (`:184-189`) × strength
   (`:191-193`) × evidence (`:196-198`) × helpfulness prior (`:201-204`) ×
   staleness penalty (`:206-212`). Then sorted by `TYPE_PRIORITY` then score,
   sliced to top 5 (`:105-128`).

The weakest link is the **lexical layer** — steps 1 and the boost in step 2.
Everything else (decay, strength, evidence, project scoping) is worth keeping
exactly as-is; this change is surgical to the lexical component.

## 3. Proposed design

### 3.1 An external-content FTS5 table, kept in sync by triggers

Add one virtual table plus three triggers. **No change to the `memories` table
and no change to the TypeScript write path** — the triggers do the syncing in
SQL, so every writer (upsert, import, janitor, migrations) stays covered
automatically. That decoupling is the main reason to prefer this over a
`search_text` column maintained in `save()`.

```sql
-- external-content FTS mirror of memories.value, keyed by memories.id
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  value,
  content='memories',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, value) VALUES (new.id, new.value);
END;
CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, value) VALUES('delete', old.id, old.value);
END;
CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, value) VALUES('delete', old.id, old.value);
  INSERT INTO memories_fts(rowid, value) VALUES (new.id, new.value);
END;
```

**v1 indexes the raw `value` JSON.** The default `unicode61` tokenizer splits on
braces/quotes/punctuation, so JSON structure mostly falls away; field-name tokens
(`what_failed`, `content`) are minor noise and can be dropped later by indexing a
derived plaintext projection (a refinement, not a v1 requirement).

### 3.2 Candidate fetch via MATCH

Replace the `LIKE` branch in `searchByContext` with an FTS `MATCH` that returns
candidate ids **and** their BM25 rank, while preserving the existing scope
predicate (`project_id = ? OR scope = 'universal' OR project_id IS NULL`,
`storage.ts:680-684`) and type filter:

```sql
SELECT m.*, bm25(memories_fts) AS bm25_rank
FROM memories_fts
JOIN memories m ON m.id = memories_fts.rowid
WHERE memories_fts MATCH ?
  AND (m.project_id = ? OR m.scope = 'universal' OR m.project_id IS NULL)
ORDER BY bm25_rank;      -- SQLite bm25 is negative; more-negative = better
```

Empty/purely-stopword queries keep today's behavior (return all scoped rows, no
lexical filter) so `load_rules`-style "give me everything" calls are unaffected.

### 3.3 Query sanitization (must-have, not optional)

Raw user keywords fed to `MATCH` are a **syntax hazard** — bare `AND`/`OR`/`NEAR`,
hyphens, quotes, and `*` are FTS5 operators and throw `SQLITE_ERROR` on malformed
input. Every term must be wrapped as a quoted phrase and OR-joined:

```
"kaggle" OR "submission" OR "api"
```

A bad query must **fall back to the LIKE path**, never crash retrieval.

### 3.4 Score fusion

Compute a normalized `bm25Score ∈ [0,1]` per candidate (min-max across the
candidate set, Mem0-style) and **replace** the `includes()` boost at
`retrieval.ts:150-174` with it — leaving every other multiplicative term
untouched:

```ts
// was: score *= 1 + matchRatio * 3.0 (+1.5 all-match / ×0.3 no-overlap)
score *= 1 + wLexical * bm25Score;   // wLexical ~ 3.0 to preserve current dynamic range
```

Keeping the fusion multiplicative means decay/strength/evidence/project boosts
behave identically — the only thing that changes is *how the lexical signal is
measured*. This bounds the blast radius to one term.

## 4. Migration & backfill

In `migrateSchema()` (`storage.ts`, alongside the existing `CREATE INDEX IF NOT
EXISTS` migrations ~`:119-149`):

1. Feature-detect FTS5 (see §5). If absent → skip everything, leave a flag off.
2. Create the vtable + triggers (idempotent).
3. Backfill once: `INSERT INTO memories_fts(rowid, value) SELECT id, value FROM memories`
   guarded by "only if the FTS table is empty."

Backfill cost is a single scan — trivial at the 10k-row cap.

## 5. Feature detection, fallback, rollback

- **Detect** at init by attempting `CREATE VIRTUAL TABLE … USING fts5` in a
  try/catch (verified working in the bundled `better-sqlite3`, but self-built or
  exotic SQLite may lack it). On failure, set `ftsAvailable = false` and use the
  existing LIKE path everywhere. **Retrieval must work identically with FTS off.**
- **Rollback is safe and non-destructive:** the FTS table + triggers are derived,
  redundant data. `DROP TRIGGER … ; DROP TABLE memories_fts;` reverts to LIKE with
  zero risk to `memories`.

## 6. Config / opt-in

`CLAUDE_RECALL_RETRIEVAL = fts | like`. Ship **`like` as default** first so the
change is inert on upgrade, flip to `fts` as default only after the benchmark
(§7) shows a win. This mirrors how AUTO_DEMOTE / the janitor shipped off-by-default.

## 7. Benchmark tie-in (finding #4)

This change is the reason to stand up the LongMemEval-subset harness **first**:
without a before/after number we can't tell whether BM25 actually helps or just
adds surface area. Track both **recall/accuracy** and **tokens-per-query** (the
2000-token `load_rules` budget is the natural denominator). The harness doubles as
the regression guard for the fusion weights.

## 8. Risks / open questions

- **Tokenizing raw JSON** dilutes ranking with field-name tokens. Acceptable for
  v1; the clean fix (derived plaintext column) means a write-path change.
- **`is_active` / superseded rows**: `searchByContext` currently returns inactive
  rows too (no `is_active` predicate at `storage.ts:677`). Confirm FTS candidate
  fetch matches whatever the intended active-set semantics are — don't silently
  change them in this PR.
- **Fusion weight `wLexical`** needs tuning against the benchmark; the ×0.3
  no-overlap penalty has no direct BM25 equivalent (non-matches simply aren't
  returned by MATCH) — verify that doesn't over-promote weak matches.
- **WAL + triggers**: triggers run inside the same transaction as the write; the
  existing `wal_checkpoint(TRUNCATE)` after writes is unaffected.

## 9. Later phase (out of scope here)

Optional local embeddings (`sqlite-vec` or a small local model) for semantic
similarity, gated behind an opt-in flag so the default stays dependency-free —
fused as a third signal exactly like Mem0 (semantic + BM25 + entity). BM25 first;
it captures most of the paraphrase win at none of the cost.

## 10. Suggested PR breakdown

1. FTS vtable + triggers + migration + feature-detect + backfill (no retrieval
   wiring yet — pure additive, inert).
2. LongMemEval-subset benchmark harness (measure the `LIKE` baseline).
3. Candidate fetch via MATCH + sanitization + fusion, behind `CLAUDE_RECALL_RETRIEVAL=fts`.
4. Flip default to `fts` once the benchmark confirms the win.

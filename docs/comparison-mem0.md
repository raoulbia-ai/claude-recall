# Claude Recall vs. mem0

A positioning and architecture comparison against [mem0](https://github.com/mem0ai/mem0)
(mem0ai), currently the most popular open-source agent-memory project
(~63k GitHub stars). Written 2026-08-17.

Both give AI agents persistent memory across conversations, but they are built
for **different consumers** and on **opposite philosophies**: mem0 is an
LLM-native memory *backend for app developers*; Claude Recall is a *purpose-built,
zero-dependency memory tool for Claude Code*.

## At a glance

| Dimension | **mem0** | **Claude Recall** |
|---|---|---|
| Primary consumer | App developers embedding memory in their own agents | Claude Code users (the coding agent itself) |
| Delivery | Python/TS SDK + REST API + hosted Platform; optional MCP servers | MCP server + Claude Code hooks, installed via npm |
| Storage | Vector DB (Qdrant default) + optional graph DB | Local SQLite (WAL mode), single file `~/.claude-recall/claude-recall.db` |
| Retrieval | Embedding / semantic vector search (top-k) | Keyword ranking + time-decay + context/usage scoring |
| Extraction | **LLM-driven** — LLM extracts facts, then ADD/UPDATE/DELETE/NOOP reconciliation | Rule/heuristic extractors (preferences, failures, patterns); no LLM in the hot injection path |
| Hard dependencies | **LLM API key + embeddings pipeline** (defaults to OpenAI) | None — no API key, no embeddings, no external services |
| Cost per write | LLM tokens + latency on every memory write | ~0 (local compute, ~10–30 ms keyword rank) |
| Scoping | `user_id` / `agent_id` / `run_id` (session) | Project-scoped (universal vs. project-specific), local machine |
| License / lang | Apache 2.0; Python + TS | TypeScript |
| Maturity | ~63k stars; commercial hosted Platform | Early-stage OSS on npm |

## Where they genuinely differ

**1. LLM-native vs. deterministic.** This is the core split. mem0 runs an LLM on
*every write*: it extracts salient facts, then (classically) does a second LLM
pass that decides whether to **ADD / UPDATE / DELETE / NOOP** against
semantically-similar existing memories. That buys real **consolidation and
contradiction resolution** — but costs tokens, latency, and an API key. Claude
Recall is deterministic: SHA-256 content-hash dedup at write time, keyword +
decay + usage ranking at read time, and the just-in-time rule-injector runs *no*
LLM in the hot path. Recall trades mem0's semantic smarts for **zero marginal
cost and no network dependency**.

**2. Retrieval mechanics.** mem0 embeds the query and returns top-k semantically
similar memories — it will match "how do I deploy" to a memory phrased "release
process" even with no shared words. Recall's keyword ranking
(`src/core/retrieval.ts`) will not catch that paraphrase. This is exactly the gap
`docs/design-hybrid-retrieval-fts5.md` targets — SQLite FTS5 narrows it without
adding an embeddings dependency.

**3. Who does the remembering.** mem0 is a **library you call** —
`client.add(messages, user_id=...)` / `client.search(query, ...)`. Your app
decides when to write and read. Claude Recall **inserts itself into the agent's
loop** via Claude Code hooks: the rule-injector fires on PreToolUse and pushes
matching rules adjacent to the action, the enforcer gates tool use until rules
load, PreCompact preserves memory before compaction. mem0 is passive
infrastructure; Recall is an active participant in the session.

**4. Multi-tenant vs. single-user-local.** mem0 is built for many users on shared
infrastructure (`user_id`/`agent_id`/`run_id`, hosted cloud). Recall is
single-developer, single-machine, project-scoped — memories never leave
`~/.claude-recall/`. That is a privacy/simplicity win and a "no sync across your
machines" limitation.

## The overlap worth noting

mem0 has two MCP paths onto coding agents: the **Platform MCP** (cloud) and
**OpenMemory MCP** — a *local-first, self-hosted* MCP server that auto-captures
coding preferences and injects relevant memories into any MCP agent.
**OpenMemory is mem0's closest analog to Claude Recall** and the most direct
competitor. Key contrast even there: OpenMemory still runs the LLM extraction
pipeline (needs a key); Recall does not.

## Ideas Recall could borrow

- **LLM-based reconcile pass** (optional, background, off the hot path) —
  mem0's ADD/UPDATE/DELETE/NOOP is stronger dedup than content-hash equality
  (catches "same fact, different words").
- **Semantic retrieval** — the FTS5 design note is the pragmatic middle ground;
  a full embeddings option would close the paraphrase gap but breaks the
  no-API-key promise.
- **Temporal/relationship reasoning** — mem0's graph layer wins on multi-hop and
  "what changed over time" queries. Recall's preference-versioning
  (`superseded_by`) is a lighter take on the same idea. See the assessment below.

## Bottom line

mem0 optimizes for *semantic recall quality and multi-tenant scale*, accepting
LLM cost and an API-key dependency. Claude Recall optimizes for *zero-dependency,
zero-cost, deep Claude Code integration*, accepting weaker paraphrase matching.
They are not really competitors except at the OpenMemory-MCP boundary — Recall's
differentiator is that it needs nothing but Node and a local SQLite file, and it
lives *inside* the agent's action loop rather than beside it.

---

# Assessment: should Recall adopt mem0's graph-memory approach?

## What mem0's graph layer actually is

mem0's graph memory stores an **entity-relationship graph alongside** the vector
store. On each write, an LLM pipeline runs: **entity extraction → relationship
establishment → conflict detection → graph update** (with an update resolver for
temporal conflicts). Retrieval can then traverse relationships, not just match
text. Reported payoff on LOCOMO: the graph variant scores ~2% higher overall than
the base config, but the base-vs-graph gains concentrate where it matters —
**+29.3 on temporal reasoning and +25.2 on multi-hop** questions ("what did I
decide about X *after* I changed Y?").

Two caveats that reshape the "adopt it" question:
- In the **v3 OSS rewrite (~Apr 2026)** mem0 **removed the graph layer from
  open source** and replaced it with lighter **spaCy-based entity linking**
  (entities stored in a parallel vector collection). Full graph memory now lives
  on the **hosted Platform**. So even mem0 concluded the LLM-driven graph was too
  heavy for the embedded/OSS tier.
- The graph's value is realized through **traversal queries** — a class of query
  Recall does not currently ask.

## How this maps onto Recall today

Recall's schema (`src/memory/schema.sql`) is a single flat `memories` table.
There is exactly one relationship edge modeled: preference versioning
(`superseded_by` / `superseded_at` / `is_active`) — effectively a one-hop
"replaced-by" chain. Retrieval (`src/core/retrieval.ts`) is pure per-memory
scoring: keyword overlap × time-decay × project/file match × usage strength ×
evidence. There is **no traversal, no entity model, no cross-memory linking**.

So adopting graph memory is not a tweak — it means adding (a) an entity/relation
data model, (b) an extraction step to populate it, and (c) traversal-aware
retrieval to consume it. Each has a cost.

### The extraction problem is the blocker

mem0's graph quality comes from an **LLM** reading each memory and emitting
`(subject, relation, object)` triples with conflict resolution. Recall's entire
design premise is **no LLM and no API key in the pipeline**. To match mem0 you
would either:
- **Add an LLM dependency** → breaks the zero-dependency promise, adds cost and
  latency to every write, needs a key. Non-starter for the core product.
- **Use spaCy/NER** (mem0's own v3 fallback) → a heavy Python/native dependency
  in a Node project, and NER on short dev-preference snippets ("commit with
  `--no-gpg-sign`", "merge before next PR") yields sparse, low-value entities.
  The corpus is imperative rules, not narrative prose with rich named entities.
- **Regex/heuristic entity tagging** → cheap and dependency-free, but produces a
  thin graph that mostly re-encodes what keyword scoring already captures.

### The demand problem

The graph pays off on **multi-hop and temporal** questions. Recall's actual
retrieval trigger is "surface rules relevant to *this tool call*" — a
single-hop, relevance-ranked lookup fired by the rule-injector. It does not ask
"trace the chain of decisions about auth across sessions." Until there is a
consumer that issues traversal queries, a graph is infrastructure with no reader.

## Verdict: **not worth a full graph layer — adopt the one idea that fits**

A mem0-style LLM-driven knowledge graph is **over-engineered for Recall's corpus,
consumers, and constraints**, and mem0 itself pulled it out of OSS for the same
weight reasons. Recommendation, in priority order:

1. **Do first — semantic retrieval via FTS5** (already scoped in
   `docs/design-hybrid-retrieval-fts5.md`). This solves the *real* observed gap
   (paraphrase matching) at a fraction of the cost, no new dependency. Higher ROI
   than any graph work.

2. **Cheap, high-value slice of the graph idea — generalize `superseded_by` into
   a lightweight typed-link table.** Recall already models one edge type. A small
   `memory_links(from_key, to_key, relation)` table — relations like
   `supersedes`, `refines`, `contradicts`, `depends-on` — captures ~80% of the
   temporal/versioning value with:
   - no LLM (links come from existing signals: the promotion engine already
     knows evidence chains; preference override already knows supersession;
     content-hash near-misses can suggest `refines`),
   - no new runtime dependency (one SQLite table + indexes),
   - a bounded blast radius (retrieval can optionally expand one hop from a
     top-ranked memory, off the hot path).

   This gives "show me the current rule *and what it replaced*" and "this failure
   plus its fix" without the extraction machinery.

3. **Do not build** — full entity-relationship extraction, graph DB backend
   (Neo4j/Kuzu/etc.), or LLM triple extraction. Wrong cost/benefit for a
   local, zero-dependency, single-developer tool.

**One-line recommendation:** skip the graph *layer*; ship FTS5 first, then, if a
traversal consumer emerges, add a single `memory_links` table that generalizes
the existing `superseded_by` edge — not an LLM knowledge graph.

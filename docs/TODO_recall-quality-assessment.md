# TODO: Recall Quality Assessment

## Problem Statement

Claude Recall may not consistently fire when it should. Memories exist in the database but don't always surface at the right moment. This doc identifies every recall trigger, known gaps, and a plan for evaluating and improving recall quality.

---

## Current Recall Triggers

| # | Trigger | Event | What Happens | Automatic? |
|---|---------|-------|-------------|------------|
| 1 | **search_enforcer** hook | `PreToolUse` (Write/Edit/Bash/Task) | Blocks or warns if `load_rules`/`search_memory` not called recently | Yes |
| 2 | **load_rules** tool | Explicit MCP call | Returns all active rules by type | No — Claude must call it |
| 3 | **search_memory** tool | Explicit MCP call | Keyword search, returns top 5 scored results | No — Claude must call it |
| 4 | **auto-skills** (SKILL.md) | Claude Code session start | Crystallized memories loaded natively | Yes — but may be stale |
| 5 | **store_memory** response | After storing mid-session | Returns `activeRule` directive for immediate use | Triggered by store |

## Known Gaps (Where Recall SHOULD Fire But Doesn't)

### Gap 1: Enforcer Only Gates Mutations
- `search_enforcer` only fires on Write, Edit, Bash, Task tool calls
- Claude can **read files, reason, plan, and advise** without ever loading rules
- Consequence: Claude may form an approach, then load rules only when forced to act — too late to change course

### Gap 2: No Context-Aware Proactive Search
- When Claude works on database code, it should automatically search for "database" memories
- When Claude writes tests, it should search for "testing" preferences
- Currently: Claude must explicitly decide to call `search_memory` — it rarely does unless the skill tells it to

### Gap 3: 60-Second TTL Is Too Short
- After 60 seconds, rules are "stale" but enforcer only warns (doesn't block)
- Long sessions can drift far from loaded rules
- The warning message is easy for Claude to acknowledge and ignore

### Gap 4: Read-Only Bypass
- Commands like `cat`, `grep`, `git log`, `ls` bypass the enforcer entirely
- Claude can explore the codebase and form conclusions before rules are loaded
- By the time it hits a Write/Edit, it may already have a plan that contradicts stored preferences

### Gap 5: Auto-Skills Staleness
- `.claude/skills/auto-*/SKILL.md` files only update when `npx claude-recall skills generate` runs
- Between regenerations, new memories stored via hooks don't appear in skills
- Skills may contain outdated or superseded preferences

### Gap 6: No Recall on Session Resume
- If a session is resumed or context is compressed, rules loaded earlier are gone
- `precompact-preserve` captures memories but doesn't re-load them
- Claude must re-call `load_rules` but may not realize it needs to

### Gap 7: load_rules Is a Firehose
- Returns ALL preferences, last 10 corrections, last 5 failures — no filtering by relevance
- With 200+ test preferences polluting the store, signal-to-noise is terrible
- Claude may miss important rules buried in the output

---

## Evaluation Plan

### Phase 1: Manual Assessment (Quick)

1. Export memories: `npx claude-recall export memories.json`
2. In a fresh session, run 10 realistic workflows and note:
   - Did Claude call `load_rules` before acting?
   - Did Claude call `search_memory` when context suggested it should?
   - Were relevant memories in the output when loaded?
   - Did Claude actually apply loaded rules?
3. Check logs: `cat ~/.claude-recall/hook-logs/memory-stop.log | tail -50`

### Phase 2: LLM-Based Eval (Structured)

Feed another LLM:
```
Given these stored memories and this task context, assess:
1. PRECISION: Are the returned results relevant to the task? (0-1)
2. RECALL: Are there relevant memories in the store that were NOT returned? (0-1)
3. RANKING: Is the order sensible? (nDCG score)
4. TIMING: Should memories have been loaded earlier in this session? (yes/no)

Stored memories: [export JSON]
Task context: [description of what Claude was doing]
Returned results: [load_rules or search_memory output]
```

Run across 10-20 test scenarios covering:
- Indentation/style preferences
- Project-specific conventions
- Past failure avoidance
- Tool usage preferences
- File naming conventions

### Phase 3: Automated Eval Harness (Future)

Build `tests/eval/recall-quality.test.ts`:
- Seed in-memory DB with known memories
- Run search queries via MemoryRetrieval
- Assert expected memories appear in top N
- Assert irrelevant memories don't rank higher than relevant ones
- Measure precision@5 and recall@5

---

## Potential Fixes (Prioritized)

### P0: Clean Up Test Data Pollution
- 200+ test preferences are drowning real rules
- Run: `npx claude-recall search "Test preference"` and bulk delete
- Or add test data exclusion filter to `load_rules`

### P1: Gate More Than Just Mutations
- Extend `search_enforcer` to also fire on the first Read/Glob/Grep of a session
- Or: fire on first tool call of ANY type, not just mutations
- Ensures rules are loaded before Claude starts exploring

### P1: Context-Aware Search Triggers
- In `memory-management` skill, add directives like:
  - "Before modifying any file, search_memory for that file path"
  - "When switching to a new task area (tests, CI, database), search for related memories"
- Low-cost, high-impact change — just skill text updates

### P2: Increase TTL or Make It Adaptive
- 60s is too aggressive for long coding sessions
- Consider: 5-minute TTL with hard block (not just warn) on expiry
- Or: TTL resets on every tool call, not just search tools

### P2: Relevance-Filtered load_rules
- Instead of returning all 200+ preferences, score them against the current task context
- Use the existing retrieval engine scoring to rank rules
- Return top 20-30 most relevant instead of everything

### P3: Auto-Reload After Context Compression
- Detect `PreCompact` event and add a directive to re-load rules
- Or: have the skill explicitly say "after context compression, call load_rules again"

---

## Metrics to Track

- `load_rules` call frequency per session (from search-monitor.log)
- `search_memory` call frequency per session
- Citation rate: cite_count / load_count ratio per rule
- Enforcer block rate: how often does the hook actually block vs. warn
- False negative rate: memories that exist but were never surfaced in relevant sessions

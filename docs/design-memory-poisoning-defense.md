# Design: memory-poisoning defense

Status: approved 2026-11-18, being implemented in phases (see [Phases](#phases)). Done: Phase 0 (#150), Phase 1.

## The problem

Anything stored as a memory is fed to the agent in future sessions as a rule. If an attacker's text gets stored, it keeps steering the agent long after the session where it appeared. This is prompt injection with a delay, and it spreads further than one session: one database sits behind Claude Code, Kiro and Pi, and `universal` memories reach every project.

Memory is *meant* to steer the agent: `load_rules` tells it to apply what it loads. So the question is not "treat memory as data" but **which memories have earned the right to be instructions**. That's the trust-separation principle: trusted instructions, user input, tool output, retrieved documents and memory are not equivalent. Untrusted content can be useful evidence, but it must not rewrite the agent's goals, permissions or rules.

References:
- [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/llm-top-10/)
- [OWASP Agentic Skills Top 10](https://owasp.org/www-project-agentic-skills-top-10/)
- [OpenAI Agents SDK guardrails](https://openai.github.io/openai-agents-python/guardrails/)

## Where memories come from

| Path | What feeds it | Trust |
|---|---|---|
| Capture from the user's prompts (correction detector, Stop-hook classification, Pi input) | The user's own words | **User**. Pasted text is the weak spot |
| CLI `claude-recall store` | The user, typing | **User** |
| Failure capture (tool-outcome watcher, Stop-hook failure scan, Pi tool results) | Tool error output | **Tool-derived** |
| Session learnings (`extractSessionLearnings`) | A model reading the transcript, including tool output, files and web pages | **Tool-derived** |
| Pre-compaction capture, success capture | The transcript | **Tool-derived** |
| `store_memory` (MCP) and Pi `recall_store` | Whatever the agent decides. The agent can be steered by text in a page or file | **Agent** |
| `claude-recall import` | A file | **Import** |
| Janitor merge / rewrite | Existing rules | The lowest trust of its sources |
| Anything stored before origin tagging | Unknown | **Unknown** |

On the maintainer's database (2026-11-18), only 16 of 156 active memories (10%) carried the user's own words as their source.

## Findings

1. **Session learnings turn untrusted text into rules.** A model reads the last ~50 transcript entries, tool output included, and stores what it writes back. There's no filter and no marker of origin, so we can't even measure whether the feature is worth keeping.
2. **`store_memory` is the widest channel.** The agent may call it with text an attacker planted in a file or web page, and the rule is "immediately active in this conversation".
3. **Auto-skills turn memories into persistent instructions.** Every `store_memory` regenerated `.claude/skills/auto-*/SKILL.md` files, which Claude Code loads as skills. On 2026-11-18 the integration tests did exactly that to this repository: its `auto-preferences` skill was regenerated with test-fixture text and listed in a live session. This is OWASP AST01/AST05: a skill whose content comes from an untrusted source.
4. **Nested model calls had tools enabled.** `claude -p` ran with Claude Code's default tools and every MCP server, and saved a session file per call (541 files, 215 MB on one machine). `pi -p` could run shell commands. *Fixed in 0.48.0 (#133, #139).*
5. **No audit trail.** A rewrite or merge by the janitor leaves only `superseded_by`; there's no history of when a rule appeared or changed (OWASP AST09).
6. **Secrets can be captured.** Tool output containing a token can land in a failure memory, a source excerpt (up to 2,000 chars) or an export.

## Threat model

| Risk | In claude-recall | Status |
|---|---|---|
| Indirect prompt injection (LLM01) | Session learnings, `store_memory`, failure text | Phases 1 and 3 |
| Data poisoning (LLM04) | The memory database is the poisonable store, and it persists | Phases 1 and 3 |
| Malicious skills / untrusted instructions (AST01, AST05) | Auto-skills | **Phase 0** |
| Cross-agent contamination | One DB for all runtimes; `universal` scope | Phase 3 (quarantine covers every runtime) |
| Improper output handling (LLM05) | Classifier, session-learning and janitor output stored with light validation | Phase 1 (screening) |
| Excessive agency (LLM06) | Nested `claude -p` / `pi -p` | Fixed in 0.48.0 |
| Sensitive information disclosure (LLM02) | Secrets in captured text, excerpts, export | Phase 1 (redaction) |
| Supply chain (LLM03, AST02, AST07) | npm package, Pi extension, hook commands | Good: OIDC provenance, pinned binary paths |
| Unbounded consumption (LLM10) | Session-end model calls, DB growth | Fixed: call caps, retention, 0.49.0 |
| No governance (AST09) | No history of rule changes | Phase 2 |

## Decisions (2026-11-18)

1. **Quarantine is the default.** An untrusted memory is stored but not loaded until it's approved. Reviewing must be easy: the user is told about pending memories at session start, and as they happen where the runtime can show it.
2. **Old memories without a source are unverified.** They go through the same review.
3. **`store_memory` from the agent is untrusted by default.**
4. **Session learnings stay, tagged as tool-derived.** Revisit with data once origins are recorded.
5. **Auto-skills are off by default.** Only two auto-skill files existed across all of the maintainer's projects (one full of test fixtures, one with three memories from August), and their content duplicates what `load_rules` already injects. Recommendation: remove the feature entirely after one release with it off.

## Controls

- **Provenance.** Every memory records its origin: `user`, `agent`, `tool`, `import`, or `NULL` for unknown.
- **Trust rule.** A memory is trusted when its origin is `user`, or when the janitor confirmed it against the user's own words (`confirmed_at`), or when the user approved it. Everything else is unverified.
- **Propose → approve → commit.** An unverified write is a proposal: stored, never loaded. The user approves or rejects it; approval is never an agent-callable tool, because a steered agent could approve its own injection.
- **Guardrails on input and output** (the OpenAI SDK's tool-guardrail pattern):
  - on every write: screen for attack patterns (`curl … | sh`, "ignore previous instructions", encoded blobs) and redact secrets before storing;
  - on `load_rules`: load trusted memories only.
- **Least privilege.** Nested model calls are sealed (0.48.0). Auto-skills are off, and never built from unverified memories.
- **Incident logging.** An append-only history of every create, rewrite, merge, demote, approve and reject.
- **Red-team suite.** Repeatable cases in `tests/redteam/`, run in CI. Each states the attacker goal, entry point, target asset, expected safe behaviour and severity.

## Phases

Each phase is its own PR, merged only when its tests pass.

- **Phase 0: auto-skills.** Off by default (`CLAUDE_RECALL_AUTO_SKILLS=1` to enable); the integration test no longer writes into the repository.
- **Phase 1: provenance and screening.** The `origin` column, set on every write path (required by the type system, so a new path can't skip it); attack-pattern screening and secret redaction on write; the red-team suite. A flagged write is refused unless its origin is `user`: the user may legitimately say "never pipe curl to sh".
- **Phase 2: history.** An append-only change log and `claude-recall rules history <id>`.
- **Phase 3: quarantine by default.** Unverified memories aren't loaded. The user is told about pending memories at session start (statusLine count, SessionStart notice, Pi `notify`), and can act on them with `claude-recall rules pending` / `approve` / `reject`, including in bulk. The janitor's `confirm` approves what the user's own words support.

**Upgrade impact of Phase 3:** with decision 2, most existing memories start as unverified and stop loading until reviewed. Bulk review (`approve --all`, by type, by project) and the janitor's confirm pass keep that to one sitting, and the release notes must say so.

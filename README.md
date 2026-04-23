# Claude Recall

### Persistent, local memory for coding agents — learn from every session.

Claude Recall is a **local memory engine** that gives coding agents something they're missing by default:
**the ability to learn from you over time.**

Works with **Claude Code** (via MCP server + hooks) and **[Pi](https://github.com/mariozechner/pi)** (via native extension). Both share the same local database — a preference learned in one agent is available in the other.

Your preferences, project structure, workflows, corrections, and coding style are captured automatically and applied in future sessions — **securely stored on your machine**.

---

## Features

- **Smart Memory Capture** — LLM-powered classification (via Claude Haiku) detects preferences and corrections from natural language, with silent regex fallback
- **Project-Scoped Knowledge** — each project gets its own memory namespace; switch projects and the agent switches context automatically
- **Failure Learning** — captures what failed, why, and what to do instead — so the agent doesn't repeat mistakes
- **Outcome-Aware Learning** — tracks action outcomes (all tool results, test cycles, user corrections), synthesizes candidate lessons, and promotes validated patterns into active rules automatically
- **Skill Crystallization** — auto-generates `.claude/skills/auto-*/` files from accumulated memories, using Anthropic's [Agent Skills](https://agentskills.io/) open standard
- **Rule Hygiene** — token-budgeted `load_rules` payload, citation-aware auto-demotion of rules that never earn citations, and retroactive dedup for near-duplicates
- **Local-Only** — SQLite on your machine, no telemetry, no cloud, works fully offline

---

## Quick Start

### Requirements

| Component | Version                 | Notes                       |
| --------- | ----------------------- | --------------------------- |
| Node.js   | **20+**                 | required for better-sqlite3 |
| OS        | macOS / Linux / Windows | WSL supported               |

### Install for Claude Code

Install the global binary once per machine:

```bash
npm install -g claude-recall
```

Then, in each project directory where you want claude-recall active:

```bash
claude-recall setup --install
claude mcp add claude-recall -- claude-recall mcp start
```

Restart Claude Code. Ask *"Load my rules"* to verify — Claude should call `load_rules`.

> **Hit `EACCES: permission denied`?** Your global npm is owned by root. Either `sudo npm install -g claude-recall` once, or do the permanent fix described in [Upgrading](#upgrading) below.

### Install for Pi

```bash
pi install npm:claude-recall
```

That's it. Ask Pi to *"Load my rules"* to verify.

### Shared Database

Both agents use the same database at `~/.claude-recall/claude-recall.db`, scoped per project by working directory. A correction learned in one agent is available in the other.

### Upgrading

```bash
claude-recall upgrade
```

One command. Checks the registry, refreshes the global binary, clears any running MCP servers — Claude Code respawns them on the next tool call, picking up the new version. **No `claude mcp add` re-run needed** — existing registrations point at the `claude-recall` command, not a pinned path.

For Pi, run `pi update npm:claude-recall` and restart Pi.

> **Seeing `error: unknown command 'upgrade'`?** Your installed version predates 0.23.2 (the release that added the `upgrade` command). Bootstrap once with `npm install -g claude-recall@latest`, then all future upgrades use `claude-recall upgrade`.

<details>
<summary><b>If the install step reports <code>EACCES: permission denied</code></b></summary>

Your global npm prefix is root-owned (common when node was installed via `apt install nodejs`). Pick one:

**Quick** — one-time sudo:
```bash
sudo npm install -g claude-recall@latest
```

**Permanent** — move the prefix to a user-owned directory so no global install ever needs sudo again:
```bash
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc

# Install claude-recall into the new user-owned prefix:
npm install -g claude-recall@latest

# Verify and you're done:
claude-recall --version
```

The prefix fix only tells npm *where* to install; it doesn't install anything itself. The explicit `npm install -g` line picks up the new binary into the new prefix so `claude-recall` on your PATH has the `upgrade` command.

</details>

---

## What to Expect

Once installed, Claude Recall works automatically in the background. Each row below is tagged with the runtime it applies to so you can skip what doesn't apply to you.

| When | What happens | CC | Pi |
|---|---|:-:|:-:|
| **Session start** | Active rules are loaded before the first action and injected into the agent's context | ✓ | ✓ |
| **As you work** | Every prompt is classified for corrections and preferences. Natural statements like *"we use tabs here"* are detected and stored | ✓ | ✓ |
| **Before each tool call / agent turn** | **Just-in-time rule injection** — relevant rules are surfaced as a `<system-reminder>` block adjacent to the action so the agent sees them at the moment of decision (not 50,000 tokens upstream). Per-tool-call in CC; per-turn in Pi | ✓ | ✓ |
| **Tool outcomes** | Tool results (Bash, Edit, Write, etc.) are captured. Failures are stored; Bash failures are paired with their successful fixes | ✓ | ✓ |
| **Reask detection** | Frustration signals (*"still broken"*, *"that didn't work"*) are recorded as outcome events | ✓ | ✓ |
| **Before context compression** | Aggressive memory sweep captures important context before the window shrinks | ✓ | ✓ |
| **After context compression** | Rules are automatically re-injected into the new context so they're not lost | ✓ |   |
| **Sub-agent spawned** | Active rules are injected into the sub-agent's context. Sub-agent outcomes (completed/failed/killed) are captured | ✓ |   |
| **Rules sync** | Top 30 rules are exported as typed `.md` files to Claude Code's native memory directory | ✓ |   |
| **Session exit** | **Auto-checkpoint** — the most recent task is extracted into a `{completed, remaining, blockers}` snapshot and saved for the next session. Critical for Pi (no `--resume` flag); safety net for CC users who exit without resuming | ✓ | ✓ |
| **End of session** | Session episodes are created, candidate lessons are extracted from failures, and validated patterns are promoted into active rules | ✓ | ✓ |

Classification and checkpoint extraction use Claude Haiku (via `ANTHROPIC_API_KEY`) with silent regex fallback. No configuration needed.

**Next session:** `load_rules` returns everything captured previously — the agent applies your preferences without being told twice.

```bash
# Verify it's working
claude-recall stats
claude-recall search "preference"
```

---

## How It Works

Claude Recall provides four memory tools backed by a local SQLite database with WAL mode, content-hash deduplication, and automatic compaction. The tools are exposed differently depending on the agent:

- **Claude Code** — MCP server with four tools and seven prompts, plus file-system hooks for automatic capture
- **Pi** — native extension with registered tools and event handlers, plus a skill file for behavioral guidance

| Tool | Claude Code | Pi |
| ---- | ----------- | --- |
| Load rules | `mcp__claude-recall__load_rules` | `recall_load_rules` |
| Store memory | `mcp__claude-recall__store_memory` | `recall_store_memory` |
| Search memory | `mcp__claude-recall__search_memory` | `recall_search_memory` |
| Delete memory | `mcp__claude-recall__delete_memory` | `recall_delete_memory` |

### Skills

Claude Recall uses skill files to teach agents when and how to use memory tools.

**Claude Code** uses Anthropic's [Agent Skills](https://agentskills.io/) open standard:

- `.claude/skills/memory-management/SKILL.md` — core skill, guides memory behavior
- `.claude/skills/auto-*/` — auto-generated, crystallized from accumulated memories

See Anthropic's [Agent Skills blog post](https://claude.com/blog/equipping-agents-for-the-real-world-with-agent-skills) for the standard.

**Pi** ships a single `skills/memory-management.md` loaded via Pi's package manifest. No setup needed.

### Outcome-Aware Learning

Claude Recall tracks what happens *after* the agent acts — not just what was said. The pipeline:

```
action → outcome event → episode → candidate lesson → promotion → active rule
                                                                        ↓
                                                            JIT-injected before next action
                                                                        ↓
                                                       PostToolUse resolves outcome per rule
```

- **Outcome events** capture results from all tool types (Bash, Edit, Write, MCP), test outcomes, user corrections, and reask signals
- **Episodes** summarize entire sessions with outcome type, severity, and confidence
- **Candidate lessons** are extracted from failure patterns — deduplicated by Jaccard similarity
- **Promotion engine** graduates lessons into active rules after 2+ observations (or immediately for high-severity failures)
- **Just-in-time rule injection (v0.22.0+)** — active rules are surfaced as a `<system-reminder>` block adjacent to each tool call (Claude Code) or each agent turn (Pi). Each injection is recorded in `rule_injection_events` and resolved with the tool's success/failure outcome by the PostToolUse hook. **This is the meter that measures rule effectiveness in practice.** It replaces the older citation-detection regex (which empirically returned 0 citations across thousands of opportunities — agents don't reliably write `(applied from memory: …)` markers, so the meter never had data to work with).
- **Per-rule effectiveness data** accumulates over time in `rule_injection_events`. Future releases will use it to deboost rules that are repeatedly injected without correlating to successful tool calls, and to auto-promote rules that are repeatedly injected before failures. As of v0.22.0 the data is being collected; ranking is not yet feeding back from it.

---

## CLI Reference

### Health Check (run these first)

```bash
claude-recall --version              # Confirm installed version
claude-recall status                 # Installation health: hooks, MCP, DB path, project ID
claude-recall stats                  # What's in the DB for this project
claude-recall stats --global         # What's in the DB across ALL projects
```

### Inspecting Memories

```bash
claude-recall search "query"             # Search current project's memories
claude-recall search "query" --global    # Search across all projects
claude-recall search "query" --json      # Machine-readable output
claude-recall search "query" --project <id>  # Search a specific project

claude-recall failures                   # View failure memories (current project)
claude-recall failures --limit 20        # Show more

claude-recall outcomes                   # Outcome-aware learning status
claude-recall outcomes --section lessons # Just candidate lessons
claude-recall outcomes --section stats   # Retrieval/helpfulness stats per memory
claude-recall outcomes --limit 20        # More items per section

claude-recall monitor                    # Memory search monitoring stats
```

### Managing Memories

```bash
claude-recall store "content"                # Store a memory (default type: preference)
claude-recall store "content" -t correction  # Store with specific type
claude-recall export backup.json             # Export all memories to JSON
claude-recall import backup.json             # Import memories from JSON
claude-recall clear --force                  # Delete all memories (irreversible)
```

### Task Checkpoints

Persistent "where I left off" snapshots — one per project, replaces previous on save. Not loaded as a rule; `load_rules` only hints that one exists.

```bash
claude-recall checkpoint save \
  --completed "inference layer, domain layer" \
  --remaining "wire server.js, strip 3GPP URNs" \
  --blockers "none" \
  --notes "see inference/README.md"

claude-recall checkpoint load              # Show the latest checkpoint
claude-recall checkpoint load --json       # Machine-readable
claude-recall checkpoint clear             # Delete the checkpoint
```

Agents can also save/load checkpoints via MCP tools (`mcp__claude-recall__save_checkpoint` / `mcp__claude-recall__load_checkpoint`) or Pi tools (`recall_save_checkpoint` / `recall_load_checkpoint`).

#### Auto-checkpoint on session exit (v0.21.2+)

Manual `checkpoint save` is the explicit path. **Auto-checkpoint** is the safety net: when a session ends, the most recent task is extracted into a checkpoint automatically so the next session can resume.

**When it fires:**

- **Pi** — every `session_shutdown` event. **This is the only way to recover context in Pi: there is no `pi --resume` equivalent.**
- **Claude Code** — voluntary `SessionEnd` reasons (`clear`, `prompt_input_exit`, `logout`). Skips `bypass_permissions_disabled` and `other` (system-driven exits, not user intent). Useful if you exit and start fresh instead of using `claude --resume`.

**Behavior (both runtimes):**

- Uses Haiku to extract `{completed, remaining, blockers}` from the most recent task in the transcript
- **Quality gate**: refuses to save if the LLM detects the task was already complete (e.g., agent said "Done.", user said "thanks"). **Manual checkpoints are never overwritten with garbage** — an empty checkpoint is far better than a fabricated one
- **Tagged**: auto-saved checkpoints include `[auto-saved on <pi|cc> session exit at <iso-timestamp>]` in their notes field
- **Requires `ANTHROPIC_API_KEY`**. Without it, no auto-checkpoint is saved and manual `checkpoint save` still works

**Disable:**

- **Claude Code**: remove the `SessionEnd` block from `.claude/settings.json`
- **Pi**: no per-project disable flag yet — [open an issue](https://github.com/raoulbia-ai/claude-recall/issues) if you need one

### Troubleshooting

```bash
# "Are my hooks installed?"
claude-recall status                     # Shows hook registration status
claude-recall hooks check                # Verify hook files exist and are valid

# "Is the MCP server running?"
claude-recall mcp status                 # Current project's server status
claude-recall mcp ps                     # List all running servers

# "Which project does this directory map to?"
claude-recall project show               # Shows project ID for current directory
claude-recall project list               # All registered projects

# "Why do I see memories from other projects?"
claude-recall search "query"             # Scoped to current project (default)
claude-recall search "query" --global    # Explicitly cross-project

# "How do I check what the DB actually contains?"
sqlite3 ~/.claude-recall/claude-recall.db "SELECT type, COUNT(*) FROM memories GROUP BY type"
sqlite3 ~/.claude-recall/claude-recall.db "SELECT type, COUNT(*) FROM memories WHERE project_id = '<id>' GROUP BY type"

# "Hook logs — what did the hooks actually do?"
tail -20 ~/.claude-recall/hook-logs/tool-outcome-watcher.log
tail -20 ~/.claude-recall/hook-logs/memory-stop.log
tail -20 ~/.claude-recall/hook-logs/correction-detector.log

# "Something is broken, start fresh"
claude-recall repair                     # Clean up old hooks, reinstall skills
claude-recall setup --install            # Reinstall skills + hooks
claude-recall mcp cleanup --all          # Stop all stale MCP servers
```

<details>
<summary>All commands</summary>

```bash
# ── Setup & Diagnostics ─────────────────────────────────────────────
claude-recall setup                      # Show activation instructions
claude-recall setup --install            # Install skills + hooks
claude-recall upgrade                    # One-shot upgrade: global binary + clear stale MCP servers
claude-recall status                     # Installation and system status
claude-recall repair                     # Clean up old hooks, install skills
claude-recall hooks check                # Verify hook files exist and are valid
claude-recall hooks test-enforcement     # Test if search enforcer hook works

# ── Memory ───────────────────────────────────────────────────────────
claude-recall stats                      # Memory statistics (current project)
claude-recall stats --global             # Memory statistics (all projects)
claude-recall search "query"             # Search memories (current project)
claude-recall search "query" --global    # Search memories (all projects)
claude-recall search "query" --json      # Output as JSON
claude-recall search "query" --project <id>  # Search specific project
claude-recall store "content"            # Store memory directly
claude-recall store "content" -t <type>  # Store with type (preference, correction, failure, devops, project-knowledge)
claude-recall export backup.json         # Export memories to JSON
claude-recall import backup.json         # Import memories from JSON
claude-recall clear --force              # Clear all memories
claude-recall failures                   # View failure memories
claude-recall failures --limit 20        # Limit results
claude-recall outcomes                   # Outcome-aware learning status
claude-recall outcomes --section lessons # Just candidate lessons
claude-recall outcomes --section stats   # Retrieval/helpfulness stats
claude-recall outcomes --limit 20        # More items per section
claude-recall monitor                    # Memory search monitoring stats

# ── Rule Hygiene ─────────────────────────────────────────────────────
claude-recall rules demote [--dry-run]              # Demote rules loaded >=N times but never cited
claude-recall rules demote --min-loads 20           # Tune load-count threshold (default 20)
claude-recall rules demote --min-age-days 7         # Minimum age before demotion (default 7)
claude-recall rules promote <id>                    # Restore an auto-demoted or auto-deduped rule
claude-recall rules dedup [--dry-run]               # Collapse near-duplicate rules (Jaccard >= threshold)
claude-recall rules dedup --threshold 0.8           # Stricter similarity (default 0.65)

# ── Cleanup (destructive — always --dry-run first) ─────────────────
claude-recall cleanup test-pollution [--dry-run]    # Delete legacy test-fixture rows

# ── Task Checkpoints ────────────────────────────────────────────────
claude-recall checkpoint save --completed <text> --remaining <text> [--blockers <text>] [--notes <text>] [--project <id>]
claude-recall checkpoint load [--project <id>] [--json]
claude-recall checkpoint clear [--project <id>]

# ── Skills ───────────────────────────────────────────────────────────
claude-recall skills generate            # Generate skills from memories
claude-recall skills generate --dry-run  # Preview without writing
claude-recall skills generate --force    # Regenerate even if unchanged
claude-recall skills list                # List generated skills
claude-recall skills clean --force       # Remove all auto-generated skills

# ── MCP Server ───────────────────────────────────────────────────────
claude-recall mcp status                 # Current project's server status
claude-recall mcp ps                     # List all running servers
claude-recall mcp stop                   # Stop server
claude-recall mcp stop --force           # Force stop
claude-recall mcp restart                # Restart server
claude-recall mcp cleanup                # Remove stale PID files
claude-recall mcp cleanup --all          # Stop all servers

# ── Project ──────────────────────────────────────────────────────────
claude-recall project show               # Current project info
claude-recall project list               # All registered projects
claude-recall project register           # Register current project
claude-recall project unregister [id]    # Unregister a project
claude-recall project clean              # Remove stale registry entries

# ── Database Migration ──────────────────────────────────────────────
claude-recall migrate check              # Check if migration needed
claude-recall migrate schema             # Show current schema version
claude-recall migrate export             # Export pre-migration backup
claude-recall migrate import             # Import from backup
claude-recall migrate complete           # Run pending migrations

# ── Auto-Capture Hooks (run automatically, registered via setup --install) ──
claude-recall hook run correction-detector   # UserPromptSubmit hook
claude-recall hook run memory-stop           # Stop hook
claude-recall hook run precompact-preserve   # PreCompact hook
claude-recall hook run memory-sync           # Stop + PreCompact hook (syncs rules to auto-memory)
```

</details>

---

## Project Scoping

Each project gets isolated memory based on its working directory. **Project ID** is derived from the `cwd` passed by the agent. Universal memories (no project scope) are available everywhere. Switching projects switches memory automatically.

Database location: `~/.claude-recall/claude-recall.db` (shared file, scoped by `project_id` column).

---

## Security & Privacy

- SQLite memory never leaves your machine
- No prompts, code, or memory content is transmitted
- Full transparency via CLI (`stats`, `search`, `export`)
- Never stores secrets (API keys, passwords, tokens)

Details in [docs/security.md](docs/security.md).

---

<details>
<summary>WSL Users</summary>

If you hit "invalid ELF header" errors from mixed Windows/WSL `node_modules`, ensure you're using the global install (now the default). Verify the binary resolves to a Linux path:

```bash
which claude-recall
# Should show: /home/<user>/.nvm/.../bin/claude-recall (NOT a Windows path)
```

Global installation does **not** affect project scoping — project ID is still detected from Claude Code's working directory.

</details>

---

## Environment Variables

Runtime behavior can be tuned via environment variables. Defaults are chosen so out-of-the-box behavior stays close to historical output; opt in as needed.

| Variable                                 | Default | Effect                                                                                                   |
| ---------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------- |
| `CLAUDE_RECALL_DB_PATH`                  | `~/.claude-recall/` | Database directory.                                                                          |
| `ANTHROPIC_API_KEY`                      | _(unset)_ | Enables LLM-based classification (Haiku). Falls back to regex silently when missing.                   |
| `CLAUDE_RECALL_LOAD_BUDGET_TOKENS`       | `2000`  | Token budget for the `load_rules` payload. Rules are emitted in priority order (corrections → preferences by citation → devops by citation → failures) and dropped rules surface via `search_memory`. |
| `CLAUDE_RECALL_AUTO_DEMOTE`              | `false` | When `true`, auto-demote rules on MCP boot where `load_count >= CLAUDE_RECALL_DEMOTE_MIN_LOADS`, `cite_count = 0`, and age `> CLAUDE_RECALL_DEMOTE_MIN_AGE_DAYS`. Still reversible via `rules promote <id>`. |
| `CLAUDE_RECALL_DEMOTE_MIN_LOADS`         | `20`    | Minimum load count before a rule qualifies for auto-demotion.                                            |
| `CLAUDE_RECALL_DEMOTE_MIN_AGE_DAYS`      | `7`     | Minimum rule age before auto-demotion can fire (avoids demoting brand-new rules).                        |
| `CLAUDE_RECALL_AUTO_CLEANUP`             | `false` | Auto-kill stale MCP processes on start (otherwise reports and exits).                                    |
| `CLAUDE_RECALL_COMPACT_THRESHOLD`        | `10MB`  | DB size at which automatic compaction kicks in.                                                          |
| `CLAUDE_RECALL_MAX_MEMORIES`             | `10000` | Memory-row soft cap.                                                                                     |
| `CLAUDE_RECALL_ENFORCE_MODE`             | `on`    | Set to `off` to bypass the search-enforcer hook.                                                         |

---

## Development & Contributions

PRs welcome — Claude Recall is open to contributors.

```bash
npm run build          # Compile TypeScript
npm test               # Run all tests
npm run test:watch     # Watch mode
npm run mcp:dev        # Start MCP server in dev mode
```

---

## Acknowledgments

The outcome-aware learning pipeline (v0.18.0) was inspired by [OpenClaw-RL](https://github.com/Gen-Verse/OpenClaw-RL) from Gen-Verse. Their core ideas — treating the next state as a first-class learning signal, separating evaluative and directive feedback, and promoting only durable lessons — shaped Claude Recall's episode tracking, candidate lesson extraction, and promotion engine. Claude Recall adapts these concepts for a closed-model runtime using memory promotion rather than gradient updates.

---

## License

MIT.

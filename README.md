# Claude Recall

### Persistent, local memory for Claude Code — powered by native Claude Skills.

Claude Recall is a **local memory engine + MCP server** that gives Claude Code something it's missing by default:
**the ability to learn from you over time.**

Your preferences, project structure, workflows, corrections, and coding style are captured automatically and applied in future sessions — **securely stored on your machine**.

---

## Features

- **Smart Memory Capture** — LLM-powered classification (via Claude Haiku) detects preferences and corrections from natural language, with silent regex fallback
- **Project-Scoped Knowledge** — each project gets its own memory namespace; switch projects and Claude switches context automatically
- **Failure Learning** — captures what failed, why, and what to do instead — so Claude doesn't repeat mistakes
- **Outcome-Aware Learning** — tracks action outcomes (bash results, test cycles, user corrections), synthesizes candidate lessons, and promotes validated patterns into active rules automatically
- **Skill Crystallization** — when enough memories accumulate, auto-generates `.claude/skills/auto-*/` files that load natively without tool calls
- **Local-Only** — SQLite on your machine, no telemetry, no cloud, works fully offline

---

## Quick Start

### Requirements

| Component | Version                 | Notes                       |
| --------- | ----------------------- | --------------------------- |
| Node.js   | **20+**                 | required for better-sqlite3 |
| OS        | macOS / Linux / Windows | WSL supported               |

### Install / Reinstall

Run these from your project directory:

```bash
# 1. Remove MCP server registration (if exists)
claude mcp remove claude-recall

# 2. Clear npm cache
npm cache clean --force

# 3. Uninstall global claude-recall
npm uninstall -g claude-recall

# 4. Install global claude-recall
npm install -g claude-recall

# 5. Install in local project folder
claude-recall setup --install

# 6. Re-register MCP server
claude mcp add claude-recall -- claude-recall mcp start
```

Then restart your Claude Code session.

### Adding to another project

From the new project directory, only steps 5-6 are needed:

```bash
claude-recall setup --install
claude mcp add claude-recall -- claude-recall mcp start
```

Memories are automatically scoped per project in a shared database (`~/.claude-recall/claude-recall.db`).

### Verify

In Claude Code, ask: *"Load my rules"*

Claude should call `mcp__claude-recall__load_rules`. If it works, you're ready.

### Upgrading

When a new version is published, update the global binary — no per-project reinstall needed:

```bash
npm cache clean --force
npm uninstall -g claude-recall
npm install -g claude-recall
```

Then restart Claude Code sessions in each project to pick up the new version.

---

## What to Expect

Once installed, Claude Recall works automatically in the background:

1. **First prompt** — the `search_enforcer` hook ensures Claude loads your stored rules before taking any action
2. **As you work** — the `correction-detector` hook classifies every prompt you type. Natural statements like *"we use tabs here"* or *"no, put tests in `__tests__/`"* are detected and stored automatically
3. **End of turn** — the `memory-stop` hook scans recent transcript entries for corrections, preferences, failures, and devops patterns. It also creates **episodes** summarizing the session outcome, generates **candidate lessons** from detected failures, and runs a **promotion cycle** to graduate validated patterns into active rules
4. **Bash failures** — the `bash-failure-watcher` hook captures command failures in real-time, pairs successful fixes, and writes **outcome events** for the learning pipeline
5. **Reask detection** — the `correction-detector` hook detects user frustration signals ("still broken", "that didn't work") and records them as outcome events
6. **Before context compression** — the `precompact-preserve` hook sweeps up to 50 entries so nothing important is lost when the context window shrinks
7. **Rules sync to auto-memory** — the `memory-sync` hook exports active rules to `~/.claude/projects/{project}/memory/recall-rules.md` so they're available even when the MCP server is down

All classification uses Claude Haiku (via `ANTHROPIC_API_KEY` from your Claude Code session) with silent regex fallback. No configuration needed.

**Next session:** `load_rules` returns everything captured previously — Claude applies your preferences without being told twice.

```bash
# Verify it's working
cat ~/.claude-recall/hook-logs/correction-detector.log
claude-recall stats
claude-recall search "preference"
```

---

## How It Works

Claude Recall runs as an MCP server exposing four tools, backed by a local SQLite database with WAL mode, content-hash deduplication, and automatic compaction. A native Claude Skill (`.claude/skills/memory-management/SKILL.md`) teaches Claude when to load, store, and search memories.

| Tool | Purpose |
| ---- | ------- |
| `load_rules` | Load all active rules (preferences, corrections, failures, devops) at the start of a task |
| `store_memory` | Save new knowledge — preferences, corrections, devops rules, failures |
| `search_memory` | Search memories by keyword, ranked by relevance |
| `delete_memory` | Delete a specific memory by ID |

### Outcome-Aware Learning (v0.18.0)

Claude Recall tracks what happens *after* Claude acts — not just what was said. The outcome processing pipeline:

```
action → outcome event → episode → candidate lesson → promotion → active rule
```

- **Outcome events** capture bash results, test outcomes, user corrections, and reask signals
- **Episodes** summarize entire sessions with outcome type, severity, and confidence
- **Candidate lessons** are extracted from failure patterns — deduplicated by Jaccard similarity
- **Promotion engine** graduates lessons into active rules after 2+ observations (or immediately for high-severity failures), and demotes never-helpful memories
- **Outcome-aware retrieval** boosts memories with evidence, penalizes stale/unhelpful ones

---

## CLI Reference

### Common Commands

```bash
claude-recall stats                  # Memory statistics
claude-recall search "query"         # Search memories
claude-recall failures               # View failure memories
claude-recall outcomes               # Outcome-aware learning status
claude-recall outcomes --section lessons  # Just candidate lessons
claude-recall export backup.json     # Export memories to JSON
claude-recall import backup.json     # Import memories from JSON
claude-recall --version              # Check version
```

<details>
<summary>All commands</summary>

```bash
# ── Setup & Diagnostics ─────────────────────────────────────────────
claude-recall setup                      # Show activation instructions
claude-recall setup --install            # Install skills + hooks
claude-recall status                     # Installation and system status
claude-recall repair                     # Clean up old hooks, install skills

# ── Memory ───────────────────────────────────────────────────────────
claude-recall stats                      # Memory statistics
claude-recall search "query"             # Search memories
claude-recall store "content"            # Store memory directly
claude-recall export backup.json         # Export memories to JSON
claude-recall import backup.json         # Import memories from JSON
claude-recall clear --force              # Clear all memories
claude-recall failures                   # View failure memories
claude-recall failures --limit 20        # Limit results
claude-recall outcomes                   # Outcome-aware learning status
claude-recall outcomes --section lessons # Just candidate lessons
claude-recall outcomes --limit 20        # More items per section
claude-recall monitor                    # Memory search monitoring stats

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
claude-recall project clean              # Remove stale registry entries

# ── Auto-Capture Hooks (run automatically, registered via setup --install) ──
claude-recall hook run correction-detector   # UserPromptSubmit hook
claude-recall hook run memory-stop           # Stop hook
claude-recall hook run precompact-preserve   # PreCompact hook
claude-recall hook run memory-sync           # Stop + PreCompact hook (syncs rules to auto-memory)
```

</details>

---

## Project Scoping

Each project gets isolated memory based on its working directory. **Project ID** is derived from the `cwd` that Claude Code passes to the MCP server. Universal memories (no project scope) are available everywhere. Switching projects switches memory automatically.

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

## Development & Contributions

PRs welcome — Claude Recall is open to contributors.

```bash
npm run build          # Compile TypeScript
npm test               # Run all tests
npm run test:watch     # Watch mode
npm run mcp:dev        # Start MCP server in dev mode
```

---

## License

MIT.

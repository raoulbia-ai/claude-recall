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
- **Skill Crystallization** — when enough memories accumulate, auto-generates `.claude/skills/auto-*/` files that load natively without tool calls
- **Local-Only** — SQLite on your machine, no telemetry, no cloud, works fully offline

---

## Quick Start

### Requirements

| Component | Version                 | Notes                       |
| --------- | ----------------------- | --------------------------- |
| Node.js   | **20+**                 | required for better-sqlite3 |
| OS        | macOS / Linux / Windows | WSL supported               |

### Install & Activate

```bash
npm install -g claude-recall
claude mcp remove claude-recall 2>/dev/null; claude mcp add claude-recall -s user -- claude-recall mcp start
cd your-project && claude-recall setup --install
claude-recall --version
```

Then restart your terminal or Claude Code session.

### Verify

In Claude Code, ask: *"Load my rules"*

Claude should call `mcp__claude-recall__load_rules`. If it works, you're ready.

---

## What to Expect

Once installed, Claude Recall works automatically in the background:

1. **First prompt** — the `search_enforcer` hook ensures Claude loads your stored rules before taking any action
2. **As you work** — the `correction-detector` hook classifies every prompt you type. Natural statements like *"we use tabs here"* or *"no, put tests in `__tests__/`"* are detected and stored automatically
3. **End of turn** — the `memory-stop` hook scans recent transcript entries for corrections, preferences, failures, and devops patterns
4. **Before context compression** — the `precompact-preserve` hook sweeps up to 50 entries so nothing important is lost when the context window shrinks

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

---

## CLI Reference

### Common Commands

```bash
claude-recall stats                  # Memory statistics
claude-recall search "query"         # Search memories
claude-recall failures               # View failure memories
claude-recall export backup.json     # Export memories to JSON
claude-recall import backup.json     # Import memories from JSON
claude-recall --version              # Check version
```

<details>
<summary>All commands</summary>

```bash
# ── Upgrade ──────────────────────────────────────────────────────────
npm install -g claude-recall@latest
claude-recall setup --install            # Re-register hooks + skills
claude-recall --version                  # Verify

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

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
cd your-project
npm cache clean --force && npm install claude-recall@latest
claude mcp remove claude-recall 2>/dev/null; claude mcp add claude-recall -- npx -y claude-recall@latest mcp start
npx claude-recall setup --install
npx claude-recall --version
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
npx claude-recall stats
npx claude-recall search "preference"
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
npx claude-recall stats                  # Memory statistics
npx claude-recall search "query"         # Search memories
npx claude-recall failures               # View failure memories
npx claude-recall export backup.json     # Export memories to JSON
npx claude-recall import backup.json     # Import memories from JSON
npx claude-recall --version              # Check version
```

<details>
<summary>All commands</summary>

```bash
# ── Upgrade ──────────────────────────────────────────────────────────
npm cache clean --force && npm install claude-recall@latest
npx claude-recall setup --install        # Re-register hooks + skills
npx claude-recall --version              # Verify

# ── Setup & Diagnostics ─────────────────────────────────────────────
npx claude-recall setup                  # Show activation instructions
npx claude-recall setup --install        # Install skills + hooks
npx claude-recall status                 # Installation and system status
npx claude-recall repair                 # Clean up old hooks, install skills

# ── Memory ───────────────────────────────────────────────────────────
npx claude-recall stats                  # Memory statistics
npx claude-recall search "query"         # Search memories
npx claude-recall store "content"        # Store memory directly
npx claude-recall export backup.json     # Export memories to JSON
npx claude-recall import backup.json     # Import memories from JSON
npx claude-recall clear --force          # Clear all memories
npx claude-recall failures               # View failure memories
npx claude-recall failures --limit 20    # Limit results
npx claude-recall monitor                # Memory search monitoring stats

# ── Skills ───────────────────────────────────────────────────────────
npx claude-recall skills generate        # Generate skills from memories
npx claude-recall skills generate --dry-run  # Preview without writing
npx claude-recall skills generate --force    # Regenerate even if unchanged
npx claude-recall skills list            # List generated skills
npx claude-recall skills clean --force   # Remove all auto-generated skills

# ── MCP Server ───────────────────────────────────────────────────────
npx claude-recall mcp status             # Current project's server status
npx claude-recall mcp ps                 # List all running servers
npx claude-recall mcp stop               # Stop server
npx claude-recall mcp stop --force       # Force stop
npx claude-recall mcp restart            # Restart server
npx claude-recall mcp cleanup            # Remove stale PID files
npx claude-recall mcp cleanup --all      # Stop all servers

# ── Project ──────────────────────────────────────────────────────────
npx claude-recall project show           # Current project info
npx claude-recall project list           # All registered projects
npx claude-recall project register       # Register current project
npx claude-recall project clean          # Remove stale registry entries

# ── Auto-Capture Hooks (run automatically, registered via setup --install) ──
npx claude-recall hook run correction-detector   # UserPromptSubmit hook
npx claude-recall hook run memory-stop           # Stop hook
npx claude-recall hook run precompact-preserve   # PreCompact hook
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

If you hit "invalid ELF header" errors from mixed Windows/WSL `node_modules`, use a global install:

```bash
npm install -g claude-recall
```

Update `~/.claude.json` to use the global binary:

```json
{
  "claude-recall": {
    "type": "stdio",
    "command": "claude-recall",
    "args": ["mcp", "start"],
    "env": {}
  }
}
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

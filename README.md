# Claude Recall

### Persistent, local memory for Claude Code — powered by native Claude Skills.

Claude Recall is a **local memory engine + MCP server** that gives Claude Code something it's missing by default:
**the ability to learn from you over time.**

Your preferences, project structure, workflows, corrections, and coding style are captured automatically and applied in future sessions — **securely stored on your machine**.

> **TL;DR**
> Claude Recall stores and searches your past preferences and project knowledge.
> Install it → restart Claude Code → Claude knows when to search memory via native Skills integration.

---

## Features

- **Smart Memory Capture** — LLM-powered classification (via Claude Haiku) detects preferences and corrections from natural language, with regex fallback when API is unavailable
- **Continuous Learning** — captures coding patterns, tool preferences, corrections, architectural decisions, and workflow habits in local SQLite
- **Native Claude Skills** — Claude decides when to search/store based on built-in skill guidance
- **User-Confirmed Storage** — Claude asks for your permission before storing via MCP tools; hooks auto-capture only high-confidence patterns
- **Project-Scoped Knowledge** — each project gets its own memory namespace; switch projects and Claude switches memory
- **Failure Learning** — captures failures with counterfactual reasoning (what failed, why, what to do instead)
- **Skill Crystallization** — automatically generates `.claude/skills/auto-*/` files when enough memories accumulate, so learned patterns load natively without tool calls
- **Zero Cloud Storage** — all memory stored locally, no telemetry, works fully offline
- **Process Management** — automatic server lifecycle management with stale process cleanup

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
npm install claude-recall
claude mcp remove claude-recall 2>/dev/null; claude mcp add claude-recall -- npx -y claude-recall@latest mcp start
npx claude-recall setup --install
npx claude-recall --version
```

Then restart your terminal or Claude Code session.

### Verify

In Claude Code, ask: *"Load my rules"*

Claude should call `mcp__claude-recall__load_rules`. If it works, you're ready.

### Upgrade

```bash
npm uninstall claude-recall && npm install claude-recall
```

---

## How It Works

Claude Recall has three layers:

### 1. Local Memory Engine (SQLite)

Stores and evolves preferences, patterns, decisions, corrections, and failure learnings. Uses WAL mode for concurrency, content-hash deduplication, and automatic compaction.

### 2. MCP Server (4 tools)

Exposes four tools to Claude Code:

| Tool | Purpose |
| ---- | ------- |
| `load_rules` | Load all active rules (preferences, corrections, failures, devops) at the start of a task |
| `store_memory` | Save new knowledge — preferences, corrections, devops rules, failures |
| `search_memory` | Search memories by keyword, ranked by relevance |
| `delete_memory` | Delete a specific memory by ID (use `search_memory` first to find the ID) |

### 3. Native Claude Skill

Installed automatically to `.claude/skills/memory-management/SKILL.md`. Teaches Claude:
- Load rules before writing/editing code
- Apply learned conventions and avoid past mistakes
- **Ask the user for confirmation before storing any memory**
- Capture corrections when users fix mistakes
- Store learning cycles (fail → fix → success)

---

## CLI Reference

```bash
# ── Upgrade ──────────────────────────────────────────────────────────
npm install claude-recall@latest         # Install latest (overwrites old)
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

# ── Auto-Capture Hooks (registered via setup --install, run automatically) ──
npx claude-recall hook run correction-detector   # UserPromptSubmit hook
npx claude-recall hook run memory-stop           # Stop hook
npx claude-recall hook run precompact-preserve   # PreCompact hook
```

---

## How Project Scoping Works

Each project gets isolated memory based on its working directory:

- **Project ID** is derived from the `cwd` that Claude Code passes to the MCP server
- **Universal memories** (no project scope) are available everywhere
- **Project memories** are only returned when working in that project
- Switching projects switches memory automatically — no configuration needed

Database location: `~/.claude-recall/claude-recall.db` (shared file, scoped by `project_id` column).

---

## WSL Users

If you hit "invalid ELF header" errors from mixed Windows/WSL `node_modules`, use a global install:

```bash
# From WSL:
npm install -g claude-recall

# Update ~/.claude.json to use the global binary:
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

---

## Security & Privacy

- SQLite memory never leaves your machine
- No external services required
- No prompts, code, or memory content is transmitted
- Full transparency via CLI (`stats`, `search`, `export`)
- Never stores secrets (API keys, passwords, tokens)

Details in [docs/security.md](docs/security.md).

---

## Documentation

All docs in [`/docs`](docs/):

- [Installation](docs/installation.md)
- [Quickstart](docs/quickstart.md)
- [CLI Reference](docs/cli.md)
- [Memory Types](docs/memory-types.md)
- [Learning Loop](docs/learning-loop.md)
- [Project Scoping](docs/project-scoping.md)
- [Content Hashing](docs/content-hashing.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Security](docs/security.md)
- [FAQ](docs/faq.md)

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

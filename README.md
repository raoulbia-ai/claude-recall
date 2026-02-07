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

- **Continuous Learning** — captures coding patterns, tool preferences, corrections, architectural decisions, and workflow habits in local SQLite
- **Native Claude Skills** — no hooks required; Claude decides when to search/store based on built-in skill guidance
- **Project-Scoped Knowledge** — each project gets its own memory namespace; switch projects and Claude switches memory
- **Failure Learning** — captures failures with counterfactual reasoning (what failed, why, what to do instead)
- **Memory Evolution** — tracks agent progression over time across sophistication levels (L1–L4)
- **Zero Cloud Storage** — all memory stored locally, no telemetry, works fully offline
- **Process Management** — automatic server lifecycle management with stale process cleanup

---

## Quick Start

### Requirements

| Component | Version                 | Notes                       |
| --------- | ----------------------- | --------------------------- |
| Node.js   | **20+**                 | required for better-sqlite3 |
| OS        | macOS / Linux / Windows | WSL supported               |

### Install

```bash
cd your-project
npm install claude-recall

# Check installed version:
npx claude-recall --version

# Show activation instructions:
npx claude-recall setup
```

### Activate

Register MCP server with Claude Code:

```bash
claude mcp add claude-recall -- npx -y claude-recall@latest mcp start
```

Then restart your terminal or Claude Code session.

Already registered? Remove first:

```bash
claude mcp remove claude-recall
```

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

### 2. MCP Server (2 tools)

Exposes two tools to Claude Code:

| Tool | Purpose |
| ---- | ------- |
| `load_rules` | Load all active rules (preferences, corrections, failures, devops) at the start of a task |
| `store_memory` | Save new knowledge — preferences, corrections, devops rules, failures |

### 3. Native Claude Skill

Installed automatically to `.claude/skills/memory-management/SKILL.md`. Teaches Claude:
- Load rules before writing/editing code
- Apply learned conventions and avoid past mistakes
- Capture corrections when users fix mistakes
- Store learning cycles (fail → fix → success)

---

## CLI Reference

### Core Commands

```bash
npx claude-recall stats                  # Memory statistics
npx claude-recall search "query"         # Search memories
npx claude-recall store "content"        # Store memory directly
npx claude-recall export backup.json     # Export memories to JSON
npx claude-recall import backup.json     # Import memories from JSON
npx claude-recall clear --force          # Clear all memories
```

### Analysis

```bash
npx claude-recall evolution              # Memory evolution metrics (L1-L4)
npx claude-recall evolution --days 60    # Custom time window
npx claude-recall failures               # View failure memories
npx claude-recall failures --limit 20    # Limit results
npx claude-recall monitor                # Memory search monitoring stats
```

### MCP Server Management

```bash
npx claude-recall mcp status             # Current project's server status
npx claude-recall mcp ps                 # List all running servers
npx claude-recall mcp stop               # Stop server
npx claude-recall mcp stop --force       # Force stop
npx claude-recall mcp restart            # Restart server
npx claude-recall mcp cleanup            # Remove stale PID files
npx claude-recall mcp cleanup --all      # Stop all servers
```

### Project Management

```bash
npx claude-recall project show           # Current project info
npx claude-recall project list           # All registered projects
npx claude-recall project register       # Register current project
npx claude-recall project clean          # Remove stale registry entries
```

### Setup & Diagnostics

```bash
npx claude-recall setup                  # Show activation instructions
npx claude-recall status                 # Installation and system status
npx claude-recall repair                 # Clean up old hooks, install skills
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

# Claude Recall

### Persistent, local memory for Claude Code — powered by native Claude Skills.

Claude Recall is a **local memory engine + MCP server** that gives Claude Code something it's missing by default:
**the ability to learn from you over time.**

Your preferences, project structure, workflows, corrections, and coding style are captured automatically and applied in future sessions — **securely stored on your machine**.

> **TL;DR**
> Claude Recall stores and searches your past preferences and project knowledge.
> Install it → restart Claude Code → Claude knows when to search memory via native Skills integration.

---

## 🚀 Features

### 🌱 Continuous Learning (Local SQLite)

Claude learns your:

* coding patterns
* tool preferences
* corrections
* architectural decisions
* workflow habits

Everything stays **local**.

---

## 🎯 Native Claude Skills Integration

Claude Recall uses Claude Code's native Skills system for seamless memory guidance.

### How it works

* **No hooks required** — Skills are built into Claude Code
* **Non-blocking** — Claude decides when to search/store based on skill guidance
* **Self-directed** — Claude understands when memory is relevant to the task
* **Zero latency** — No external processes or enforcement overhead

### What the Skill teaches Claude

* Search memory before writing/editing code
* Apply learned conventions and avoid past mistakes
* Capture corrections when users fix mistakes
* Store learning cycles (fail → fix → success)

The skill is automatically installed to `.claude/skills/memory-management/SKILL.md` on package install.

---

## 📂 Project-Scoped Knowledge

Each project gets its own memory namespace:

* architecture
* tech stack
* conventions
* past decisions
* known pitfalls
* previous fixes
* preferences unique to that codebase

Switch projects → Claude switches memory.

---

## 🔌 Zero Cloud Storage

* All memory stored locally in SQLite
* No cloud sync
* No telemetry
* Entire system works offline

---

## 💻 Claude Code–Native Integration

Claude Recall integrates via:

* **MCP server** — search, store, retrieve memories
* **Native Skills** — guides Claude on when to use memory tools
* **Automatic capture** — extracts preferences from conversations

Claude knows to search memory before significant actions, with no enforcement overhead.

---

## ⚡ Quick Start

### Requirements

| Component | Version                 | Notes                       |
| --------- | ----------------------- | --------------------------- |
| Node.js   | **20+**                 | required for better-sqlite3 |
| OS        | macOS / Linux / Windows | WSL supported               |

---

### Install (per project)

```bash
cd your-project
npm install claude-recall

# Check installed version:
npx claude-recall --version

# Show activation instructions:
npx claude-recall setup
```

### Upgrade

```bash
npm uninstall claude-recall && npm install claude-recall
```

---

### Activate

Register MCP server:

```bash
claude mcp add claude-recall -- npx -y claude-recall@latest mcp start
```

Then restart your terminal or Claude Code session.

Already registered? Remove first:

```bash
claude mcp remove claude-recall
```

---

### Verify

In Claude Code, ask: *"Search my memories"*

Claude should call `mcp__claude-recall__search`. If it works → you're ready.

---

## 🧠 How It Works (High-Level)

Claude Recall consists of:

### 1. Local Memory Engine (SQLite)

Stores and evolves preferences, patterns, decisions, corrections.

### 2. MCP Server

Exposes memory tools to Claude Code:
- `mcp__claude-recall__search` — find relevant memories
- `mcp__claude-recall__store_memory` — save new knowledge
- `mcp__claude-recall__retrieve_memory` — get specific memories

### 3. Native Claude Skill

Teaches Claude when and how to use memory:
- Search before writing/editing code
- Store corrections and learning cycles
- Apply preferences and patterns

---

## 🔐 Security & Privacy

Claude Recall is built for local-first workflows:

* SQLite memory never leaves your machine
* No external services required
* No prompts, code, or memory content is transmitted
* Full transparency via CLI (`list`, `inspect`, `export`)

Full details in `/docs/security.md`.

---

## 📚 Full Documentation

All docs in `/docs`:

* Installation
* Quickstart
* Architecture
* Learning Loop
* Memory Types
* CLI Reference
* Skills Integration
* Project Scoping
* Troubleshooting
* Security
* FAQ

---

## 🛠 Development & Contributions

PRs welcome — Claude Recall is open to contributors.

---

## 📝 License

MIT.

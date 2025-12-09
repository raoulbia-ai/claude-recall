# Claude Recall

### Persistent, local memory for Claude Code — powered by realtime event orchestration.

Claude Recall is a **local memory engine + MCP server** that gives Claude Code something it's missing by default:
**the ability to learn from you over time.**

Your preferences, project structure, workflows, corrections, and coding style are captured automatically and applied in future sessions — **securely stored on your machine**.

> **TL;DR**
> Claude Recall stores and searches your past preferences and project knowledge.
> Install it → restart Claude Code → Claude is reminded to search memory on every turn.

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

## ⚡ Realtime Memory Intelligence (PubNub Event Bus)

Claude Recall uses a lightweight, metadata-only PubNub layer to provide **instant, asynchronous memory intelligence**.

### What PubNub enables

* **Hooks become <10ms**
  Instead of slow, blocking MCP or CLI calls (50–500ms), hooks now publish a tiny packet and return instantly.

* **The Memory Agent works in the background**
  The Agent subscribes to PubNub channels, processes events in real time, updates memory, and sends suggestions back to Claude without slowing anything down.

* **Claude stays fast and responsive**
  Even under heavy editing or repeated tool runs.

### Why only Write/Edit, not Search?

* **Write/Edit (capture)** → async via PubNub
  Hooks fire metadata and return instantly. Memory Agent processes in background. Non-blocking.

* **Search (retrieval)** → sync via MCP
  Claude needs results immediately to inform its response. Must be synchronous. No benefit to PubNub here.

The pattern: **capture async, retrieve sync**.

### What PubNub actually carries (metadata-only)

* tool name
* file path
* event type
* prompt token counts (no text)
* memory suggestion IDs
* Agent heartbeat

### What PubNub does *not* carry

🚫 code
🚫 conversation text
🚫 file contents
🚫 memory content
🚫 embeddings
🚫 prompts
🚫 anything sensitive

PubNub is **not** storage — it is a realtime coordination channel.

---

## 💬 Why use PubNub at all?

Developers often ask this. Here's the clear answer:

### ✔ **Persistent memory doesn't require PubNub**

The core idea (Claude remembering preferences and project knowledge) could be implemented with:

* direct MCP calls
* local HTTP server
* sockets / pipes
* a local queue
* synchronous CLI calls

### ✔ **But PubNub gives a dramatically better UX**

Without PubNub:

* hooks block while waiting for the Memory Agent to finish
* every file write/edit stalls Claude
* the editor feels sluggish
* memory suggestions arrive too late to help
* cross-platform performance varies wildly

With PubNub:

* hooks return in **6–10ms**
* memory is processed asynchronously
* Claude gets suggestions in real time
* no need to bundle/maintain a local broker
* works the same on macOS, Windows, Linux, WSL

### ✔ **Local-first design is preserved**

PubNub only transmits metadata — no user content ever leaves your machine.

### ✔ **Implementation detail, not a hard dependency**

In the future the event bus can be swapped (local-only transport, WebSockets, NATS, etc.).
PubNub is simply the fastest path to a great developer experience today.

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
* PubNub carries **ephemeral metadata only**
* Entire system works offline (except realtime coordination)

---

## 💻 Claude Code–Native Integration

Claude Recall integrates tightly via:

* MCP server (search, store, evolve)
* UserPromptSubmit hooks (reminder on every turn)
* PreToolUse hooks (enforce search before Write/Edit)
* PubNub event subscriber (Memory Agent)

Claude sees a memory search reminder on every conversation turn, with suggested keywords extracted from your prompt.

---

## ⚡ Quick Start

### Requirements

| Component | Version                 | Notes                          |
| --------- | ----------------------- | ------------------------------ |
| Node.js   | **20+**                 | required for better-sqlite3    |
| Python    | **3.x**                 | required for Claude Code hooks |
| PubNub    | included via npm        | metadata only                  |
| OS        | macOS / Linux / Windows | WSL supported                  |

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
npm install claude-recall@latest
npx claude-recall repair
```

This updates the package and repairs hooks/skills to the latest version.

---

### Activate

```bash
# Register MCP server:
claude mcp add claude-recall -- npx -y claude-recall@latest mcp start

# Restart your terminal or Claude Code session
```

Already registered? Remove first: `claude mcp remove claude-recall`

---

### Automatic Capture (Optional)

For automatic preference/pattern capture from conversations, start the Memory Agent:

```bash
npx claude-recall agent start
```

The Memory Agent:
- Listens to conversation events via PubNub
- Extracts preferences ("I prefer TypeScript", "always use Jest")
- Stores learnings automatically

Without the agent, you can still manually store memories via MCP tools.

---

### Verify

In Claude Code, ask: *"Search my memories"*

Claude should call `mcp__claude-recall__search`. If it works → you're ready.

---

## 🧠 How It Works (High-Level)

Claude Recall consists of:

### 1. Local Memory Engine (SQLite)

Stores and evolves preferences, patterns, decisions, corrections.

### 2. Realtime Event Bus (PubNub)

Makes hooks fast and enables the Memory Agent to work asynchronously.

### 3. Memory Agent

Subscribes to PubNub, updates memory, sends suggestions to Claude.

### 4. Claude Code Hooks

Inject memory pre-action, perform structured planning, capture post-action learnings.

---

## 🔐 Security & Privacy

Claude Recall is built for local-first workflows:

* SQLite memory never leaves your machine
* PubNub sends metadata only
* No storage of PubNub messages
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
* Hooks
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

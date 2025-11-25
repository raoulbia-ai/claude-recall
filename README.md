# Claude Recall

### Persistent, local memory for Claude Code — powered by realtime event orchestration.

Claude Recall is a **local memory engine + MCP server** that gives Claude Code something it's missing by default:
**the ability to learn from you over time.**

Your preferences, project structure, workflows, corrections, and coding style are captured automatically and applied in future sessions — **securely stored on your machine**.

> **TL;DR**
> Claude Recall stores and searches your past preferences and project knowledge.
> Install it → restart Claude Code → Claude automatically uses memory before writing or editing files.

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
* pre-action hooks
* planning hooks
* post-action hooks
* PubNub event subscriber (Memory Agent)

Claude automatically searches memory before writing or editing files.

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
```

Restart **Claude Code**.

---

### Verify it's working

In Claude Code:

> "Search my memories."

Claude should call:

```
mcp__claude-recall__search
```

If results appear → You're ready.

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

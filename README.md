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

### **🌱 Continuous Learning (Local SQLite)**

* Learns your coding patterns, tool preferences, and corrections
* Stores and evolves them in a local SQLite database
* Claud Code automatically searches memory before performing actions

### **⚡ Realtime Memory Intelligence (PubNub Event Bus)**

Claude Recall uses a lightweight, metadata-only PubNub layer to enable **instant, asynchronous memory processing**:

* Hooks publish tool events and prompt metadata to PubNub channels
* Memory Agent subscribes in real time
* Processes events without blocking Claude
* Suggests relevant memories back to Claude Code

This gives hooks **sub-10ms execution**, compared to 50–500ms with synchronous CLI pipelines.

> **No user text, code, or memory content is ever sent over PubNub.**
> Only small metadata packets — tool names, file paths, event types, heartbeat signals.

### **📂 Project-Scoped Knowledge**

Each project gets its own memory context:

* architecture
* conventions
* decisions
* constraints
* mistakes + corrections
* coding preferences
* tech stack

Switch projects → Claude switches memory.

### **🔌 Zero Cloud Storage**

* All memory stays local
* SQLite database in `~/.claude-recall/`
* No telemetry
* No remote sync
* PubNub carries **ephemeral metadata only**

### **💻 Claude Code–Native Integration**

* MCP server automatically detected
* Realtime memory suggestions
* High-quality planning via Python hooks
* Automatic search-before-edit behavior

---

## ⚡ Quick Start

### **Requirements**

| Component | Version                 | Notes                                 |
| --------- | ----------------------- | ------------------------------------- |
| Node.js   | **20+**                 | required for better-sqlite3           |
| Python    | **3.x**                 | required for Claude Code hook scripts |
| PubNub    | included via npm        | metadata-only usage                   |
| OS        | macOS / Linux / Windows | WSL supported                         |

---

### **Install (recommended: per project)**

```bash
cd your-project
npm install claude-recall
```

Restart **Claude Code**.

---

### **Verify it's working**

In Claude Code:

> "Search my memories for preferences."

Claude should call:

```
mcp__claude-recall__search
```

If results appear → Claude Recall is active.

---

## 🧠 How It Works

Claude Recall consists of **three integrated systems**:

---

### **1. The Memory Engine (SQLite, local)**

Stores:

* preferences
* project knowledge
* coding style
* corrections
* workflow patterns
* successes & failures

Memory is structured, versioned, and evolves over time.

---

### **2. The Realtime Event Bus (PubNub)**

A lightweight, metadata-only communication layer enabling **non-blocking hooks** and **fast memory updates**.

**Why PubNub?**

* Hooks complete in <10ms
* Memory Agent processes events asynchronously
* Claude stays fast and responsive
* Zero waiting on the MCP server
* No user data transmitted

**Channels used:**

| Channel                 | Purpose                  | Payload (metadata only) |
| ----------------------- | ------------------------ | ----------------------- |
| `claude-tool-events`    | tool invocation metadata | tool name, file path    |
| `claude-prompt-stream`  | prompt chunk events      | token counts, not text  |
| `claude-memory-context` | memory suggestions       | memory IDs, confidence  |
| `claude-presence`       | heartbeat & lifecycle    | agent online/offline    |

**Privacy guarantee:**
No code, file contents, conversation text, or memory content is ever transmitted.
Only minimal metadata.

---

### **3. Claude Code Hook System**

Hooks enforce high-quality behavior:

**Pre-action:**

* Search memory
* Provide context
* Adjust plan

**Post-action:**

* Capture new learnings
* Update or evolve memories
* Suggest improvements through PubNub

**Planning hook:**

* High-quality reasoning
* Structured decision making
* Leverages stored knowledge

---

## 📚 Full Documentation

Detailed docs live in the `docs/` folder:

| Topic                      | File                      |
| -------------------------- | ------------------------- |
| Installation               | `docs/installation.md`    |
| 5-minute Quickstart        | `docs/quickstart.md`      |
| Architecture (with PubNub) | `docs/architecture.md`    |
| The Learning Loop          | `docs/learning-loop.md`   |
| Memory Types               | `docs/memory-types.md`    |
| CLI Reference              | `docs/cli.md`             |
| Hooks Documentation        | `docs/hooks.md`           |
| Project Scoping            | `docs/project-scoping.md` |
| Troubleshooting            | `docs/troubleshooting.md` |
| Security & Privacy         | `docs/security.md`        |
| FAQ                        | `docs/faq.md`             |

---

## 🔐 Security & Privacy

Claude Recall is a **local-first**, privacy-focused system.

* All memory stored locally in SQLite
* PubNub used only for ephemeral event metadata
* No user data, code, or conversation text leaves your machine
* No cloud sync
* No telemetry
* You control your entire memory set
* Easy export/inspect/delete through CLI

Full security notes: `docs/security.md`.

---

## 🛠 Development

PRs welcome — see `CONTRIBUTING.md` (optional).
Local development uses the Memory Agent + PubNub + SQLite.

---

## ❤️ Community

Issues and feedback are welcome.
Claude Recall is evolving rapidly — your input shapes it.

---

## 📝 License

MIT.

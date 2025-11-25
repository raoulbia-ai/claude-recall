# Architecture Overview

Claude Recall consists of three integrated subsystems:

1. **Local Memory Engine (SQLite)**
2. **Realtime Event Bus (PubNub)**
3. **Claude Code Hooks + MCP Server**

Together, they form a fast, private, adaptive memory layer for Claude.

---

# 1. Local Memory Engine (SQLite)

All persistent knowledge is stored locally:

- preferences
- workflow patterns
- project architecture
- mistakes + corrections
- reasoning heuristics
- coding standards
- naming conventions

The database:
- is located at `~/.claude-recall/memories.db`
- is indexed for fast semantic search
- uses structured, typed memory records
- prunes & evolves data over time

The Memory Engine guarantees:
- **zero cloud storage**
- **full user control**
- **review, edit, export, delete**

---

# 2. Realtime Event Bus (PubNub)

PubNub enables Claude Recall's **low-latency, non-blocking architecture**.

### Why PubNub?

Claude Code hooks run inside time-sensitive workflows.
Traditional synchronous CLI calls were slow (50–500ms).
PubNub reduces them to **sub-10ms**.

### What PubNub Transmits
Only *lightweight metadata*, for example:

- tool name
- file path
- event type
- prompt token counts (never text)
- memory suggestion IDs
- agent lifecycle heartbeat

### What PubNub Does *NOT* Transmit
- code
- conversation text
- memory contents
- embeddings
- prompts
- project data
- file contents

PubNub is a **coordination mechanism**, not storage and not transport of user content.

### Event Flow

```
Claude Code Hook
↓ publish (metadata only)
PubNub Channel
↓ subscribe
Memory Agent
↓ analyze
Memory Engine (SQLite)
↓ suggestions
PubNub Channel
↓ subscribe
Claude Code
```

### Channels Used

| Channel | Purpose |
|---------|---------|
| `claude-tool-events` | File write/edit events from hooks |
| `claude-prompt-stream` | Prompt token metadata |
| `claude-memory-context` | Contextual memory suggestions |
| `claude-presence` | Agent heartbeat & lifecycle |

### Architecture Benefits
- Hooks are instantaneous
- Memory is processed asynchronously
- Claude remains responsive
- Multiple events can be buffered in parallel
- Agent can evolve memory without blocking anything

---

# 3. Claude Code Hooks + MCP Server

Claude Recall integrates deeply with Claude Code:

### Pre-Action Hook
- Fired before Claude writes or edits files
- Publishes event metadata
- Requests relevant memories
- Injects memory into planning

### Planning Hook
- Performs advanced reasoning
- Uses previous memories
- Returns structured plan
- Reduces hallucination & mistakes

### Post-Action Hook
- Captures new knowledge
- Classifies memory type
- Publishes metadata via PubNub
- Evolves memory asynchronously

### MCP Server
Handles:
- semantic search
- memory retrieval
- memory creation/updating
- project registration
- skills activation

---

# Summary Diagram

```
        ┌──────────────┐
        │  Claude Code │
        └───────┬──────┘
                │ Hooks
                ▼
      ┌─────────────────────┐
      │   PubNub Event Bus  │
      └───────┬────────────┘
              │ metadata only
              ▼
    ┌───────────────────────┐
    │  Memory Agent (Local) │
    └───────┬──────────────┘
            │
            ▼
 ┌─────────────────────────────┐
 │   SQLite Memory Engine      │
 └─────────────────────────────┘
```

---

Next: Learn about the [Learning Loop](learning-loop.md).

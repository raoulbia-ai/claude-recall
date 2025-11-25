# Security & Privacy

Claude Recall is designed to be **local-first** and **privacy-safe**.

---

# Local Memory Storage

All memory is stored in:

```
~/.claude-recall/memories.db
```

Properties:
- local only
- never transmitted
- fully user-controlled
- exportable
- deletable

---

# PubNub Security Model

PubNub is used only as a **realtime metadata bus**.

### What PubNub does NOT transmit:
- code
- text
- file contents
- prompts
- memory content
- embeddings
- project data

### What PubNub DOES transmit:
- tool names
- file paths
- event types
- token counts
- memory suggestion IDs
- agent heartbeat metadata

### Why this is safe:
- payloads are small
- no sensitive content ever leaves machine
- events are ephemeral
- keys stored locally only
- no cloud persistence

---

# SQLite Security

- file-based permissions
- no remote access
- ACID-compliant
- optional encryption layer (coming soon)

---

# Transparency

You can:
- list memory
- inspect memory
- delete memory
- purge memory
- view event streams
- stop the agent

Claude Recall provides full visibility.

---

Security is a top priority.
For questions, open an issue.

# Security & Privacy

Claude Recall is designed to be **local-first** and **privacy-safe**.

---

# Local Memory Storage

All memory is stored in:

```
~/.claude-recall/claude-recall.db
```

Properties:
- local only
- never transmitted
- fully user-controlled
- exportable
- deletable

---

# SQLite Security

- file-based permissions
- no remote access
- ACID-compliant
- WAL mode for concurrency

---

# Transparency

You can:
- list memory
- inspect memory
- delete memory
- purge memory
- view compliance stats
- stop the MCP server

Claude Recall provides full visibility.

---

Security is a top priority.
For questions, open an issue.

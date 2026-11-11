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
- the database is never transmitted (prompts are, for classification — see the README's *Security & privacy*)
- directory is owner-only (`0700`); an existing `~/.claude-recall` is tightened on startup
- fully user-controlled
- exportable
- deletable

What a memory holds: the extracted rule, and for memories captured by a
Claude Code hook (0.46.0+) a copy of the user's message it came from, up to
2,000 chars and including pasted text, plus the session id, transcript path
and transcript entry id. The copy is kept because Claude Code deletes old
transcripts. It is included in `export` files, and the daily memory janitor
sends it, shortened to 400 chars per rule, to the runtime's own LLM to check
the rule against it. Deleting a memory deletes its copy.

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

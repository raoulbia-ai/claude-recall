# FAQ

---

## Does Claude Recall sync anything to the cloud?

**No.**
All memory is stored locally in SQLite. No user data is ever sent anywhere.

---

## How fast is it?

**MCP tool calls**: <10ms for `load_rules`, <5ms for `store_memory`
**Hook enforcement**: <10ms (checks state file, exits)

Claude Code never waits on Claude Recall.

---

## Does it work in monorepos?

Yes.

Claude Recall detects each workspace as a project based on the working directory Claude Code passes to the MCP server.

---

## Can I use it across multiple projects?

Yes.

Each project gets:
- unique project ID (derived from working directory)
- isolated memory namespace
- shared database file (`~/.claude-recall/claude-recall.db`), scoped by `project_id` column

---

## How do I see what's stored?

```bash
npx claude-recall stats
npx claude-recall search "your query"
npx claude-recall export backup.json
```

---

## Can I delete memories?

```bash
npx claude-recall clear --force    # Clear all memories
```

Or export, edit, and re-import:

```bash
npx claude-recall export backup.json
# Edit backup.json to remove unwanted entries
npx claude-recall clear --force
npx claude-recall import backup.json
```

---

## Does it work offline?

Yes. Everything is local SQLite — no network required.

---

## How is this different from GitHub Copilot?

GitHub Copilot:
- cloud-based autocomplete
- trained on public code
- no persistent memory

Claude Recall:
- local persistent memory
- learns your preferences
- project-scoped knowledge
- 100% private

---

## Why SQLite?

- local only
- no remote access
- ACID-compliant
- file-based permissions
- WAL mode for concurrency

---

## What's the memory limit?

Default: 10,000 memories

Configurable:

```bash
export CLAUDE_RECALL_MAX_MEMORIES=20000
```

Automatic compaction at 10MB threshold (configurable via `CLAUDE_RECALL_COMPACT_THRESHOLD`).

---

## Can I export/import memories?

Yes.

```bash
npx claude-recall export backup.json
npx claude-recall import backup.json
```

---

## Does it work with other Claude interfaces?

No.

Claude Recall is built specifically for **Claude Code** using:
- MCP (Model Context Protocol)
- Native Claude Skills

---

## How do I update?

```bash
npm uninstall claude-recall && npm install claude-recall
```

Restart Claude Code after updating.

---

## What if I want to reset everything?

```bash
rm -rf ~/.claude-recall
```

Then reinstall:

```bash
npm install claude-recall
```

---

For deeper issues, open a GitHub issue.

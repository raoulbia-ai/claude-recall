# FAQ

---

## Does Claude Recall sync anything to the cloud?

**No.**
All memory is stored locally in SQLite.

PubNub is used only for:
- event metadata
- agent coordination
- heartbeat signals

No user data is ever sent.

---

## What exactly does PubNub transmit?

**Metadata only**:
- tool names
- file paths
- event types
- token counts
- memory suggestion IDs
- agent heartbeat metadata

**Never transmitted**:
- code
- text
- file contents
- prompts
- memory content
- embeddings
- project data

---

## Is PubNub required?

Yes, for the Memory Agent to receive events from Claude Code.

Without PubNub:
- hooks still fire
- no agent coordination
- no realtime memory suggestions

With PubNub:
- sub-10ms event publishing
- autonomous Memory Agent
- zero blocking overhead

---

## How fast is it?

**Hook execution**: <10ms (fire-and-forget)
**Event publishing**: <5ms
**Memory Agent response**: 50-200ms (background)

Claude Code never waits.

---

## Does it work in monorepos?

Yes.

Claude Recall:
- detects each workspace as a project
- or treats the whole repo as one project
- configurable via `claude-recall.json`

---

## Can I use it across multiple projects?

Yes.

Each project gets:
- unique project ID
- isolated memory namespace
- its own PubNub presence channel
- context directory in `~/.claude-recall/projects`

---

## What happens if the Memory Agent crashes?

Claude Code continues working normally.

Hooks still fire (non-blocking).
Events are ephemeral — no persistence.

Restart the agent:

```bash
npx claude-recall watch
```

---

## How do I see what's stored?

```bash
npx claude-recall list
npx claude-recall search "your query"
npx claude-recall inspect <id>
```

---

## Can I delete memories?

Yes.

```bash
npx claude-recall delete <id>
npx claude-recall purge  # deletes all (dangerous)
```

---

## Does it work offline?

**Local memory**: Yes (SQLite is fully local)
**PubNub events**: No (requires internet)

If offline:
- hooks still fire
- no agent coordination
- no realtime memory suggestions

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
- optional encryption (coming soon)

---

## What's the memory limit?

Default: 10,000 memories

Configurable:

```bash
export CLAUDE_RECALL_MAX_MEMORIES=20000
```

Automatic cleanup when limit reached.

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
- Claude Code hooks
- Claude Agent SDK

---

## How do I update?

```bash
npm update claude-recall
```

Or reinstall:

```bash
npm install claude-recall@latest
```

Restart Claude Code after updating.

---

## Where are the PubNub keys stored?

`~/.claude-recall/keys.json`

Project-specific keys ensure:
- isolated event channels
- no cross-project leakage
- clean agent shutdown

**Recommended**: Create your own free keys for production:
[Create PubNub Keys](https://www.pubnub.com/how-to/admin-portal-create-keys/)

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

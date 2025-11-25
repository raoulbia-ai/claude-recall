# Installation

Claude Recall supports macOS, Linux, Windows, and WSL.
Memory remains fully local (SQLite), while PubNub is used for lightweight realtime event metadata.

---

## Requirements

| Component | Version | Notes |
|----------|---------|-------|
| Node.js | **20+** | Required (`better-sqlite3`) |
| Python | **3.x** | Required for Claude Code hook scripts |
| PubNub | Included via npm | Used only for metadata events |
| Claude Code | Latest | Required for MCP integration |
| OS | macOS / Linux / Windows | WSL supported |

Check versions:

```bash
node --version
python3 --version
```

---

## Recommended Install (Per Project)

This is the cleanest and most predictable setup:

```bash
cd your-project
npm install claude-recall
```

Then restart **Claude Code**.

Claude will automatically detect the MCP server and begin using persistent memory.

Installation creates `.claude/skills/memory-management/` with:
- SKILL.md (main skill definition)
- references/ (examples, patterns, troubleshooting)

---

## Global Install (Not Recommended)

You can install globally:

```bash
npm install -g claude-recall
```

But this:

* makes debugging harder
* mixes project contexts
* can interfere with monorepos
* is less secure and harder to reason about

Local project installs are strongly preferred.

---

## Verifying Installation

Run:

```bash
npx claude-recall --version
```

In Claude Code, ask:

> "Search my memories."

You should see:

```
mcp__claude-recall__search
```

If so, you're fully set up.

---

## WSL Setup

If using Ubuntu under WSL2:

1. Install Node 20+ inside Ubuntu:

   ```bash
   nvm install 20
   ```
2. Install the package:

   ```bash
   cd your-project
   npm install claude-recall
   ```
3. Ensure VSCode's terminal is *also* WSL.

PubNub works normally under WSL since it uses outbound-only secure connections.

---

## Node 20 Requirement

Claude Recall uses `better-sqlite3`, which requires Node 20+ for stable builds.

If you're on Node 18 or lower:

```bash
nvm install 20
nvm use 20
```

---

## Uninstall

From a project:

```bash
npm uninstall claude-recall
```

To remove all memories:

```bash
rm -rf ~/.claude-recall
```

---

You're now ready to use Claude Recall.
Continue to the [Quickstart](quickstart.md).

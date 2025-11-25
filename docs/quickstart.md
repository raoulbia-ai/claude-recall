# Quickstart (5 Minutes)

This guide gets you from zero → persistent-memory Claude Code in a few minutes.

---

## 1. Install

```bash
cd your-project
npm install claude-recall
```

Restart **Claude Code**.

---

## 2. First Interaction

Ask Claude:

> "Search my memories."

You should see a call to:

```
mcp__claude-recall__search
```

If not, see [Troubleshooting](troubleshooting.md).

---

## 3. Teach Claude a Preference

Say something natural:

> "By the way, always use Vitest instead of Jest."

Claude Recall will:

* capture the preference
* store it locally in SQLite
* route metadata via PubNub
* evolve memory asynchronously
* apply it the next time Claude generates tests

---

## 4. Watch It Apply Automatically

Ask Claude:

> "Write unit tests for this file."

Claude should automatically use:

* Vitest test syntax
* your preferred directory structure
* your conventions (e.g., `describe` style, inline snapshots, etc.)

The key: **You never have to repeat this preference again.**

---

## 5. Explore the CLI

```bash
npx claude-recall list
npx claude-recall search vitest
npx claude-recall inspect <id>
```

---

## 6. Done!

Claude Recall is now learning from every action you take.

Next:

* Learn the [Architecture](architecture.md)
* Understand the [Learning Loop](learning-loop.md)
* Explore [Memory Types](memory-types.md)

# CLI Reference

The `claude-recall` CLI gives full visibility into stored memory.

---

## List

```bash
npx claude-recall list
```

Shows all stored memories (preference, project, corrections, etc.)

---

## Search

```bash
npx claude-recall search <query>
```

Example:

```bash
npx claude-recall search testing
```

---

## Inspect

```bash
npx claude-recall inspect <id>
```

Shows memory details:

* type
* metadata
* strength
* evolution history

---

## Delete

```bash
npx claude-recall delete <id>
```

---

## Purge (dangerous)

```bash
npx claude-recall purge
```

Deletes **all** memory.

---

## Watch (debug)

```bash
npx claude-recall watch
```

Streams:

* PubNub events
* memory updates
* hook events
* agent status

---

Next: Learn how [Hooks](hooks.md) work.

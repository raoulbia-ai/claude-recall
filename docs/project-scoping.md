# Project Scoping

Claude Recall maintains a registry of all projects using it.

---

## How Projects Are Identified

Each project gets:
- a unique ID
- a PubNub presence channel
- its own memory namespace
- its own context directory inside `~/.claude-recall/projects`

This enables:
- isolated memory
- correct context switching
- no leakage across projects

---

## Presence Channel

Memory Agent publishes heartbeats:

```
claude-presence:<projectId>
```

Used to ensure:
- at most one Agent per project
- consistent event processing
- clean agent shutdown

---

## Monorepos

Claude Recall:
- identifies each workspace as a project
- or can treat the whole repo as one project
- configurable via `claude-recall.json`

---

## Multi-Project Workflows

Switching projects inside VSCode triggers:
- PubNub presence update
- registry notification
- memory namespace change

Claude immediately uses the correct memory.

---

Next: If something goes wrong, see [Troubleshooting](troubleshooting.md).

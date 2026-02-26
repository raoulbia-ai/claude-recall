# Project Scoping

Claude Recall maintains a registry of all projects using it.

---

## How Projects Are Identified

Each project gets:
- a unique ID
- its own memory namespace
- its own context directory inside `~/.claude-recall/projects`

This enables:
- isolated memory
- correct context switching
- no leakage across projects

---

## Automatic Memory Scoping

Claude Recall automatically manages memory scope:
- **Universal memories** (coding style, tool preferences) → reused across all projects
- **Project memories** (database configs, APIs) → isolated per project

System auto-detects from language ("remember everywhere" vs "for this project").
No user configuration needed.

---

## Monorepos

Claude Recall:
- identifies each workspace as a project
- or can treat the whole repo as one project
- configurable via `claude-recall.json`

---

## Multi-Project Workflows

Switching projects inside VSCode triggers:
- registry notification
- memory namespace change

Claude immediately uses the correct memory.

---

Next: If something goes wrong, see [Troubleshooting](troubleshooting.md).

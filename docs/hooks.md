# Hook System

Claude Recall uses three Claude Code hooks:

1. Pre-Action Hook
2. Planning Hook
3. Post-Action Hook

Hooks are extremely fast (<10ms) because they publish to PubNub without waiting.

---

# 1. Pre-Action Hook

Triggered before Claude:

- writes a file
- edits a file
- runs a tool

Responsibilities:
- publish tool metadata
- request memory suggestions
- inject context into planning

Payload example:

```json
{
  "event": "pre_action",
  "tool": "write_file",
  "path": "src/utils/math.ts"
}
```

---

# 2. Planning Hook

Enforces high-quality reasoning:

* improves plan structure
* reduces hallucinations
* ensures memory is incorporated
* provides Claude with retrieved memories

---

# 3. Post-Action Hook

Triggered after execution.

Responsibilities:

* detect failures & successes
* publish metadata about results
* classify new learnings
* update/evolve memories asynchronously

Example metadata:

```json
{
  "event": "post_action",
  "status": "success",
  "path": "src/utils/math.ts"
}
```

---

# PubNub Integration

Hooks **never block**:

```python
pubnub.publish(channel="claude-tool-events", message=event)
```

Memory Agent receives events immediately and processes them in the background.

---

Next: Learn how memory is scoped in [Project Scoping](project-scoping.md).

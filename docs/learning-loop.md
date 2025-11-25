# The Learning Loop

Claude Recall uses a 5-phase learning process that improves over time.

---

## 1. Pre-Action Search
Before Claude writes or edits a file:

- Hook sends metadata to PubNub
- Agent receives event
- Searches SQLite memory
- Sends relevant memories back

Claude now knows:
- your preferences
- past corrections
- project conventions
- architectural constraints

---

## 2. Apply
Claude Code injects memory into planning:

- modifies its approach
- adapts to your style
- avoids past mistakes

This reduces friction dramatically.

---

## 3. Execute
Claude performs the task:

- code generation
- file edits
- refactoring
- analysis

Execution is monitored by hooks.

---

## 4. Capture
After the action:

- Post-action hook captures outcome metadata
- Agent evaluates success/failure
- Learns new patterns
- Identifies improvements

---

## 5. Evolve
Claude Recall merges:

- newly captured memory
- old memory
- usage patterns

It may:
- strengthen a memory
- weaken it
- modify it
- merge multiple related memories
- retire stale ones

The system remains small & relevant.

---

This loop repeats continuously — making Claude more personal, accurate, and aligned to your workflow.

Next: Explore [Memory Types](memory-types.md).

# Memory Types

Claude Recall stores memory in structured categories.

---

## 1. Preferences
Long-term personal choices:

- testing framework
- naming conventions
- indentation/style rules
- tooling choices
- preferred libraries

---

## 2. Project Knowledge
Architecture-level information:

- directory layout
- design patterns
- domain models
- tech stack
- specific decisions
- constraints & guarantees

This memory is scoped per project.

---

## 3. Corrections
When you correct Claude:

- "Use snake_case here."
- "We don't use Redux anymore."
- "Tests go in `__tests__/`."

These get stored and reused.

---

## 4. Behavioral Heuristics
Inferred from observation:

- how you structure commits
- preferred refactor patterns
- your debugging workflow
- typical error recovery steps

---

## 5. Failures & Successes
Claude Recall tracks patterns like:

- errors Claude caused
- fixes that worked
- operations that frequently go wrong

---

Next: See the full [CLI Reference](cli.md).

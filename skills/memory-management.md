---
name: memory-management
description: Persistent memory management — load rules at session start, store corrections and preferences automatically
---

# Memory Management

You have access to persistent memory tools from Claude Recall. Use them to learn from the user over time.

## When starting a task

Call `recall_load_rules` to load stored preferences, corrections, failure lessons, and devops rules. Apply relevant rules to your work and cite them inline: `(applied from memory: <rule summary>)`.

## When the user corrects you

If the user says things like "no, always use X" or "don't do Y", call `recall_store_memory` with:
- `content`: the correction in clear, reusable language
- `metadata.type`: `"correction"`

## When you learn a preference

If the user states a preference ("I prefer tabs", "use functional style"), call `recall_store_memory` with:
- `content`: the preference
- `metadata.type`: `"preference"`

## When something fails

If a command fails or you need to backtrack, the failure is captured automatically. You don't need to store it manually.

## Before making decisions

Call `recall_search_memory` with relevant keywords to check for existing project knowledge before choosing approaches, tools, or conventions.

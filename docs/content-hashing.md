# Content Hashing for Memory Deduplication

## Problem

Claude Recall's auto-capture system frequently stores semantically identical memories under different keys (e.g., `memory_1738a...` and `memory_1738b...` with the same content). The existing dedup only catches exact `(type, key, value)` triples during offline compaction — it misses same-content memories stored under different keys, which is the common case.

## Approach

Each memory gets a `content_hash` column containing the SHA-256 hex digest of its meaningful content. The hash is computed at write time from:

- **`type`** — the memory type (preference, project-knowledge, etc.)
- **`value`** — the memory value, canonically serialized (sorted keys)

These two fields define what a memory *means*. Everything else (key, project_id, scope, timestamps, access_count, relevance_score) is metadata that can differ for semantically identical content.

### Why `type` is included

A preference "use tabs" and a correction "use tabs" are semantically different memories even though the value is identical.

### Why `project_id` and `scope` are excluded

If a user stores "always use tabs" as both universal and project-scoped, that's a duplicate worth catching. The existing record's scope is preserved on dedup hit.

## Behavior

### Write-time dedup

Before inserting a new memory, `MemoryStorage.save()` checks if a memory with the same `content_hash` already exists (excluding same-key updates). If a match is found:

1. The existing memory's `timestamp` is bumped to now (keeps it fresh in time-decay scoring)
2. The existing memory's `access_count` is incremented
3. The new insert is skipped

Same-key updates (INSERT OR REPLACE) are unaffected — content_hash dedup only prevents *different-key* duplicates.

### Compaction dedup

`DatabaseManager.deduplicateMemories()` uses `GROUP BY content_hash` for indexed hash comparison instead of `GROUP BY type, key, value`. A fallback handles pre-migration rows where `content_hash IS NULL`.

### Backfill

On migration, all existing rows with `NULL` content_hash are backfilled with computed hashes. This is a one-time operation.

## Opt-out

There is no opt-out toggle. Content hashing is always on because it is pure upside — prevents duplicates with negligible CPU cost (one SHA-256 per store operation). The hash computation adds no measurable latency to memory storage.

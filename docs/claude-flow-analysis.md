# Claude-Flow Analysis: Adopted Patterns

## Overview

Analysis of the [claude-flow](https://github.com/anthropics/claude-flow) repository identified two high-impact patterns applicable to Claude Recall's architecture. This document records what was adopted, what was skipped, and the rationale.

## Adopted

### 1. Database Adapter Layer (sql.js fallback for better-sqlite3)

**Problem**: Claude Recall's sole dependency on `better-sqlite3` causes "invalid ELF header" errors in mixed Windows/WSL environments because native binaries compiled for one platform fail on the other.

**Claude-flow's approach**: Uses `sql.js` (SQLite compiled to WASM — pure JavaScript, zero native bindings) as the primary backend with `better-sqlite3` as an optional faster alternative.

**Our approach**: Try `better-sqlite3` first (fastest), fall back to `sql.js` automatically if the native binary fails to load. This preserves existing performance for users where `better-sqlite3` works while eliminating the WSL pain point.

**Implementation**: `src/memory/database-adapter.ts` defines a `DatabaseAdapter` interface and factory function. `MemoryStorage` and `DatabaseManager` use the adapter instead of importing `better-sqlite3` directly. The queue system (`queue-system.ts`, `queue-migration.ts`) was left on direct `better-sqlite3` — it's MCP-server-only code with deeply coupled prepared-statement patterns that warrant a separate migration effort.

### 2. Vector Similarity Search (Embedding-Based Retrieval)

**Problem**: Claude Recall's retrieval engine uses SQL `LIKE` keyword matching. Searching for "authentication" won't find a memory stored about "JWT login flow" because there's no semantic overlap in the literal text.

**Claude-flow's approach**: HNSW vector indexing with embeddings for similarity search.

**Our approach**: For Claude Recall's scale (<10K memories), brute-force cosine similarity over stored embeddings is sufficient — no need for HNSW indexing complexity. We use `@huggingface/transformers` with the `Xenova/all-MiniLM-L6-v2` model (384-dimensional, ~22MB, runs locally via ONNX — no API key required). The feature degrades gracefully: if `@huggingface/transformers` is not installed, retrieval falls back to existing keyword matching.

**Implementation**: `src/services/embedding-service.ts` is a singleton that lazily loads the model on first use. Embeddings are stored as BLOBs in an `embedding` column on the `memories` table. `MemoryStorage.similaritySearch()` computes cosine similarity across all embedded memories. `MemoryRetrieval.findRelevant()` merges similarity results with keyword results.

## Skipped

### HNSW Indexing

Claude-flow uses HNSW (Hierarchical Navigable Small World) graphs for approximate nearest-neighbor search. At Claude Recall's scale (<10K entries), brute-force cosine similarity over Float32Arrays completes in sub-millisecond time. HNSW adds complexity (index maintenance, rebuild on insert) with no measurable benefit at this scale.

### Multi-Database Coordination

Claude-flow manages multiple databases with coordination layers. Claude Recall uses a single SQLite database per installation — this pattern doesn't apply.

### QUIC Transport

Claude-flow includes QUIC-based synchronization for distributed deployments. Claude Recall is a single-user local tool — network transport is out of scope.

## Trade-offs

| Decision | Pro | Con |
|---|---|---|
| better-sqlite3 first, sql.js fallback | No performance loss for working installs | Two code paths to maintain |
| Brute-force cosine vs HNSW | Simple, zero dependencies, fast at <10K | Won't scale past ~100K memories |
| Optional @huggingface/transformers | Zero-config for keyword-only users | ~22MB model download on first semantic search |
| Fire-and-forget embedding on save | Non-blocking save path | Brief window where new memory lacks embedding |

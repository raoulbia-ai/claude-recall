# Performance Benchmarks

This directory contains performance and load testing benchmarks for Claude Recall.

## Purpose

Benchmarks are **separate from the main test suite** because:
- They measure performance, not correctness
- They run slower (can take minutes)
- They're for optimization work, not daily TDD
- They can be flaky (timing-dependent)

## When to Run Benchmarks

Run benchmarks when:
- ✅ Optimizing performance
- ✅ Before releasing performance-sensitive changes
- ✅ Investigating performance regressions
- ✅ Establishing performance baselines

**Don't run benchmarks:**
- ❌ During daily TDD workflow
- ❌ For every code change
- ❌ In watch mode

## Running Benchmarks

```bash
# Run all benchmarks
npm run test:benchmarks

# Or directly with jest
npx jest tests/benchmarks/

# Run specific benchmark
npx jest tests/benchmarks/queue-performance.test.ts

# Run with detailed output
npx jest tests/benchmarks/ --verbose
```

## Current Benchmarks

### Retrieval: LIKE vs FTS5/BM25 (`retrieval-benchmark.ts`)

Measures **recall@5** and mean payload size for the two lexical retrieval
engines (`CLAUDE_RECALL_RETRIEVAL=like` vs `fts`) over a curated fixture set.
Unlike the others here, this is a **standalone reporting script, not a jest
test** — it prints a comparison table and has no pass/fail assertions, so it is
never part of `npm test`.

```bash
npm run bench:retrieval
```

It exists to give the FTS5 rollout an evidenced before/after number (see
`docs/design-hybrid-retrieval-fts5.md` §7) so flipping the default to `fts` is a
measured decision. The built-in fixtures are a small hand-labelled seed, not the
full LongMemEval corpus — expand `MEMORIES` / `QUERIES` in the script with real
transcript-derived cases to tighten the estimate.

### Queue Performance (`queue-performance.test.ts`)

Tests the performance characteristics of the queue system:

**Metrics tested:**
- Concurrent message processing (50-1000 messages)
- Retry performance under load
- Database performance with large message volumes
- Cleanup efficiency
- Batch operations throughput

**Typical run time:** 2-5 minutes

**What it measures:**
- Messages processed per second
- Retry delays and backoff behavior
- Database query performance
- Memory usage under load
- Cleanup operation speed

## Writing New Benchmarks

When adding benchmarks:

1. Place them in this directory
2. Use realistic load scenarios
3. Measure and assert on timing
4. Include warmup runs
5. Document expected performance baselines

**Example:**
```typescript
describe('My Feature Performance', () => {
  it('should process 1000 items in under 5 seconds', () => {
    const start = Date.now();

    for (let i = 0; i < 1000; i++) {
      processItem(i);
    }

    const duration = Date.now() - start;
    expect(duration).toBeLessThan(5000);
  });
});
```

## Performance Baselines

Track performance over time:

| Test | Baseline | Current | Change |
|------|----------|---------|--------|
| Enqueue 1000 messages | 100ms | - | - |
| Process 1000 with retries | 2000ms | - | - |
| Database cleanup (1000 records) | 50ms | - | - |

Update this table when performance changes significantly.

## CI/CD Integration

Consider running benchmarks:
- **Nightly builds** - Track performance trends
- **PR benchmarks** - Catch performance regressions
- **Release gates** - Ensure performance requirements met

Example GitHub Actions:
```yaml
name: Benchmarks
on:
  schedule:
    - cron: '0 0 * * *'  # Daily at midnight
jobs:
  benchmark:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - run: npm install
      - run: npm run test:benchmarks
```

## Interpreting Results

**Good:** Tests pass consistently
**Warning:** Tests sometimes fail (timing variance)
**Bad:** Tests consistently fail or performance degrades

If benchmarks fail:
1. Check for competing processes
2. Verify hardware consistency
3. Review recent code changes
4. Consider adjusting thresholds if too strict

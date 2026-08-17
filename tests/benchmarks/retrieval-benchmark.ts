/**
 * Retrieval benchmark: LIKE vs FTS5/BM25.
 *
 * Measures recall@5 and mean payload size (≈tokens) for the two lexical
 * retrieval engines over a curated fixture set. This is the scaffold the FTS5
 * design note (docs/design-hybrid-retrieval-fts5.md §7) calls for: it exists to
 * produce a before/after number so flipping CLAUDE_RECALL_RETRIEVAL=fts to the
 * default is an evidenced decision, not a vibe.
 *
 * NOT a jest test (no pass/fail assertions) and NOT part of `npm test` — it is a
 * reporting tool. Run it explicitly:
 *
 *     npm run bench:retrieval
 *
 * The fixture set below is a small, hand-labelled seed — deliberately not the
 * full LongMemEval corpus. It is enough to expose the structural difference
 * (LIKE's ">=2-of-many keywords" AND-filter vs FTS's OR-of-prefix-terms + BM25
 * ranking). Expand `MEMORIES` / `QUERIES` with real transcript-derived cases to
 * tighten the estimate; the harness scales as-is.
 */

import { MemoryStorage } from '../../src/memory/storage';
import { MemoryRetrieval } from '../../src/core/retrieval';

const PROJECT = 'bench-project';

interface Fixture {
  key: string;
  type: string;
  text: string;
}

// Realistic dev memories (preferences, project-knowledge, failures, devops).
const MEMORIES: Fixture[] = [
  { key: 'm-db', type: 'project-knowledge', text: 'The project uses PostgreSQL as its primary database with connection pooling via pgbouncer.' },
  { key: 'm-auth', type: 'project-knowledge', text: 'Authentication is handled with JWT tokens issued by the auth service; refresh tokens live in Redis.' },
  { key: 'm-deploy', type: 'devops', text: 'Deployment goes through the Kubernetes cluster; the release pipeline builds a docker image and applies the helm chart.' },
  { key: 'm-lint', type: 'preference', text: 'Prefer eslint with the airbnb config and prettier for formatting; run lint before every commit.' },
  { key: 'm-test', type: 'preference', text: 'Write jest unit tests first (TDD); integration tests use an in-memory sqlite database.' },
  { key: 'm-migrate', type: 'project-knowledge', text: 'Database migrations are managed with knex; never edit an applied migration, add a new one.' },
  { key: 'm-fail-docker', type: 'failure', text: 'The docker build failed because the node version in the base image was too old; pin node 22 in the Dockerfile.' },
  { key: 'm-fail-cors', type: 'failure', text: 'API requests failed with a CORS error; the express middleware order matters, register cors before the routes.' },
  { key: 'm-webpack', type: 'project-knowledge', text: 'The frontend bundles with webpack; the production build enables tree-shaking and source maps are disabled.' },
  { key: 'm-graphql', type: 'project-knowledge', text: 'The public API is GraphQL; avoid adding new REST endpoints, extend the schema instead.' },
  { key: 'm-secrets', type: 'devops', text: 'Secrets are injected from the vault as environment variables at deploy time; never commit a token to git.' },
  { key: 'm-cache', type: 'project-knowledge', text: 'Redis is used both as the session store and as a query cache with a five minute TTL.' },
  { key: 'm-branch', type: 'preference', text: 'Never stack pull requests; merge one on green CI before opening the next.' },
  { key: 'm-noise-1', type: 'preference', text: 'Use tabs for indentation in Go files and spaces everywhere else.' },
  { key: 'm-noise-2', type: 'tool-use', text: 'Ran the stats command to inspect memory counts on Tuesday afternoon.' },
];

// Each query names the memory keys a good retriever SHOULD surface in the top-5.
const QUERIES: { query: string; relevant: string[] }[] = [
  { query: 'how do we deploy the app to kubernetes', relevant: ['m-deploy'] },
  { query: 'what database and connection pooling do we use', relevant: ['m-db'] },
  { query: 'the docker build is failing on the base image node version', relevant: ['m-fail-docker'] },
  { query: 'how is authentication and token refresh implemented', relevant: ['m-auth'] },
  // Paraphrase / partial-overlap: query shares only ONE strong token with the
  // target ("migration"), so LIKE's ">=2-of-3" AND-filter can drop it while
  // FTS's OR-of-prefixes keeps it.
  { query: 'adding a new database schema migration safely', relevant: ['m-migrate', 'm-db'] },
  { query: 'linting and code formatting rules before commit', relevant: ['m-lint'] },
  { query: 'why did the api return a cors error', relevant: ['m-fail-cors'] },
  { query: 'where are secrets and tokens stored for deployment', relevant: ['m-secrets'] },
  { query: 'redis caching and session storage ttl', relevant: ['m-cache', 'm-auth'] },
  { query: 'rules about opening pull requests and ci', relevant: ['m-branch'] },
];

function seed(storage: MemoryStorage): void {
  const now = Date.now();
  for (const m of MEMORIES) {
    storage.save({
      key: m.key,
      value: { content: m.text },
      type: m.type,
      project_id: PROJECT,
      timestamp: now,
    });
  }
}

/** Rough token estimate: chars / 4 (good enough for a relative comparison). */
function approxTokens(objs: any[]): number {
  const s = objs.map(o => JSON.stringify(o.value)).join(' ');
  return Math.ceil(s.length / 4);
}

function runMode(mode: 'like' | 'fts'): { recall: number; tokens: number; perQuery: { query: string; recall: number; hits: string[] }[] } {
  process.env.CLAUDE_RECALL_RETRIEVAL = mode;
  const storage = new MemoryStorage(':memory:');
  seed(storage);
  const retrieval = new MemoryRetrieval(storage);

  let recallSum = 0;
  let tokenSum = 0;
  const perQuery: { query: string; recall: number; hits: string[] }[] = [];

  for (const q of QUERIES) {
    const top = retrieval.findRelevant({ project_id: PROJECT, query: q.query }).slice(0, 5);
    const topKeys = new Set(top.map(t => t.key));
    const hit = q.relevant.filter(k => topKeys.has(k));
    const recall = q.relevant.length === 0 ? 1 : hit.length / q.relevant.length;
    recallSum += recall;
    tokenSum += approxTokens(top);
    perQuery.push({ query: q.query, recall, hits: hit });
  }

  storage.close();
  return {
    recall: recallSum / QUERIES.length,
    tokens: tokenSum / QUERIES.length,
    perQuery,
  };
}

function pct(n: number): string {
  return (n * 100).toFixed(1) + '%';
}

function main(): void {
  const like = runMode('like');
  const fts = runMode('fts');

  console.log('\nRetrieval benchmark — LIKE vs FTS5/BM25');
  console.log(`Fixtures: ${MEMORIES.length} memories, ${QUERIES.length} queries, recall@5\n`);

  console.log('Per-query recall@5:');
  console.log('  ' + 'query'.padEnd(52) + 'LIKE'.padEnd(8) + 'FTS');
  for (let i = 0; i < QUERIES.length; i++) {
    const q = QUERIES[i].query.slice(0, 50);
    console.log('  ' + q.padEnd(52) + pct(like.perQuery[i].recall).padEnd(8) + pct(fts.perQuery[i].recall));
  }

  console.log('\nSummary:');
  console.log('  metric'.padEnd(24) + 'LIKE'.padEnd(12) + 'FTS');
  console.log('  ' + 'mean recall@5'.padEnd(22) + pct(like.recall).padEnd(12) + pct(fts.recall));
  console.log('  ' + 'mean tokens/query'.padEnd(22) + like.tokens.toFixed(0).padEnd(12) + fts.tokens.toFixed(0));

  const delta = fts.recall - like.recall;
  console.log(`\nΔ recall@5 (fts - like): ${(delta >= 0 ? '+' : '') + pct(delta)}`);
  console.log(
    delta > 0.001
      ? '→ FTS improves recall on this fixture set.'
      : delta < -0.001
        ? '→ FTS REGRESSES recall on this fixture set — investigate before flipping the default.'
        : '→ No measurable difference on this fixture set.',
  );
  console.log('\nNote: curated seed fixtures, not the full LongMemEval corpus. Expand for a tighter estimate.\n');
}

main();

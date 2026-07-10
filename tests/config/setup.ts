/**
 * Jest Test Setup
 *
 * This file runs before all tests and sets up the test environment.
 * It's configured in jest.config.js via setupFilesAfterEnv, so it executes
 * once per test file BEFORE that file's imports — early enough to redirect the
 * database away from the real one before any ConfigService is constructed.
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

// DB ISOLATION — the single most important guard here. Without it, any test
// that uses real storage without setting its own CLAUDE_RECALL_DB_PATH reads
// and writes the developer's REAL ~/.claude-recall/claude-recall.db, and the
// several tests that clear memories would wipe it (this has happened). An unset
// path defaults to that real DB, so redirect it to a throwaway temp directory.
// Tests that set their own path (or ':memory:') in a beforeEach/beforeAll still
// win — that runs after this file.
const REAL_HOME_DB = path.join(os.homedir(), '.claude-recall');
if (!process.env.CLAUDE_RECALL_DB_PATH) {
  process.env.CLAUDE_RECALL_DB_PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-recall-test-'));
}
// Hard stop: never run the suite against the real home database. Fail loudly
// instead of silently destroying the developer's memories.
if (process.env.CLAUDE_RECALL_DB_PATH === REAL_HOME_DB) {
  throw new Error(
    `Refusing to run tests against the real database at ${REAL_HOME_DB}. ` +
    'Set CLAUDE_RECALL_DB_PATH to a temp directory.',
  );
}

// Set test timeout for all tests (can be overridden per test)
jest.setTimeout(30000);

// Suppress console.log in tests unless needed for debugging
// Comment these out if you need to see console output during test development
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
// };

// Add custom matchers or global test utilities here if needed

module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': ['ts-jest', { diagnostics: false }]
  },
  // src must be in roots: collectCoverageFrom only matches files found under
  // roots, so with tests/ alone the 20+ untested src files silently vanished
  // from the coverage report instead of counting as 0% (inflating the totals).
  roots: ['<rootDir>/tests', '<rootDir>/src'],
  testMatch: ['**/*.test.ts', '**/*.test.js'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/cli/claude-recall-cli.ts',
    // Exclude test utilities and templates
    '!tests/**/*.ts',
    '!tests/templates/**',
    '!tests/utils/**'
  ],
  // Honest ratchet: set just below actual coverage so CI fails on regression.
  // Raise these as coverage improves — never lower them. (The previous 70%
  // referred to a report that silently omitted 20+ untested src files; with
  // every file counted, real coverage is ~48% statements / ~44% branches.)
  coverageThreshold: {
    global: {
      branches: 43,
      functions: 49,
      lines: 48,
      statements: 47
    }
  },
  testTimeout: 30000, // 30 seconds for MCP tests
  setupFilesAfterEnv: ['<rootDir>/tests/config/setup.ts'],
  // Optimize test execution
  maxWorkers: '50%', // Use half of available CPU cores
  cache: true,
  cacheDirectory: '<rootDir>/.jest-cache'
};
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': ['ts-jest', { diagnostics: false }]
  },
  roots: ['<rootDir>/tests'],
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
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70
    }
  },
  testTimeout: 30000, // 30 seconds for MCP tests
  setupFilesAfterEnv: ['<rootDir>/tests/config/setup.ts'],
  // Optimize test execution
  maxWorkers: '50%', // Use half of available CPU cores
  cache: true,
  cacheDirectory: '<rootDir>/.jest-cache'
};
/**
 * Jest Test Setup
 *
 * This file runs before all tests and sets up the test environment.
 * It's configured in jest.config.js via setupFilesAfterEnv.
 */

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

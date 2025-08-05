// Increase timeout for integration tests
jest.setTimeout(30000);

// Mock home directory for consistent test environment
process.env.HOME = '/tmp/test-home';

// Ensure clean test environment
beforeEach(() => {
  // Clear any test databases
  const testDbPath = '/tmp/test-home/.claude-recall/';
  if (require('fs').existsSync(testDbPath)) {
    require('fs').rmSync(testDbPath, { recursive: true, force: true });
  }
});

// Clean up after tests
afterAll(() => {
  // Kill any lingering MCP processes
  try {
    require('child_process').execSync('pkill -f "claude-recall mcp"');
  } catch (e) {
    // Ignore if no processes found
  }
});
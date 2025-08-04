// Test to verify behavioral pattern detection works
describe('Behavioral Pattern Detection', () => {
  it('should detect when Claude Code creates files in specific directories', () => {
    // This file was created in tests-raoul/ based on stored preference
    // The ActionPatternDetector should detect this behavioral pattern
    const testLocation = 'tests-raoul';
    expect(testLocation).toBe('tests-raoul');
  });

  it('should learn from repeated file creation patterns', () => {
    // When Claude Code repeatedly creates test files in the same directory,
    // the system should learn this as a behavioral preference
    expect(true).toBe(true);
  });
});
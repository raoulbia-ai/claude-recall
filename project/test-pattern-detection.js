const { PatternDetector } = require('./dist/core/pattern-detector');
const { PatternService } = require('./dist/services/pattern-service');

console.log('Testing Pattern Detection...\n');

const detector = new PatternDetector();
const service = PatternService.getInstance();

const testCases = [
  "create a test for the auth module",
  "fix the TypeError in user.service.ts",
  "refactor the React component to use hooks",
  "add a new endpoint to the Express router",
  "explain how the authentication flow works",
  "can you help me test the database connection?"
];

testCases.forEach(prompt => {
  console.log(`\nPrompt: "${prompt}"`);
  const patterns = detector.detectPatterns(prompt);
  console.log('Detected:', JSON.stringify(patterns, null, 2));
  
  // Test service enhancement
  const context = { project_id: 'test-project' };
  const enhanced = service.enhanceContext(context, prompt);
  console.log('Enhanced context includes:', Object.keys(enhanced).filter(k => k !== 'project_id').join(', '));
});
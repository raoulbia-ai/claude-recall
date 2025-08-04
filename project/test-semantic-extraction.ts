#!/usr/bin/env ts-node

import { SemanticPreferenceExtractor } from './src/services/semantic-preference-extractor';
import { HookService } from './src/services/hook';
import { MemoryService } from './src/services/memory';

console.log('🧪 Testing Semantic Preference Extraction\n');

const extractor = new SemanticPreferenceExtractor();
const hookService = HookService.getInstance();
const memoryService = MemoryService.getInstance();

// Test cases from requirements
const testCases = [
  "hey, lets put tests in test-new from now on",
  "I think tests belong in the testing folder",
  "tests go in __test__ going forward",
  "actually, save test files under src/tests",
  "you know what, use test-v2 for tests",
  // Additional natural variations
  "oh btw, tests should be in test-final moving forward",
  "let's start putting all test files in tests-dir",
  "can we put tests in the new-tests folder from now on?",
  "tests should live in spec/ directory",
  "I want test files to go in __tests__ folder",
  // Style preferences
  "use 4 spaces for indentation",
  "actually, let's use tabs instead",
  "prefer axios over fetch for http requests",
  // Process preferences
  "always run tests before committing",
  "never commit directly to main branch"
];

console.log('Testing individual extraction:\n');

for (const testCase of testCases) {
  console.log(`📝 Input: "${testCase}"`);
  
  const preference = extractor.extractPreference(testCase);
  
  if (preference) {
    console.log(`✅ Extracted:`);
    console.log(`   Key: ${preference.key}`);
    console.log(`   Value: ${preference.value}`);
    console.log(`   Confidence: ${(preference.confidence * 100).toFixed(0)}%`);
    console.log(`   Intent: ${preference.intent.category} - ${preference.intent.action}`);
    console.log(`   Override: ${preference.isOverride} ${preference.overrideSignals.length > 0 ? `(${preference.overrideSignals.join(', ')})` : ''}`);
  } else {
    console.log(`❌ No preference extracted`);
  }
  console.log();
}

// Test full integration through hook service
console.log('\n🔄 Testing full integration through HookService:\n');

async function runIntegrationTests() {

const testPrompt = "Actually, you know what? Let's put all tests in test-v3 from now on. And use 2 spaces for indentation going forward.";

const event = {
  type: 'UserPromptSubmit',
  content: testPrompt,
  timestamp: Date.now(),
  session_id: 'test-session'
};

console.log(`📝 Processing: "${testPrompt}"`);

// Process through hook service
const result = await hookService.handleUserPromptSubmit(event);

console.log(`\n✅ Result:`);
console.log(`   Preferences stored: ${result.preferences || 0}`);
console.log(`   Memories retrieved: ${result.memories || 0}`);

// Check what was stored
const activePreferences = memoryService.getActivePreferences({
  projectId: 'test-project',
  sessionId: 'test-session'
});

console.log(`\n📦 Active preferences in memory:`);
for (const pref of activePreferences) {
  if (pref.value && typeof pref.value === 'object' && 'key' in pref.value) {
    console.log(`   - ${pref.value.key}: ${pref.value.value}`);
  }
}

// Test override functionality
console.log('\n🔄 Testing preference override:\n');

const overridePrompts = [
  "save tests in test-location-1",
  "actually, put tests in test-location-2 from now on",
  "changed my mind, tests should go in test-location-3"
];

for (const prompt of overridePrompts) {
  console.log(`📝 Processing: "${prompt}"`);
  
  await hookService.handleUserPromptSubmit({
    type: 'UserPromptSubmit',
    content: prompt,
    timestamp: Date.now(),
    session_id: 'override-test'
  });
  
  const currentPrefs = memoryService.getActivePreferences({
    projectId: 'test-project',
    sessionId: 'override-test'
  });
  
  const testLocationPref = currentPrefs.find(p => 
    p.preference_key === 'test_location' || 
    (p.value && typeof p.value === 'object' && p.value.key === 'test_location')
  );
  
  if (testLocationPref && testLocationPref.value) {
    const value = typeof testLocationPref.value === 'object' ? testLocationPref.value.value : testLocationPref.value;
    console.log(`   ✅ Current test_location: ${value}`);
  }
}

console.log('\n✨ Testing complete!');
}

// Run the async tests
runIntegrationTests().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
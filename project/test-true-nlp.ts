#!/usr/bin/env npx tsx
import { HookService } from './src/services/hook';
import { MemoryService } from './src/services/memory';
import { LoggingService } from './src/services/logging';
import { ClaudeNLPAnalyzer } from './src/services/claude-nlp-analyzer';

const logger = LoggingService.getInstance();
const hookService = HookService.getInstance();
const memoryService = MemoryService.getInstance();

// Test variations of natural language preferences
const testVariations = [
  "hey, let's put tests in test-new from now on",
  "I think tests belong in the testing folder",
  "actually, use __test__ for test files",
  "you know what, save tests under src/tests",
  "moving forward, create all tests in tests-arlo",
  "from now on, I want all test files in test-v2",
  "let's start putting our tests in tests-raoul/",
  "I prefer tests to be saved in tests directory",
  "tests should be saved in tests-enhanced/ moving forward",
  "can we put tests in the tests-final folder from now on?"
];

async function testNLPIntegration() {
  console.log('🧪 Testing True NLP Integration...\n');

  for (const variation of testVariations) {
    console.log(`\n📝 Testing: "${variation}"`);
    
    // Check if it might contain a preference
    const mightContain = ClaudeNLPAnalyzer.mightContainPreference(variation);
    console.log(`  - Might contain preference: ${mightContain}`);
    
    // Create analysis marker
    if (mightContain) {
      const marker = ClaudeNLPAnalyzer.createAnalysisMarker(variation);
      console.log(`  - Analysis marker created`);
      
      // Simulate hook event
      const event = {
        type: 'user-prompt-submit',
        content: variation,
        timestamp: Date.now(),
        session_id: 'test-session'
      };
      
      // Process through hook
      const result = await hookService.handleUserPromptSubmit(event);
      console.log(`  - Preferences stored: ${result.preferences || 0}`);
      
      // Simulate Claude's response understanding
      const simulatedResponses = [
        `I'll save tests in ${extractLocation(variation)} from now on. PREF[test_location:${extractLocation(variation)}]`,
        `Understood! Tests will be placed in ${extractLocation(variation)}. PREF[test_location:${extractLocation(variation)}]`,
        `I'll create all tests in ${extractLocation(variation)} going forward. PREF[test_location:${extractLocation(variation)}]`
      ];
      
      const response = simulatedResponses[Math.floor(Math.random() * simulatedResponses.length)];
      console.log(`  - Simulated Claude response: "${response}"`);
      
      // Extract preferences from response
      const extracted = ClaudeNLPAnalyzer.extractPreferencesFromResponse(response);
      console.log(`  - Extracted preferences: ${extracted.length}`);
      
      if (extracted.length > 0) {
        console.log(`    • Key: ${extracted[0].key}, Value: ${extracted[0].value}`);
      }
      
      // Test implicit analysis
      const implicitPrefs = ClaudeNLPAnalyzer.analyzeImplicitPreferences(response, variation);
      console.log(`  - Implicit preferences: ${implicitPrefs.length}`);
    }
  }
  
  console.log('\n\n✅ True NLP Integration Test Complete!');
  
  // Show current active preferences
  const context = {
    projectId: 'claude-recall',
    timestamp: Date.now(),
    sessionId: 'test-session'
  };
  
  const activePrefs = memoryService.getActivePreferences(context);
  console.log(`\n📊 Active Preferences: ${activePrefs.length}`);
  activePrefs.forEach(pref => {
    console.log(`  - ${pref.preference_key}: ${JSON.stringify(pref.value)}`);
  });
}

function extractLocation(text: string): string {
  // Simple extraction for testing
  const patterns = [
    /in\s+([\w\-\/_]+)/,
    /under\s+([\w\-\/_]+)/,
    /to\s+([\w\-\/_]+)/
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  
  return 'tests';
}

// Run the test
testNLPIntegration().catch(console.error);
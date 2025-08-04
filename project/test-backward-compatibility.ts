#!/usr/bin/env ts-node

import { HookService } from './src/services/hook';
import { MemoryService } from './src/services/memory';

console.log('🧪 Testing Backward Compatibility\n');

const hookService = HookService.getInstance();
const memoryService = MemoryService.getInstance();

// Test that existing patterns still work
const legacyPatterns = [
  "tests should be in test-dir",
  "use axios for http requests", 
  "save config files in configs",
  "components go in src/components",
  "prefer spaces over tabs",
  "always lint before commit",
  "never push to production directly"
];

async function testLegacyPatterns() {
  console.log('Testing legacy pattern extraction:\n');
  
  for (const pattern of legacyPatterns) {
    console.log(`📝 Testing: "${pattern}"`);
    
    const event = {
      type: 'UserPromptSubmit',
      content: pattern,
      timestamp: Date.now(),
      session_id: 'legacy-test'
    };
    
    const result = await hookService.handleUserPromptSubmit(event);
    
    if (result.preferences && result.preferences > 0) {
      console.log(`✅ Extracted ${result.preferences} preference(s)`);
    } else {
      console.log(`❌ No preferences extracted`);
    }
  }
  
  // Check what was stored
  console.log('\n📦 Stored preferences:');
  const activePrefs = memoryService.getActivePreferences({
    projectId: 'test-project',
    sessionId: 'legacy-test'
  });
  
  for (const pref of activePrefs) {
    if (pref.value && typeof pref.value === 'object') {
      if ('key' in pref.value && 'value' in pref.value) {
        console.log(`   - ${pref.value.key}: ${pref.value.value}`);
      } else if ('pattern' in pref.value) {
        console.log(`   - ${pref.value.pattern}: ${pref.value.subject} ${pref.value.action} ${pref.value.object || ''}`);
      }
    }
  }
}

// Test that existing memory retrieval still works
async function testMemoryRetrieval() {
  console.log('\n\n🔍 Testing Memory Retrieval:\n');
  
  // Store some test memories
  memoryService.store({
    key: 'test-memory-1',
    value: { content: 'Previous instruction about file organization' },
    type: 'project-knowledge',
    context: { projectId: 'test-project' }
  });
  
  memoryService.store({
    key: 'test-correction-1',
    value: { original: 'test', corrected: 'tests', frequency: 3 },
    type: 'correction-pattern',
    context: { projectId: 'test-project' }
  });
  
  // Test retrieval
  const testPrompt = "I need to organize my test files";
  const event = {
    type: 'UserPromptSubmit', 
    content: testPrompt,
    timestamp: Date.now(),
    session_id: 'retrieval-test'
  };
  
  const result = await hookService.handleUserPromptSubmit(event);
  
  console.log(`📝 Query: "${testPrompt}"`);
  console.log(`✅ Memories retrieved: ${result.memories || 0}`);
  
  if (result.additionalContext) {
    console.log('\n📄 Additional context provided:');
    console.log(result.additionalContext);
  }
}

// Test that the system doesn't break with edge cases
async function testEdgeCases() {
  console.log('\n\n🔧 Testing Edge Cases:\n');
  
  const edgeCases = [
    "", // Empty string
    "   ", // Whitespace only
    "a", // Very short
    "this is just a regular message without any preferences",
    "!@#$%^&*()", // Special characters
    "test test test test test", // Repetition
    "TESTS SHOULD BE IN TEST-DIR", // All caps
    "tests should be in test-dir!!!", // Extra punctuation
  ];
  
  for (const testCase of edgeCases) {
    console.log(`📝 Testing: "${testCase}"`);
    
    try {
      const event = {
        type: 'UserPromptSubmit',
        content: testCase,
        timestamp: Date.now(), 
        session_id: 'edge-test'
      };
      
      const result = await hookService.handleUserPromptSubmit(event);
      console.log(`✅ Handled successfully (preferences: ${result.preferences || 0})`);
    } catch (error) {
      console.log(`❌ Error: ${error}`);
    }
  }
}

// Run all tests
async function runAllTests() {
  await testLegacyPatterns();
  await testMemoryRetrieval();
  await testEdgeCases();
  
  console.log('\n\n✨ Backward compatibility testing complete!');
}

runAllTests().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
#!/usr/bin/env npx tsx
import { HookService } from './src/services/hook';
import { MemoryService } from './src/services/memory';
import { ClaudeNLPAnalyzer } from './src/services/claude-nlp-analyzer';

const hookService = HookService.getInstance();
const memoryService = MemoryService.getInstance();

// Simulate a real conversation flow
async function simulateConversation() {
  console.log('🎭 Simulating Claude Code conversation with NLP preference understanding...\n');
  
  const sessionId = 'nlp-test-' + Date.now();
  
  // User asks Claude to save tests in a specific location
  console.log('👤 User: "hey, let\'s put tests in test-new from now on"\n');
  
  // Step 1: User prompt goes through hook
  const userEvent = {
    type: 'user-prompt-submit',
    content: "hey, let's put tests in test-new from now on",
    timestamp: Date.now(),
    session_id: sessionId
  };
  
  const hookResult = await hookService.handleUserPromptSubmit(userEvent);
  
  console.log('🪝 Hook processed:');
  console.log('  - Preferences extracted:', hookResult.preferences || 0);
  console.log('  - Additional context added:', !!hookResult.additionalContext);
  
  if (hookResult.additionalContext) {
    // Show what Claude sees (without the hidden marker)
    const visibleContext = hookResult.additionalContext.replace(/<!-- .* -->/s, '');
    console.log('\n📋 Visible context for Claude:');
    console.log(visibleContext);
    
    // Check for hidden analysis marker
    const hasHiddenMarker = hookResult.additionalContext.includes('PREFERENCE_ANALYSIS:');
    console.log('\n🔍 Hidden analysis marker present:', hasHiddenMarker);
  }
  
  // Step 2: Simulate Claude's response with preference understanding
  console.log('\n🤖 Claude: "I\'ll save all tests in test-new from now on. PREF[test_location:test-new]"\n');
  
  const claudeResponse = "I'll save all tests in test-new from now on. PREF[test_location:test_new]";
  
  // Step 3: Process Claude's response to extract NLP preferences
  await hookService.handleClaudeResponse(claudeResponse, userEvent.content, userEvent);
  
  // Step 4: Verify preferences were stored
  const context = {
    projectId: 'claude-recall',
    timestamp: Date.now(),
    sessionId: sessionId
  };
  
  const activePrefs = memoryService.getActivePreferences(context);
  console.log('✅ Active preferences after NLP analysis:');
  activePrefs.forEach(pref => {
    if (pref.preference_key === 'test_location') {
      console.log(`  - ${pref.preference_key}: ${JSON.stringify(pref.value)}`);
    }
  });
  
  // Test another variation
  console.log('\n\n--- Testing another variation ---\n');
  console.log('👤 User: "actually, I think tests belong in the testing-v2 folder"\n');
  
  const userEvent2 = {
    type: 'user-prompt-submit',
    content: "actually, I think tests belong in the testing-v2 folder",
    timestamp: Date.now() + 1000,
    session_id: sessionId
  };
  
  const hookResult2 = await hookService.handleUserPromptSubmit(userEvent2);
  console.log('🪝 Hook processed:', hookResult2.preferences || 0, 'preferences');
  
  // Simulate Claude understanding the implicit preference
  const claudeResponse2 = "Understood! I'll place all tests in the testing-v2 folder from now on. PREF[test_location:testing-v2]";
  console.log('\n🤖 Claude:', claudeResponse2);
  
  await hookService.handleClaudeResponse(claudeResponse2, userEvent2.content, userEvent2);
  
  // Check updated preferences
  const updatedPrefs = memoryService.getActivePreferences(context);
  console.log('\n✅ Updated preferences:');
  updatedPrefs.forEach(pref => {
    if (pref.preference_key === 'test_location') {
      console.log(`  - ${pref.preference_key}: ${JSON.stringify(pref.value)} (active: ${pref.is_active})`);
    }
  });
  
  // Test implicit understanding without markers
  console.log('\n\n--- Testing implicit understanding ---\n');
  console.log('👤 User: "can we save all the unit tests in __tests__ directory?"\n');
  
  const userEvent3 = {
    type: 'user-prompt-submit', 
    content: "can we save all the unit tests in __tests__ directory?",
    timestamp: Date.now() + 2000,
    session_id: sessionId
  };
  
  await hookService.handleUserPromptSubmit(userEvent3);
  
  // Claude responds naturally without explicit markers
  const claudeResponse3 = "Sure! I'll save all unit tests in the __tests__ directory going forward.";
  console.log('🤖 Claude:', claudeResponse3);
  
  await hookService.handleClaudeResponse(claudeResponse3, userEvent3.content, userEvent3);
  
  // Extract implicit preferences
  const implicitPrefs = ClaudeNLPAnalyzer.analyzeImplicitPreferences(claudeResponse3, userEvent3.content);
  console.log('\n🔍 Implicit preferences detected:', implicitPrefs.length);
  implicitPrefs.forEach(pref => {
    console.log(`  - ${pref.key}: ${pref.value} (confidence: ${pref.confidence})`);
  });
  
  console.log('\n\n🎉 NLP Integration demonstration complete!');
}

// Run the simulation
simulateConversation().catch(console.error);
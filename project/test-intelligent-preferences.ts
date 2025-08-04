#!/usr/bin/env npx ts-node

import { PreferenceExtractor } from './src/services/preference-extractor';
import { HookService } from './src/services/hook';
import { MemoryService } from './src/services/memory';

/**
 * Test script for intelligent preference system
 */

async function testPreferenceExtraction() {
  console.log('🧪 Testing Intelligent Preference System\n');
  
  const extractor = new PreferenceExtractor();
  const hookService = HookService.getInstance();
  const memoryService = MemoryService.getInstance();
  
  // Test scenarios from the requirements
  const testCases = [
    {
      name: 'Natural Language - Moving Forward',
      input: 'moving forward, create all tests in tests-arlo',
      expectedKey: 'test_location',
      expectedValue: 'tests-arlo',
      expectedOverride: true
    },
    {
      name: 'Natural Language - From Now On',
      input: 'from now on, use 4 spaces instead of tabs for indentation',
      expectedKey: 'indentation',
      expectedValue: '4_spaces',
      expectedOverride: true
    },
    {
      name: 'Natural Language - Preference Expression',
      input: 'I prefer axios over fetch for API calls',
      expectedKey: 'http_client',
      expectedValue: 'axios',
      expectedOverride: false
    },
    {
      name: 'Override Signal - Actually',
      input: 'actually, save the test files in __tests__ instead',
      expectedKey: 'test_location',
      expectedValue: '__tests__',
      expectedOverride: true
    },
    {
      name: 'Override Signal - Changed Mind',
      input: 'I changed my mind, put tests in test-new',
      expectedKey: 'test_location',
      expectedValue: 'test-new',
      expectedOverride: true
    },
    {
      name: 'Framework Choice',
      input: 'use jest for testing going forward',
      expectedKey: 'test_framework',
      expectedValue: 'jest',
      expectedOverride: true
    }
  ];
  
  console.log('📋 Testing Preference Extraction:\n');
  
  for (const testCase of testCases) {
    console.log(`🔍 ${testCase.name}`);
    console.log(`   Input: "${testCase.input}"`);
    
    const preferences = extractor.extractPreferences(testCase.input);
    
    if (preferences.length === 0) {
      console.log(`   ❌ No preferences extracted`);
      continue;
    }
    
    const pref = preferences[0]; // Test first preference
    console.log(`   ✅ Extracted: ${pref.key} = ${pref.value}`);
    console.log(`   📊 Confidence: ${pref.confidence.toFixed(2)}`);
    console.log(`   🔄 Override: ${pref.isOverride}`);
    
    if (pref.overrideSignals.length > 0) {
      console.log(`   🔔 Override Signals: ${pref.overrideSignals.join(', ')}`);
    }
    
    // Validate against expected results
    const keyMatch = pref.key === testCase.expectedKey;
    const valueMatch = pref.value === testCase.expectedValue;
    const overrideMatch = pref.isOverride === testCase.expectedOverride;
    
    if (keyMatch && valueMatch && overrideMatch) {
      console.log(`   ✅ All expectations met!\n`);
    } else {
      console.log(`   ⚠️  Expectations:`);
      console.log(`       Key: ${testCase.expectedKey} (${keyMatch ? '✅' : '❌'})`);
      console.log(`       Value: ${testCase.expectedValue} (${valueMatch ? '✅' : '❌'})`);
      console.log(`       Override: ${testCase.expectedOverride} (${overrideMatch ? '✅' : '❌'})\n`);
    }
  }
}

async function testOverrideScenario() {
  console.log('🔄 Testing Override Scenario:\n');
  
  const hookService = HookService.getInstance();
  const memoryService = MemoryService.getInstance();
  
  // Clear any existing test preferences
  console.log('🧹 Clearing existing test preferences...');
  
  // Test override scenario
  const sessionId = `test_session_${Date.now()}`;
  const baseContext = {
    type: 'user_prompt_submit',
    timestamp: Date.now(),
    session_id: sessionId
  };
  
  console.log('1️⃣ Setting initial preference: "tests should be saved in tests-raoul"');
  await hookService.handleUserPromptSubmit({
    ...baseContext,
    content: 'tests should be saved in tests-raoul'
  });
  
  // Check active preferences
  let activePrefs = memoryService.getActivePreferences({ sessionId });
  console.log(`   Active preferences: ${activePrefs.length}`);
  activePrefs.forEach(p => {
    const val = p.value;
    console.log(`   - ${val.key || 'unknown'}: ${val.value || val.object} (active: ${p.is_active})`);
  });
  
  console.log('\n2️⃣ Override with: "moving forward, create all tests in tests-arlo"');
  await hookService.handleUserPromptSubmit({
    ...baseContext,
    content: 'moving forward, create all tests in tests-arlo',
    timestamp: Date.now() + 1000 // Ensure later timestamp
  });
  
  // Check active preferences after override
  activePrefs = memoryService.getActivePreferences({ sessionId });
  console.log(`   Active preferences: ${activePrefs.length}`);
  activePrefs.forEach(p => {
    const val = p.value;
    console.log(`   - ${val.key || 'unknown'}: ${val.value || val.object} (active: ${p.is_active})`);
  });
  
  console.log('\n3️⃣ Another override: "actually, I changed my mind, put tests in __tests__"');
  await hookService.handleUserPromptSubmit({
    ...baseContext,
    content: 'actually, I changed my mind, put tests in __tests__',
    timestamp: Date.now() + 2000
  });
  
  // Final check
  activePrefs = memoryService.getActivePreferences({ sessionId });
  console.log(`   Final active preferences: ${activePrefs.length}`);
  activePrefs.forEach(p => {
    const val = p.value;
    console.log(`   - ${val.key || 'unknown'}: ${val.value || val.object} (active: ${p.is_active})`);
  });
  
  // Verify only the latest preference is active
  const testLocationPrefs = activePrefs.filter(p => 
    p.preference_key === 'test_location' || 
    (p.value.key && p.value.key === 'test_location')
  );
  
  if (testLocationPrefs.length === 1) {
    const finalPref = testLocationPrefs[0];
    const expectedValue = '__tests__';
    const actualValue = finalPref.value.value || finalPref.value.object;
    
    if (actualValue === expectedValue) {
      console.log(`\n✅ SUCCESS: Only latest preference active (${actualValue})`);
    } else {
      console.log(`\n❌ FAILURE: Expected ${expectedValue}, got ${actualValue}`);
    }
  } else {
    console.log(`\n❌ FAILURE: Expected 1 test_location preference, got ${testLocationPrefs.length}`);
  }
}

async function testPerformance() {
  console.log('⚡ Testing Performance:\n');
  
  const extractor = new PreferenceExtractor();
  const testPrompt = 'moving forward, create all tests in tests-arlo and use 4 spaces for indentation';
  
  const iterations = 100;
  const startTime = Date.now();
  
  for (let i = 0; i < iterations; i++) {
    extractor.extractPreferences(testPrompt);
  }
  
  const endTime = Date.now();
  const totalTime = endTime - startTime;
  const avgTime = totalTime / iterations;
  
  console.log(`📊 Performance Results:`);
  console.log(`   Total iterations: ${iterations}`);
  console.log(`   Total time: ${totalTime}ms`);
  console.log(`   Average time per extraction: ${avgTime.toFixed(2)}ms`);
  
  if (avgTime < 100) {
    console.log(`   ✅ Performance target met (<100ms)`);
  } else {
    console.log(`   ⚠️  Performance target missed (${avgTime.toFixed(2)}ms > 100ms)`);
  }
}

async function main() {
  try {
    await testPreferenceExtraction();
    console.log('\n' + '='.repeat(60) + '\n');
    
    await testOverrideScenario();
    console.log('\n' + '='.repeat(60) + '\n');
    
    await testPerformance();
    
    console.log('\n🎉 All tests completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  } finally {
    // Clean up
    MemoryService.getInstance().close();
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  main();
}

export { testPreferenceExtraction, testOverrideScenario, testPerformance };
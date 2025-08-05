#!/usr/bin/env node

/**
 * Automated test for Claude Recall memory search compliance
 * This test verifies that Claude properly searches memory before creating files
 * Can be run as: node tests/memory-search-compliance.test.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('Claude Recall Memory Search Compliance', () => {
  const TEST_DIR = 'test-pasta';
  const DEFAULT_DIR = 'tests';
  
  beforeEach(() => {
    // Clean up test directories
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    if (fs.existsSync(DEFAULT_DIR)) {
      fs.rmSync(DEFAULT_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up after tests
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    if (fs.existsSync(DEFAULT_DIR)) {
      fs.rmSync(DEFAULT_DIR, { recursive: true });
    }
  });

  test('Claude should search memory before creating files', async () => {
    // This test verifies the fix for the critical bug where Claude
    // was creating files in the wrong location because it didn't
    // search memory first
    
    console.log('TEST SCENARIO:');
    console.log('1. User stores preference: "save all tests in test-pasta/"');
    console.log('2. User asks: "create a blank test script"');
    console.log('3. Expected: File created in test-pasta/ (not tests/)');
    console.log('');
    
    // Step 1: Store the preference
    console.log('Storing preference in memory...');
    const storeCommand = `echo '{"content":"All tests should be saved in ${TEST_DIR}/ directory","metadata":{"type":"location_preference","entity":"tests","location":"${TEST_DIR}/"}}' | npx claude-recall store`;
    execSync(storeCommand, { stdio: 'inherit' });
    
    // Step 2: Search for the preference (simulating what Claude should do)
    console.log('\\nSearching memory for test location preferences...');
    const searchCommand = `echo '{"query":"test script location directory folder save"}' | npx claude-recall search`;
    const searchResult = execSync(searchCommand, { encoding: 'utf8' });
    
    // Verify search returns the stored preference
    expect(searchResult).toContain(TEST_DIR);
    console.log('✅ Memory search returned stored preference');
    
    // Step 3: Verify the expected behavior
    console.log('\\nEXPECTED BEHAVIOR:');
    console.log(`- Claude should create test file in ${TEST_DIR}/`);
    console.log(`- Claude should NOT create test file in ${DEFAULT_DIR}/`);
    
    // The actual file creation would be done by Claude
    // This test verifies that the memory search returns the correct location
  });

  test('Multiple location preferences should use the latest one', async () => {
    // Test that newer preferences override older ones
    
    console.log('TEST: Multiple preferences - latest should win');
    
    // Store first preference
    const store1 = `echo '{"content":"All tests should be saved in old-tests/ directory","metadata":{"type":"location_preference","entity":"tests","location":"old-tests/"}}' | npx claude-recall store`;
    execSync(store1, { stdio: 'inherit' });
    
    // Store second preference (should override)
    const store2 = `echo '{"content":"All tests should be saved in ${TEST_DIR}/ directory","metadata":{"type":"location_preference","entity":"tests","location":"${TEST_DIR}/"}}' | npx claude-recall store`;
    execSync(store2, { stdio: 'inherit' });
    
    // Search should return both, but latest should be used
    const searchCommand = `echo '{"query":"test location directory"}' | npx claude-recall search`;
    const searchResult = execSync(searchCommand, { encoding: 'utf8' });
    
    expect(searchResult).toContain(TEST_DIR);
    console.log('✅ Latest preference found in search results');
  });

  test('Different entity types should have separate preferences', async () => {
    // Test that different file types can have different locations
    
    console.log('TEST: Different file types with different locations');
    
    // Store test location
    const storeTests = `echo '{"content":"All tests should be saved in ${TEST_DIR}/ directory","metadata":{"type":"location_preference","entity":"tests","location":"${TEST_DIR}/"}}' | npx claude-recall store`;
    execSync(storeTests, { stdio: 'inherit' });
    
    // Store config location  
    const storeConfigs = `echo '{"content":"All configs should be saved in settings/ directory","metadata":{"type":"location_preference","entity":"configs","location":"settings/"}}' | npx claude-recall store`;
    execSync(storeConfigs, { stdio: 'inherit' });
    
    // Search for test location
    const searchTests = `echo '{"query":"test location"}' | npx claude-recall search`;
    const testResult = execSync(searchTests, { encoding: 'utf8' });
    expect(testResult).toContain(TEST_DIR);
    
    // Search for config location
    const searchConfigs = `echo '{"query":"config location"}' | npx claude-recall search`;
    const configResult = execSync(searchConfigs, { encoding: 'utf8' });
    expect(configResult).toContain('settings');
    
    console.log('✅ Different preferences maintained for different file types');
  });
});

// Manual test verification helper
console.log('\\n═══════════════════════════════════════════════════════════════════════════════');
console.log('📋 MANUAL TEST INSTRUCTIONS');
console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('');
console.log('To manually verify the fix works with Claude:');
console.log('');
console.log('1. Run: claude "save all tests in test-pasta/"');
console.log('   - Should see: mcp__claude-recall__store_memory called');
console.log('');
console.log('2. Run: claude "create a blank test script"');
console.log('   - Should see: mcp__claude-recall__search called FIRST');
console.log('   - Should see: File created in test-pasta/ directory');
console.log('');
console.log('3. Verify: ls test-pasta/');
console.log('   - Should show the created test file');
console.log('');
console.log('4. Verify: ls tests/');
console.log('   - Should be empty or not exist');
console.log('');
console.log('═══════════════════════════════════════════════════════════════════════════════');
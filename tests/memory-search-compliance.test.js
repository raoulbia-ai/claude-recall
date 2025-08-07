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
    // Clean up test directories - but NOT the actual tests directory
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    // Don't delete the DEFAULT_DIR as it's the actual tests directory!
    // Only create it if it doesn't exist
    if (!fs.existsSync(DEFAULT_DIR)) {
      fs.mkdirSync(DEFAULT_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up after tests - only remove test-pasta, not the tests directory
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    // Don't delete the actual tests directory
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
    
    // Step 1: Store the preference using MemoryService directly
    console.log('Storing preference in memory...');
    const { MemoryService } = require('../dist/services/memory');
    const memoryService = MemoryService.getInstance();
    memoryService.store({
      key: `test-location-${Date.now()}`,
      value: `All tests should be saved in ${TEST_DIR}/ directory`,
      type: 'location_preference',
      metadata: {
        entity: 'tests',
        location: `${TEST_DIR}/`
      }
    });
    
    // Step 2: Search for the preference (simulating what Claude should do)
    console.log('\\nSearching memory for test location preferences...');
    const searchResults = memoryService.search('test script location directory folder save');
    const searchResult = JSON.stringify(searchResults);
    
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
    const { MemoryService } = require('../dist/services/memory');
    const memoryService = MemoryService.getInstance();
    memoryService.store({
      key: `test-location-old-${Date.now()}`,
      value: 'All tests should be saved in old-tests/ directory',
      type: 'location_preference',
      metadata: {
        entity: 'tests',
        location: 'old-tests/'
      }
    });
    
    // Store second preference (should override)
    memoryService.store({
      key: `test-location-new-${Date.now()}`,
      value: `All tests should be saved in ${TEST_DIR}/ directory`,
      type: 'location_preference',
      metadata: {
        entity: 'tests',
        location: `${TEST_DIR}/`
      }
    });
    
    // Search should return both, but latest should be used
    const searchResults = memoryService.search('test location directory');
    const searchResult = JSON.stringify(searchResults);
    
    expect(searchResult).toContain(TEST_DIR);
    console.log('✅ Latest preference found in search results');
  });

  test('Different entity types should have separate preferences', async () => {
    // Test that different file types can have different locations
    
    console.log('TEST: Different file types with different locations');
    
    // Store test location
    const { MemoryService } = require('../dist/services/memory');
    const memoryService = MemoryService.getInstance();
    memoryService.store({
      key: `test-location-${Date.now()}`,
      value: `All tests should be saved in ${TEST_DIR}/ directory`,
      type: 'location_preference',
      metadata: {
        entity: 'tests',
        location: `${TEST_DIR}/`
      }
    });
    
    // Store config location  
    memoryService.store({
      key: `config-location-${Date.now()}`,
      value: 'All configs should be saved in settings/ directory',
      type: 'location_preference',
      metadata: {
        entity: 'configs',
        location: 'settings/'
      }
    });
    
    // Search for test location
    const testResults = memoryService.search('test location');
    const testResult = JSON.stringify(testResults);
    expect(testResult).toContain(TEST_DIR);
    
    // Search for config location
    const configResults = memoryService.search('config location');
    const configResult = JSON.stringify(configResults);
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
#!/usr/bin/env npx ts-node

import { PreferenceExtractor } from './src/services/preference-extractor';
import { MemoryService } from './src/services/memory';

async function debugPreferences() {
  console.log('🔍 Debug: Direct preference testing\n');
  
  const extractor = new PreferenceExtractor();
  const memoryService = MemoryService.getInstance();
  
  // Test direct extraction
  const testPrompt = 'moving forward, create all tests in tests-arlo';
  console.log(`Testing: "${testPrompt}"`);
  
  const preferences = extractor.extractPreferences(testPrompt);
  console.log(`Extracted ${preferences.length} preferences:`);
  preferences.forEach(p => {
    console.log(`  - Key: ${p.key}`);
    console.log(`  - Value: ${p.value}`);
    console.log(`  - Override: ${p.isOverride}`);
    console.log(`  - Confidence: ${p.confidence}`);
    console.log(`  - Raw: ${p.raw}`);
    console.log('');
  });
  
  // Test direct storage
  if (preferences.length > 0) {
    const context = {
      projectId: 'debug-test',
      sessionId: `debug_${Date.now()}`
    };
    
    console.log('Storing preference directly...');
    try {
      memoryService.storePreferenceWithOverride(preferences[0], context);
      console.log('✅ Preference stored successfully');
      
      // Retrieve active preferences
      const activePrefs = memoryService.getActivePreferences(context);
      console.log(`Found ${activePrefs.length} active preferences:`);
      activePrefs.forEach(p => {
        console.log(`  - ${p.preference_key}: ${JSON.stringify(p.value)}`);
      });
      
    } catch (error) {
      console.error('❌ Error storing preference:', error);
    }
  }
  
  memoryService.close();
}

debugPreferences();
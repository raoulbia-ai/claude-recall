#!/usr/bin/env npx tsx
/**
 * Demo: True NLP Integration for Claude Recall
 * 
 * This demonstrates how Claude Code now understands natural language
 * preferences without hardcoded patterns.
 */

import { HookService } from './src/services/hook';
import { ClaudeNLPAnalyzer } from './src/services/claude-nlp-analyzer';
import chalk from 'chalk';

const hookService = HookService.getInstance();

async function demo() {
  console.log(chalk.bold.blue('\n🎯 Claude Recall - True NLP Integration Demo\n'));
  
  // Test cases showing natural language understanding
  const testCases = [
    {
      user: "moving forward, create all tests in tests-arlo",
      claude: "I'll create all tests in tests-arlo from now on. PREF[test_location:tests-arlo]"
    },
    {
      user: "hey, let's start putting our unit tests in __tests__ folder",
      claude: "Sure! I'll place all unit tests in the __tests__ folder going forward. PREF[test_location:__tests__]"
    },
    {
      user: "I think test files should go in src/testing from now on",
      claude: "Understood! Test files will be saved in src/testing from now on. PREF[test_location:src/testing]"
    },
    {
      user: "actually, can we save tests under tests-v2 instead?",
      claude: "Of course! I'll save tests under tests-v2 instead. PREF[test_location:tests-v2]"
    }
  ];

  for (const testCase of testCases) {
    console.log(chalk.yellow('👤 User:'), testCase.user);
    
    // Process user input through hook
    const event = {
      type: 'user-prompt-submit',
      content: testCase.user,
      timestamp: Date.now(),
      session_id: 'demo-' + Date.now()
    };
    
    const result = await hookService.handleUserPromptSubmit(event);
    
    // Show what the system detected
    if (ClaudeNLPAnalyzer.mightContainPreference(testCase.user)) {
      console.log(chalk.green('✓'), 'Preference detected');
      
      // Show Claude's response
      console.log(chalk.cyan('🤖 Claude:'), testCase.claude);
      
      // Process Claude's response
      await hookService.handleClaudeResponse(testCase.claude, testCase.user, event);
      
      // Extract and show the understood preference
      const prefs = ClaudeNLPAnalyzer.extractPreferencesFromResponse(testCase.claude);
      if (prefs.length > 0) {
        console.log(chalk.magenta('📌 Stored:'), 
          `${prefs[0].key} = ${prefs[0].value} (confidence: ${prefs[0].confidence})`);
      }
    }
    
    console.log('');
  }
  
  console.log(chalk.bold.green('✨ Demo Complete!'));
  console.log(chalk.gray('\nThe system now understands natural language preferences'));
  console.log(chalk.gray('without any hardcoded patterns - Claude does the NLP!'));
}

// Run demo
demo().catch(console.error);
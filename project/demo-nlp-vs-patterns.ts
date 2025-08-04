#!/usr/bin/env npx tsx

import { SemanticPreferenceExtractor } from './src/services/semantic-preference-extractor';
import { IntelligentPreferenceExtractor } from './src/services/intelligent-preference-extractor';
import { LoggingService } from './src/services/logging';

async function compareExtractors() {
  console.log('🤖 Claude Recall - Pattern Matching vs True NLP Comparison\n');
  
  const logger = LoggingService.getInstance();
  logger.setLogLevel('error'); // Suppress debug logs for cleaner output
  
  const patternExtractor = new SemanticPreferenceExtractor();
  const nlpExtractor = new IntelligentPreferenceExtractor(process.env.ANTHROPIC_API_KEY);
  
  // Test cases that demonstrate NLP superiority
  const testCases = [
    // Case 1: Contextual understanding
    "I've been thinking about it, and you know what? Tests really belong in a tests-raoul directory. That just makes more sense for our project structure.",
    
    // Case 2: Natural language variations
    "Whenever you're writing tests, make sure they end up in the tests-raoul folder. That's where I want them from now on.",
    
    // Case 3: Implicit preferences
    "I noticed you used 2 spaces for indentation. I actually prefer tabs - they're more flexible.",
    
    // Case 4: Complex reasoning
    "Since we're using TypeScript now, let's adopt a more strict coding style. Use tabs for indentation and always include semicolons at the end of statements.",
    
    // Case 5: Conversational override
    "Actually, forget what I said earlier. Put the test files in __tests__ instead. That's more standard.",
    
    // Case 6: Ambiguous language
    "The way you're saving config files is fine, but for this project specifically, configs should live under a .config directory",
    
    // Case 7: Multiple preferences in context
    "Looking at the code, I think we should use Vitest for testing since it's faster, and all test files should go in src/__tests__. Oh, and stick with 2 spaces for indentation - tabs are too wide in our editor.",
    
    // Case 8: Corrections without explicit statement
    "No no, not 'tests', use 'specs' for the test directory name. And while we're at it, specs/unit and specs/integration would be even better.",
  ];
  
  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    console.log(`\n📝 Test Case ${i + 1}:`);
    console.log(`Input: "${testCase}"\n`);
    
    // Pattern-based extraction
    console.log('🔍 Pattern-Based Extraction:');
    const patternResults = patternExtractor.extractAllPreferences(testCase);
    if (patternResults.length === 0) {
      console.log('  ❌ No preferences detected');
    } else {
      patternResults.forEach(pref => {
        console.log(`  ✓ ${pref.key} = ${pref.value} (confidence: ${pref.confidence.toFixed(2)})`);
        console.log(`    Intent: ${pref.intent.category} - ${pref.intent.action}`);
        if (pref.isOverride) {
          console.log(`    Override signals: ${pref.overrideSignals.join(', ')}`);
        }
      });
    }
    
    // NLP-based extraction
    console.log('\n🧠 NLP-Based Extraction:');
    try {
      const nlpResults = await nlpExtractor.extractPreferences(testCase);
      if (nlpResults.length === 0) {
        console.log('  ❌ No preferences detected');
      } else {
        nlpResults.forEach(pref => {
          console.log(`  ✓ ${pref.key} = ${pref.value} (confidence: ${pref.confidence.toFixed(2)})`);
          console.log(`    Analysis: ${pref.analysis.reasoning}`);
          console.log(`    Intent: ${pref.analysis.intent.type} (${pref.analysis.intent.confidence.toFixed(2)})`);
          console.log(`    Context: ${pref.analysis.context.emotional_tone} tone, ${pref.analysis.context.urgency} urgency`);
          if (pref.metadata.source === 'inferred') {
            console.log(`    📊 Inferred preference from context`);
          }
        });
      }
    } catch (error) {
      console.log('  ⚠️  NLP extraction failed (API key may be missing)');
      console.log(`     Set ANTHROPIC_API_KEY to enable NLP extraction`);
    }
    
    console.log('\n' + '─'.repeat(80));
  }
  
  // Summary comparison
  console.log('\n📊 Key Differences:\n');
  console.log('Pattern-Based Approach:');
  console.log('  • Uses regex patterns to match specific phrases');
  console.log('  • Limited to predefined patterns');
  console.log('  • Cannot understand context or intent');
  console.log('  • Misses subtle or conversational preferences');
  console.log('  • Fast but inflexible');
  
  console.log('\nNLP-Based Approach:');
  console.log('  • Uses language model to understand meaning');
  console.log('  • Handles any natural language expression');
  console.log('  • Understands context, tone, and intent');
  console.log('  • Can infer implicit preferences');
  console.log('  • Detects override signals naturally');
  console.log('  • Can suggest related preferences');
  console.log('  • Slightly slower but highly accurate');
}

// Run the comparison
compareExtractors().catch(console.error);
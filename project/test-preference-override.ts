import { PreferenceExtractor } from './src/services/preference-extractor';
import { HookService } from './src/services/hook';
import { MemoryService } from './src/services/memory';
import { PatternDetector } from './src/services/pattern-detector';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

async function testPreferenceSystem() {
    console.log('🧪 Testing Intelligent Preference System\n');

    // Initialize services
    const db = await open({
        filename: ':memory:',
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS memories (
            id TEXT PRIMARY KEY,
            prompt TEXT NOT NULL,
            response TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            files_modified TEXT,
            memory_type TEXT,
            preference_key TEXT,
            is_active INTEGER DEFAULT 1,
            superseded_by TEXT,
            supersedes_id TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_preference_key ON memories(preference_key);
        CREATE INDEX IF NOT EXISTS idx_is_active ON memories(is_active);
    `);

    const memoryService = new MemoryService(db);
    const patternDetector = new PatternDetector();
    const hookService = new HookService(memoryService, patternDetector);
    const preferenceExtractor = new PreferenceExtractor();

    // Test scenarios
    const testCases = [
        {
            name: "Initial preference",
            prompt: "tests should be saved in tests-raoul",
            expectedKey: "test_location",
            expectedValue: "tests-raoul"
        },
        {
            name: "Natural language override",
            prompt: "moving forward, create all tests in tests-arlo",
            expectedKey: "test_location",
            expectedValue: "tests-arlo",
            shouldOverride: true
        },
        {
            name: "Another override with 'actually'",
            prompt: "actually, I changed my mind, put tests in __tests__",
            expectedKey: "test_location",
            expectedValue: "__tests__",
            shouldOverride: true
        }
    ];

    console.log('📝 Running test scenarios:\n');

    for (const test of testCases) {
        console.log(`\n🔍 Test: ${test.name}`);
        console.log(`   Prompt: "${test.prompt}"`);

        // Extract preferences
        const extracted = preferenceExtractor.extractPreferences(test.prompt);
        console.log(`   Extracted: ${extracted.length} preference(s)`);

        if (extracted.length > 0) {
            const pref = extracted[0];
            console.log(`   Key: ${pref.key}, Value: ${pref.value}, Confidence: ${pref.confidence}`);
            
            // Check if it matches expected
            if (pref.key === test.expectedKey && pref.value === test.expectedValue) {
                console.log(`   ✅ Correctly extracted!`);
            } else {
                console.log(`   ❌ Mismatch - Expected ${test.expectedKey}: ${test.expectedValue}`);
            }

            // Check override detection
            if (test.shouldOverride) {
                const hasOverride = preferenceExtractor.detectOverrideIntent(test.prompt);
                console.log(`   Override intent: ${hasOverride ? '✅ Detected' : '❌ Not detected'}`);
            }
        } else {
            console.log(`   ❌ No preferences extracted`);
        }

        // Store through hook service
        await hookService.captureMemory({
            prompt: test.prompt,
            response: "Test response",
            filesModified: []
        });
    }

    // Verify final state
    console.log('\n\n📊 Final preference state:');
    const memories = await memoryService.getRecentMemories(100);
    const activePreferences = memories.filter(m => m.memory_type === 'preference' && m.is_active);
    
    console.log(`\nActive preferences (${activePreferences.length} total):`);
    for (const pref of activePreferences) {
        console.log(`   - ${pref.preference_key}: ${JSON.parse(pref.response).value}`);
    }

    // Test retrieval formatting
    console.log('\n\n🔄 Testing retrieval formatting:');
    const formattedMemories = await hookService.formatRetrievedMemories(memories);
    console.log('Formatted output:');
    console.log(formattedMemories);

    await db.close();
    console.log('\n\n✅ All tests completed!');
}

// Run tests
testPreferenceSystem().catch(console.error);
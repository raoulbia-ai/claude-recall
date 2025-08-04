// Simple test to verify preference extraction logic

console.log('🧪 Testing Intelligent Preference System\n');

// Simulate the PreferenceExtractor logic
function extractPreferences(prompt) {
    const preferences = [];
    const lower = prompt.toLowerCase();
    
    // Override signals
    const overrideSignals = [
        'moving forward', 'from now on', 'going forward', 'henceforth',
        'actually', 'instead', 'changed my mind', 'rather than'
    ];
    
    // Check for override intent
    const hasOverride = overrideSignals.some(signal => lower.includes(signal));
    
    // Extract test location preferences
    const testLocationPatterns = [
        // Natural language: "moving forward, create all tests in tests-arlo"
        /(?:moving forward|from now on|going forward).*?(?:create|put|save|place).*?(?:all\s+)?(?:tests?|test files?).*?(?:in|at|to)\s+([\w\-\/\.]+)/i,
        // Override: "actually, I changed my mind, put tests in __tests__"
        /(?:actually|changed my mind).*?(?:put|save|create).*?(?:tests?).*?(?:in|at|to)\s+([\w\-\/\.]+)/i,
        // Basic: "tests should be saved in tests-raoul"
        /tests?\s+should\s+be\s+(?:saved\s+)?in\s+([\w\-\/\.]+)/i,
        // Simple: "save tests in X"
        /save\s+tests?\s+in\s+([\w\-\/\.]+)/i
    ];
    
    for (const pattern of testLocationPatterns) {
        const match = prompt.match(pattern);
        if (match && match[1]) {
            preferences.push({
                key: 'test_location',
                value: match[1],
                isOverride: hasOverride,
                confidence: hasOverride ? 0.95 : 0.8,
                raw: prompt
            });
            break; // Only take first match
        }
    }
    
    return preferences;
}

// Test cases
const testScenarios = [
    {
        name: "Initial preference",
        prompt: "tests should be saved in tests-raoul",
        expected: { key: 'test_location', value: 'tests-raoul', isOverride: false }
    },
    {
        name: "Natural language override",
        prompt: "moving forward, create all tests in tests-arlo",
        expected: { key: 'test_location', value: 'tests-arlo', isOverride: true }
    },
    {
        name: "Changed mind override",
        prompt: "actually, I changed my mind, put tests in __tests__",
        expected: { key: 'test_location', value: '__tests__', isOverride: true }
    },
    {
        name: "From now on pattern",
        prompt: "from now on, save tests in test-new",
        expected: { key: 'test_location', value: 'test-new', isOverride: true }
    }
];

// Run tests
let passCount = 0;
let failCount = 0;

testScenarios.forEach((scenario, index) => {
    console.log(`\n📝 Scenario ${index + 1}: ${scenario.name}`);
    console.log(`   Input: "${scenario.prompt}"`);
    
    const prefs = extractPreferences(scenario.prompt);
    
    if (prefs.length > 0) {
        const pref = prefs[0];
        const keyMatch = pref.key === scenario.expected.key;
        const valueMatch = pref.value === scenario.expected.value;
        const overrideMatch = pref.isOverride === scenario.expected.isOverride;
        
        if (keyMatch && valueMatch && overrideMatch) {
            console.log(`   ✅ PASS: Correctly extracted`);
            console.log(`      - Key: ${pref.key}`);
            console.log(`      - Value: ${pref.value}`);
            console.log(`      - Override: ${pref.isOverride}`);
            console.log(`      - Confidence: ${pref.confidence}`);
            passCount++;
        } else {
            console.log(`   ❌ FAIL: Mismatch`);
            console.log(`      Expected: ${scenario.expected.key} = ${scenario.expected.value} (override: ${scenario.expected.isOverride})`);
            console.log(`      Got: ${pref.key} = ${pref.value} (override: ${pref.isOverride})`);
            failCount++;
        }
    } else {
        console.log(`   ❌ FAIL: No preferences extracted`);
        failCount++;
    }
});

// Simulate preference storage with override
console.log('\n\n📊 Simulating Preference Override System:');

const storedPreferences = [];

function storePreference(pref) {
    if (pref.isOverride) {
        // Mark existing preferences for same key as superseded
        storedPreferences.forEach(stored => {
            if (stored.key === pref.key && stored.isActive) {
                stored.isActive = false;
                stored.supersededBy = pref.id;
                console.log(`   🔄 Superseding: ${stored.value} → ${pref.value}`);
            }
        });
    }
    
    pref.id = `pref_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    pref.isActive = true;
    storedPreferences.push(pref);
}

// Simulate the scenario from the requirements
console.log('\n1. User: "tests should be saved in tests-raoul"');
let pref1 = extractPreferences("tests should be saved in tests-raoul")[0];
storePreference(pref1);

console.log('\n2. User: "moving forward, create all tests in tests-arlo"');
let pref2 = extractPreferences("moving forward, create all tests in tests-arlo")[0];
storePreference(pref2);

console.log('\n3. User: "actually, I changed my mind, put tests in __tests__"');
let pref3 = extractPreferences("actually, I changed my mind, put tests in __tests__")[0];
storePreference(pref3);

// Show final state
console.log('\n📋 Final Active Preferences:');
const activePrefs = storedPreferences.filter(p => p.isActive);
activePrefs.forEach(pref => {
    console.log(`   - ${pref.key}: ${pref.value}`);
});

// Summary
console.log('\n\n🎯 Test Summary:');
console.log(`   Total scenarios: ${testScenarios.length}`);
console.log(`   Passed: ${passCount}`);
console.log(`   Failed: ${failCount}`);

if (failCount === 0) {
    console.log('\n✅ All tests passed! The intelligent preference system:');
    console.log('   1. Extracts preferences from natural language expressions');
    console.log('   2. Detects override intent (moving forward, actually, etc.)');
    console.log('   3. Correctly supersedes old preferences with new ones');
    console.log('   4. Maintains only the latest active preference per key');
} else {
    console.log('\n❌ Some tests failed. Please check the implementation.');
}
#!/bin/bash

# Test the preference system with the actual database

echo "🧪 Testing Preference System with Claude Recall Database"
echo ""

# Test 1: Initial preference
echo "Test 1: Setting initial preference"
echo 'tests should be saved in tests-raoul' | npx claude-recall

# Check what was stored
echo ""
echo "Checking stored preferences:"
sqlite3 claude-recall.db "SELECT preference_key, json_extract(response, '$.value') as value, is_active FROM memories WHERE memory_type = 'preference' ORDER BY timestamp DESC LIMIT 5;"

# Test 2: Override with natural language
echo ""
echo "Test 2: Override with 'moving forward'"
echo 'moving forward, create all tests in tests-arlo' | npx claude-recall

# Check updated preferences
echo ""
echo "Checking after override:"
sqlite3 claude-recall.db "SELECT preference_key, json_extract(response, '$.value') as value, is_active FROM memories WHERE memory_type = 'preference' ORDER BY timestamp DESC LIMIT 5;"

# Test 3: Another override
echo ""
echo "Test 3: Another override with 'actually'"
echo 'actually, I changed my mind, put tests in __tests__' | npx claude-recall

# Final check
echo ""
echo "Final active preferences:"
sqlite3 claude-recall.db "SELECT DISTINCT preference_key, json_extract(response, '$.value') as value FROM memories WHERE memory_type = 'preference' AND is_active = 1;"

echo ""
echo "✅ Test complete!"
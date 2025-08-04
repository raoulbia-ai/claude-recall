#!/bin/bash

echo "Testing intelligent memory retrieval..."
echo ""

# First, let's check what memories we have about test directories
echo "1. Current memories about test directories:"
npx claude-recall search "test directory" | head -10
echo ""

# Now test the intelligent retrieval - should find test preferences without mentioning "directory"
echo "2. Testing: 'create a test for auth' (without mentioning directory):"
echo '{"content":"create a test for auth"}' | npx claude-recall capture user-prompt
echo ""

# Test bug fix pattern
echo "3. Testing: 'fix the TypeError' (should find related error fixes):"
echo '{"content":"fix the TypeError in user service"}' | npx claude-recall capture user-prompt
echo ""

# Test that direct search still works
echo "4. Testing direct search still works: 'what database do we use?'"
echo '{"content":"what database do we use?"}' | npx claude-recall capture user-prompt
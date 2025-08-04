#!/bin/bash

# Test what our hook outputs
echo "Testing memory retrieval for 'create a test file':"
echo '{"content":"create a test file"}' | npx claude-recall capture user-prompt

echo -e "\n\nTesting memory retrieval for 'where should tests be saved?':"
echo '{"content":"where should tests be saved?"}' | npx claude-recall capture user-prompt

echo -e "\n\nTesting memory retrieval for 'fix the TypeError':"
echo '{"content":"fix the TypeError"}' | npx claude-recall capture user-prompt
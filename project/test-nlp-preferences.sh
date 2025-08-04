#!/bin/bash

echo "🧪 Testing NLP Preference System"
echo "================================"

# Test 1: Basic preference
echo -e "\n1️⃣ Testing: 'from now on, put tests in test-v2'"
echo "from now on, put tests in test-v2" | npx tsx -e "
import { HookService } from './src/services/hook';
import { MemoryService } from './src/services/memory';

const hookService = HookService.getInstance();
const memoryService = MemoryService.getInstance();

async function test() {
  const input = await new Promise(resolve => {
    let data = '';
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => resolve(data.trim()));
  });
  
  const event = {
    type: 'user-prompt-submit',
    content: input,
    timestamp: Date.now(),
    session_id: 'test-' + Date.now()
  };
  
  const result = await hookService.handleUserPromptSubmit(event);
  console.log('Hook result:', result);
  
  // Simulate Claude's response
  await hookService.handleClaudeResponse(
    'I\\'ll put all tests in test-v2 from now on. PREF[test_location:test-v2]',
    input,
    event
  );
  
  // Check what was stored
  const context = {
    projectId: 'claude-recall',
    timestamp: Date.now(),
    sessionId: event.session_id
  };
  
  const memories = await memoryService.findRelevant(context);
  const prefs = memories.filter(m => m.type === 'preference');
  console.log('Preferences stored:', prefs.length);
  prefs.forEach(p => console.log(' -', p.value));
}

test();
"

# Test 2: Check database
echo -e "\n\n2️⃣ Checking database for stored preferences:"
sqlite3 claude-recall.db "SELECT type, json_extract(value, '$.key') as key, json_extract(value, '$.value') as val FROM memories WHERE type = 'preference' ORDER BY timestamp DESC LIMIT 5;"

echo -e "\n✅ Test complete!"
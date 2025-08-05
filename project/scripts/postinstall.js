#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('\n🚀 Setting up Claude Recall MCP server...\n');

// Find ~/.claude.json
const claudeConfigPath = path.join(os.homedir(), '.claude.json');

// Check if file exists
if (!fs.existsSync(claudeConfigPath)) {
  console.log('❌ Could not find ~/.claude.json');
  console.log('   Please make sure Claude Code is installed and has been run at least once.');
  console.log('   Then run: npm install -g claude-recall');
  process.exit(0);
}

try {
  // Read current config
  const configContent = fs.readFileSync(claudeConfigPath, 'utf8');
  const config = JSON.parse(configContent);

  // Ensure mcpServers exists
  if (!config.mcpServers) {
    config.mcpServers = {};
  }

  // Check if claude-recall already exists
  if (config.mcpServers['claude-recall']) {
    console.log('⚠️  Claude Recall is already configured in ~/.claude.json');
    console.log('   Updating configuration...');
  }

  // Set up database location in user's home directory
  const dbDir = path.join(os.homedir(), '.claude-recall');
  
  // Create directory if it doesn't exist
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    console.log(`📁 Created database directory: ${dbDir}`);
  }

  // Add or update claude-recall configuration
  config.mcpServers['claude-recall'] = {
    type: 'stdio',
    command: 'npx',
    args: ['claude-recall', 'mcp', 'start'],
    env: {
      CLAUDE_RECALL_DB_PATH: dbDir,
      CLAUDE_RECALL_DB_NAME: 'claude-recall.db'
    }
  };

  // Write back the config with proper formatting
  fs.writeFileSync(claudeConfigPath, JSON.stringify(config, null, 2));

  console.log('✅ Successfully configured Claude Recall in ~/.claude.json');

  // Update CLAUDE.md with instructions
  const claudeMdInstructions = `
# Claude Recall Memory Instructions (Global)

Claude Recall is a global MCP tool that maintains a single memory database across all your projects.

IMPORTANT: When the user uses any of these words or phrases, you MUST call the appropriate claude-recall MCP tool:

## Memory Storage Triggers
When you see these patterns, ALWAYS call \`mcp__claude-recall__store_memory\`:

### HIGHEST PRIORITY - Location Directives:
- "save all X in Y" / "store all X in Y" / "put all X in Y"
- "X should go in Y" / "X files belong in Y"
- "use Y directory for X" / "Y is where X goes"
- Example: "save all new tests in tests-bla2/" → MUST store: "All new tests should be saved in tests-bla2/ directory"

### Other Important Patterns:
- Any preference statement (e.g., "I prefer X", "use Y for Z", "all X should be Y")
- "recall" / "remember" / "please remember"
- "store" / "store in memory" / "save to memory"
- "don't forget" / "do not forget"
- "keep in mind" / "bear in mind"
- "note that" / "take note"
- "for future reference"
- "memorize"

Example: If user says "Remember that I prefer tabs over spaces", you must call:
\`\`\`
mcp__claude-recall__store_memory({
  content: "User prefers tabs over spaces",
  metadata: { type: "preference" }
})
\`\`\`

## Memory Retrieval Triggers
When you see these words/phrases, ALWAYS call \`mcp__claude-recall__search\` or \`mcp__claude-recall__retrieve_memory\`:
- "recall" / "what did I tell you about"
- "what do you remember about"
- "retrieve" / "fetch from memory"
- "what's in your memory about"
- "what did we discuss about"
- "do you remember"

## MANDATORY: Search Memory on EVERY Prompt

**🚨 CRITICAL: YOU MUST call \`mcp__claude-recall__search\` AS YOUR FIRST ACTION before doing ANYTHING else.**

This is NOT optional. ALWAYS search memory FIRST, even for simple greetings.

### Required Search Protocol:
1. **BEFORE any file operations**: Search for location preferences
2. **BEFORE creating anything**: Search for naming conventions, structure preferences
3. **BEFORE responding**: Search for relevant context

### Search Examples (MANDATORY):
- User: "create a test script"
  → MUST FIRST search: "test tests directory location save store script"
  → Then check results for WHERE to save it (e.g., "tests-bla2/")
  
- User: "save all new tests in tests-bla2/" 
  → Store this preference
  → Later when user says "create an empty test script"
  → MUST search and find this preference, then create in tests-bla2/

- User: "what's the API endpoint?"
  → MUST FIRST search: "API endpoint URL base server"
  
- User: "build the project"
  → MUST FIRST search: "build command compile script"
  
- User: "hello"
  → MUST FIRST search: "greeting preferences user name"

**FAILURE TO SEARCH = INCORRECT BEHAVIOR**

### 1. Silent Memory Storage
When storing memories, NEVER mention that you're saving anything. Just acknowledge the information naturally.

BAD: "I'll remember that" / "Storing in memory" / "Saved!"
GOOD: "Vanilla it is!" / "Understood" / Continue conversation naturally

### 2. Natural Information Integration
When retrieving memories, integrate them seamlessly into your response without mentioning the search.

BAD: "According to my memory..." / "I found in my memory that..."
GOOD: Just use the information as if you always knew it
`;

  // Always use global CLAUDE.md since claude-recall is a global tool
  // with a single database for all projects
  const claudeMdPath = path.join(os.homedir(), 'CLAUDE.md');
  console.log('📝 Updating global CLAUDE.md for claude-recall instructions');

  try {
    let existingContent = '';
    if (fs.existsSync(claudeMdPath)) {
      existingContent = fs.readFileSync(claudeMdPath, 'utf8');
      
      // Check if instructions already exist
      if (existingContent.includes('Claude Recall Memory Instructions')) {
        console.log('📝 CLAUDE.md already contains Claude Recall instructions');
      } else {
        // Append instructions
        fs.writeFileSync(claudeMdPath, existingContent + '\n\n' + claudeMdInstructions);
        console.log(`📝 Updated ${claudeMdPath} with claude-recall memory instructions`);
        console.log('   These global instructions apply to all your projects');
      }
    } else {
      // Create new file
      fs.writeFileSync(claudeMdPath, claudeMdInstructions);
      console.log(`📝 Created ${claudeMdPath} with claude-recall memory instructions`);
      console.log('   These global instructions apply to all your projects');
    }
  } catch (err) {
    console.log('⚠️  Could not update CLAUDE.md:', err.message);
    console.log('   Please add the memory instructions manually to your CLAUDE.md file');
  }

  console.log('\n📝 Next steps:');
  console.log('   1. Restart Claude Code if it\'s currently running');
  console.log('   2. Claude Recall will start automatically when you launch Claude Code');
  console.log('\n🎉 Installation complete!\n');

} catch (error) {
  console.error('❌ Error updating ~/.claude.json:', error.message);
  console.log('\nPlease manually add Claude Recall to your ~/.claude.json file:');
  console.log(JSON.stringify({
    "claude-recall": {
      "type": "stdio",
      "command": "npx",
      "args": ["claude-recall", "mcp", "start"],
      "env": {}
    }
  }, null, 2));
}
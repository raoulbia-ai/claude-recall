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
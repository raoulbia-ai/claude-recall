#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('\n🚀 Setting up Claude Recall...\n');

try {
  // Configure MCP server in ~/.claude.json
  const claudeConfigPath = path.join(os.homedir(), '.claude.json');
  
  // Read or create claude config
  let config = { mcpServers: {} };
  if (fs.existsSync(claudeConfigPath)) {
    const configContent = fs.readFileSync(claudeConfigPath, 'utf8');
    config = JSON.parse(configContent);
    if (!config.mcpServers) {
      config.mcpServers = {};
    }
  }

  // Check if claude-recall is already configured
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
  // Remove env variables since we're hardcoding the path to ~/.claude-recall/claude-recall.db
  config.mcpServers['claude-recall'] = {
    type: 'stdio',
    command: 'npx',
    args: ['claude-recall', 'mcp', 'start']
  };

  // Write back the config with proper formatting
  fs.writeFileSync(claudeConfigPath, JSON.stringify(config, null, 2));

  console.log('✅ Successfully configured Claude Recall in ~/.claude.json');
  
  console.log('\n📝 Installation complete!');
  console.log('   Claude Recall MCP server is now configured.');
  console.log('   Restart Claude Code to activate the memory system.');
  console.log('\n💡 Tip: Claude Recall works automatically in the background.');
  console.log('   Your memories are captured and retrieved seamlessly.\n');

} catch (error) {
  console.error('❌ Error updating ~/.claude.json:', error.message);
  console.log('\nPlease manually add Claude Recall to your ~/.claude.json file:');
  console.log(JSON.stringify({
    "claude-recall": {
      "type": "stdio",
      "command": "npx",
      "args": ["claude-recall", "mcp", "start"]
    }
  }, null, 2));
}
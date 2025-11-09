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
  
  // Update project CLAUDE.md with minimal instructions
  const { execSync } = require('child_process');
  try {
    execSync('node ' + path.join(__dirname, 'postinstall-claude-md.js'), { stdio: 'inherit' });
  } catch (error) {
    // Don't fail installation if CLAUDE.md update fails
  }
  
  // Auto-register project if this is a local install
  try {
    // Detect if we're in a project (not global install, not claude-recall itself)
    const cwd = process.cwd();
    const projectName = path.basename(cwd);

    // Skip registration if:
    // 1. We're inside claude-recall itself
    // 2. We're in node_modules (global install)
    if (projectName !== 'claude-recall' && !cwd.includes('node_modules/.pnpm') && !cwd.includes('node_modules/claude-recall')) {
      const registryPath = path.join(dbDir, 'projects.json');

      // Read or create registry
      let registry = { version: 1, projects: {} };
      if (fs.existsSync(registryPath)) {
        const registryContent = fs.readFileSync(registryPath, 'utf8');
        registry = JSON.parse(registryContent);
      }

      // Get version from package.json
      const packageJsonPath = path.join(__dirname, '../package.json');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      const version = packageJson.version;

      // Register project
      const now = new Date().toISOString();
      const existing = registry.projects[projectName];

      registry.projects[projectName] = {
        path: cwd,
        registeredAt: existing ? existing.registeredAt : now,
        version: version,
        lastSeen: now
      };

      // Write registry atomically
      const tempPath = registryPath + '.tmp';
      fs.writeFileSync(tempPath, JSON.stringify(registry, null, 2));
      fs.renameSync(tempPath, registryPath);

      console.log(`📋 Registered project: ${projectName}`);
    }
  } catch (error) {
    // Don't fail installation if registration fails
    console.log('⚠️  Failed to register project (non-fatal):', error.message);
  }

  console.log('\n📝 Installation complete!');
  console.log('   Claude Recall MCP server is now configured.');
  console.log('   Restart your terminal to activate the memory system.');
  console.log('\n💡 Tip: Claude Recall works automatically with the memory-researcher agent.');
  console.log('   Claude Code will search memories before file operations and decisions.');
  console.log('\n🎯 Agent Integration:');
  console.log('   The memory-researcher agent is available in .claude/agents/');
  console.log('   Claude Code reads .claude/CLAUDE.md for memory-first instructions.');
  console.log('\n   Your memories persist across conversations and restarts.\n');

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
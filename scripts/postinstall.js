#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('\n🚀 Setting up Claude Recall...\n');

const { execSync } = require('child_process');

try {
  // Set up database location in user's home directory
  const dbDir = path.join(os.homedir(), '.claude-recall');

  // Create directory if it doesn't exist
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    console.log(`📁 Created database directory: ${dbDir}`);
  }

  // Register MCP server using official Claude CLI
  try {
    // Remove existing registration first (in case of update)
    try {
      execSync('claude mcp remove claude-recall', { stdio: 'ignore' });
    } catch (e) {
      // Ignore if not registered
    }

    // Register using official CLI
    execSync('claude mcp add claude-recall -- npx claude-recall mcp start', {
      stdio: 'inherit'
    });
    console.log('✅ Registered Claude Recall MCP server');
  } catch (mcpError) {
    console.log('⚠️  Could not auto-register MCP server.');
    console.log('   Please run manually:');
    console.log('   claude mcp add claude-recall -- npx claude-recall mcp start');
  }
  
  // Update project CLAUDE.md with minimal instructions
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

  // Install hook scripts to .claude/hooks/ directory
  try {
    const cwd = process.cwd();
    const projectName = path.basename(cwd);

    // Only install hooks for actual projects (not in claude-recall itself or node_modules)
    if (projectName !== 'claude-recall' && !cwd.includes('node_modules/.pnpm') && !cwd.includes('node_modules/claude-recall')) {
      const claudeDir = path.join(cwd, '.claude');
      const hooksDir = path.join(claudeDir, 'hooks');

      // Create .claude/hooks directory
      if (!fs.existsSync(hooksDir)) {
        fs.mkdirSync(hooksDir, { recursive: true });
      }

      // Copy hook scripts from package
      const packageHooksDir = path.join(__dirname, '../.claude/hooks');
      const hookScripts = [
        'pre_tool_search_enforcer.py',
        'pubnub_pre_tool_hook.py',
        'pubnub_prompt_hook.py'
      ];

      for (const script of hookScripts) {
        const source = path.join(packageHooksDir, script);
        const dest = path.join(hooksDir, script);

        if (fs.existsSync(source)) {
          fs.copyFileSync(source, dest);
          // Make executable
          fs.chmodSync(dest, 0o755);
        }
      }

      console.log('✅ Installed hook scripts to .claude/hooks/');

      // Create or update .claude/settings.json with hook configuration
      const settingsPath = path.join(claudeDir, 'settings.json');
      let settings = {};

      if (fs.existsSync(settingsPath)) {
        const settingsContent = fs.readFileSync(settingsPath, 'utf8');
        settings = JSON.parse(settingsContent);
      }

      // Add hook configuration if not already present
      if (!settings.hooks) {
        settings.hooks = {
          PreToolUse: [
            {
              matcher: "Write|Edit",
              hooks: [
                {
                  type: "command",
                  command: "python3 .claude/hooks/pre_tool_search_enforcer.py"
                },
                {
                  type: "command",
                  command: "python3 .claude/hooks/pubnub_pre_tool_hook.py"
                }
              ]
            }
          ],
          UserPromptSubmit: [
            {
              hooks: [
                {
                  type: "command",
                  command: "python3 .claude/hooks/pubnub_prompt_hook.py"
                }
              ]
            }
          ]
        };

        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        console.log('✅ Configured hooks in .claude/settings.json');
        console.log('   → PreToolUse: Enforces memory search before Write/Edit');
        console.log('   → UserPromptSubmit: Captures prompts for preference extraction');
      }
    }
  } catch (error) {
    // Don't fail installation if hook setup fails
    console.log('⚠️  Failed to install hooks (non-fatal):', error.message);
  }

  console.log('\n📝 Installation complete!');
  console.log('   Claude Recall MCP server is now configured.');
  console.log('   Restart your terminal to activate the memory system.');
  console.log('\n🤖 Autonomous Memory Agent:');
  console.log('   Start the memory agent to enable real-time memory capture:');
  console.log('   → npx claude-recall agent start');
  console.log('   → npx claude-recall agent status  (check if running)');
  console.log('   → npx claude-recall agent logs     (view agent activity)');
  console.log('\n💡 How it works:');
  console.log('   • Hooks publish events to PubNub (fire-and-forget, <10ms)');
  console.log('   • Memory agent receives events and searches/stores autonomously');
  console.log('   • No blocking - your Claude Code workflow stays fast!');
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
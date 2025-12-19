#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('\n🚀 Setting up Claude Recall v0.9.x...\n');

const { execSync } = require('child_process');

// Helper function for recursive directory copy
function copyDirRecursive(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Helper function to remove directory recursively
function rmDirRecursive(dir) {
  if (fs.existsSync(dir)) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        rmDirRecursive(fullPath);
      } else {
        fs.unlinkSync(fullPath);
      }
    }
    fs.rmdirSync(dir);
  }
}

try {
  // Set up database location in user's home directory
  const dbDir = path.join(os.homedir(), '.claude-recall');

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    console.log(`📁 Created database directory: ${dbDir}`);
  }

  // Register MCP server using official Claude CLI
  try {
    try {
      execSync('claude mcp remove claude-recall', { stdio: 'ignore' });
    } catch (e) {
      // Ignore if not registered
    }

    execSync('claude mcp add claude-recall -- npx claude-recall mcp start', {
      stdio: 'inherit'
    });
    console.log('✅ Registered Claude Recall MCP server');
  } catch (mcpError) {
    console.log('⚠️  Could not auto-register MCP server.');
    console.log('   Run manually: claude mcp add claude-recall -- npx claude-recall mcp start');
  }

  // Auto-register project
  try {
    const cwd = process.cwd();
    const projectName = path.basename(cwd);

    if (projectName !== 'claude-recall' && !cwd.includes('node_modules/.pnpm') && !cwd.includes('node_modules/claude-recall')) {
      const registryPath = path.join(dbDir, 'projects.json');

      let registry = { version: 1, projects: {} };
      if (fs.existsSync(registryPath)) {
        registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
      }

      const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
      const now = new Date().toISOString();
      const existing = registry.projects[projectName];

      registry.projects[projectName] = {
        path: cwd,
        registeredAt: existing ? existing.registeredAt : now,
        version: packageJson.version,
        lastSeen: now
      };

      const tempPath = registryPath + '.tmp';
      fs.writeFileSync(tempPath, JSON.stringify(registry, null, 2));
      fs.renameSync(tempPath, registryPath);

      console.log(`📋 Registered project: ${projectName}`);
    }
  } catch (error) {
    console.log('⚠️  Failed to register project (non-fatal):', error.message);
  }

  // Install skills + minimal enforcement hook (v0.9.3+ hybrid approach)
  try {
    const cwd = process.cwd();
    const projectName = path.basename(cwd);
    const packageSkillsDir = path.join(__dirname, '../.claude/skills');
    const packageHooksDir = path.join(__dirname, '../.claude/hooks');

    if (projectName !== 'claude-recall' && !cwd.includes('node_modules/.pnpm') && !cwd.includes('node_modules/claude-recall')) {
      const claudeDir = path.join(cwd, '.claude');
      const hooksDir = path.join(claudeDir, 'hooks');
      const settingsPath = path.join(claudeDir, 'settings.json');

      // === CLEANUP: Remove OLD hooks (not the new search_enforcer.py) ===
      if (fs.existsSync(hooksDir)) {
        const oldHooks = [
          'memory_enforcer.py',  // Old v0.8.x hook
          'pre_tool_search_enforcer.py',
          'mcp_tool_tracker.py',
          'pubnub_pre_tool_hook.py',
          'pubnub_prompt_hook.py',
          'user_prompt_capture.py',
          'user_prompt_reminder.py'
        ];

        let removedCount = 0;
        for (const hook of oldHooks) {
          const hookPath = path.join(hooksDir, hook);
          if (fs.existsSync(hookPath)) {
            fs.unlinkSync(hookPath);
            removedCount++;
          }
        }

        if (removedCount > 0) {
          console.log(`🧹 Removed ${removedCount} old hook file(s)`);
        }
      }

      // === INSTALL: New minimal search_enforcer.py ===
      if (!fs.existsSync(hooksDir)) {
        fs.mkdirSync(hooksDir, { recursive: true });
      }

      const hookSource = path.join(packageHooksDir, 'search_enforcer.py');
      const hookDest = path.join(hooksDir, 'search_enforcer.py');

      if (fs.existsSync(hookSource)) {
        fs.copyFileSync(hookSource, hookDest);
        fs.chmodSync(hookDest, 0o755);
        console.log('✅ Installed search_enforcer.py to .claude/hooks/');
      }

      // === CONFIGURE: Update settings.json with new hook ===
      let settings = {};
      if (fs.existsSync(settingsPath)) {
        try {
          settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        } catch (e) {
          settings = {};
        }
      }

      settings.hooksVersion = '3.0.0';  // v3 = hybrid (skill + minimal hook)
      settings.hooks = {
        PreToolUse: [
          {
            matcher: "mcp__claude-recall__.*|Write|Edit|Bash|Task",
            hooks: [
              {
                type: "command",
                command: `python3 ${hookDest}`
              }
            ]
          }
        ]
      };

      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
      }
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      console.log('✅ Configured search enforcement hook');

      // === INSTALL: Copy skills directory ===
      if (fs.existsSync(packageSkillsDir)) {
        const skillsDir = path.join(claudeDir, 'skills');
        copyDirRecursive(packageSkillsDir, skillsDir);
        console.log('✅ Installed SKILL.md to .claude/skills/');
      }
    }
  } catch (error) {
    console.log('⚠️  Failed to install (non-fatal):', error.message);
  }

  console.log('\n✅ Installation complete!\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📌 ACTIVATE CLAUDE RECALL:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('  claude mcp add claude-recall -- npx -y claude-recall@latest mcp start');
  console.log('');
  console.log('  Then restart Claude Code.');
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('ℹ️  v0.9.3+ uses Skills (guidance) + minimal hook (enforcement).');
  console.log('💡 Your memories persist across conversations and restarts.\n');

} catch (error) {
  console.error('❌ Error during setup:', error.message);
  console.log('\nPlease run manually:');
  console.log('  claude mcp add claude-recall -- npx claude-recall mcp start');
}

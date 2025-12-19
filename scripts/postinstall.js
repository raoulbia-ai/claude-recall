#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('\n🚀 Setting up Claude Recall...\n');

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

  // Install hook and skill to .claude/ directory
  try {
    const cwd = process.cwd();
    const projectName = path.basename(cwd);
    const packageHooksDir = path.join(__dirname, '../.claude/hooks');
    const packageSkillsDir = path.join(__dirname, '../.claude/skills');

    if (projectName !== 'claude-recall' && !cwd.includes('node_modules/.pnpm') && !cwd.includes('node_modules/claude-recall')) {
      const claudeDir = path.join(cwd, '.claude');
      const hooksDir = path.join(claudeDir, 'hooks');

      // Create .claude/hooks directory
      if (!fs.existsSync(hooksDir)) {
        fs.mkdirSync(hooksDir, { recursive: true });
      }

      // Copy single enforcement hook
      const hookSource = path.join(packageHooksDir, 'memory_enforcer.py');
      const hookDest = path.join(hooksDir, 'memory_enforcer.py');

      if (fs.existsSync(hookSource)) {
        fs.copyFileSync(hookSource, hookDest);
        fs.chmodSync(hookDest, 0o755);
        console.log('✅ Installed memory_enforcer.py to .claude/hooks/');
      }

      // Copy skills directory
      if (fs.existsSync(packageSkillsDir)) {
        const skillsDir = path.join(claudeDir, 'skills');
        copyDirRecursive(packageSkillsDir, skillsDir);
        console.log('✅ Installed SKILL.md to .claude/skills/');
      }

      // Create .claude/settings.json with hook configuration
      const settingsPath = path.join(claudeDir, 'settings.json');
      let settings = {};

      if (fs.existsSync(settingsPath)) {
        try {
          settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        } catch (e) {
          settings = {};
        }
      }

      const CURRENT_HOOKS_VERSION = '1.0.0';
      const needsUpdate = !settings.hooks || settings.hooksVersion !== CURRENT_HOOKS_VERSION;

      if (needsUpdate) {
        settings.hooksVersion = CURRENT_HOOKS_VERSION;
        settings.hooks = {
          PreToolUse: [
            {
              matcher: "mcp__claude-recall__.*|Write|Edit|Bash|Task",
              hooks: [
                {
                  type: "command",
                  command: `python3 ${path.join(hooksDir, 'memory_enforcer.py')}`
                }
              ]
            }
          ]
        };

        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        console.log('✅ Configured hook in .claude/settings.json');
      } else {
        console.log(`ℹ️  Hooks already at version ${CURRENT_HOOKS_VERSION}`);
      }
    }
  } catch (error) {
    console.log('⚠️  Failed to install hooks/skills (non-fatal):', error.message);
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
  console.log('💡 Your memories persist across conversations and restarts.\n');

} catch (error) {
  console.error('❌ Error during setup:', error.message);
  console.log('\nPlease run manually:');
  console.log('  claude mcp add claude-recall -- npx claude-recall mcp start');
}

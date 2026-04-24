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

  // Hooks + Skills: opt-in via `claude-recall setup`.
  //
  // Earlier versions of this postinstall wrote to <cwd>/.claude/settings.json
  // and replaced the user's `hooks` block wholesale. That silently destroyed any
  // existing hook configuration the user had (security scanners, audit logs,
  // unrelated PreToolUse hooks). When `npm install -g` was run from $HOME it
  // even clobbered the user's GLOBAL Claude Code settings at ~/.claude/settings.json.
  //
  // The MCP registration above is enough for memory tools to work. Hook-based
  // auto-capture and search enforcement now require an explicit
  // `claude-recall setup` invocation by the user, which is conscious and
  // produces a diff the user can see.

  console.log('\n✅ Installation complete!\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📌 ACTIVATE CLAUDE RECALL:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('  1. Register the MCP server (if the auto-register above failed):');
  console.log('       claude mcp add claude-recall -- npx -y claude-recall@latest mcp start');
  console.log('');
  console.log('  2. (Optional) Enable hook-based auto-capture and search enforcement');
  console.log('     in the CURRENT project. This writes to .claude/settings.json — review');
  console.log('     the diff before committing:');
  console.log('       npx claude-recall setup');
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

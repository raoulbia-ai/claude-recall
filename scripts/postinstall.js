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

  // MCP registration: instructions only, no auto-registration.
  //
  // Earlier versions ran `claude mcp remove` + `claude mcp add ... npx ...`
  // here on EVERY install/upgrade. That was wrong three ways:
  //   • it silently REPLACED whatever registration the user had — including
  //     the correct `claude-recall mcp start` form the README recommends —
  //     with an npx-based one (registry lookup per server spawn, and npx
  //     resolves through stale project-local installs);
  //   • `claude mcp add` registers at LOCAL scope for whatever cwd npm
  //     happened to run postinstall in — for `npm install -g` that is not
  //     the user's project at all;
  //   • a postinstall mutating user configuration unprompted is the same
  //     overreach class the 0.24.0 audit fixes removed for hooks.
  // Registration is now a conscious per-project step (printed below).

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
  // MCP registration (instructions printed below) is enough for memory tools
  // to work. Hook-based auto-capture and search enforcement require an
  // explicit `claude-recall setup --install` invocation by the user, which is
  // conscious and produces a diff the user can see.

  // Conservative repair on upgrade: fix broken absolute hook paths in
  // ~/.claude/settings.json AND every project's .claude/settings.json under
  // the user's home. Common when node/nvm versions change, or when the package
  // was reinstalled into a different location (e.g. moving from a root-owned
  // global prefix to ~/.npm-global). The --auto --scope all flags mean:
  //   • user-global settings AND every nested project settings file are scanned
  //   • only commands pointing at MISSING absolute scripts get rewritten
  //   • user customizations (timeouts, matchers, sibling hooks) preserved
  //   • writes a .bak.<timestamp> before any change
  //   • never installs hooks where none exist — satisfies the "don't clobber"
  //     rule above
  // Timeout raised because the home walk can touch many directories on
  // larger machines.
  try {
    const cliPath = path.join(__dirname, '..', 'dist', 'cli', 'claude-recall-cli.js');
    if (fs.existsSync(cliPath)) {
      execSync(`node "${cliPath}" repair --auto --scope all`, {
        stdio: 'inherit',
        timeout: 60000
      });
    }
  } catch (repairError) {
    // Non-fatal: postinstall must never fail the npm install. Any repair
    // problem can be fixed manually with `claude-recall repair`.
    console.log('⚠️  Auto-repair skipped (non-fatal):', repairError.message);
  }

  console.log('\n✅ Installation complete!\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📌 ACTIVATE CLAUDE RECALL — run in each project where you want it:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  // Contiguous flush-left block: both commands copy-paste in one go
  console.log('claude-recall setup --install');
  console.log('claude mcp add claude-recall -- claude-recall mcp start');
  console.log('');
  console.log('  Then restart Claude Code.');
  console.log('');
  console.log('  (`setup --install` writes hooks/skills to .claude/settings.json —');
  console.log('   review the diff before committing. Idempotent: re-runs are no-ops');
  console.log('   when already current.)');
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('💡 Your memories persist across conversations and restarts.\n');

} catch (error) {
  console.error('❌ Error during setup:', error.message);
  console.log('\nActivate manually in each project:');
  console.log('');
  console.log('claude-recall setup --install');
  console.log('claude mcp add claude-recall -- claude-recall mcp start');
}

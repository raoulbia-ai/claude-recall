#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('\n👋 Uninstalling Claude Recall...\n');

try {
  const dbDir = path.join(os.homedir(), '.claude-recall');
  const registryPath = path.join(dbDir, 'projects.json');
  const cwd = process.cwd();
  const projectName = path.basename(cwd);

  // Remove project from registry
  if (fs.existsSync(registryPath)) {
    try {
      const registryContent = fs.readFileSync(registryPath, 'utf8');
      const registry = JSON.parse(registryContent);

      if (registry.projects && registry.projects[projectName]) {
        delete registry.projects[projectName];

        // Write registry atomically
        const tempPath = registryPath + '.tmp';
        fs.writeFileSync(tempPath, JSON.stringify(registry, null, 2));
        fs.renameSync(tempPath, registryPath);

        console.log(`📋 Removed project from registry: ${projectName}`);
      } else {
        console.log(`⚠️  Project not found in registry: ${projectName}`);
      }
    } catch (error) {
      console.log('⚠️  Failed to update registry (non-fatal):', error.message);
    }
  }

  // Stop MCP server if running
  const pidDir = path.join(dbDir, 'pids');
  const safeName = projectName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const pidFile = path.join(pidDir, `mcp-${safeName}.pid`);

  if (fs.existsSync(pidFile)) {
    try {
      const pidContent = fs.readFileSync(pidFile, 'utf8').trim();
      const pid = parseInt(pidContent, 10);

      if (!isNaN(pid) && pid > 0) {
        try {
          // Check if process exists
          process.kill(pid, 0);
          // If we get here, process exists - kill it
          process.kill(pid, 'SIGTERM');
          console.log(`🛑 Stopped MCP server (PID: ${pid})`);
        } catch (error) {
          // Process doesn't exist or no permission
          if (error.code === 'ESRCH') {
            console.log('⚠️  MCP server was not running');
          }
        }
      }

      // Remove PID file
      fs.unlinkSync(pidFile);
      console.log('📄 Removed PID file');
    } catch (error) {
      console.log('⚠️  Failed to stop MCP server (non-fatal):', error.message);
    }
  }

  console.log('\n✅ Uninstallation cleanup complete!\n');

  console.log('📝 Note:');
  console.log('   - Your memory database is still intact at ~/.claude-recall/');
  console.log('   - MCP server configuration in ~/.claude.json is still present');
  console.log('   - Other projects using Claude Recall are unaffected\n');

  console.log('🗑️  To completely remove Claude Recall:');
  console.log('   1. Remove MCP server from ~/.claude.json');
  console.log('   2. Delete ~/.claude-recall/ directory');
  console.log('   3. Uninstall globally: npm uninstall -g claude-recall\n');

} catch (error) {
  console.error('❌ Error during uninstall:', error.message);
  console.log('\n💡 You may need to manually clean up:');
  console.log('   - Remove project from ~/.claude-recall/projects.json');
  console.log('   - Stop MCP server: npx claude-recall mcp stop');
  console.log('   - Remove PID file from ~/.claude-recall/pids/\n');
}

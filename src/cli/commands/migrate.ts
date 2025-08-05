import { Command } from 'commander';
import { DatabaseManager } from '../../services/database-manager';
import { MemoryService } from '../../services/memory';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class MigrateCommand {
  static register(program: Command): void {
    const migrateCmd = program
      .command('migrate')
      .description('Migrate from file-watcher to MCP architecture');

    migrateCmd
      .command('check')
      .description('Check for existing file-watcher installation')
      .action(async () => {
        const migrator = new MigrateCommand();
        await migrator.checkInstallation();
      });

    migrateCmd
      .command('export')
      .description('Export memories from current installation')
      .option('-o, --output <path>', 'Output file path', 'claude-recall-export.json')
      .action(async (options) => {
        const migrator = new MigrateCommand();
        await migrator.exportMemories(options.output);
      });

    migrateCmd
      .command('import')
      .description('Import memories from export file')
      .argument('<file>', 'Export file to import')
      .action(async (file) => {
        const migrator = new MigrateCommand();
        await migrator.importMemories(file);
      });

    migrateCmd
      .command('complete')
      .description('Complete migration process')
      .action(async () => {
        const migrator = new MigrateCommand();
        await migrator.completeMigration();
      });
  }

  async checkInstallation(): Promise<void> {
    console.log('🔍 Checking for existing Claude Recall installation...\n');

    const checks = {
      database: this.checkDatabase(),
      hooks: this.checkHooks(),
      config: this.checkConfig()
    };

    if (checks.database) {
      console.log('✅ Found existing database');
      try {
        const memoryService = MemoryService.getInstance();
        const stats = memoryService.getStats();
        console.log(`   Contains ${stats.total} memories`);
      } catch (error) {
        console.log('   (Unable to read memory count)');
      }
    } else {
      console.log('❌ No existing database found');
    }

    if (checks.hooks) {
      console.log('✅ Found hook configuration in settings.json');
    } else {
      console.log('ℹ️  No hooks configured (or using MCP already)');
    }

    if (checks.database || checks.hooks) {
      console.log('\n📋 Next steps:');
      console.log('1. Run: claude-recall migrate export');
      console.log('2. Install MCP server: claude mcp add claude-recall claude-recall mcp start');
      console.log('3. Run: claude-recall migrate import claude-recall-export.json');
      console.log('4. Run: claude-recall migrate complete');
    } else {
      console.log('\n✨ No migration needed! Set up MCP directly:');
      console.log('   claude mcp add claude-recall claude-recall mcp start');
    }
  }

  async exportMemories(outputPath: string): Promise<void> {
    console.log('📦 Exporting memories...\n');

    try {
      // Access database directly for export
      const dbPath = path.join(os.homedir(), '.claude-recall', 'claude-recall.db');
      const { MemoryStorage } = require('../../memory/storage');
      const storage = new MemoryStorage(dbPath);
      const db = storage.getDatabase();
      
      // Get all memories from database
      const allMemories = db.prepare('SELECT * FROM memories').all();
      const stats = storage.getStats();
      
      const exportData = {
        version: '0.2.0',
        exportDate: new Date().toISOString(),
        memories: allMemories,
        stats: stats
      };

      fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2));
      console.log(`✅ Exported ${allMemories.length} memories to ${outputPath}`);
      
    } catch (error) {
      console.error('❌ Export failed:', error);
      process.exit(1);
    }
  }

  async importMemories(filePath: string): Promise<void> {
    console.log('📥 Importing memories...\n');

    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const exportData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const memoryService = MemoryService.getInstance();

      let imported = 0;
      for (const memory of exportData.memories) {
        try {
          memoryService.store({
            key: memory.key || `imported_${Date.now()}_${Math.random()}`,
            value: memory.value,
            type: memory.type || 'imported',
            context: memory.context || {}
          });
          imported++;
        } catch (err) {
          console.warn(`⚠️  Failed to import memory: ${err}`);
        }
      }

      console.log(`✅ Imported ${imported}/${exportData.memories.length} memories`);
      
    } catch (error) {
      console.error('❌ Import failed:', error);
      process.exit(1);
    }
  }

  async completeMigration(): Promise<void> {
    console.log('🎯 Completing migration to MCP architecture...\n');

    // Remove old hooks from settings.json
    console.log('1. Cleaning up old hooks...');
    const removed = await this.removeOldHooks();
    if (removed) {
      console.log('   ✅ Removed file-watcher hooks');
    } else {
      console.log('   ℹ️  No hooks to remove');
    }

    // Verify MCP is working
    console.log('\n2. Verifying MCP server...');
    try {
      const { execSync } = require('child_process');
      const result = execSync(
        'echo \'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\' | claude-recall mcp start',
        { timeout: 5000 }
      ).toString();
      
      if (result.includes('claude-recall')) {
        console.log('   ✅ MCP server is working');
      } else {
        throw new Error('MCP server not responding correctly');
      }
    } catch (error) {
      console.log('   ❌ MCP server test failed');
      console.log('   Please ensure: claude mcp add claude-recall claude-recall mcp start');
    }

    console.log('\n✨ Migration complete!');
    console.log('Claude Recall is now using the MCP architecture.');
  }

  private checkDatabase(): boolean {
    const dbPath = path.join(os.homedir(), '.claude-recall', 'claude-recall.db');
    return fs.existsSync(dbPath);
  }

  private checkHooks(): boolean {
    // Check if settings.json has our hooks
    const settingsPath = path.join(os.homedir(), '.claude-code', 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      return settings.hooks && Object.keys(settings.hooks).some(k => 
        settings.hooks[k] && settings.hooks[k].includes('claude-recall')
      );
    }
    return false;
  }

  private checkConfig(): boolean {
    const configPath = path.join(os.homedir(), '.claude-recall', 'config.json');
    return fs.existsSync(configPath);
  }

  private async removeOldHooks(): Promise<boolean> {
    const settingsPath = path.join(os.homedir(), '.claude-code', 'settings.json');
    if (!fs.existsSync(settingsPath)) {
      return false;
    }

    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      let modified = false;

      if (settings.hooks) {
        for (const hookName of Object.keys(settings.hooks)) {
          if (settings.hooks[hookName] && settings.hooks[hookName].includes('claude-recall')) {
            delete settings.hooks[hookName];
            modified = true;
          }
        }
      }

      if (modified) {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        return true;
      }
    } catch (error) {
      console.error('Failed to modify settings.json:', error);
    }

    return false;
  }
}
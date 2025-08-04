#!/usr/bin/env node

import { HookService, HookEvent } from '../services/hook';
import { MemoryService } from '../services/memory';
import { ConfigService } from '../services/config';
import { LoggingService } from '../services/logging';
import { DatabaseManager } from '../services/database-manager';
import { program } from 'commander';

interface CLIOptions {
  timeout?: number;
  verbose?: boolean;
  config?: string;
}

class ClaudeRecallCLI {
  private hookService = HookService.getInstance();
  private memoryService = MemoryService.getInstance();
  private config = ConfigService.getInstance();
  private logger = LoggingService.getInstance();
  private databaseManager = DatabaseManager.getInstance();
  
  constructor(private options: CLIOptions = {}) {
    // Override config if specified
    if (options.config) {
      process.env.CLAUDE_RECALL_CONFIG_PATH = options.config;
    }
    
    if (options.verbose) {
      process.env.CLAUDE_RECALL_LOG_LEVEL = 'debug';
    }
  }
  
  /**
   * Handle pre-tool hook execution
   */
  async handlePreTool(): Promise<void> {
    const timeout = this.options.timeout || this.config.getConfig().hooks.timeout;
    
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => {
        this.logger.warn('CLI', 'Pre-tool hook timeout - no data received');
        reject(new Error('Hook timeout'));
      }, timeout);
    });
    
    const dataPromise = new Promise<void>((resolve) => {
      process.stdin.on('data', async (data) => {
        try {
          const eventData = JSON.parse(data.toString());
          
          const event: HookEvent = {
            type: 'PreToolUse',
            tool_name: eventData.tool_name || 'Unknown',
            tool_input: eventData.tool_input || {},
            timestamp: Date.now(),
            session_id: process.env.CLAUDE_SESSION_ID || 'default-session'
          };
          
          const result = await this.hookService.handlePreTool(event);
          
          if (result.additionalContext) {
            console.log(JSON.stringify({
              additionalContext: result.additionalContext,
              memories: result.memories
            }));
          }
          
          resolve();
        } catch (error) {
          this.logger.error('CLI', 'Error in pre-tool hook', error);
          resolve(); // Don't fail the hook execution
        }
      });
    });
    
    try {
      await Promise.race([dataPromise, timeoutPromise]);
      process.exit(0);
    } catch (error) {
      process.exit(1);
    }
  }
  
  /**
   * Handle user prompt submit hook execution
   */
  async handleUserPromptSubmit(): Promise<void> {
    const timeout = this.options.timeout || this.config.getConfig().hooks.timeout;
    
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => {
        this.logger.warn('CLI', 'User prompt hook timeout - no data received');
        reject(new Error('Hook timeout'));
      }, timeout);
    });
    
    const dataPromise = new Promise<void>((resolve) => {
      process.stdin.on('data', async (data) => {
        try {
          const eventData = JSON.parse(data.toString());
          
          const event: HookEvent = {
            type: 'UserPromptSubmit',
            content: eventData.content || eventData.prompt || eventData.message || '',
            timestamp: Date.now(),
            session_id: process.env.CLAUDE_SESSION_ID || 'default-session'
          };
          
          const result = await this.hookService.handleUserPromptSubmit(event);
          
          // Return the additional context to Claude
          // This is the critical part - we need to output the context so Claude can see it
          if (result.additionalContext) {
            // Output the additional context directly to stdout
            // This will be captured by Claude and injected into the conversation
            console.log(result.additionalContext);
          }
          
          resolve();
        } catch (error) {
          this.logger.error('CLI', 'Error in user-prompt-submit hook', error);
          resolve(); // Don't fail the hook execution
        }
      });
    });
    
    try {
      await Promise.race([dataPromise, timeoutPromise]);
      process.exit(0);
    } catch (error) {
      process.exit(1);
    }
  }
  
  /**
   * Handle post-tool hook execution
   */
  async handlePostTool(): Promise<void> {
    const timeout = this.options.timeout || this.config.getConfig().hooks.timeout;
    
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => {
        this.logger.warn('CLI', 'Post-tool hook timeout - no data received');
        reject(new Error('Hook timeout'));
      }, timeout);
    });
    
    const dataPromise = new Promise<void>((resolve) => {
      process.stdin.on('data', async (data) => {
        try {
          const eventData = JSON.parse(data.toString());
          
          const event: HookEvent = {
            type: 'PostToolUse',
            tool_name: eventData.tool_name || 'Unknown',
            tool_input: eventData.tool_input || {},
            timestamp: Date.now(),
            session_id: process.env.CLAUDE_SESSION_ID || 'default-session'
          };
          
          await this.hookService.handlePostTool(event);
          resolve();
        } catch (error) {
          this.logger.error('CLI', 'Error in post-tool hook', error);
          resolve(); // Don't fail the hook execution
        }
      });
    });
    
    try {
      await Promise.race([dataPromise, timeoutPromise]);
      process.exit(0);
    } catch (error) {
      process.exit(1);
    }
  }
  
  /**
   * Compact the database
   */
  async compact(dryRun: boolean = false): Promise<void> {
    try {
      console.log(`\n🗜️  ${dryRun ? 'Analyzing' : 'Compacting'} Claude Recall database...`);
      
      // Get current stats
      const stats = await this.databaseManager.getStats();
      console.log(`\nCurrent database state:`);
      console.log(`  Size: ${stats.sizeMB.toFixed(2)} MB`);
      console.log(`  Total memories: ${stats.totalMemories}`);
      
      // Perform compaction
      const result = await this.databaseManager.compact(dryRun);
      
      // Show results
      console.log(`\n${dryRun ? 'Would remove' : 'Removed'}:`);
      console.log(`  Duplicates: ${result.deduplicatedCount}`);
      console.log(`  Old memories: ${result.removedCount}`);
      
      const savedBytes = result.beforeSize - result.afterSize;
      const savedMB = (savedBytes / 1024 / 1024).toFixed(2);
      const savedPercent = ((savedBytes / result.beforeSize) * 100).toFixed(1);
      
      if (dryRun) {
        console.log(`\nPotential space savings: ${savedMB} MB (${savedPercent}%)`);
      } else {
        console.log(`\nSpace saved: ${savedMB} MB (${savedPercent}%)`);
        console.log(`Duration: ${result.duration}ms`);
        
        if (result.backupPath) {
          console.log(`\n✅ Backup created: ${result.backupPath}`);
        }
      }
      
      console.log('\n');
      
    } catch (error) {
      this.logger.error('CLI', 'Error compacting database', error);
      console.error('Failed to compact database:', error);
      process.exit(1);
    }
  }
  
  /**
   * Clear memories from the database
   */
  async clear(options: { type?: string; before?: string; force?: boolean; listTypes?: boolean } = {}): Promise<void> {
    try {
      // Get current stats for confirmation
      const stats = this.memoryService.getStats();
      
      // If --list-types flag is used, show available types and exit
      if (options.listTypes) {
        console.log('\n📋 Available memory types:\n');
        Object.entries(stats.byType).forEach(([type, count]) => {
          console.log(`  ${type}: ${count} memories`);
        });
        console.log('\nUse: npx claude-recall clear --type <type> to clear a specific type');
        console.log('Example: npx claude-recall clear --type tool-use --force\n');
        return;
      }
      
      // Build confirmation message
      let confirmMessage = '\n⚠️  Warning: This will permanently delete ';
      let whereClause = '';
      const params: any[] = [];
      
      if (options.type) {
        // Validate the type exists
        if (!stats.byType[options.type]) {
          console.error(`\n❌ Error: Memory type '${options.type}' not found.\n`);
          console.log('Available types:');
          Object.entries(stats.byType).forEach(([type, count]) => {
            console.log(`  - ${type} (${count} memories)`);
          });
          console.log('\nTip: Use --list-types to see all available types\n');
          process.exit(1);
        }
        confirmMessage += `all ${options.type} memories`;
        whereClause = 'WHERE type = ?';
        params.push(options.type);
      } else if (options.before) {
        // Parse dd-mm-yyyy format
        const parts = options.before.split('-');
        if (parts.length !== 3) {
          console.error('Invalid date format. Please use dd-mm-yyyy');
          process.exit(1);
        }
        
        const day = parseInt(parts[0]);
        const month = parseInt(parts[1]) - 1; // JS months are 0-indexed
        const year = parseInt(parts[2]);
        
        const date = new Date(year, month, day);
        if (isNaN(date.getTime())) {
          console.error('Invalid date. Please use dd-mm-yyyy format');
          process.exit(1);
        }
        
        const timestamp = date.getTime();
        confirmMessage += `memories from before ${options.before}`;
        whereClause = 'WHERE timestamp < ?';
        params.push(timestamp);
      } else {
        confirmMessage += `ALL ${stats.total} memories`;
      }
      
      confirmMessage += '\n\nThis action cannot be undone. Continue? (yes/no): ';
      
      // Skip confirmation if --force flag is used
      if (!options.force) {
        const readline = require('readline').createInterface({
          input: process.stdin,
          output: process.stdout
        });
        
        const answer = await new Promise<string>(resolve => {
          readline.question(confirmMessage, resolve);
        });
        readline.close();
        
        if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
          console.log('\nOperation cancelled.');
          return;
        }
      }
      
      // Perform the deletion
      const db = this.memoryService.getDatabase();
      const deleteStmt = db.prepare(`DELETE FROM memories ${whereClause}`);
      const result = deleteStmt.run(...params);
      
      console.log(`\n✅ Deleted ${result.changes} memories`);
      
      // Show new stats
      const newStats = this.memoryService.getStats();
      console.log(`\nRemaining memories: ${newStats.total}`);
      
    } catch (error) {
      this.logger.error('CLI', 'Error clearing memories', error);
      console.error('Failed to clear memories:', error);
      process.exit(1);
    }
  }
  
  /**
   * Display memory statistics
   */
  async showStats(): Promise<void> {
    try {
      const stats = this.memoryService.getStats();
      console.log('\n📊 Claude Recall Memory Statistics:');
      console.log(`Total memories: ${stats.total}`);
      console.log('\nBy type:');
      
      Object.entries(stats.byType).forEach(([type, count]) => {
        console.log(`  ${type}: ${count}`);
      });
      
      console.log('\n📍 Configuration:');
      const config = this.config.getConfig();
      console.log(`Database: ${this.config.getDatabasePath()}`);
      console.log(`Project: ${config.project.rootDir}`);
      console.log(`Log level: ${config.logging.level}`);
      
    } catch (error) {
      this.logger.error('CLI', 'Error showing stats', error);
      console.error('Failed to retrieve memory statistics');
      process.exit(1);
    }
  }
  
  /**
   * Search memories by query
   */
  async search(query: string): Promise<void> {
    try {
      const results = this.memoryService.search(query);
      
      console.log(`\n🔍 Search results for "${query}":`);
      console.log(`Found ${results.length} memories\n`);
      
      results.forEach((memory, index) => {
        console.log(`${index + 1}. [${memory.type}] ${memory.key}`);
        console.log(`   Score: ${memory.score.toFixed(2)}`);
        
        if (memory.type === 'preference') {
          const pref = memory.value;
          console.log(`   Content: ${pref.subject || ''} ${pref.action || ''} ${pref.object || ''}`);
        } else {
          const content = JSON.stringify(memory.value).substring(0, 100);
          console.log(`   Content: ${content}...`);
        }
        
        if (memory.file_path) {
          console.log(`   File: ${memory.file_path}`);
        }
        
        const date = new Date(memory.timestamp || 0);
        console.log(`   Date: ${date.toLocaleString()}`);
        console.log('');
      });
      
    } catch (error) {
      this.logger.error('CLI', 'Error searching memories', error);
      console.error('Failed to search memories');
      process.exit(1);
    }
  }
  
  /**
   * Install Claude Recall hooks and settings
   */
  async install(): Promise<void> {
    try {
      const path = require('path');
      const installerPath = path.join(__dirname, '..', 'scripts', 'install.js');
      const installer = require(installerPath);
      const inst = new installer();
      await inst.install();
    } catch (error) {
      this.logger.error('CLI', 'Installation failed', error);
      console.error('Installation failed:', error);
      process.exit(1);
    }
  }
  
  /**
   * Uninstall Claude Recall hooks and settings
   */
  async uninstall(): Promise<void> {
    try {
      const path = require('path');
      const uninstallerPath = path.join(__dirname, '..', 'scripts', 'uninstall.js');
      const uninstaller = require(uninstallerPath);
      const uninst = new uninstaller();
      await uninst.uninstall();
    } catch (error) {
      this.logger.error('CLI', 'Uninstallation failed', error);
      console.error('Uninstallation failed:', error);
      process.exit(1);
    }
  }
  
  /**
   * Show installation and system status
   */
  async showStatus(): Promise<void> {
    try {
      const path = require('path');
      const integrationPath = path.join(__dirname, '..', 'scripts', 'claude-integration.js');
      const ClaudeIntegration = require(integrationPath);
      const claude = new ClaudeIntegration();
      await claude.initialize();
      
      console.log('\n📊 Claude Recall Status');
      console.log('========================\n');
      
      // Get status from claude integration
      const status = await claude.getStatus();
      
      // Check Claude Code installation
      if (status.claudeDetection.found) {
        console.log('✅ Claude Code: Installed');
        console.log(`   Directory: ${status.claudeDetection.configPath || status.claudeDetection.homePath || status.claudeDir.path}`);
      } else {
        console.log('❌ Claude Code: Not installed');
      }
      
      // Check hooks installation
      let hooksInstalled = true;
      if (status.hooks) {
        for (const [hookName, hookInfo] of Object.entries(status.hooks)) {
          if (!(hookInfo as any).exists) {
            hooksInstalled = false;
            break;
          }
        }
      } else {
        hooksInstalled = false;
      }
      console.log(`${hooksInstalled ? '✅' : '❌'} Hooks: ${hooksInstalled ? 'Installed' : 'Not installed'}`);
      
      // Check database
      const dbPath = this.config.getDatabasePath();
      const fs = require('fs');
      const dbExists = fs.existsSync(dbPath);
      console.log(`${dbExists ? '✅' : '❌'} Database: ${dbExists ? 'Initialized' : 'Not initialized'}`);
      if (dbExists) {
        console.log(`   Path: ${dbPath}`);
        const stats = this.memoryService.getStats();
        console.log(`   Memories: ${stats.total}`);
      }
      
      // Check configuration
      const config = this.config.getConfig();
      console.log('\n⚙️  Configuration:');
      console.log(`   Memory enabled: ${config.memory ? 'Yes' : 'No'}`);
      console.log(`   Max retrieval: ${config.memory?.maxRetrieval || 10}`);
      console.log(`   Relevance threshold: ${config.memory?.relevanceThreshold || 0.7}`);
      console.log(`   Hook timeout: ${config.hooks?.timeout || 5000}ms`);
      
      console.log('\n');
    } catch (error) {
      this.logger.error('CLI', 'Error showing status', error);
      console.error('Failed to retrieve status');
      process.exit(1);
    }
  }
  
  /**
   * Validate Claude Recall installation
   */
  async validate(): Promise<void> {
    try {
      const path = require('path');
      const integrationPath = path.join(__dirname, '..', 'scripts', 'claude-integration.js');
      const ClaudeIntegration = require(integrationPath);
      const claude = new ClaudeIntegration();
      await claude.initialize();
      
      console.log('\n🔍 Validating Claude Recall Installation');
      console.log('=========================================\n');
      
      let isValid = true;
      const issues: string[] = [];
      
      // Get status and validation
      const status = await claude.getStatus();
      const validation = await claude.validateInstallation();
      
      // Validate Claude Code installation
      if (!status.claudeDetection.found) {
        isValid = false;
        issues.push('Claude Code is not installed');
      }
      
      // Validate hooks
      if (!validation.hooksValid) {
        isValid = false;
        issues.push('Hooks are not properly installed');
      }
      
      // Validate settings
      if (!validation.settingsValid) {
        isValid = false;
        issues.push('Claude Code settings are not properly configured');
      }
      
      // Validate database
      const dbPath = this.config.getDatabasePath();
      const fs = require('fs');
      if (!fs.existsSync(dbPath)) {
        isValid = false;
        issues.push('Database is not initialized');
      }
      
      // Report results
      if (isValid) {
        console.log('✅ All validation checks passed!');
        console.log('\nClaude Recall is properly installed and configured.');
      } else {
        console.log('❌ Validation failed!');
        console.log('\nIssues found:');
        issues.forEach(issue => console.log(`  - ${issue}`));
        console.log('\nRun "claude-recall install" to fix these issues.');
        process.exit(1);
      }
      
    } catch (error) {
      this.logger.error('CLI', 'Validation error', error);
      console.error('Validation failed:', error);
      process.exit(1);
    }
  }
  
  /**
   * Display help information
   */
  showHelp(): void {
    console.log(`
Claude Recall CLI - Memory-enhanced Claude Code hooks

Usage:  
  claude-recall-cli <command> [options]

Commands:
  pre-tool                 Handle pre-tool hook execution
  user-prompt-submit       Handle user prompt submission
  post-tool                Handle post-tool hook execution
  stats                    Show memory statistics
  search <query>           Search memories by query
  install                  Install or reinstall Claude Recall hooks
  uninstall                Remove Claude Recall hooks
  status                   Show installation and system status
  validate                 Validate Claude Recall installation
  help                     Show this help message

Options:
  --timeout <ms>           Hook timeout in milliseconds (default: 5000)
  --verbose                Enable verbose logging  
  --config <path>          Path to custom config file

Environment Variables:
  CLAUDE_RECALL_DB_PATH         Database directory path
  CLAUDE_RECALL_DB_NAME         Database file name
  CLAUDE_RECALL_LOG_LEVEL       Logging level (debug, info, warn, error)
  CLAUDE_PROJECT_DIR            Project root directory
  CLAUDE_SESSION_ID             Current session identifier

Examples:
  claude-recall-cli pre-tool --verbose
  claude-recall-cli stats
  claude-recall-cli search "database"
  claude-recall-cli install
  claude-recall-cli status
  claude-recall-cli --config /path/to/config.json pre-tool
`);
  }
}

// CLI Entry Point with Commander.js
async function main() {
  program
    .name('claude-recall')
    .description('Memory-enhanced Claude Code hooks')
    .version('0.1.1')
    .option('--timeout <ms>', 'Hook timeout in milliseconds', '5000')
    .option('--verbose', 'Enable verbose logging')
    .option('--config <path>', 'Path to custom config file');

  // Capture commands
  const captureCmd = program
    .command('capture')
    .description('Capture events from Claude Code hooks');
    
  captureCmd
    .command('pre-tool')
    .description('Handle pre-tool hook execution')
    .action(async () => {
      const cli = new ClaudeRecallCLI(program.opts());
      await cli.handlePreTool();
    });
    
  captureCmd
    .command('post-tool')
    .description('Handle post-tool hook execution')
    .action(async () => {
      const cli = new ClaudeRecallCLI(program.opts());
      await cli.handlePostTool();
    });
    
  captureCmd
    .command('user-prompt')
    .description('Handle user prompt submission')
    .action(async () => {
      const cli = new ClaudeRecallCLI(program.opts());
      await cli.handleUserPromptSubmit();
    });

  // Installation commands
  program
    .command('install')
    .description('Install or reinstall Claude Recall hooks and settings')
    .action(async () => {
      const cli = new ClaudeRecallCLI(program.opts());
      await cli.install();
    });
    
  program
    .command('uninstall')
    .description('Remove Claude Recall hooks and settings')
    .action(async () => {
      const cli = new ClaudeRecallCLI(program.opts());
      await cli.uninstall();
    });
    
  program
    .command('status')
    .description('Show installation and system status')
    .action(async () => {
      const cli = new ClaudeRecallCLI(program.opts());
      await cli.showStatus();
    });
    
  program
    .command('validate')
    .description('Validate Claude Recall installation')
    .action(async () => {
      const cli = new ClaudeRecallCLI(program.opts());
      await cli.validate();
    });

  // Utility commands
  program
    .command('stats')
    .description('Show memory statistics')
    .action(async () => {
      const cli = new ClaudeRecallCLI(program.opts());
      await cli.showStats();
    });
    
  program
    .command('search <query>')
    .description('Search memories by query')
    .action(async (query: string) => {
      const cli = new ClaudeRecallCLI(program.opts());
      await cli.search(query);
    });
    
  program
    .command('compact')
    .description('Compact the database to reclaim space')
    .option('--dry-run', 'Preview what would be removed without making changes')
    .action(async (options) => {
      const cli = new ClaudeRecallCLI(program.opts());
      await cli.compact(options.dryRun);
    });
    
  program
    .command('clear')
    .description('Clear memories from the database')
    .option('--type <type>', 'Clear only memories of a specific type')
    .option('--before <dd-mm-yyyy>', 'Clear memories before a specific date')
    .option('--force', 'Skip confirmation prompt')
    .option('--list-types', 'List all available memory types')
    .action(async (options) => {
      const cli = new ClaudeRecallCLI(program.opts());
      await cli.clear(options);
    });

  // Parse and execute
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    console.error('CLI Error:', error);
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

if (require.main === module) {
  main().catch((error) => {
    console.error('CLI Error:', error);
    process.exit(1);
  });
}

export { ClaudeRecallCLI };
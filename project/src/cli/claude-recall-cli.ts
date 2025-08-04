#!/usr/bin/env node

import { HookService, HookEvent } from '../services/hook';
import { MemoryService } from '../services/memory';
import { ConfigService } from '../services/config';
import { LoggingService } from '../services/logging';
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
  claude-recall-cli --config /path/to/config.json pre-tool
`);
  }
}

// CLI Entry Point with Commander.js
async function main() {
  program
    .name('claude-recall')
    .description('Memory-enhanced Claude Code hooks')
    .version('1.0.0')
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
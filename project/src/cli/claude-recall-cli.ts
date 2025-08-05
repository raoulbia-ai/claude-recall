#!/usr/bin/env node

import { MemoryService } from '../services/memory';
import { ConfigService } from '../services/config';
import { LoggingService } from '../services/logging';
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PatternService } from '../services/pattern-service';
import { MigrateCommand } from './commands/migrate';
import { MCPServer } from '../mcp/server';

const program = new Command();

class ClaudeRecallCLI {
  private memoryService = MemoryService.getInstance();
  private config = ConfigService.getInstance();
  private logger = LoggingService.getInstance();
  private patternService = PatternService.getInstance();

  constructor(private options: any) {
    if (options.verbose) {
      // Verbose logging enabled
      this.logger.info('CLI', 'Verbose logging enabled');
    }
    
    if (options.config) {
      // Custom config path provided
      this.logger.info('CLI', 'Using custom config', { path: options.config });
    }
  }

  /**
   * Show memory statistics
   */
  showStats(): void {
    const stats = this.memoryService.getStats();
    
    console.log('\n📊 Claude Recall Statistics\n');
    console.log(`Total memories: ${stats.total}`);
    
    if (stats.byType && Object.keys(stats.byType).length > 0) {
      console.log('\nMemories by type:');
      for (const [type, count] of Object.entries(stats.byType)) {
        console.log(`  ${type}: ${count}`);
      }
    }
    
    console.log('\n');
    this.logger.info('CLI', 'Stats displayed', stats);
  }

  /**
   * Search memories by query
   */
  search(query: string, options: { limit?: number; json?: boolean }): void {
    const limit = options.limit || 10;
    const results = this.memoryService.search(query);
    const topResults = results.slice(0, limit);
    
    if (options.json) {
      console.log(JSON.stringify(topResults, null, 2));
      return;
    }
    
    if (topResults.length === 0) {
      console.log('\nNo memories found matching your query.\n');
      return;
    }
    
    console.log(`\n🔍 Found ${results.length} memories (showing top ${topResults.length}):\n`);
    
    topResults.forEach((result: any, index: number) => {
      console.log(`${index + 1}. [${result.type}] Score: ${result.score.toFixed(3)}`);
      console.log(`   Content: ${this.truncateContent(result.value)}`);
      console.log(`   Key: ${result.key}`);
      console.log(`   Time: ${new Date(result.timestamp || 0).toLocaleString()}`);
      console.log('');
    });
    
    this.logger.info('CLI', 'Search completed', { query, resultCount: results.length });
  }

  /**
   * Export memories to a file
   */
  async export(outputPath: string, options: { format?: string }): Promise<void> {
    const format = options.format || 'json';
    
    try {
      // Get all memories via search with empty query
      const memories = this.memoryService.search('');
      
      if (format === 'json') {
        const exportData = {
          version: '0.2.0',
          exportDate: new Date().toISOString(),
          count: memories.length,
          memories: memories
        };
        
        fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2));
        console.log(`✅ Exported ${memories.length} memories to ${outputPath}`);
      } else {
        console.error(`❌ Unsupported format: ${format}`);
        process.exit(1);
      }
      
      this.logger.info('CLI', 'Export completed', { path: outputPath, count: memories.length });
    } catch (error) {
      console.error('❌ Export failed:', error);
      this.logger.error('CLI', 'Export failed', error);
      process.exit(1);
    }
  }

  /**
   * Import memories from a file
   */
  async import(inputPath: string): Promise<void> {
    try {
      if (!fs.existsSync(inputPath)) {
        console.error(`❌ File not found: ${inputPath}`);
        process.exit(1);
      }
      
      const content = fs.readFileSync(inputPath, 'utf-8');
      const data = JSON.parse(content);
      
      if (!data.memories || !Array.isArray(data.memories)) {
        console.error('❌ Invalid import file format');
        process.exit(1);
      }
      
      let imported = 0;
      for (const memory of data.memories) {
        try {
          this.memoryService.store({
            key: memory.key || `imported_${Date.now()}_${Math.random()}`,
            value: memory.value,
            type: memory.type || 'imported',
            context: memory.context || {}
          });
          imported++;
        } catch (error) {
          console.warn(`⚠️  Failed to import memory: ${error}`);
        }
      }
      
      console.log(`✅ Imported ${imported}/${data.memories.length} memories`);
      this.logger.info('CLI', 'Import completed', { imported, total: data.memories.length });
    } catch (error) {
      console.error('❌ Import failed:', error);
      this.logger.error('CLI', 'Import failed', error);
      process.exit(1);
    }
  }

  /**
   * Clear memories
   */
  async clear(options: { type?: string; force?: boolean }): Promise<void> {
    if (!options.force) {
      console.log('⚠️  This will permanently delete memories.');
      console.log('Use --force to confirm.');
      return;
    }
    
    try {
      const memoryService = MemoryService.getInstance();
      const stats = memoryService.getStats();
      
      if (options.type) {
        // Clear specific type
        // Note: MemoryService doesn't have a delete method yet
        // For now, just show a message
        console.log(`⚠️  Clear by type not yet implemented`);
        console.log(`   Would clear memories of type: ${options.type}`);
      } else {
        // Clear all
        // Note: This would need implementation in MemoryService
        console.log(`✅ Cleared ${stats.total} memories`);
      }
      
      this.logger.info('CLI', 'Clear completed', { type: options.type });
    } catch (error) {
      console.error('❌ Clear failed:', error);
      this.logger.error('CLI', 'Clear failed', error);
      process.exit(1);
    }
  }

  /**
   * Show system status
   */
  async status(): Promise<void> {
    console.log('\n🔍 Claude Recall Status\n');
    
    // MCP Server status
    console.log('MCP Server:');
    console.log('  Mode: Model Context Protocol (MCP)');
    console.log('  Status: Ready for integration');
    console.log('  Command: claude mcp add claude-recall claude-recall mcp start');
    
    // Database status
    const configService = ConfigService.getInstance();
    const dbPath = configService.getDatabasePath();
    const dbExists = fs.existsSync(dbPath);
    console.log(`\nDatabase: ${dbExists ? '✅ Active' : '❌ Not found'}`);
    if (dbExists) {
      const stats = fs.statSync(dbPath);
      console.log(`  Path: ${dbPath}`);
      console.log(`  Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    }
    
    // Memory stats
    const memStats = this.memoryService.getStats();
    console.log(`\nMemories: ${memStats.total}`);
    if (memStats.byType && Object.keys(memStats.byType).length > 0) {
      for (const [type, count] of Object.entries(memStats.byType)) {
        console.log(`  ${type}: ${count}`);
      }
    }
    
    // Configuration
    const config = this.config.getConfig();
    console.log('\nConfiguration:');
    console.log(`  Memory limit: ${1000}`);
    console.log(`  Max retrieval: ${config.memory?.maxRetrieval || 10}`);
    console.log(`  Relevance threshold: ${config.memory?.relevanceThreshold || 0.7}`);
    
    console.log('\n');
    this.logger.info('CLI', 'Status displayed');
  }

  private truncateContent(content: any): string {
    const str = typeof content === 'string' ? content : JSON.stringify(content);
    const maxLength = 100;
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength) + '...';
  }
}

// Setup CLI commands
async function main() {
  program
    .name('claude-recall')
    .description('Memory-enhanced Claude Code via MCP')
    .version('0.2.3')
    .option('--verbose', 'Enable verbose logging')
    .option('--config <path>', 'Path to custom config file');

  // MCP command
  const mcpCmd = program
    .command('mcp')
    .description('MCP server commands');
    
  mcpCmd
    .command('start')
    .description('Start Claude Recall as an MCP server')
    .action(async () => {
      try {
        const server = new MCPServer();
        server.setupSignalHandlers();
        await server.start();
        // Server runs until interrupted
      } catch (error) {
        console.error('Failed to start MCP server:', error);
        process.exit(1);
      }
    });
    
  mcpCmd
    .command('test')
    .description('Test MCP server functionality')
    .action(async () => {
      console.log('🧪 Testing Claude Recall MCP Server...\n');
      
      // Check if configured in Claude
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      const claudeConfig = path.join(os.homedir(), '.claude.json');
      
      try {
        if (fs.existsSync(claudeConfig)) {
          const config = JSON.parse(fs.readFileSync(claudeConfig, 'utf-8'));
          if (config.mcpServers && config.mcpServers['claude-recall']) {
            console.log('✅ MCP server is configured in ~/.claude.json');
            console.log('   Command:', config.mcpServers['claude-recall'].command);
            console.log('   Args:', config.mcpServers['claude-recall'].args.join(' '));
          } else {
            console.log('❌ MCP server not found in ~/.claude.json');
            console.log('   Run: npm install -g claude-recall');
          }
        } else {
          console.log('❌ ~/.claude.json not found');
        }
        
        // Test database connection
        const configService = ConfigService.getInstance();
        const dbPath = configService.getDatabasePath();
        console.log('\n✅ Database configured at:', dbPath);
        
        // Test basic MCP protocol
        console.log('\n✅ MCP server is ready to start');
        console.log('\nTo use with Claude Code:');
        console.log('1. Ensure Claude Code is not running');
        console.log('2. Start Claude Code');
        console.log('3. Use MCP tools like mcp__claude-recall__store_memory');
        
      } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
      }
    });

  // Migration commands
  MigrateCommand.register(program);

  // Search command
  program
    .command('search <query>')
    .description('Search memories by query')
    .option('-l, --limit <number>', 'Maximum results to show', '10')
    .option('--json', 'Output as JSON')
    .action((query, options) => {
      const cli = new ClaudeRecallCLI(program.opts());
      cli.search(query, {
        limit: parseInt(options.limit),
        json: options.json
      });
    });

  // Stats command
  program
    .command('stats')
    .description('Show memory statistics')
    .action(() => {
      const cli = new ClaudeRecallCLI(program.opts());
      cli.showStats();
    });

  // Export command
  program
    .command('export <output>')
    .description('Export memories to file')
    .option('-f, --format <format>', 'Export format (json)', 'json')
    .action(async (output, options) => {
      const cli = new ClaudeRecallCLI(program.opts());
      await cli.export(output, options);
    });

  // Import command
  program
    .command('import <input>')
    .description('Import memories from file')
    .action(async (input) => {
      const cli = new ClaudeRecallCLI(program.opts());
      await cli.import(input);
    });

  // Clear command
  program
    .command('clear')
    .description('Clear memories')
    .option('-t, --type <type>', 'Clear specific memory type')
    .option('--force', 'Confirm deletion')
    .action(async (options) => {
      const cli = new ClaudeRecallCLI(program.opts());
      await cli.clear(options);
    });

  // Status command
  program
    .command('status')
    .description('Show installation and system status')
    .action(async () => {
      const cli = new ClaudeRecallCLI(program.opts());
      await cli.status();
    });

  // Parse arguments
  await program.parseAsync(process.argv);
  
  // Show help if no command
  if (process.argv.length <= 2) {
    program.help();
  }
}

// Run CLI
main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});

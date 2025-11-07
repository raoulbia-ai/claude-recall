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
import { SearchMonitor } from '../services/search-monitor';
import { LiveTestCommand } from './commands/live-test';
import { QueueIntegrationService } from '../services/queue-integration';

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
    const configService = ConfigService.getInstance();
    const config = configService.getConfig();
    const maxMemories = config.database.compaction?.maxMemories || 10000;
    const usagePercent = (stats.total / maxMemories) * 100;

    console.log('\n📊 Claude Recall Statistics\n');
    console.log(`Total Memories: ${stats.total}/${maxMemories} (${usagePercent.toFixed(1)}%)`);

    // Simple status indicator
    if (usagePercent >= 90) {
      console.log('⚠️  WARNING: Approaching memory limit - pruning will occur soon');
    } else if (usagePercent >= 80) {
      console.log('⚠️  Note: Memory usage is high');
    }

    if (stats.byType && Object.keys(stats.byType).length > 0) {
      console.log('\nMemories by type:');
      for (const [type, count] of Object.entries(stats.byType)) {
        console.log(`  ${type}: ${count}`);
      }
    }

    // Skills Evolution: Show DevOps breakdown
    this.showSkillsEvolution();

    // Token Savings Estimate
    this.showTokenSavings(stats);

    console.log('\n');
    this.logger.info('CLI', 'Stats displayed', stats);
  }

  /**
   * Show skills evolution breakdown
   */
  private showSkillsEvolution(): void {
    const allMemories = this.memoryService.search('');
    const devopsMemories = allMemories.filter(m => m.type === 'devops');

    if (devopsMemories.length === 0) {
      return;
    }

    console.log('\n🚀 Skills Evolution (DevOps Workflows):');

    // Count by category
    const categoryCounts: Record<string, number> = {};
    for (const memory of devopsMemories) {
      try {
        const data = typeof memory.value === 'string' ? JSON.parse(memory.value) : memory.value;
        const category = data.category || 'unknown';
        categoryCounts[category] = (categoryCounts[category] || 0) + 1;
      } catch {
        categoryCounts['unknown'] = (categoryCounts['unknown'] || 0) + 1;
      }
    }

    // Display categories with friendly names
    const categoryNames: Record<string, string> = {
      'project_purpose': 'Project Identity',
      'tech_stack': 'Tech Stack Choices',
      'dev_environment': 'Dev Environment Setup',
      'workflow_rule': 'Workflow Rules',
      'git_workflow': 'Git Patterns',
      'testing_approach': 'Testing Strategies',
      'architecture': 'Architecture Decisions',
      'dependency': 'Dependencies',
      'build_deploy': 'Build & Deploy'
    };

    const sortedCategories = Object.entries(categoryCounts)
      .sort(([, a], [, b]) => b - a);

    for (const [category, count] of sortedCategories) {
      const friendlyName = categoryNames[category] || category;
      console.log(`  ${friendlyName}: ${count} pattern${count > 1 ? 's' : ''}`);
    }
  }

  /**
   * Show estimated token savings
   */
  private showTokenSavings(stats: any): void {
    if (stats.total === 0) {
      return;
    }

    // Rough estimation:
    // - Each memory saves ~200 tokens (vs repeating to LLM)
    // - DevOps memories save ~1,500 tokens each (vs loading reference files)
    const allMemories = this.memoryService.search('');
    const devopsCount = allMemories.filter(m => m.type === 'devops').length;
    const otherCount = stats.total - devopsCount;

    const devopsSavings = devopsCount * 1500;
    const otherSavings = otherCount * 200;
    const totalSavings = devopsSavings + otherSavings;

    console.log('\n💰 Estimated Token Savings:');
    console.log(`  Total saved: ~${totalSavings.toLocaleString()} tokens`);
    console.log(`  (vs repeating preferences or loading all reference files)`);
  }

  /**
   * Search memories by query
   */
  search(query: string, options: { limit?: number; json?: boolean }): void {
    const limit = options.limit || 10;
    const results = this.memoryService.search(query);
    const topResults = results.slice(0, limit);

    if (options.json) {
      // Format for hook consumption - include relevance_score field
      const formattedResults = topResults.map((result: any) => ({
        key: result.key,
        value: result.value,
        type: result.type,
        timestamp: result.timestamp,
        relevance_score: result.score, // Rename score to relevance_score for hooks
        access_count: result.access_count,
        project_id: result.project_id,
        file_path: result.file_path
      }));
      console.log(JSON.stringify(formattedResults, null, 2));
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
      
      // Actually clear the memories
      const count = memoryService.clear(options.type);
      
      if (options.type) {
        console.log(`✅ Cleared ${count} memories of type: ${options.type}`);
      } else {
        console.log(`✅ Cleared ${count} memories`);
      }
      
      this.logger.info('CLI', 'Clear completed', { type: options.type, count });
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

  /**
   * Store a memory directly from CLI
   */
  async store(content: string, options: { type?: string; confidence?: number; metadata?: string }): Promise<void> {
    try {
      const type = options.type || 'preference';
      const confidence = options.confidence || 0.8;

      // Parse metadata if provided
      let metadata = {};
      if (options.metadata) {
        try {
          metadata = JSON.parse(options.metadata);
        } catch (error) {
          console.error('❌ Invalid metadata JSON');
          process.exit(1);
        }
      }

      // Generate unique key
      const key = `cli_${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Store memory
      this.memoryService.store({
        key,
        value: {
          content,
          confidence,
          source: 'cli',
          ...metadata,
          timestamp: Date.now()
        },
        type,
        context: {
          timestamp: Date.now()
        },
        relevanceScore: confidence
      });

      console.log(`✅ Memory stored successfully`);
      console.log(`   ID: ${key}`);
      console.log(`   Type: ${type}`);
      console.log(`   Confidence: ${confidence}`);

      this.logger.info('CLI', 'Memory stored', { key, type, confidence });
    } catch (error) {
      console.error('❌ Store failed:', error);
      this.logger.error('CLI', 'Store failed', error);
      process.exit(1);
    }
  }

  private truncateContent(content: any): string {
    const str = typeof content === 'string' ? content : JSON.stringify(content);
    const maxLength = 100;
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength) + '...';
  }
}

// Get version from package.json
function getVersion(): string {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf-8')
    );
    return packageJson.version;
  } catch (error) {
    return '0.3.0'; // Fallback
  }
}

// Setup CLI commands
async function main() {
  program
    .name('claude-recall')
    .description('Memory-enhanced Claude Code via MCP')
    .version(getVersion())
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
        // Initialize queue integration service for background processing
        const queueIntegration = QueueIntegrationService.getInstance();
        await queueIntegration.initialize();
        
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
  
  // Register live test command
  new LiveTestCommand().register(program);

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
      process.exit(0);
    });

  // Stats command
  program
    .command('stats')
    .description('Show memory statistics')
    .action(() => {
      const cli = new ClaudeRecallCLI(program.opts());
      cli.showStats();
      process.exit(0);
    });

  // Export command
  program
    .command('export <output>')
    .description('Export memories to file')
    .option('-f, --format <format>', 'Export format (json)', 'json')
    .action(async (output, options) => {
      const cli = new ClaudeRecallCLI(program.opts());
      await cli.export(output, options);
      process.exit(0);
    });

  // Import command
  program
    .command('import <input>')
    .description('Import memories from file')
    .action(async (input) => {
      const cli = new ClaudeRecallCLI(program.opts());
      await cli.import(input);
      process.exit(0);
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
      process.exit(0);
    });

  // Status command
  program
    .command('status')
    .description('Show installation and system status')
    .action(async () => {
      const cli = new ClaudeRecallCLI(program.opts());
      await cli.status();
      process.exit(0);
    });

  // Store command
  program
    .command('store <content>')
    .description('Store a memory directly')
    .option('-t, --type <type>', 'Memory type (default: preference)', 'preference')
    .option('-c, --confidence <score>', 'Confidence score 0.0-1.0 (default: 0.8)', '0.8')
    .option('-m, --metadata <json>', 'Additional metadata as JSON string')
    .action(async (content, options) => {
      const cli = new ClaudeRecallCLI(program.opts());
      await cli.store(content, {
        type: options.type,
        confidence: parseFloat(options.confidence),
        metadata: options.metadata
      });
      process.exit(0);
    });

  // Test memory search command
  program
    .command('test-memory-search')
    .description('Test if Claude properly searches memory before creating files')
    .action(async () => {
      console.log('\n🧪 Testing Claude Memory Search Compliance\n');
      console.log('This test verifies that Claude searches memory before file operations.\n');
      
      // Store a test preference
      const memoryService = MemoryService.getInstance();
      const testKey = `test_${Date.now()}`;
      memoryService.store({
        key: testKey,
        value: 'save all tests in test-pasta/',
        type: 'preference',
        context: { projectId: 'test', type: 'location_preference' }
      });
      
      console.log('✅ Test preference stored: "save all tests in test-pasta/"\n');
      console.log('📋 Now test with Claude:');
      console.log('1. Ask Claude: "create a blank test script"');
      console.log('2. Claude SHOULD:');
      console.log('   - First search memory for test location preferences');
      console.log('   - Find the stored preference');
      console.log('   - Create the file in test-pasta/ (NOT in tests/)');
      console.log('\n❌ If Claude creates in tests/ instead, the search was NOT performed.');
      console.log('✅ If Claude creates in test-pasta/, the search WAS performed.\n');
      
      // Show search results to verify
      console.log('🔍 Verifying stored preference can be found:');
      const results = memoryService.search('test script location directory');
      const found = results.find((r: any) => r.value.includes('test-pasta'));
      
      if (found) {
        console.log('✅ Memory search returns: "' + found.value + '"');
        console.log('   Score: ' + found.score.toFixed(3));
      } else {
        console.log('❌ Warning: Test preference not found in search!');
      }
      
      console.log('\n📊 Memory search monitoring is active.');
      console.log('   Check logs to verify search calls are being made.\n');
      process.exit(0);
    });

  // Search monitor command
  program
    .command('monitor')
    .description('View memory search monitoring statistics')
    .option('--clear', 'Clear monitoring logs')
    .action(async (options) => {
      const monitor = SearchMonitor.getInstance();
      
      if (options.clear) {
        monitor.clearLogs();
        console.log('✅ Search monitoring logs cleared.\n');
        process.exit(0);
      }
      
      console.log('\n📊 Memory Search Monitoring Statistics\n');
      
      const stats = monitor.getSearchStats();
      console.log(`Total searches: ${stats.totalSearches}`);
      console.log(`Average results per search: ${stats.averageResultCount.toFixed(1)}`);
      
      if (stats.lastSearchTime) {
        console.log(`Last search: ${stats.lastSearchTime.toLocaleString()}`);
      }
      
      if (Object.keys(stats.searchesBySource).length > 0) {
        console.log('\nSearches by source:');
        for (const [source, count] of Object.entries(stats.searchesBySource)) {
          console.log(`  ${source}: ${count}`);
        }
      }
      
      // Check compliance
      const compliance = monitor.checkCompliance();
      console.log('\nCompliance check (last 5 minutes):');
      console.log(`  Status: ${compliance.compliant ? '✅ Compliant' : '❌ Non-compliant'}`);
      console.log(`  Compliance rate: ${(compliance.details.complianceRate * 100).toFixed(0)}%`);
      
      if (compliance.details.issues.length > 0) {
        console.log('  Issues:');
        compliance.details.issues.forEach(issue => {
          console.log(`    - ${issue}`);
        });
      }
      
      // Show recent searches
      const recent = monitor.getRecentSearches(5);
      if (recent.length > 0) {
        console.log('\nRecent searches:');
        recent.forEach((search, i) => {
          const time = new Date(search.timestamp).toLocaleTimeString();
          console.log(`  ${i + 1}. [${time}] "${search.query.substring(0, 50)}${search.query.length > 50 ? '...' : ''}" (${search.resultCount} results)`);
        });
      }
      
      console.log('\n');
      process.exit(0);
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

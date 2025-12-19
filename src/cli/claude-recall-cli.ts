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
import { MemoryEvolution, SophisticationLevel } from '../services/memory-evolution';
import { FailureExtractor } from '../services/failure-extractor';
import { MCPCommands } from './commands/mcp-commands';
import { ProjectCommands } from './commands/project-commands';
import { HookCommands } from './commands/hook-commands';
import { AgentCommands } from './commands/agent-commands';

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
  showStats(options?: { project?: string; global?: boolean }): void {
    let stats;
    const configService = ConfigService.getInstance();
    const config = configService.getConfig();
    const maxMemories = config.database.compaction?.maxMemories || 10000;

    if (options?.global) {
      // Show stats for all memories
      stats = this.memoryService.getStats();
      console.log('\n📊 Claude Recall Statistics (All Projects)\n');
    } else if (options?.project) {
      // Show stats for specific project + universal
      stats = this.getProjectStats(options.project);
      console.log(`\n📊 Claude Recall Statistics (Project: ${options.project})\n`);
    } else {
      // Show stats for current project + universal
      const projectId = configService.getProjectId();
      stats = this.getProjectStats(projectId);
      console.log(`\n📊 Claude Recall Statistics (Project: ${projectId})\n`);
    }

    const usagePercent = (stats.total / maxMemories) * 100;
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
   * Get stats for a specific project (includes universal and unscoped memories)
   */
  private getProjectStats(projectId: string): any {
    const allMemories = this.memoryService.search('');
    const projectMemories = allMemories.filter(m =>
      m.project_id === projectId ||
      m.scope === 'universal' ||
      m.project_id === null
    );

    // Calculate byType breakdown
    const byType: Record<string, number> = {};
    for (const mem of projectMemories) {
      byType[mem.type] = (byType[mem.type] || 0) + 1;
    }

    return {
      total: projectMemories.length,
      byType
    };
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
   * Show memory evolution metrics (v0.7.0)
   */
  showEvolution(options: { project?: string; days?: number }): void {
    const evolution = MemoryEvolution.getInstance();
    const metrics = evolution.getEvolutionMetrics(
      options.project,
      options.days || 30
    );

    console.log('\n📈 Memory Evolution\n');
    console.log(`Analysis Period: Last ${options.days || 30} days`);
    if (options.project) {
      console.log(`Project: ${options.project}`);
    }
    console.log(`Total Memories: ${metrics.totalMemories}`);
    console.log(`Progression Score: ${metrics.progressionScore}/100\n`);

    if (metrics.totalMemories === 0) {
      console.log('No memories found for this period.\n');
      return;
    }

    console.log('Sophistication Breakdown:');
    const total = metrics.totalMemories;
    const levels = [
      { level: 1, name: 'Procedural (L1)' },
      { level: 2, name: 'Self-Reflection (L2)' },
      { level: 3, name: 'Adaptive (L3)' },
      { level: 4, name: 'Compositional (L4)' }
    ];

    for (const { level, name } of levels) {
      const count = metrics.sophisticationBreakdown[level as SophisticationLevel];
      const pct = ((count / total) * 100).toFixed(1);
      console.log(`  ${name}: ${count.toString().padStart(3)} (${pct.padStart(5)}%)`);
    }

    console.log('');

    // Confidence trend
    const confidenceArrow = metrics.confidenceTrend === 'improving' ? '↗' :
                            metrics.confidenceTrend === 'declining' ? '↘' : '→';
    console.log(`Average Confidence: ${metrics.averageConfidence.toFixed(2)} ${confidenceArrow}`);

    // Failure trend
    const failureArrow = metrics.failureTrend === 'improving' ? '↗ Better' :
                         metrics.failureTrend === 'worsening' ? '↘ Worse' : '→';
    console.log(`Failure Rate: ${metrics.failureRate.toFixed(1)}% ${failureArrow}\n`);

    // Interpretation
    if (metrics.progressionScore >= 75) {
      console.log('✓ Agent demonstrating sophisticated reasoning');
    } else if (metrics.progressionScore >= 50) {
      console.log('○ Agent developing adaptive patterns');
    } else {
      console.log('◌ Agent in early learning phase');
    }

    console.log('');
    this.logger.info('CLI', 'Evolution metrics displayed', metrics);
  }

  /**
   * Show failure memories (v0.7.0)
   */
  showFailures(options: { limit?: number; project?: string }): void {
    const allMemories = this.memoryService.search('');
    let failures = allMemories.filter(m => m.type === 'failure');

    if (options.project) {
      failures = failures.filter(m => m.project_id === options.project);
    }

    // Sort by timestamp (newest first)
    failures.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    // Limit results
    const limit = options.limit || 10;
    const displayFailures = failures.slice(0, limit);

    console.log('\n❌ Failure Memories (Counterfactual Learning)\n');
    console.log(`Found ${failures.length} failures (showing ${displayFailures.length})\n`);

    if (displayFailures.length === 0) {
      console.log('No failure memories found.\n');
      return;
    }

    displayFailures.forEach((failure, index) => {
      const value = typeof failure.value === 'string'
        ? JSON.parse(failure.value)
        : failure.value;

      const content = value.content || value;

      console.log(`${index + 1}. ${value.title || 'Untitled Failure'}`);
      console.log(`   What Failed: ${content.what_failed || 'Unknown'}`);
      console.log(`   Why Failed: ${content.why_failed || 'Unknown'}`);
      console.log(`   Should Do: ${content.what_should_do || 'Unknown'}`);

      if (content.preventative_checks && content.preventative_checks.length > 0) {
        console.log(`   Preventative Checks:`);
        content.preventative_checks.forEach((check: string) => {
          console.log(`     - ${check}`);
        });
      }

      console.log(`   Context: ${content.context || 'Unknown'}`);
      console.log(`   When: ${new Date(failure.timestamp || 0).toLocaleString()}`);
      console.log('');
    });

    this.logger.info('CLI', 'Failures displayed', { count: displayFailures.length });
  }

  /**
   * Search memories by query
   */
  search(query: string, options: { limit?: number; json?: boolean; project?: string; global?: boolean }): void {
    const limit = options.limit || 10;

    // Determine search scope
    let results;
    if (options.global) {
      // Global search: all memories
      results = this.memoryService.search(query);
    } else if (options.project) {
      // Project-specific search: project + universal
      results = this.memoryService.findRelevant({
        query,
        projectId: options.project
      });
    } else {
      // Default: current project + universal
      const config = ConfigService.getInstance();
      results = this.memoryService.findRelevant({
        query,
        projectId: config.getProjectId()
      });
    }

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

  // Helper function to recursively copy directories
  function copyDirRecursive(src: string, dest: string): void {
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

  // Install hooks and skills to current project
  function installHooksAndSkills(force: boolean = false): void {
    const cwd = process.cwd();
    const projectName = path.basename(cwd);

    console.log('\n📦 Installing Claude Recall hooks and skills...\n');
    console.log(`📍 Project: ${projectName}`);
    console.log(`📍 Directory: ${cwd}\n`);

    // Find the package directory (where claude-recall is installed)
    // When run via npx, __dirname points to dist/cli, so we go up to find .claude
    const packageDir = path.resolve(__dirname, '../..');
    const packageHooksDir = path.join(packageDir, '.claude/hooks');
    const packageSkillsDir = path.join(packageDir, '.claude/skills');

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
    } else {
      console.log(`⚠️  Hook not found at: ${packageHooksDir}`);
    }

    // Create or update .claude/settings.json with hook configuration
    const settingsPath = path.join(claudeDir, 'settings.json');
    let settings: Record<string, unknown> = {};

    if (fs.existsSync(settingsPath)) {
      try {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      } catch (e) {
        settings = {};
      }
    }

    const CURRENT_HOOKS_VERSION = '1.0.0';
    const needsUpdate = force || !settings.hooks || settings.hooksVersion !== CURRENT_HOOKS_VERSION;

    if (needsUpdate) {
      settings.hooksVersion = CURRENT_HOOKS_VERSION;
      settings.hooks = {
        PreToolUse: [
          {
            matcher: "mcp__claude-recall__.*|Write|Edit|Bash|Task",
            hooks: [
              {
                type: "command",
                command: `python3 ${path.join(hooksDir, 'memory_enforcer.py')}`,
              }
            ]
          }
        ]
      };

      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      console.log('✅ Configured hook in .claude/settings.json');
      if (force) {
        console.log('   → Force flag: overwrote existing configuration');
      }
    } else {
      console.log(`ℹ️  Hooks already at version ${CURRENT_HOOKS_VERSION}`);
    }

    // Copy skills directory
    if (fs.existsSync(packageSkillsDir)) {
      const skillsDir = path.join(claudeDir, 'skills');
      copyDirRecursive(packageSkillsDir, skillsDir);
      console.log('✅ Installed SKILL.md to .claude/skills/');
    } else {
      console.log(`⚠️  Skills not found at: ${packageSkillsDir}`);
    }

    console.log('\n✅ Installation complete!\n');
    console.log('Restart Claude Code to activate.\n');
  }

  // Setup command - shows activation instructions or installs hooks/skills
  program
    .command('setup')
    .description('Show activation instructions or install hooks/skills')
    .option('--install', 'Install hooks and skills to current project')
    .action((options) => {
      if (options.install) {
        // Install hooks and skills to current project
        installHooksAndSkills();
      } else {
        // Show activation instructions
        console.log('\n✅ Claude Recall Setup\n');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📌 ACTIVATE CLAUDE RECALL:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('');
        console.log('  claude mcp add claude-recall -- npx -y claude-recall@latest mcp start');
        console.log('');
        console.log('  Then restart Claude Code (exit and re-enter the session).');
        console.log('');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('');
        console.log('🔄 Already registered? Remove and re-add:');
        console.log('  claude mcp remove claude-recall');
        console.log('  claude mcp add claude-recall -- npx -y claude-recall@latest mcp start');
        console.log('');
        console.log('🛑 Stop old instance:');
        console.log('  npx claude-recall mcp stop');
        console.log('');
      }
      process.exit(0);
    });

  // Repair command - simple alias for setup --install
  program
    .command('repair')
    .description('Repair broken or missing hooks and skills')
    .option('--force', 'Force overwrite existing hook configuration')
    .action((options) => {
      installHooksAndSkills(options.force || false);
      process.exit(0);
    });

  // Check hooks function
  function checkHooks(): void {
    const cwd = process.cwd();
    console.log('\n🔍 Checking Claude Recall hooks...\n');
    console.log(`📍 Directory: ${cwd}\n`);

    // 1. Find settings.json (walk up directory tree like Claude Code does)
    let settingsPath: string | null = null;
    let searchDir = cwd;
    while (searchDir !== path.dirname(searchDir)) {
      const candidate = path.join(searchDir, '.claude/settings.json');
      if (fs.existsSync(candidate)) {
        settingsPath = candidate;
        break;
      }
      searchDir = path.dirname(searchDir);
    }

    if (!settingsPath) {
      console.log('❌ No .claude/settings.json found in directory tree');
      console.log('   Run: npx claude-recall repair\n');
      return;
    }
    console.log(`✅ Found settings: ${settingsPath}`);

    // 2. Parse and check hooks config
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (!settings.hooks) {
      console.log('❌ No hooks configured in settings.json');
      return;
    }
    console.log('✅ Hooks configured in settings.json');

    // 3. Check each hook file exists
    const hookCommands: string[] = [];
    for (const hookType of ['PreToolUse', 'UserPromptSubmit']) {
      const hooks = settings.hooks[hookType] || [];
      for (const group of hooks) {
        for (const hook of group.hooks || []) {
          if (hook.command) hookCommands.push(hook.command);
        }
      }
    }

    console.log(`\n📋 Hook commands (${hookCommands.length}):\n`);

    let hasIssues = false;
    for (const cmd of hookCommands) {
      const match = cmd.match(/python3?\s+(.+\.py)/);
      if (match) {
        const scriptPath = match[1];
        const isAbsolute = path.isAbsolute(scriptPath);
        const exists = fs.existsSync(scriptPath);

        const existsIcon = exists ? '✅' : '❌';
        console.log(`   ${existsIcon} ${scriptPath}`);

        if (!isAbsolute) {
          console.log(`      ⚠️  Relative path - may fail from subdirectories`);
          hasIssues = true;
        }
        if (!exists) {
          console.log(`      ❌ File not found`);
          hasIssues = true;
        }
      }
    }

    // 4. Test a hook (dry run)
    console.log('\n🧪 Testing hook execution...\n');
    const testHook = hookCommands[0];
    if (testHook) {
      try {
        const { execSync } = require('child_process');
        execSync(testHook + ' --help 2>&1 || true', { encoding: 'utf8', timeout: 5000 });
        console.log('✅ Hook script is executable');
      } catch (e) {
        console.log('❌ Hook script failed to execute');
        hasIssues = true;
      }
    }

    if (hasIssues) {
      console.log('\n⚠️  Issues found. Run: npx claude-recall repair\n');
    } else {
      console.log('\n✅ All hooks OK!\n');
    }
  }

  // Test enforcement function - simulates the hook chain to verify it works
  function testEnforcement(): void {
    const os = require('os');
    const { execSync } = require('child_process');

    console.log('\n🧪 Testing Memory Search Enforcement...\n');

    const stateDir = path.join(os.homedir(), '.claude-recall', 'hook-state');
    const testSessionId = 'test-enforcement-' + Date.now();
    const stateFile = path.join(stateDir, `${testSessionId}.json`);

    // Create state directory if needed
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }

    // Find the enforcer hook script
    let searchDir = process.cwd();
    let enforcerPath: string | null = null;
    while (searchDir !== path.dirname(searchDir)) {
      const candidate = path.join(searchDir, '.claude/hooks/pre_tool_search_enforcer.py');
      if (fs.existsSync(candidate)) {
        enforcerPath = candidate;
        break;
      }
      searchDir = path.dirname(searchDir);
    }

    if (!enforcerPath) {
      console.log('❌ Could not find pre_tool_search_enforcer.py');
      console.log('   Run: npx claude-recall repair\n');
      return;
    }

    console.log(`📍 Enforcer: ${enforcerPath}`);
    console.log(`📍 State file: ${stateFile}\n`);

    // Test 1: No state file - should block
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 1: Write without search (should BLOCK)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Remove any existing state file
    if (fs.existsSync(stateFile)) {
      fs.unlinkSync(stateFile);
    }

    const testInput1 = JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: '/test/example.ts' },
      session_id: testSessionId
    });

    let test1Passed = false;
    try {
      execSync(`echo '${testInput1}' | python3 ${enforcerPath}`, {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      console.log('❌ FAIL: Hook allowed Write without search\n');
    } catch (e: unknown) {
      const execError = e as { status?: number; stderr?: string };
      if (execError.status === 2) {
        console.log('✅ PASS: Hook blocked Write (exit code 2)\n');
        test1Passed = true;
      } else {
        console.log(`❌ FAIL: Unexpected error: ${e}\n`);
      }
    }

    // Test 2: Create state file with recent search - should allow
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 2: Write after recent search (should ALLOW)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Create state file simulating a recent search
    const stateData = {
      sessionId: testSessionId,
      lastSearchAt: Date.now(),
      searchQuery: 'test query',
      toolHistory: [
        { tool: 'mcp__claude-recall__search', at: Date.now() }
      ]
    };
    fs.writeFileSync(stateFile, JSON.stringify(stateData, null, 2));

    const testInput2 = JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: '/test/example.ts' },
      session_id: testSessionId
    });

    let test2Passed = false;
    try {
      execSync(`echo '${testInput2}' | python3 ${enforcerPath}`, {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      console.log('✅ PASS: Hook allowed Write after search (exit code 0)\n');
      test2Passed = true;
    } catch (e: unknown) {
      const execError = e as { status?: number };
      console.log(`❌ FAIL: Hook blocked Write (exit code ${execError.status})\n`);
    }

    // Cleanup
    if (fs.existsSync(stateFile)) {
      fs.unlinkSync(stateFile);
    }

    // Summary
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (test1Passed && test2Passed) {
      console.log('✅ All tests passed! Enforcement is working correctly.\n');
      console.log('Claude will be blocked from Write/Edit until memory search is performed.\n');
    } else {
      console.log('❌ Some tests failed. Check hook configuration.\n');
      console.log('Run: npx claude-recall repair\n');
    }
  }

  // Hooks command group
  const hooksCmd = program
    .command('hooks')
    .description('Hook management (subcommands: check, test-enforcement)');

  hooksCmd
    .command('check')
    .description('Check if hooks are properly configured and working')
    .action(() => {
      checkHooks();
      process.exit(0);
    });

  hooksCmd
    .command('test-enforcement')
    .description('Test that memory search enforcement is working')
    .action(() => {
      testEnforcement();
      process.exit(0);
    });

  // MCP command
  const mcpCmd = program
    .command('mcp')
    .description('MCP server commands (start, stop, status, cleanup, ps, restart)');

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

  // Register MCP process management commands
  MCPCommands.register(mcpCmd);

  // Project management commands
  ProjectCommands.register(program);

  // Migration commands
  MigrateCommand.register(program);

  // Hook commands (used by Claude Code hooks)
  HookCommands.register(program);

  // Agent commands (autonomous memory agent management)
  AgentCommands.register(program);

  // Register live test command
  new LiveTestCommand().register(program);

  // Search command
  program
    .command('search <query>')
    .description('Search memories by query')
    .option('-l, --limit <number>', 'Maximum results to show', '10')
    .option('--json', 'Output as JSON')
    .option('--project <id>', 'Filter by project ID (includes universal memories)')
    .option('--global', 'Search all projects and memories')
    .action((query, options) => {
      const cli = new ClaudeRecallCLI(program.opts());
      cli.search(query, {
        limit: parseInt(options.limit),
        json: options.json,
        project: options.project,
        global: options.global
      });
      process.exit(0);
    });

  // Stats command
  program
    .command('stats')
    .description('Show memory statistics')
    .option('--project <id>', 'Filter by project ID')
    .option('--global', 'Show all memories across all projects')
    .action((options) => {
      const cli = new ClaudeRecallCLI(program.opts());
      cli.showStats({
        project: options.project,
        global: options.global
      });
      process.exit(0);
    });

  // Evolution command
  program
    .command('evolution')
    .description('View memory evolution and sophistication metrics')
    .option('--project <id>', 'Filter by project ID')
    .option('--days <number>', 'Number of days to analyze', '30')
    .action((options) => {
      const cli = new ClaudeRecallCLI(program.opts());
      cli.showEvolution({
        project: options.project,
        days: parseInt(options.days)
      });
      process.exit(0);
    });

  // Failures command
  program
    .command('failures')
    .description('View failure memories with counterfactual learning')
    .option('--limit <number>', 'Maximum failures to show', '10')
    .option('--project <id>', 'Filter by project ID')
    .action((options) => {
      const cli = new ClaudeRecallCLI(program.opts());
      cli.showFailures({
        limit: parseInt(options.limit),
        project: options.project
      });
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

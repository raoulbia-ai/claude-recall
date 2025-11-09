import { Command } from 'commander';
import { ProjectRegistry } from '../../services/project-registry';
import { ConfigService } from '../../services/config';
import { ProcessManager } from '../../services/process-manager';
import chalk from 'chalk';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Project Management Commands
 *
 * Provides CLI commands for managing project registration:
 * - register: Register current or specific project
 * - unregister: Remove project from registry
 * - list: Show all registered projects
 * - show: Show details for specific project
 * - clean: Remove stale registry entries
 */
export class ProjectCommands {
  private projectRegistry: ProjectRegistry;
  private config: ConfigService;
  private processManager: ProcessManager;

  constructor() {
    this.projectRegistry = ProjectRegistry.getInstance();
    this.config = ConfigService.getInstance();
    this.processManager = ProcessManager.getInstance();
  }

  static register(program: Command): void {
    const commands = new ProjectCommands();

    const projectCmd = program
      .command('project')
      .description('Project registration and management');

    // project register
    projectCmd
      .command('register')
      .description('Register current or specified project')
      .option('--path <path>', 'Project path (default: current directory)')
      .action(async (options) => {
        await commands.registerProject(options);
      });

    // project unregister
    projectCmd
      .command('unregister [project-id]')
      .description('Unregister a project')
      .action(async (projectId) => {
        await commands.unregisterProject(projectId);
      });

    // project list
    projectCmd
      .command('list')
      .description('List all registered projects')
      .option('--json', 'Output as JSON')
      .action(async (options) => {
        await commands.listProjects(options);
      });

    // project show
    projectCmd
      .command('show [project-id]')
      .description('Show details for a project (default: current)')
      .action(async (projectId) => {
        await commands.showProject(projectId);
      });

    // project clean
    projectCmd
      .command('clean')
      .description('Remove stale registry entries')
      .option('--dry-run', 'Show what would be removed without removing')
      .option('--days <number>', 'Days without activity to consider stale', '30')
      .action(async (options) => {
        await commands.cleanRegistry(options);
      });
  }

  /**
   * Register a project
   */
  async registerProject(options: { path?: string }): Promise<void> {
    console.log(chalk.cyan('\n📝 Registering Project\n'));

    try {
      // Determine project path
      const projectPath = options.path
        ? path.resolve(options.path)
        : process.cwd();

      // Validate path exists
      if (!fs.existsSync(projectPath)) {
        console.log(chalk.red(`✗ Path does not exist: ${projectPath}`));
        console.log();
        return;
      }

      // Get project ID
      const projectId = path.basename(projectPath);

      // Get version
      const version = this.getVersion();

      // Register
      this.projectRegistry.register(projectId, projectPath, version);

      console.log(`Project:  ${chalk.yellow(projectId)}`);
      console.log(`Path:     ${chalk.gray(projectPath)}`);
      console.log(`Version:  ${chalk.gray(version)}`);
      console.log();
      console.log(chalk.green('✓ Project registered successfully'));
      console.log();
    } catch (error) {
      console.log(chalk.red(`✗ Failed to register project: ${error}`));
      console.log();
    }
  }

  /**
   * Unregister a project
   */
  async unregisterProject(projectId?: string): Promise<void> {
    console.log(chalk.cyan('\n🗑️  Unregistering Project\n'));

    try {
      // If no projectId provided, use current directory
      const targetProjectId = projectId || this.config.getProjectId();

      // Get project info before removing
      const entry = this.projectRegistry.get(targetProjectId);
      if (!entry) {
        console.log(chalk.yellow(`⚠ Project not found in registry: ${targetProjectId}`));
        console.log();
        return;
      }

      console.log(`Project:  ${chalk.yellow(targetProjectId)}`);
      console.log(`Path:     ${chalk.gray(entry.path)}`);
      console.log();

      // Unregister
      const success = this.projectRegistry.unregister(targetProjectId);

      if (success) {
        console.log(chalk.green('✓ Project unregistered successfully'));
        console.log();
        console.log(chalk.gray('Note: This does not remove the MCP server configuration from ~/.claude.json'));
        console.log(chalk.gray('      Use `claude mcp` commands to manage MCP servers.'));
        console.log();
      } else {
        console.log(chalk.red('✗ Failed to unregister project'));
        console.log();
      }
    } catch (error) {
      console.log(chalk.red(`✗ Error: ${error}`));
      console.log();
    }
  }

  /**
   * List all registered projects
   */
  async listProjects(options: { json?: boolean }): Promise<void> {
    const projects = this.projectRegistry.list();

    if (options.json) {
      console.log(JSON.stringify(projects, null, 2));
      return;
    }

    console.log(chalk.cyan('\n📋 Registered Projects\n'));

    if (projects.length === 0) {
      console.log(chalk.gray('No projects registered.'));
      console.log();
      console.log(chalk.yellow('💡 Run `npx claude-recall project register` to register the current project'));
      console.log();
      return;
    }

    // Get running servers for status
    const runningServers = this.processManager.getAllRunningServers();
    const runningProjectIds = new Set(
      runningServers.filter(s => s.isRunning).map(s => s.projectId)
    );

    // Sort by lastSeen (most recent first)
    projects.sort((a, b) => {
      return new Date(b.entry.lastSeen).getTime() - new Date(a.entry.lastSeen).getTime();
    });

    for (const { projectId, entry } of projects) {
      const isRunning = runningProjectIds.has(projectId);
      const lastSeenTime = this.formatRelativeTime(entry.lastSeen);

      console.log(chalk.bold(projectId));
      console.log(`  Path:      ${chalk.gray(entry.path)}`);
      console.log(`  Version:   ${chalk.gray(entry.version)}`);
      console.log(`  Last seen: ${chalk.gray(lastSeenTime)}`);
      console.log(`  Status:    ${isRunning ? chalk.green('✓ Active (MCP running)') : chalk.gray('✗ Inactive')}`);
      console.log();
    }

    console.log(chalk.gray(`Total: ${projects.length} project(s)`));
    console.log();
  }

  /**
   * Show details for a specific project
   */
  async showProject(projectId?: string): Promise<void> {
    const targetProjectId = projectId || this.config.getProjectId();

    console.log(chalk.cyan('\n📊 Project Details\n'));

    const entry = this.projectRegistry.get(targetProjectId);
    if (!entry) {
      console.log(chalk.yellow(`⚠ Project not found: ${targetProjectId}`));
      console.log();
      console.log(chalk.gray('Run `npx claude-recall project list` to see registered projects'));
      console.log();
      return;
    }

    // Check if MCP server is running
    const status = this.processManager.getServerStatus(targetProjectId);

    console.log(`${chalk.bold('Project:')}  ${chalk.yellow(targetProjectId)}`);
    console.log();
    console.log(chalk.bold('Registry Information:'));
    console.log(`  Path:         ${chalk.gray(entry.path)}`);
    console.log(`  Version:      ${chalk.gray(entry.version)}`);
    console.log(`  Registered:   ${chalk.gray(new Date(entry.registeredAt).toLocaleString())}`);
    console.log(`  Last Seen:    ${chalk.gray(new Date(entry.lastSeen).toLocaleString())} (${this.formatRelativeTime(entry.lastSeen)})`);
    console.log();
    console.log(chalk.bold('MCP Server Status:'));
    console.log(`  Running:      ${status.isRunning ? chalk.green('✓ Yes') : chalk.gray('✗ No')}`);
    if (status.pid) {
      console.log(`  PID:          ${chalk.gray(status.pid)}`);
    }
    console.log(`  PID File:     ${chalk.gray(status.pidFile)}`);
    console.log();
  }

  /**
   * Clean stale registry entries
   */
  async cleanRegistry(options: { dryRun?: boolean; days?: string }): Promise<void> {
    const daysOld = parseInt(options.days || '30', 10);

    console.log(chalk.cyan('\n🧹 Cleaning Registry\n'));

    if (options.dryRun) {
      console.log(chalk.yellow('DRY RUN MODE - No changes will be made\n'));
    }

    console.log(`Removing projects not seen in ${daysOld} days...\n`);

    const removed = this.projectRegistry.clean(daysOld, options.dryRun || false);

    if (removed === 0) {
      console.log(chalk.green('✓ No stale entries found'));
    } else {
      if (options.dryRun) {
        console.log(chalk.gray(`\nWould remove ${removed} stale project(s)`));
      } else {
        console.log(chalk.green(`\n✓ Removed ${removed} stale project(s)`));
      }
    }

    console.log();
  }

  /**
   * Format relative time (e.g., "2 minutes ago", "5 days ago")
   */
  private formatRelativeTime(timestamp: string): string {
    const now = Date.now();
    const then = new Date(timestamp).getTime();
    const diffMs = now - then;

    const seconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days} day${days === 1 ? '' : 's'} ago`;
    } else if (hours > 0) {
      return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    } else if (minutes > 0) {
      return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    } else {
      return 'just now';
    }
  }

  /**
   * Get current version
   */
  private getVersion(): string {
    try {
      const packageJsonPath = path.join(__dirname, '../../../package.json');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      return packageJson.version;
    } catch (error) {
      return 'unknown';
    }
  }
}

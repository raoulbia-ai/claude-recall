import { Command } from 'commander';
import { ProcessManager } from '../../services/process-manager';
import { ConfigService } from '../../services/config';
import { ProjectRegistry } from '../../services/project-registry';
import chalk from 'chalk';

/**
 * MCP Process Management Commands
 *
 * Provides CLI commands for managing MCP server processes:
 * - status: Show MCP server status
 * - ps: List all running MCP servers
 * - stop: Stop MCP server
 * - restart: Restart MCP server
 * - cleanup: Clean up stale PID files and processes
 */
export class MCPCommands {
  private processManager: ProcessManager;
  private config: ConfigService;
  private projectRegistry: ProjectRegistry;

  constructor() {
    this.processManager = ProcessManager.getInstance();
    this.config = ConfigService.getInstance();
    this.projectRegistry = ProjectRegistry.getInstance();
  }

  static register(mcpCmd: Command): void {
    const commands = new MCPCommands();

    // mcp status - Show current project's MCP server status
    mcpCmd
      .command('status')
      .description('Show MCP server status for current project')
      .action(async () => {
        await commands.showStatus();
        process.exit(0);
      });

    // mcp ps - List all running MCP servers
    mcpCmd
      .command('ps')
      .description('List all running MCP servers across all projects')
      .action(async () => {
        await commands.listServers();
        process.exit(0);
      });

    // mcp stop - Stop MCP server
    mcpCmd
      .command('stop')
      .description('Stop MCP server')
      .option('--project <id>', 'Stop specific project server (default: current project)')
      .option('--force', 'Force kill (SIGKILL) instead of graceful shutdown (SIGTERM)')
      .action(async (options) => {
        await commands.stopServer(options);
        process.exit(0);
      });

    // mcp restart - Restart MCP server
    mcpCmd
      .command('restart')
      .description('Restart MCP server for current project')
      .option('--force', 'Force kill before restart')
      .action(async (options) => {
        await commands.restartServer(options);
        process.exit(0);
      });

    // mcp cleanup - Clean up stale processes and PID files
    mcpCmd
      .command('cleanup')
      .description('Clean up stale PID files and processes')
      .option('--dry-run', 'Show what would be cleaned without making changes')
      .option('--all', 'Stop all running MCP servers')
      .option('--force', 'Force kill processes')
      .action(async (options) => {
        await commands.cleanup(options);
        process.exit(0);
      });
  }

  /**
   * Show status of MCP server for current project
   */
  async showStatus(): Promise<void> {
    const projectId = this.config.getProjectId();
    const status = this.processManager.getServerStatus(projectId);
    const registryEntry = this.projectRegistry.get(projectId);

    console.log(chalk.cyan('\n📊 MCP Server Status\n'));
    console.log(`Project:  ${chalk.yellow(projectId)}`);
    console.log(`Status:   ${status.isRunning ? chalk.green('✓ Running') : chalk.gray('✗ Stopped')}`);

    if (status.pid !== null) {
      console.log(`PID:      ${chalk.yellow(status.pid)}`);
      if (!status.isRunning) {
        console.log(chalk.gray(`          (stale PID file exists)`));
      }
    }

    console.log(`PID File: ${chalk.gray(status.pidFile)}`);

    // Show registry information if available
    if (registryEntry) {
      console.log();
      console.log(chalk.bold('Registry Info:'));
      console.log(`  Version:      ${chalk.gray(registryEntry.version)}`);
      console.log(`  Path:         ${chalk.gray(registryEntry.path)}`);
      console.log(`  Registered:   ${chalk.gray(new Date(registryEntry.registeredAt).toLocaleString())}`);
      console.log(`  Last Seen:    ${chalk.gray(new Date(registryEntry.lastSeen).toLocaleString())}`);
    } else {
      console.log();
      console.log(chalk.yellow('⚠ Project not registered in registry'));
      console.log(chalk.gray('  Run `npx claude-recall project register` to register'));
    }

    console.log();
  }

  /**
   * List all running MCP servers across projects
   */
  async listServers(): Promise<void> {
    const servers = this.processManager.getAllRunningServers();
    const registeredProjects = this.projectRegistry.list();

    console.log(chalk.cyan('\n📋 MCP Servers & Registered Projects\n'));

    if (servers.length === 0 && registeredProjects.length === 0) {
      console.log(chalk.gray('No MCP servers or registered projects found.'));
      console.log();
      return;
    }

    const runningServers = servers.filter(s => s.isRunning);
    const staleServers = servers.filter(s => !s.isRunning);

    if (runningServers.length > 0) {
      console.log(chalk.green(`✓ Running (${runningServers.length}):`));
      for (const server of runningServers) {
        const registryEntry = this.projectRegistry.get(server.projectId);
        const versionInfo = registryEntry ? ` [v${registryEntry.version}]` : '';
        console.log(`  ${chalk.yellow(server.projectId.padEnd(40))} PID: ${chalk.cyan(server.pid)}${chalk.gray(versionInfo)}`);
      }
      console.log();
    }

    if (staleServers.length > 0) {
      console.log(chalk.gray(`✗ Stale (${staleServers.length}):`));
      for (const server of staleServers) {
        console.log(`  ${chalk.gray(server.projectId.padEnd(40))} PID: ${chalk.gray(server.pid)} (not running)`);
      }
      console.log();
      console.log(chalk.yellow(`💡 Run 'npx claude-recall mcp cleanup' to remove stale PID files`));
      console.log();
    }

    // Show registered projects that don't have running servers
    const runningProjectIds = new Set(runningServers.map(s => s.projectId));
    const inactiveProjects = registeredProjects.filter(({ projectId }) => !runningProjectIds.has(projectId));

    if (inactiveProjects.length > 0) {
      console.log(chalk.gray(`📂 Registered but Inactive (${inactiveProjects.length}):`));
      for (const { projectId, entry } of inactiveProjects) {
        console.log(`  ${chalk.gray(projectId.padEnd(40))} v${entry.version}`);
      }
      console.log();
      console.log(chalk.gray(`💡 Run 'npx claude-recall project list' for detailed registry info`));
      console.log();
    }
  }

  /**
   * Stop MCP server
   */
  async stopServer(options: { project?: string; force?: boolean }): Promise<void> {
    const projectId = options.project || this.config.getProjectId();
    const status = this.processManager.getServerStatus(projectId);

    console.log(chalk.cyan('\n🛑 Stopping MCP Server\n'));
    console.log(`Project: ${chalk.yellow(projectId)}`);

    if (!status.isRunning) {
      if (status.pid !== null) {
        console.log(chalk.yellow('⚠ Server not running, but stale PID file exists'));
        console.log('Removing stale PID file...');
        this.processManager.removePidFile(projectId);
        console.log(chalk.green('✓ Stale PID file removed'));
      } else {
        console.log(chalk.gray('✗ Server not running'));
      }
      console.log();
      return;
    }

    const signal = options.force ? 'SIGKILL' : 'SIGTERM';
    console.log(`Sending ${signal} to PID ${chalk.yellow(status.pid)}...`);

    try {
      this.processManager.killProcess(status.pid!, options.force || false);
      this.processManager.removePidFile(projectId);

      // Give it a moment to shut down
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify it stopped
      const newStatus = this.processManager.getServerStatus(projectId);
      if (!newStatus.isRunning) {
        console.log(chalk.green('✓ Server stopped successfully'));
      } else {
        console.log(chalk.yellow('⚠ Server may still be running. Try --force flag.'));
      }
    } catch (error) {
      console.log(chalk.red(`✗ Failed to stop server: ${error}`));
    }

    console.log();
  }

  /**
   * Restart MCP server
   */
  async restartServer(options: { force?: boolean }): Promise<void> {
    const projectId = this.config.getProjectId();
    const status = this.processManager.getServerStatus(projectId);

    console.log(chalk.cyan('\n🔄 Restarting MCP Server\n'));
    console.log(`Project: ${chalk.yellow(projectId)}`);

    if (status.isRunning) {
      console.log('Stopping current server...');
      await this.stopServer({ force: options.force });

      // Wait a bit longer for graceful shutdown
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log('\nTo start the server, run:');
    console.log(chalk.cyan('  npx claude-recall mcp start'));
    console.log();
    console.log(chalk.gray('Note: The MCP server is normally started automatically by Claude Code.'));
    console.log(chalk.gray('      You only need to run this manually for debugging purposes.'));
    console.log();
  }

  /**
   * Clean up stale PID files and optionally stop all servers
   */
  async cleanup(options: { dryRun?: boolean; all?: boolean; force?: boolean }): Promise<void> {
    console.log(chalk.cyan('\n🧹 MCP Server Cleanup\n'));

    if (options.dryRun) {
      console.log(chalk.yellow('DRY RUN MODE - No changes will be made\n'));
    }

    if (options.all) {
      console.log(chalk.yellow('⚠ Stopping ALL MCP servers...\n'));
      const stopped = this.processManager.stopAllServers(options.dryRun || false, options.force || false);

      if (options.dryRun) {
        console.log(chalk.gray(`Would stop ${stopped} server(s)`));
      } else {
        console.log(chalk.green(`✓ Stopped ${stopped} server(s)`));
      }
    } else {
      console.log('Cleaning up stale PID files...\n');
      const cleaned = this.processManager.cleanupStalePidFiles(options.dryRun || false);

      if (cleaned === 0) {
        console.log(chalk.green('✓ No stale PID files found'));
      } else {
        if (options.dryRun) {
          console.log(chalk.gray(`\nWould remove ${cleaned} stale PID file(s)`));
        } else {
          console.log(chalk.green(`\n✓ Removed ${cleaned} stale PID file(s)`));
        }
      }
    }

    console.log();
  }
}

import { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { spawn, execSync } from 'child_process';
import chalk from 'chalk';

/**
 * Memory Agent Management Commands
 *
 * Provides CLI commands for managing the autonomous memory agent:
 * - start: Start the memory agent daemon
 * - stop: Stop the memory agent
 * - restart: Restart the agent
 * - status: Check agent status
 * - logs: View agent logs
 */
export class AgentCommands {
  private static AGENT_DIR = join(homedir(), '.claude-recall', 'agent');
  private static PID_FILE = join(AgentCommands.AGENT_DIR, 'memory-agent.pid');
  private static LOG_FILE = join(AgentCommands.AGENT_DIR, 'memory-agent.log');

  static register(program: Command): void {
    const agentCmd = program
      .command('agent')
      .description('Manage the autonomous memory agent');

    // agent start - Start the memory agent daemon
    agentCmd
      .command('start')
      .description('Start the memory agent daemon')
      .option('--project <id>', 'Project ID to monitor')
      .action(async (options) => {
        await AgentCommands.start(options.project);
      });

    // agent stop - Stop the memory agent
    agentCmd
      .command('stop')
      .description('Stop the memory agent')
      .action(() => {
        AgentCommands.stop();
      });

    // agent restart - Restart the agent
    agentCmd
      .command('restart')
      .description('Restart the memory agent')
      .option('--project <id>', 'Project ID to monitor')
      .action(async (options) => {
        await AgentCommands.restart(options.project);
      });

    // agent status - Check agent status
    agentCmd
      .command('status')
      .description('Check memory agent status')
      .action(() => {
        AgentCommands.status();
      });

    // agent logs - Show agent logs
    agentCmd
      .command('logs')
      .description('Show memory agent logs')
      .option('--lines <number>', 'Number of lines to show', '50')
      .action((options) => {
        AgentCommands.logs(parseInt(options.lines));
      });
  }

  /**
   * Ensure agent directory exists
   */
  private static ensureAgentDir(): void {
    if (!existsSync(AgentCommands.AGENT_DIR)) {
      const fs = require('fs');
      fs.mkdirSync(AgentCommands.AGENT_DIR, { recursive: true });
    }
  }

  /**
   * Start the memory agent as a background daemon
   */
  private static async start(projectId?: string): Promise<void> {
    AgentCommands.ensureAgentDir();

    // Check if already running
    if (existsSync(AgentCommands.PID_FILE)) {
      const pid = parseInt(readFileSync(AgentCommands.PID_FILE, 'utf-8').trim());

      try {
        process.kill(pid, 0); // Check if process exists
        console.log(chalk.yellow('⚠ Memory agent already running'));
        console.log(`   PID: ${chalk.cyan(pid)}`);
        console.log(`   Use ${chalk.cyan('npx claude-recall agent stop')} to stop it`);
        console.log();
        return;
      } catch {
        // Process doesn't exist, remove stale PID file
        unlinkSync(AgentCommands.PID_FILE);
      }
    }

    console.log(chalk.cyan('\n🤖 Starting Memory Agent\n'));

    // Spawn agent as detached background process
    const agentPath = join(__dirname, '..', '..', 'pubnub', 'memory-agent.js');
    const args = projectId ? [projectId] : [];

    const child = spawn('node', [agentPath, ...args], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Write PID file
    writeFileSync(AgentCommands.PID_FILE, child.pid!.toString());

    // Pipe logs to file
    const logStream = require('fs').createWriteStream(AgentCommands.LOG_FILE, { flags: 'a' });
    child.stdout?.pipe(logStream);
    child.stderr?.pipe(logStream);

    // Detach from parent
    child.unref();

    console.log(chalk.green('✓ Memory agent started'));
    console.log(`  PID:     ${chalk.cyan(child.pid)}`);
    console.log(`  Project: ${chalk.yellow(projectId || 'global')}`);
    console.log(`  Logs:    ${chalk.gray(AgentCommands.LOG_FILE)}`);
    console.log();
    console.log(chalk.gray(`💡 Use ${chalk.cyan('npx claude-recall agent logs')} to view logs`));
    console.log(chalk.gray(`💡 Use ${chalk.cyan('npx claude-recall agent status')} to check status`));
    console.log();

    // Wait a bit to ensure startup, then exit cleanly
    await new Promise((resolve) => setTimeout(resolve, 500));
    process.exit(0);
  }

  /**
   * Stop the memory agent
   */
  private static stop(): void {
    if (!existsSync(AgentCommands.PID_FILE)) {
      console.log(chalk.gray('✗ Memory agent is not running'));
      console.log();
      return;
    }

    const pid = parseInt(readFileSync(AgentCommands.PID_FILE, 'utf-8').trim());

    try {
      console.log(chalk.cyan('\n🛑 Stopping Memory Agent\n'));
      console.log(`Stopping agent (PID: ${chalk.yellow(pid)})...`);
      process.kill(pid, 'SIGTERM');

      // Wait for process to exit
      let attempts = 0;
      const maxAttempts = 10;

      const checkInterval = setInterval(() => {
        try {
          process.kill(pid, 0);
          attempts++;

          if (attempts >= maxAttempts) {
            console.log(chalk.yellow('⚠ Agent did not stop gracefully, forcing...'));
            process.kill(pid, 'SIGKILL');
            clearInterval(checkInterval);
            unlinkSync(AgentCommands.PID_FILE);
            console.log(chalk.green('✓ Memory agent stopped (forced)'));
            console.log();
          }
        } catch {
          // Process no longer exists
          clearInterval(checkInterval);
          unlinkSync(AgentCommands.PID_FILE);
          console.log(chalk.green('✓ Memory agent stopped'));
          console.log();
        }
      }, 500);
    } catch (error) {
      console.error(chalk.red(`✗ Failed to stop agent: ${error}`));
      // Remove stale PID file
      unlinkSync(AgentCommands.PID_FILE);
      console.log();
    }
  }

  /**
   * Restart the memory agent
   */
  private static async restart(projectId?: string): Promise<void> {
    console.log(chalk.cyan('\n🔄 Restarting Memory Agent\n'));

    // Stop if running
    if (existsSync(AgentCommands.PID_FILE)) {
      AgentCommands.stop();
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // Start again
    await AgentCommands.start(projectId);
  }

  /**
   * Check agent status
   */
  private static status(): void {
    console.log(chalk.cyan('\n📊 Memory Agent Status\n'));

    if (!existsSync(AgentCommands.PID_FILE)) {
      console.log(`Status: ${chalk.gray('✗ Not running')}`);
      console.log();
      console.log(chalk.gray(`💡 Start with: ${chalk.cyan('npx claude-recall agent start')}`));
      console.log();
      return;
    }

    const pid = parseInt(readFileSync(AgentCommands.PID_FILE, 'utf-8').trim());

    try {
      process.kill(pid, 0);
      console.log(`Status: ${chalk.green('✓ Running')}`);
      console.log(`PID:    ${chalk.cyan(pid)}`);
      console.log(`Logs:   ${chalk.gray(AgentCommands.LOG_FILE)}`);

      // Check log file size
      if (existsSync(AgentCommands.LOG_FILE)) {
        const stats = require('fs').statSync(AgentCommands.LOG_FILE);
        const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
        console.log(`Size:   ${chalk.gray(sizeMB)} ${chalk.gray('MB')}`);
      }

      console.log();
      console.log(chalk.gray(`💡 View logs: ${chalk.cyan('npx claude-recall agent logs')}`));
      console.log(chalk.gray(`💡 Stop agent: ${chalk.cyan('npx claude-recall agent stop')}`));
      console.log();
    } catch {
      console.log(`Status: ${chalk.yellow('✗ Not running')} ${chalk.gray('(stale PID file)')}`);
      console.log();
      unlinkSync(AgentCommands.PID_FILE);
    }
  }

  /**
   * Show agent logs
   */
  private static logs(lines: number = 50): void {
    if (!existsSync(AgentCommands.LOG_FILE)) {
      console.log(chalk.gray('✗ No logs found'));
      console.log();
      console.log(chalk.gray(`💡 Start agent first: ${chalk.cyan('npx claude-recall agent start')}`));
      console.log();
      return;
    }

    console.log(chalk.cyan(`\n📋 Memory Agent Logs (last ${lines} lines)\n`));

    try {
      // Use tail to show last N lines
      const output = execSync(`tail -n ${lines} "${AgentCommands.LOG_FILE}"`, {
        encoding: 'utf-8',
      });
      console.log(output);
    } catch (error) {
      // Fallback: read entire file
      const logs = readFileSync(AgentCommands.LOG_FILE, 'utf-8');
      const logLines = logs.split('\n');
      console.log(logLines.slice(-lines).join('\n'));
    }

    console.log();
  }
}

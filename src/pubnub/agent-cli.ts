#!/usr/bin/env node
/**
 * Memory Agent CLI
 *
 * Start, stop, and manage the autonomous memory agent.
 *
 * Usage:
 *   claude-recall agent start [--project <id>]
 *   claude-recall agent stop
 *   claude-recall agent status
 *   claude-recall agent logs
 */

import { runAgent } from './memory-agent.js';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { spawn } from 'child_process';

const AGENT_DIR = join(homedir(), '.claude-recall', 'agent');
const PID_FILE = join(AGENT_DIR, 'memory-agent.pid');
const LOG_FILE = join(AGENT_DIR, 'memory-agent.log');

/**
 * Ensure agent directory exists
 */
function ensureAgentDir(): void {
  const fs = require('fs');
  if (!fs.existsSync(AGENT_DIR)) {
    fs.mkdirSync(AGENT_DIR, { recursive: true });
  }
}

/**
 * Start the memory agent as a background daemon
 */
async function startAgent(projectId?: string): Promise<void> {
  ensureAgentDir();

  // Check if already running
  if (existsSync(PID_FILE)) {
    const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim());

    try {
      process.kill(pid, 0); // Check if process exists
      console.log(`[Agent CLI] Memory agent already running (PID: ${pid})`);
      console.log(`[Agent CLI] Use 'claude-recall agent stop' to stop it`);
      return;
    } catch {
      // Process doesn't exist, remove stale PID file
      unlinkSync(PID_FILE);
    }
  }

  console.log('[Agent CLI] Starting memory agent...');

  // Spawn agent as detached background process
  const agentPath = join(__dirname, 'memory-agent.js');
  const args = projectId ? [projectId] : [];

  const child = spawn('node', [agentPath, ...args], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Write PID file
  writeFileSync(PID_FILE, child.pid!.toString());

  // Pipe logs to file
  const logStream = require('fs').createWriteStream(LOG_FILE, { flags: 'a' });
  child.stdout?.pipe(logStream);
  child.stderr?.pipe(logStream);

  // Detach from parent
  child.unref();

  console.log(`[Agent CLI] Memory agent started (PID: ${child.pid})`);
  console.log(`[Agent CLI] Project: ${projectId || 'global'}`);
  console.log(`[Agent CLI] Logs: ${LOG_FILE}`);
  console.log(`[Agent CLI] Use 'claude-recall agent logs' to view logs`);

  // Wait a bit to ensure startup
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

/**
 * Stop the memory agent
 */
function stopAgent(): void {
  if (!existsSync(PID_FILE)) {
    console.log('[Agent CLI] Memory agent is not running');
    return;
  }

  const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim());

  try {
    console.log(`[Agent CLI] Stopping memory agent (PID: ${pid})...`);
    process.kill(pid, 'SIGTERM');

    // Wait for process to exit
    let attempts = 0;
    const maxAttempts = 10;

    const checkInterval = setInterval(() => {
      try {
        process.kill(pid, 0);
        attempts++;

        if (attempts >= maxAttempts) {
          console.log('[Agent CLI] Agent did not stop gracefully, forcing...');
          process.kill(pid, 'SIGKILL');
          clearInterval(checkInterval);
          unlinkSync(PID_FILE);
          console.log('[Agent CLI] Memory agent stopped (forced)');
        }
      } catch {
        // Process no longer exists
        clearInterval(checkInterval);
        unlinkSync(PID_FILE);
        console.log('[Agent CLI] Memory agent stopped');
      }
    }, 500);
  } catch (error) {
    console.error(`[Agent CLI] Failed to stop agent: ${error}`);
    // Remove stale PID file
    unlinkSync(PID_FILE);
  }
}

/**
 * Check agent status
 */
function checkStatus(): void {
  if (!existsSync(PID_FILE)) {
    console.log('[Agent CLI] Status: Not running');
    return;
  }

  const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim());

  try {
    process.kill(pid, 0);
    console.log('[Agent CLI] Status: Running');
    console.log(`[Agent CLI] PID: ${pid}`);
    console.log(`[Agent CLI] Logs: ${LOG_FILE}`);

    // Check log file size
    if (existsSync(LOG_FILE)) {
      const stats = require('fs').statSync(LOG_FILE);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      console.log(`[Agent CLI] Log size: ${sizeMB} MB`);
    }
  } catch {
    console.log('[Agent CLI] Status: Not running (stale PID file)');
    unlinkSync(PID_FILE);
  }
}

/**
 * Show agent logs
 */
function showLogs(lines: number = 50): void {
  if (!existsSync(LOG_FILE)) {
    console.log('[Agent CLI] No logs found');
    return;
  }

  const { execSync } = require('child_process');

  try {
    // Use tail to show last N lines
    const output = execSync(`tail -n ${lines} "${LOG_FILE}"`, {
      encoding: 'utf-8',
    });
    console.log(output);
  } catch (error) {
    // Fallback: read entire file
    const logs = readFileSync(LOG_FILE, 'utf-8');
    const logLines = logs.split('\n');
    console.log(logLines.slice(-lines).join('\n'));
  }
}

/**
 * Main CLI entry point
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'start': {
      const projectIdx = args.indexOf('--project');
      const projectId = projectIdx !== -1 ? args[projectIdx + 1] : undefined;
      await startAgent(projectId);
      break;
    }

    case 'stop':
      stopAgent();
      break;

    case 'status':
      checkStatus();
      break;

    case 'logs': {
      const linesIdx = args.indexOf('--lines');
      const lines = linesIdx !== -1 ? parseInt(args[linesIdx + 1]) : 50;
      showLogs(lines);
      break;
    }

    case 'restart': {
      stopAgent();
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const projectIdx = args.indexOf('--project');
      const projectId = projectIdx !== -1 ? args[projectIdx + 1] : undefined;
      await startAgent(projectId);
      break;
    }

    default:
      console.log('Memory Agent CLI');
      console.log('');
      console.log('Usage:');
      console.log('  claude-recall agent start [--project <id>]  Start the memory agent');
      console.log('  claude-recall agent stop                     Stop the memory agent');
      console.log('  claude-recall agent restart                  Restart the memory agent');
      console.log('  claude-recall agent status                   Check agent status');
      console.log('  claude-recall agent logs [--lines N]         Show agent logs (default: 50 lines)');
      console.log('');
      console.log('Examples:');
      console.log('  claude-recall agent start');
      console.log('  claude-recall agent start --project my-app');
      console.log('  claude-recall agent logs --lines 100');
      process.exit(1);
  }
}

main().catch((error) => {
  console.error('[Agent CLI] Error:', error);
  process.exit(1);
});

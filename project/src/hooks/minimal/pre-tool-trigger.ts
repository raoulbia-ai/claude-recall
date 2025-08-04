#!/usr/bin/env node

/**
 * Minimal Pre-Tool Hook Trigger
 * 
 * This is a lightweight trigger that delegates all business logic
 * to the claude-recall-cli service layer. This hook only handles
 * data forwarding and process management.
 */

import { spawn } from 'child_process';
import * as path from 'path';

// Determine CLI path - prefer built version, fallback to source
const CLI_PATHS = [
  path.join(__dirname, '../../dist/cli/claude-recall-cli.js'),
  path.join(__dirname, '../../cli/claude-recall-cli.js'),
  'claude-recall-cli' // Global installation
];

function findCliPath(): string {
  const fs = require('fs');
  
  for (const cliPath of CLI_PATHS) {
    try {
      if (fs.existsSync(cliPath)) {
        return cliPath;
      }
    } catch (error) {
      // Continue to next path
    }
  }
  
  // Fallback to global command
  return 'claude-recall-cli';
}

async function executeCLI(): Promise<void> {
  return new Promise((resolve, reject) => {
    const cliPath = findCliPath();
    const isGlobal = cliPath === 'claude-recall-cli';
    
    // Spawn the CLI process
    const child = spawn(
      isGlobal ? cliPath : 'node',
      isGlobal ? ['pre-tool'] : [cliPath, 'pre-tool'],
      {
        stdio: ['pipe', 'inherit', 'inherit'],
        env: process.env
      }
    );
    
    // Forward stdin data to CLI
    process.stdin.pipe(child.stdin);
    
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`CLI process exited with code ${code}`));
      }
    });
    
    child.on('error', (error) => {
      reject(error);
    });
    
    // Handle process signals
    process.on('SIGTERM', () => child.kill('SIGTERM'));
    process.on('SIGINT', () => child.kill('SIGINT'));
  });
}

// Main execution
async function main() {
  try {
    await executeCLI();
    process.exit(0);
  } catch (error) {
    console.error('Pre-tool hook error:', error);
    process.exit(1);
  }
}

// Handle timeout at process level
const timeout = parseInt(process.env.CLAUDE_RECALL_HOOK_TIMEOUT || '5000');
const timeoutHandle = setTimeout(() => {
  console.error('Pre-tool hook timeout');
  process.exit(1);
}, timeout);

// Clear timeout when we start processing
process.stdin.once('data', () => {
  clearTimeout(timeoutHandle);
});

if (require.main === module) {
  main();
}
#!/usr/bin/env node

/**
 * Minimal Post-Tool Hook Trigger
 * 
 * This is a dumb trigger that pipes all data to the CLI service.
 * Contains NO business logic - just pipes data and exits cleanly.
 * 
 * Following Stage 7 service layer pattern:
 * Hook → CLI → Service → Storage
 */

const { exec } = require('child_process');

let input = '';

// Collect all input data
process.stdin.on('data', (chunk) => {
  input += chunk;
});

// When input is complete, pipe to CLI service
process.stdin.on('end', () => {
  const child = exec('npx claude-recall capture post-tool');
  child.stdin.write(input);
  child.stdin.end();
  
  // Always exit 0 - let service handle errors
  child.on('close', () => process.exit(0));
  child.on('error', () => process.exit(0)); // Silent failure
});

// Handle interrupts gracefully
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
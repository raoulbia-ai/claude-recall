#!/usr/bin/env node

// Test the capture functionality directly
const { spawn } = require('child_process');

console.log('Testing claude-recall capture...');

const proc = spawn('npx', ['claude-recall', 'capture', 'user-prompt'], {
  stdio: ['pipe', 'inherit', 'inherit']
});

const testData = JSON.stringify({
  content: "test memory from script"
});

console.log('Sending:', testData);
proc.stdin.write(testData);
proc.stdin.end();

proc.on('exit', (code) => {
  console.log('Process exited with code:', code);
  
  // Check stats after
  setTimeout(() => {
    console.log('\nChecking stats...');
    spawn('npx', ['claude-recall', 'stats'], {
      stdio: 'inherit'
    });
  }, 1000);
});
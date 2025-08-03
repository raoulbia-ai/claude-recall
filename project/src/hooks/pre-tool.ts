#!/usr/bin/env node

import { HookCapture, HookEvent } from './capture';
import * as fs from 'fs';
import * as path from 'path';

const capture = new HookCapture();
const logFile = path.join(process.cwd(), 'hook-capture.log');

// Create a simple logging function
function logToFile(message: string): void {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(logFile, logMessage);
}

// Handle stdin data from Claude Code
process.stdin.on('data', (data) => {
  try {
    const eventData = JSON.parse(data.toString());
    
    const event: HookEvent = {
      type: 'PreToolUse',
      tool_name: eventData.tool_name || 'Unknown',
      tool_input: eventData.tool_input || {},
      timestamp: Date.now(),
      session_id: process.env.CLAUDE_SESSION_ID || 'default-session'
    };

    // Capture the event
    capture.capture(event);
    
    // Log to file for verification
    logToFile(`Captured: ${event.type} - ${event.tool_name}`);
    logToFile(`Tool Input: ${JSON.stringify(event.tool_input)}`);
    
  } catch (error) {
    logToFile(`Error parsing hook data: ${error}`);
  }
  
  // Exit successfully to allow tool execution to continue
  process.exit(0);
});

// Handle timeout
setTimeout(() => {
  logToFile('Hook timeout - no data received');
  process.exit(1);
}, 5000);

// Log that hook started
logToFile('Pre-tool hook started');
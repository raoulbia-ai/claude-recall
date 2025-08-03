#!/usr/bin/env node

import { PatternDetector } from '../core/patterns';
import { PatternStore } from '../memory/pattern-store';
import { MemoryStorage } from '../memory/storage';
import * as fs from 'fs';
import * as path from 'path';

const detector = new PatternDetector();
const dbPath = path.join(process.cwd(), 'claude-recall.db');
const storage = new MemoryStorage(dbPath);
const patternStore = new PatternStore(storage);
const logFile = path.join(process.cwd(), 'hook-capture.log');

// Create a simple logging function
function logToFile(message: string): void {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [POST-TOOL] ${message}\n`;
  fs.appendFileSync(logFile, logMessage);
}

// Handle stdin data from Claude Code
process.stdin.on('data', (data) => {
  try {
    const event = JSON.parse(data.toString());
    
    logToFile(`Processing ${event.tool_name} result`);
    
    // Check if this is an Edit tool event with corrections
    if (event.tool_name === 'Edit' && event.tool_input) {
      const { old_string, new_string } = event.tool_input;
      
      if (old_string && new_string) {
        const pattern = detector.detectCorrection(old_string, new_string);
        
        if (pattern) {
          logToFile(`Detected pattern: ${pattern.context}`);
          logToFile(`Original: ${pattern.original}`);
          logToFile(`Corrected: ${pattern.corrected}`);
          
          patternStore.savePattern(pattern);
          logToFile('Pattern saved to database');
        }
      }
    }
    
    // Also check MultiEdit tool
    if (event.tool_name === 'MultiEdit' && event.tool_input?.edits) {
      for (const edit of event.tool_input.edits) {
        if (edit.old_string && edit.new_string) {
          const pattern = detector.detectCorrection(edit.old_string, edit.new_string);
          
          if (pattern) {
            logToFile(`Detected pattern in MultiEdit: ${pattern.context}`);
            patternStore.savePattern(pattern);
          }
        }
      }
    }
    
  } catch (error) {
    logToFile(`Error processing post-tool data: ${error}`);
  }
  
  // Exit successfully
  process.exit(0);
});

// Handle timeout
setTimeout(() => {
  logToFile('Post-tool hook timeout - no data received');
  process.exit(1);
}, 5000);

// Log that hook started
logToFile('Post-tool hook started');
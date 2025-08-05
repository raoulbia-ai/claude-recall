#!/usr/bin/env node

/**
 * Memory Search Enforcer Hook
 * This hook ensures memory search is performed before file operations
 * It acts as a fallback strategy when Claude doesn't search memory first
 */

const fs = require('fs');
const path = require('path');

// Configuration
const ENFORCE_SEARCH = process.env.CLAUDE_RECALL_ENFORCE_SEARCH !== 'false';
const LOG_FILE = path.join(process.env.HOME, '.claude-recall', 'enforcer.log');

function log(message) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}\n`;
  
  try {
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(LOG_FILE, logEntry);
  } catch (error) {
    console.error('Failed to write to log:', error.message);
  }
}

function checkRecentSearches() {
  try {
    const monitorLog = path.join(process.env.HOME, '.claude-recall', 'search-monitor.log');
    if (!fs.existsSync(monitorLog)) {
      return false;
    }
    
    // Check if a search was performed in the last 5 seconds
    const stats = fs.statSync(monitorLog);
    const lastModified = stats.mtime.getTime();
    const now = Date.now();
    const timeSinceLastSearch = now - lastModified;
    
    return timeSinceLastSearch < 5000; // 5 seconds
  } catch (error) {
    log(`Error checking recent searches: ${error.message}`);
    return false;
  }
}

function analyzeUserInput() {
  const input = process.argv.slice(2).join(' ').toLowerCase();
  
  // Patterns that indicate file operations
  const fileOperationPatterns = [
    /create.*file/,
    /create.*script/,
    /create.*test/,
    /write.*file/,
    /add.*file/,
    /make.*file/,
    /new.*file/,
    /generate.*file/
  ];
  
  return fileOperationPatterns.some(pattern => pattern.test(input));
}

function enforceMemorySearch() {
  // Check if this looks like a file operation
  const isFileOperation = analyzeUserInput();
  
  if (!isFileOperation) {
    log('Not a file operation, skipping enforcement');
    return;
  }
  
  log('File operation detected, checking for recent memory search');
  
  // Check if a search was recently performed
  const hasRecentSearch = checkRecentSearches();
  
  if (!hasRecentSearch) {
    log('⚠️  WARNING: No recent memory search detected!');
    
    if (ENFORCE_SEARCH) {
      console.error('\n🚨 MEMORY SEARCH REQUIRED 🚨');
      console.error('You must search memory before creating files.');
      console.error('Use: mcp__claude-recall__search');
      console.error('\nTo disable enforcement: export CLAUDE_RECALL_ENFORCE_SEARCH=false\n');
      
      // Log the violation
      log('VIOLATION: File operation attempted without memory search');
      
      // Exit with error to prevent the operation
      process.exit(1);
    } else {
      console.warn('\n⚠️  Warning: Memory search not performed');
      console.warn('Files may be created in incorrect locations');
      log('WARNING: Enforcement disabled, allowing operation without search');
    }
  } else {
    log('✅ Recent memory search detected, operation allowed');
  }
}

// Main execution
if (require.main === module) {
  try {
    log(`Enforcer hook called with args: ${process.argv.slice(2).join(' ')}`);
    enforceMemorySearch();
  } catch (error) {
    log(`Error in enforcer: ${error.message}`);
    // Don't block on errors
  }
}

module.exports = { enforceMemorySearch, checkRecentSearches };
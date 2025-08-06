#!/usr/bin/env node

/**
 * Queue-Enhanced Memory Search Enforcer Hook
 * This enhanced version uses the queue system for asynchronous processing
 * while maintaining the original enforcement behavior
 */

const fs = require('fs');
const path = require('path');

// Configuration
const ENFORCE_SEARCH = process.env.CLAUDE_RECALL_ENFORCE_SEARCH !== 'false';
const LOG_FILE = path.join(process.env.HOME, '.claude-recall', 'enforcer.log');

// Import the queue integration (dynamically to avoid import issues in JS)
let queueIntegration = null;

async function initializeQueueIntegration() {
  if (queueIntegration) return queueIntegration;
  
  try {
    // Try to load the queue integration service
    const { HookQueueIntegration } = require('../dist/services/queue-integration');
    queueIntegration = HookQueueIntegration.getInstance();
    await queueIntegration.initialize();
    log('✅ Queue integration initialized successfully');
    return queueIntegration;
  } catch (error) {
    log(`⚠️ Queue integration not available: ${error.message}`);
    log('Falling back to direct processing mode');
    return null;
  }
}

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

async function processHookEventAsync(eventType, payload) {
  const integration = await initializeQueueIntegration();
  
  if (integration) {
    // Process through queue system
    try {
      integration.processToolUse('hook-enforcer', payload, {
        source: 'memory-search-enforcer',
        eventType,
        timestamp: Date.now()
      });
      log(`📨 Hook event queued: ${eventType}`);
    } catch (error) {
      log(`❌ Failed to queue hook event: ${error.message}`);
      // Fall through to direct processing
    }
  }
  
  // Direct processing for immediate enforcement
  log(`🔍 Processing hook event directly: ${eventType}`);
}

async function enforceMemorySearch() {
  // Analyze user input
  const userInput = process.argv.slice(2).join(' ');
  const isFileOperation = analyzeUserInput();
  
  // Queue the hook event for asynchronous analysis
  await processHookEventAsync('user-command', {
    command: userInput,
    isFileOperation,
    arguments: process.argv.slice(2),
    workingDirectory: process.cwd(),
    timestamp: Date.now()
  });
  
  if (!isFileOperation) {
    log('Not a file operation, skipping enforcement');
    return;
  }
  
  log('File operation detected, checking for recent memory search');
  
  // Check if a search was recently performed
  const hasRecentSearch = checkRecentSearches();
  
  if (!hasRecentSearch) {
    log('⚠️  WARNING: No recent memory search detected!');
    
    // Queue a warning event for tracking
    await processHookEventAsync('enforcement-warning', {
      command: userInput,
      reason: 'no_recent_memory_search',
      enforceSearchEnabled: ENFORCE_SEARCH,
      timestamp: Date.now()
    });
    
    if (ENFORCE_SEARCH) {
      console.error('\n🚨 MEMORY SEARCH REQUIRED 🚨');
      console.error('You must search memory before creating files.');
      console.error('Use: mcp__claude-recall__search');
      console.error('\nTo disable enforcement: export CLAUDE_RECALL_ENFORCE_SEARCH=false\n');
      
      // Log the violation
      log('VIOLATION: File operation attempted without memory search');
      
      // Queue violation event for analysis
      await processHookEventAsync('enforcement-violation', {
        command: userInput,
        reason: 'file_operation_without_search',
        action: 'blocked',
        timestamp: Date.now()
      });
      
      // Exit with error to prevent the operation
      process.exit(1);
    } else {
      console.warn('\n⚠️  Warning: Memory search not performed');
      console.warn('Files may be created in incorrect locations');
      log('WARNING: Enforcement disabled, allowing operation without search');
    }
  } else {
    log('✅ Recent memory search detected, operation allowed');
    
    // Queue success event
    await processHookEventAsync('enforcement-success', {
      command: userInput,
      reason: 'recent_search_detected',
      timestamp: Date.now()
    });
  }
}

// Enhanced error handling with queue integration
async function handleError(error, context) {
  log(`Error in enforcer: ${error.message}`);
  
  // Queue error event for analysis
  await processHookEventAsync('hook-error', {
    error: error.message,
    stack: error.stack,
    context,
    timestamp: Date.now()
  });
}

// Main execution with async support
async function main() {
  try {
    const userInput = process.argv.slice(2).join(' ');
    log(`Enforcer hook called with args: ${userInput}`);
    
    await enforceMemorySearch();
  } catch (error) {
    await handleError(error, {
      args: process.argv.slice(2),
      cwd: process.cwd()
    });
    // Don't block on errors to maintain backward compatibility
  }
}

// Run main function if called directly
if (require.main === module) {
  main().catch(error => {
    log(`Fatal error: ${error.message}`);
    // Don't exit with error to avoid breaking existing workflows
  });
}

// Export functions for testing
module.exports = { 
  enforceMemorySearch, 
  checkRecentSearches, 
  analyzeUserInput,
  processHookEventAsync
};
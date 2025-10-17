#!/usr/bin/env node

/**
 * Automatic Memory Recall Hook
 * User-prompt-submit hook that automatically retrieves and injects relevant memories
 * before the LLM sees the user's message.
 *
 * This solves the core problem: memories are stored but not automatically recalled.
 *
 * Usage: Configure in ~/.claude/config.yaml:
 * hooks:
 *   user-prompt-submit: /path/to/auto-memory-recall.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const ENABLED = process.env.CLAUDE_RECALL_AUTO_INJECT !== 'false';
const MAX_MEMORIES = parseInt(process.env.CLAUDE_RECALL_INJECT_LIMIT || '3', 10);
const MIN_RELEVANCE = parseFloat(process.env.CLAUDE_RECALL_MIN_RELEVANCE || '0.7');
const MAX_CONTENT_LENGTH = parseInt(process.env.CLAUDE_RECALL_MAX_CONTENT_LENGTH || '200', 10);
const LOG_FILE = path.join(process.env.HOME || '/tmp', '.claude-recall', 'auto-recall.log');

/**
 * Log message to file for debugging
 */
function log(message, data = {}) {
  if (!process.env.CLAUDE_RECALL_DEBUG) return;

  try {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message} ${JSON.stringify(data)}\n`;

    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(LOG_FILE, logEntry);
  } catch (error) {
    // Silently fail - don't block on logging errors
  }
}

/**
 * Extract keywords from user message
 * Simple keyword extraction - takes important words
 */
function extractKeywords(message) {
  // Remove common stop words
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'should', 'could', 'may', 'might', 'must', 'can', 'i', 'you', 'he',
    'she', 'it', 'we', 'they', 'this', 'that', 'these', 'those'
  ]);

  const words = message
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Remove punctuation
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word));

  // Return unique keywords, limit to 10
  return [...new Set(words)].slice(0, 10);
}

/**
 * Search claude-recall for relevant memories
 */
function searchMemories(query) {
  try {
    log('Searching memories', { query });

    // Use claude-recall CLI to search
    // Try multiple approaches to find the CLI
    const commands = [
      `npx --no claude-recall search "${query}" --json 2>/dev/null`,
      `claude-recall search "${query}" --json 2>/dev/null`,
      `node ~/.npm-global/lib/node_modules/claude-recall/dist/cli/claude-recall-cli.js search "${query}" --json 2>/dev/null`
    ];

    let output = '';
    let lastError = null;

    for (const command of commands) {
      try {
        output = execSync(command, {
          encoding: 'utf-8',
          timeout: 2000, // 2 second timeout
          stdio: ['pipe', 'pipe', 'ignore'] // Ignore stderr
        });
        if (output && output.trim() !== '') {
          break; // Success
        }
      } catch (error) {
        lastError = error;
        continue; // Try next command
      }
    }

    if (!output || output.trim() === '') {
      log('No search results', { lastError: lastError?.message });
      return [];
    }

    const results = JSON.parse(output);
    log('Search results', { count: results.length });

    return results;
  } catch (error) {
    log('Search failed', { error: error.message });
    // If search fails, return empty array - don't block user
    return [];
  }
}

/**
 * Truncate content to max length
 */
function truncateContent(content, maxLength) {
  if (content.length <= maxLength) {
    return content;
  }
  return content.substring(0, maxLength) + '...';
}

/**
 * Format memories for injection into user prompt
 */
function formatMemoriesForInjection(memories) {
  if (memories.length === 0) {
    return null;
  }

  const lines = ['🧠 **Relevant Memories**:'];

  for (const memory of memories.slice(0, MAX_MEMORIES)) {
    const content = extractMemoryContent(memory);
    if (content) {
      // Truncate long memories
      const truncated = truncateContent(content, MAX_CONTENT_LENGTH);
      const confidence = memory.relevance_score
        ? ` (${Math.round(memory.relevance_score * 100)}% relevant)`
        : '';
      lines.push(`- ${truncated}${confidence}`);
    }
  }

  if (lines.length === 1) {
    return null; // No valid memories
  }

  lines.push(''); // Empty line for spacing

  return lines.join('\n');
}

/**
 * Extract readable content from memory object
 */
function extractMemoryContent(memory) {
  try {
    const value = memory.value;

    // String value
    if (typeof value === 'string') {
      return value;
    }

    // Object value - try common fields in priority order
    if (typeof value === 'object' && value !== null) {
      // Priority 1: Direct content fields
      if (value.content && typeof value.content === 'string') {
        return value.content;
      }

      if (value.preference && typeof value.preference === 'string') {
        return value.preference;
      }

      if (value.message && typeof value.message === 'string') {
        return value.message;
      }

      // Priority 2: Raw field
      if (value.raw && typeof value.raw === 'string') {
        return value.raw;
      }

      // Priority 3: Value field
      if (value.value) {
        if (typeof value.value === 'string') {
          return value.value;
        }
        if (typeof value.value === 'object' && value.value !== null) {
          if (value.value.framework) return `Use ${value.value.framework}`;
          if (value.value.location) return `Location: ${value.value.location}`;
        }
      }

      // Priority 4: Specific structured fields
      if (value.framework) return `Framework: ${value.framework}`;
      if (value.location) return `Location: ${value.location}`;
      if (value.style) return `Style: ${value.style}`;

      // Filter out low-quality memories
      // Skip memories that are just metadata or system info
      const skipPatterns = [
        /restart|recovered/i,
        /pattern-detection/i,
        /pattern-\d+/i,
        /response-pattern/i,
        /queue-/i
      ];

      const memoryStr = JSON.stringify(value);
      if (skipPatterns.some(pattern => pattern.test(memoryStr))) {
        return null;
      }

      // Last resort: extract from key if value is minimal
      if (memory.key && (!value || Object.keys(value).length < 2)) {
        const cleanKey = memory.key
          .replace(/^(pref_|auto_|memory_)/g, '')
          .replace(/_\d+$/g, '')
          .replace(/_/g, ' ');

        // Only return if it looks meaningful
        if (cleanKey.length > 5) {
          return cleanKey;
        }
      }
    }

    return null;
  } catch (error) {
    log('Failed to extract memory content', { error: error.message });
    return null;
  }
}

/**
 * Main hook function
 * Receives user message on stdin, outputs enhanced message on stdout
 */
function main() {
  try {
    if (!ENABLED) {
      log('Auto-injection disabled');
      // Pass through unchanged
      const input = fs.readFileSync(0, 'utf-8');
      process.stdout.write(input);
      return;
    }

    // Read user message from stdin
    const userMessage = fs.readFileSync(0, 'utf-8').trim();

    if (!userMessage) {
      log('Empty message, skipping');
      return;
    }

    log('Processing message', { length: userMessage.length });

    // Extract keywords for search
    const keywords = extractKeywords(userMessage);

    if (keywords.length === 0) {
      log('No keywords extracted, skipping memory search');
      process.stdout.write(userMessage);
      return;
    }

    const searchQuery = keywords.join(' ');
    log('Search query', { query: searchQuery, keywords });

    // Search for relevant memories
    const memories = searchMemories(searchQuery);

    // Filter by relevance threshold
    const relevantMemories = memories.filter(m =>
      (m.relevance_score || 0) >= MIN_RELEVANCE
    );

    log('Filtered memories', {
      total: memories.length,
      relevant: relevantMemories.length
    });

    if (relevantMemories.length === 0) {
      // No relevant memories, pass through unchanged
      log('No relevant memories found');
      process.stdout.write(userMessage);
      return;
    }

    // Format memories for injection
    const memoryContext = formatMemoriesForInjection(relevantMemories);

    if (!memoryContext) {
      log('No formattable memories');
      process.stdout.write(userMessage);
      return;
    }

    // Inject memories before user message
    const enhancedMessage = `${memoryContext}\n${userMessage}`;

    log('Injected memories', {
      count: relevantMemories.length,
      contextLength: memoryContext.length
    });

    // Output enhanced message
    process.stdout.write(enhancedMessage);

  } catch (error) {
    log('Hook failed', { error: error.message, stack: error.stack });

    // On error, pass through original message
    try {
      const input = fs.readFileSync(0, 'utf-8');
      process.stdout.write(input);
    } catch (readError) {
      // Total failure - output nothing (will block submission)
      console.error('Auto-memory-recall hook failed:', error.message);
      process.exit(1);
    }
  }
}

// Execute main function
if (require.main === module) {
  main();
}

module.exports = { extractKeywords, extractMemoryContent };

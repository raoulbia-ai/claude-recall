import { Command } from 'commander';
import { MemoryService } from '../../services/memory';

/**
 * Hook-related CLI commands for Claude Code integration
 * These commands are called by hook scripts to interact with Claude Recall
 */
export class HookCommands {
  static register(program: Command): void {
    const hookCmd = program
      .command('recent-tools')
      .description('Get recent tool usage for session (used by PreToolUse hook)')
      .option('-s, --session <sessionId>', 'Session ID to check')
      .option('-l, --limit <number>', 'Maximum number of recent tools to return', '10')
      .action(async (options) => {
        await HookCommands.recentTools(options.session, parseInt(options.limit));
      });

    program
      .command('capture-prompt')
      .description('Capture user prompt for processing (used by UserPromptSubmit hook)')
      .option('-s, --session <sessionId>', 'Session ID')
      .option('-c, --content <content>', 'Prompt content')
      .action(async (options) => {
        await HookCommands.capturePrompt(options.session, options.content);
      });
  }

  /**
   * Get recent tool usage for a session
   * Used by PreToolUse hook to check if memory search was performed
   */
  static async recentTools(sessionId: string, limit: number): Promise<void> {
    try {
      if (!sessionId) {
        console.log(JSON.stringify({ error: 'Session ID required' }));
        return;
      }

      const memoryService = MemoryService.getInstance();

      // Search for recent tool-use memories in this session
      const memories = memoryService.search(`session:${sessionId} tool-use`);

      // Get the most recent entries
      const recentTools = memories
        .filter(m => m.type === 'tool-use')
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, limit)
        .map(m => ({
          tool: m.key,
          timestamp: m.timestamp,
          // Include mcp__claude-recall__search in the key for detection
          toolName: m.key.split(':')[0] || m.key
        }));

      // Output as newline-separated tool names (easier for shell scripts to parse)
      if (recentTools.length > 0) {
        console.log(recentTools.map(t => t.toolName).join('\n'));
      }

    } catch (error) {
      console.error(`Error retrieving recent tools: ${error}`);
      process.exit(1);
    }
  }

  /**
   * Capture user prompt for processing
   * Used by UserPromptSubmit hook to enable preference extraction
   */
  static async capturePrompt(sessionId: string, content: string): Promise<void> {
    try {
      if (!content) {
        // No content to capture
        return;
      }

      const memoryService = MemoryService.getInstance();

      // Store prompt as a special memory type for later processing
      // This will be picked up by the queue system and processed asynchronously
      memoryService.store({
        key: `prompt:${sessionId}:${Date.now()}`,
        value: {
          content,
          sessionId,
          capturedAt: Date.now(),
          source: 'hook:UserPromptSubmit'
        },
        type: 'prompt-capture',
        context: {
          sessionId,
          timestamp: Date.now(),
          tool: 'UserPromptSubmit'
        }
      });

      // Note: Preference extraction happens asynchronously via the queue system
      // The HookEventProcessor will process this prompt

    } catch (error) {
      // Don't fail the hook - this is best-effort
      console.error(`Warning: Prompt capture failed: ${error}`);
    }
  }
}

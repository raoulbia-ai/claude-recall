import { Command } from 'commander';
import { readStdin, hookLog, safeErrorMessage } from '../../hooks/shared';

const AVAILABLE_HOOKS = [
  'correction-detector',
  'memory-stop',
  'memory-sync',
  'precompact-preserve',
  'post-compact-reload',
  'tool-outcome-watcher',
  'tool-failure',
  'rule-injector',
  'rule-injection-resolver',
  'subagent-start',
  'subagent-stop',
  'session-end-checkpoint',
  'session-end-checkpoint-worker',
  'bash-failure-watcher',
] as const;

/**
 * Hook CLI Commands
 *
 * Dispatches `claude-recall hook run <name...>` to the appropriate hook
 * handler(s). Multiple names run sequentially in ONE process — each node
 * invocation cold-boots the CLI and reopens the database, so hooks that fire
 * on the same event (e.g. PostToolUse) should share an invocation.
 * Reads stdin first (before dynamic import) then passes parsed input to the
 * handlers. Always exits 0.
 */
export class HookCommands {
  private static async runOne(name: string, input: any): Promise<void> {
    switch (name) {
      case 'correction-detector': {
        const { handleCorrectionDetector } = await import('../../hooks/correction-detector');
        await handleCorrectionDetector(input);
        break;
      }
      case 'memory-stop': {
        const { handleMemoryStop } = await import('../../hooks/memory-stop-hook');
        await handleMemoryStop(input);
        break;
      }
      case 'precompact-preserve': {
        const { handlePrecompactPreserve } = await import('../../hooks/precompact-preserve');
        await handlePrecompactPreserve(input);
        break;
      }
      case 'memory-sync': {
        const { handleMemorySync } = await import('../../hooks/memory-sync-hook');
        await handleMemorySync(input);
        break;
      }
      case 'tool-outcome-watcher': {
        const { handleToolOutcomeWatcher } = await import('../../hooks/tool-outcome-watcher');
        await handleToolOutcomeWatcher(input);
        break;
      }
      case 'tool-failure': {
        const { handleToolFailure } = await import('../../hooks/tool-outcome-watcher');
        await handleToolFailure(input);
        break;
      }
      case 'post-compact-reload': {
        const { handlePostCompactReload } = await import('../../hooks/post-compact-reload');
        await handlePostCompactReload(input);
        break;
      }
      case 'subagent-start': {
        const { handleSubagentStart } = await import('../../hooks/subagent-hooks');
        await handleSubagentStart(input);
        break;
      }
      case 'subagent-stop': {
        const { handleSubagentStop } = await import('../../hooks/subagent-hooks');
        await handleSubagentStop(input);
        break;
      }
      case 'bash-failure-watcher': {
        // Backward compat alias — routes to tool-outcome-watcher
        const { handleBashFailureWatcher } = await import('../../hooks/tool-outcome-watcher');
        await handleBashFailureWatcher(input);
        break;
      }
      case 'session-end-checkpoint': {
        const { handleSessionEndCheckpoint } = await import('../../hooks/session-end-checkpoint');
        await handleSessionEndCheckpoint(input);
        break;
      }
      case 'session-end-checkpoint-worker': {
        const { handleSessionEndCheckpointWorker } = await import('../../hooks/session-end-checkpoint-worker');
        await handleSessionEndCheckpointWorker(input);
        break;
      }
      case 'rule-injector': {
        const { handleRuleInjector } = await import('../../hooks/rule-injector');
        await handleRuleInjector(input);
        break;
      }
      case 'rule-injection-resolver': {
        const { handleRuleInjectionResolver } = await import('../../hooks/rule-injection-resolver');
        await handleRuleInjectionResolver(input);
        break;
      }
      default:
        console.error(`Unknown hook: ${name}`);
        console.error(`Available: ${AVAILABLE_HOOKS.join(', ')}`);
    }
  }

  static register(program: Command): void {
    const hookCmd = program
      .command('hook')
      .description('Hook handlers for automatic memory capture');

    hookCmd
      .command('run <names...>')
      .description(`Run one or more hook handlers in a single process (${AVAILABLE_HOOKS.slice(0, 3).join(' | ')} | ...)`)
      .action(async (names: string[]) => {
        // Read stdin synchronously BEFORE dynamic import to avoid data loss;
        // every handler receives the same event payload.
        let input: any;
        try {
          input = readStdin();
        } catch (err) {
          hookLog('hook-dispatcher', `stdin read failed: ${safeErrorMessage(err)}`);
          process.exit(0);
        }

        for (const name of names) {
          try {
            await HookCommands.runOne(name, input);
          } catch (err) {
            // Hooks must never block Claude — always exit 0. But a swallowed
            // error with no log line means a hook can silently stop capturing
            // for weeks, so record it.
            hookLog('hook-dispatcher', `${name}: ${safeErrorMessage(err)}`);
          }
        }
        process.exit(0);
      });
  }
}

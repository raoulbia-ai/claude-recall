import { Command } from 'commander';
import { readStdin } from '../../hooks/shared';

/**
 * Hook CLI Commands
 *
 * Dispatches `claude-recall hook run <name>` to the appropriate hook handler.
 * Reads stdin first (before dynamic import) then passes parsed input to the handler.
 * Always exits 0.
 */
export class HookCommands {
  static register(program: Command): void {
    const hookCmd = program
      .command('hook')
      .description('Hook handlers for automatic memory capture');

    hookCmd
      .command('run <name>')
      .description('Run a hook handler (correction-detector | memory-stop | precompact-preserve)')
      .action(async (name: string) => {
        try {
          // Read stdin synchronously BEFORE dynamic import to avoid data loss
          const input = readStdin();

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
            case 'session-preseed': {
              const { handleSessionPreseed } = await import('../../hooks/session-preseed');
              await handleSessionPreseed(input);
              break;
            }
            default:
              console.error(`Unknown hook: ${name}`);
              console.error('Available: correction-detector, memory-stop, precompact-preserve, memory-sync, tool-outcome-watcher, session-end-checkpoint');
          }
        } catch {
          // Hooks must never block Claude — always exit 0
        }
        process.exit(0);
      });
  }
}

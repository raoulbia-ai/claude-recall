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
  'kiro-agent-spawn',
  'kiro-rule-injector',
  'kiro-tool-outcome',
  'kiro-capture',
  'kiro-capture-worker',
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
      // Kiro CLI adapters — see src/hooks/kiro-hooks.ts. Kiro's
      // userPromptSubmit needs no adapter: wire `correction-detector` directly.
      case 'kiro-agent-spawn': {
        const { handleKiroAgentSpawn } = await import('../../hooks/kiro-hooks');
        await handleKiroAgentSpawn(input);
        break;
      }
      case 'kiro-rule-injector': {
        const { handleKiroRuleInjector } = await import('../../hooks/kiro-hooks');
        await handleKiroRuleInjector(input);
        break;
      }
      case 'kiro-tool-outcome': {
        const { handleKiroToolOutcome } = await import('../../hooks/kiro-hooks');
        await handleKiroToolOutcome(input);
        break;
      }
      case 'kiro-capture': {
        const { handleKiroCapture } = await import('../../hooks/kiro-hooks');
        await handleKiroCapture(input);
        break;
      }
      case 'kiro-capture-worker': {
        const { handleKiroCaptureWorker } = await import('../../hooks/kiro-hooks');
        await handleKiroCaptureWorker(input);
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
        // every handler receives the same event payload. An empty/unreadable
        // stdin degrades to {} instead of aborting — lifecycle events with no
        // payload (e.g. Kiro agentSpawn variants) must still run the handler.
        let input: any;
        try {
          input = readStdin();
        } catch (err) {
          hookLog('hook-dispatcher', `stdin read failed (continuing with empty payload): ${safeErrorMessage(err)}`);
          input = {};
        }

        // Deterministic project scoping. Resolve the project from the cwd the
        // RUNTIME declares in the hook payload — NOT the cwd this subprocess
        // happened to inherit. Both Claude Code and Kiro include `cwd`; for CC
        // it equals process.cwd() so this is a no-op, but for Kiro it pins
        // scoping to the session's working directory. Without this a memory
        // captured while working on project A could land in project B (any
        // session whose declared cwd differs from what this subprocess
        // inherited), and capture (userPromptSubmit) and injection
        // (agentSpawn) could even disagree. Project memories must scope to
        // ONE deterministic project.
        try {
          const { ConfigService } = await import('../../services/config');
          const cfg = ConfigService.getInstance();
          const payloadCwd = (input && typeof input.cwd === 'string' && input.cwd.trim()) ? input.cwd : null;
          if (payloadCwd) {
            cfg.updateConfig({ project: { rootDir: payloadCwd } } as any);
          }
          // Diagnostic: record what the runtime declared vs. what this
          // subprocess inherited, and the project we resolved. Makes "which
          // project did this scope to, and why" answerable from the log —
          // the definitive check for `kiro --resume` scoping questions.
          const pin = process.env.CLAUDE_RECALL_PROJECT_ID || process.env.CLAUDE_PROJECT_ID;
          hookLog('hook-dispatcher',
            `scope [${names.join('+')}]: payload.cwd=${payloadCwd ?? '(none)'} ` +
            `process.cwd=${process.cwd()} pin=${pin ?? '(none)'} → project=${cfg.getProjectId()}`);
        } catch (err) {
          hookLog('hook-dispatcher', `cwd scoping failed (using inherited cwd): ${safeErrorMessage(err)}`);
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

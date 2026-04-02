/**
 * Claude Recall — Pi Extension
 *
 * Provides persistent memory tools for the Pi coding agent.
 * Shares the same SQLite database as the Claude Code integration.
 *
 * Install: pi install npm:claude-recall
 */

import { MemoryService, ActiveRules } from '../services/memory';
import { ConfigService } from '../services/config';
import { OutcomeStorage } from '../services/outcome-storage';
import { LoggingService } from '../services/logging';
import {
  processToolOutcome,
  processUserInput,
  processSessionEnd,
  processPreCompact,
  setLogFunction,
  resetPendingFailures,
} from '../shared/event-processors';

const LOAD_RULES_DIRECTIVE =
  'Before your FIRST action, briefly state which rules below you will apply to this task.\n' +
  'As you work, cite each rule at the point where it influences your action:\n' +
  '(applied from memory: <short rule name>)\n' +
  'Place citations next to the action they influenced — not at the end of unrelated text.\n' +
  'If a rule conflicts with your plan, follow the rule — it reflects a user decision.';

function truncateStr(s: string, max: number): string {
  return s.length <= max ? s : s.substring(0, max - 3) + '...';
}

/** Check if tool output indicates a failure (mirrors event-processors logic). */
function isFailureOutput(toolName: string, output: string): boolean {
  if (toolName === 'bash' || toolName === 'Bash') {
    return /Exit code (\d+)/.test(output) && !/Exit code 0/.test(output);
  }
  if (['edit', 'write', 'Edit', 'Write'].includes(toolName)) {
    return /permission denied|EACCES|ENOENT|file not found|old_string.*not found|not unique in the file/i.test(output);
  }
  if (output.length < 500) {
    return /error|failed|exception|timeout/i.test(output);
  }
  return false;
}

/** Format a memory value for display. */
function extractVal(value: any): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null) {
    return value.content || value.value || JSON.stringify(value);
  }
  return String(value ?? '');
}

/** Format active rules as markdown sections. */
function formatRules(rules: ActiveRules): string {
  const sections: string[] = [];

  if (rules.preferences.length > 0) {
    sections.push('## Preferences\n' + rules.preferences.map(m => `- ${extractVal(m.value)}`).join('\n'));
  }
  if (rules.corrections.length > 0) {
    sections.push('## Corrections\n' + rules.corrections.map(m => `- ${extractVal(m.value)}`).join('\n'));
  }
  if (rules.failures.length > 0) {
    sections.push('## Failures\n' + rules.failures.map(m => `- ${extractVal(m.value)}`).join('\n'));
  }
  if (rules.devops.length > 0) {
    sections.push('## DevOps Rules\n' + rules.devops.map(m => `- ${extractVal(m.value)}`).join('\n'));
  }

  return sections.join('\n\n');
}

export default function(pi: PiTypes.ExtensionAPI) {
  let projectId: string = '';
  let sessionId: string = `pi_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  let rulesLoaded = false;
  const collectedUserTexts: string[] = [];

  // Route logs through Pi's UI when available
  setLogFunction((source, msg) => {
    try { LoggingService.getInstance().info(source, msg); } catch { /* silent */ }
  });

  // --- Session init: set project context from cwd ---

  pi.on('session_start', (_event, ctx) => {
    projectId = ctx.cwd.split('/').pop() || 'unknown';
    rulesLoaded = false;
    collectedUserTexts.length = 0;
    resetPendingFailures();
    try {
      ConfigService.getInstance().updateConfig({
        project: { rootDir: ctx.cwd },
      } as any);
    } catch {
      // Non-critical
    }
  });

  // --- Event: inject rules before first agent turn ---

  pi.on('before_agent_start', (_event, _ctx) => {
    if (rulesLoaded) return;
    rulesLoaded = true;

    try {
      const ms = MemoryService.getInstance();
      const rules = ms.loadActiveRules(projectId || undefined);
      const body = formatRules(rules);
      if (body) {
        return { systemPrompt: _event.systemPrompt + '\n\n' + LOAD_RULES_DIRECTIVE + '\n\n---\n\n' + body };
      }
    } catch {
      // Non-critical — tools still available as fallback
    }
  });

  // --- Event: capture tool outcomes ---

  pi.on('tool_result', (event, ctx) => {
    const output = event.content
      .filter((c): c is PiTypes.TextContent => c.type === 'text')
      .map(c => c.text)
      .join('\n');

    const result = processToolOutcome(event.toolName, event.input, output, event.isError, sessionId);

    if (ctx.hasUI) {
      const label = event.input?.command
        ? truncateStr(event.input.command as string, 40)
        : event.toolName;
      try {
        if (result.captured) {
          ctx.ui.notify(`Recall: failure stored — ${label}`, 'info');
        } else if (result.fixPaired) {
          ctx.ui.notify(`Recall: fix paired — ${label} (learned from previous failure)`, 'info');
        }
      } catch { /* non-critical */ }
    }
  });

  // --- Event: detect corrections from user input ---

  pi.on('input', (event, _ctx) => {
    collectedUserTexts.push(event.text);
    processUserInput(event.text, sessionId).catch(() => {});
    return { action: 'continue' as const };
  });

  // --- Event: session end — episode + promotion ---

  pi.on('session_shutdown', (_event, _ctx) => {
    processSessionEnd(collectedUserTexts, sessionId, projectId).catch(() => {});
  });

  // --- Event: pre-compaction — aggressive capture ---

  pi.on('session_before_compact', (event, _ctx) => {
    // Extract user texts from branch entries
    const texts: string[] = [];
    for (const entry of (event.branchEntries || [])) {
      if (entry?.role === 'user' && typeof entry.content === 'string') {
        texts.push(entry.content);
      }
    }
    if (texts.length > 0) {
      processPreCompact(texts, sessionId).catch(() => {});
    }

    // Re-inject rules after compaction
    rulesLoaded = false;
  });

  // --- Tool: recall_load_rules ---

  pi.registerTool({
    name: 'recall_load_rules',
    label: 'Load Rules',
    description: 'Load all stored rules (preferences, corrections, failures, devops). Call at the start of every task.',
    promptSnippet: 'Load stored rules and preferences from memory',
    parameters: {},
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      try {
        const ms = MemoryService.getInstance();
        const rules = ms.loadActiveRules(projectId || undefined);
        const body = formatRules(rules);
        const totalRules = rules.preferences.length + rules.corrections.length +
          rules.failures.length + rules.devops.length;

        // Track retrievals
        try {
          const os = OutcomeStorage.getInstance();
          const all = [...rules.preferences, ...rules.corrections, ...rules.failures, ...rules.devops];
          for (const m of all) os.recordRetrieval(m.key);
        } catch { /* non-critical */ }

        const text = body
          ? `${LOAD_RULES_DIRECTIVE}\n\n---\n\n${body}`
          : 'No active rules found. This may be a new project.';

        return {
          content: [{ type: 'text' as const, text }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Failed to load rules: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  });

  // --- Tool: recall_store_memory ---

  pi.registerTool({
    name: 'recall_store_memory',
    label: 'Store Memory',
    description: 'Store a rule or learning. Use for: corrections, preferences, devops rules, failures.',
    promptSnippet: 'Store a rule, correction, or preference to memory',
    parameters: {},
    async execute(_id, params: any, _signal, _onUpdate, _ctx) {
      try {
        const content = params.content;
        if (!content || typeof content !== 'string') {
          return {
            content: [{ type: 'text' as const, text: 'Error: content is required and must be a string' }],
            isError: true,
          };
        }

        const validTypes = ['preference', 'correction', 'devops', 'failure', 'project-knowledge'];
        const metadata = params.metadata || {};
        const detectedType = (metadata.type && validTypes.includes(metadata.type))
          ? metadata.type : 'preference';

        const key = `memory_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const ms = MemoryService.getInstance();
        ms.store({
          key,
          value: { content, ...metadata, sessionId, timestamp: Date.now() },
          type: detectedType,
          context: {
            sessionId,
            projectId: params.scope === 'project' ? projectId : undefined,
            timestamp: Date.now(),
            scope: params.scope || null,
          },
        });

        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            id: key,
            success: true,
            activeRule: `Stored as active rule:\n- ${content}`,
            type: detectedType,
            _directive: 'Apply this rule immediately.',
          }) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Failed to store memory: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  });

  // --- Tool: recall_search_memory ---

  pi.registerTool({
    name: 'recall_search_memory',
    label: 'Search Memory',
    description: 'Search memories by keyword. Returns matched memories ranked by relevance.',
    promptSnippet: 'Search stored memories by keyword',
    parameters: {},
    async execute(_id, params: any, _signal, _onUpdate, _ctx) {
      try {
        const query = params.query;
        if (!query || typeof query !== 'string') {
          return {
            content: [{ type: 'text' as const, text: 'Error: query is required and must be a string' }],
            isError: true,
          };
        }

        const limit = Math.min(Math.max(params.limit || 10, 1), 25);
        const ms = MemoryService.getInstance();
        const searchCtx: any = { query, projectId, timestamp: Date.now() };
        if (params.type) searchCtx.type = params.type;

        const results = ms.findRelevant(searchCtx);
        const top = results.slice(0, limit);

        // Track retrievals
        try {
          const os = OutcomeStorage.getInstance();
          for (const r of top) os.recordRetrieval(r.key);
        } catch { /* non-critical */ }

        const formatted = top.map(r => {
          const val = extractVal(r.value);
          return `- [${r.type}] (id: ${r.key}) ${val}`;
        });

        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            results: formatted.length > 0 ? formatted.join('\n') : `No memories found matching "${query}".`,
            count: top.length,
            query,
          }) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Failed to search: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  });

  // --- Tool: recall_delete_memory ---

  pi.registerTool({
    name: 'recall_delete_memory',
    label: 'Delete Memory',
    description: 'Delete a specific memory by its ID. Use recall_search_memory first to find the ID.',
    parameters: {},
    async execute(_id, params: any, _signal, _onUpdate, _ctx) {
      try {
        const id = params.id;
        if (!id || typeof id !== 'string') {
          return {
            content: [{ type: 'text' as const, text: 'Error: id is required and must be a string' }],
            isError: true,
          };
        }

        const ms = MemoryService.getInstance();
        const deleted = ms.delete(id);

        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            success: deleted,
            id,
            message: deleted ? `Memory "${id}" deleted.` : `Memory "${id}" not found.`,
          }) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Failed to delete: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  });
}

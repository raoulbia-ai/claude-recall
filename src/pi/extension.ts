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
  extractSessionLearnings,
  extractCheckpoint,
  ConversationEntry,
} from '../shared/event-processors';
import { rankRulesForToolCall, Rule, RankedRule } from '../services/rule-retrieval';

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

/**
 * Format the just-in-time relevant rules for injection into the per-turn
 * system prompt addendum. Mirrors the CC rule-injector hook output but as
 * plain text (no system-reminder wrapper since Pi handles that itself).
 */
function formatJitReminder(matches: RankedRule[]): string {
  if (matches.length === 0) return '';
  const TYPE_LABELS: Record<string, string> = {
    correction: 'correction',
    devops: 'devops',
    preference: 'preference',
    failure: 'avoid',
    'project-knowledge': 'project',
  };
  const lines = matches.map(m => {
    const label = TYPE_LABELS[m.rule.type] ?? m.rule.type;
    const v = m.rule.value;
    let snippet = '';
    if (typeof v === 'string') snippet = v;
    else if (v && typeof v === 'object') {
      snippet = (typeof v.content === 'string' ? v.content
        : typeof v.value === 'string' ? v.value
        : typeof v.title === 'string' ? v.title
        : JSON.stringify(v).substring(0, 200));
    }
    return `• [${label}] ${snippet.substring(0, 200).replace(/\s+/g, ' ').trim()}`;
  });
  return (
    `Recall: ${matches.length} rule${matches.length === 1 ? '' : 's'} relevant to this turn. ` +
    `Apply them or explicitly note why they don't fit:\n${lines.join('\n')}`
  );
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
  const collectedToolResults: ConversationEntry[] = [];
  let rulesLoaded = false;
  const collectedUserTexts: string[] = [];
  // Chronologically interleaved entries (user input + tool results in order)
  // for auto-checkpoint extraction at session end. Distinct from the two
  // arrays above which are kept for backward compat with processSessionEnd
  // and extractSessionLearnings.
  const collectedEntries: ConversationEntry[] = [];
  const MAX_COLLECTED_ENTRIES = 100;

  // Route logs through Pi's UI when available
  setLogFunction((source, msg) => {
    try { LoggingService.getInstance().info(source, msg); } catch { /* silent */ }
  });

  // --- Session init: set project context from cwd ---

  pi.on('session_start', (_event, ctx) => {
    projectId = ctx.cwd.split('/').pop() || 'unknown';
    rulesLoaded = false;
    collectedUserTexts.length = 0;
    collectedToolResults.length = 0;
    collectedEntries.length = 0;
    resetPendingFailures();
    try {
      ConfigService.getInstance().updateConfig({
        project: { rootDir: ctx.cwd },
      } as any);
    } catch {
      // Non-critical
    }
  });

  // --- Event: inject rules before each agent turn (full load on first turn,
  //     just-in-time relevant rules on subsequent turns based on the user's
  //     current prompt — Pi's analog of CC's PreToolUse rule injector) ---

  pi.on('before_agent_start', (_event, _ctx) => {
    try {
      const ms = MemoryService.getInstance();
      const rules = ms.loadActiveRules(projectId || undefined);
      const allRulesFlat: Rule[] = [
        ...rules.preferences,
        ...rules.corrections,
        ...rules.failures,
        ...rules.devops,
      ].map(m => ({
        key: m.key,
        type: m.type,
        value: m.value,
        is_active: m.is_active !== false,
        timestamp: m.timestamp,
        project_id: m.project_id,
      }));

      // First turn: full ruleset to seed context, plus JIT injection for the
      // very first prompt. Subsequent turns: JIT only — context already has
      // the full set from turn 1.
      let systemPromptOut: string | undefined;

      if (!rulesLoaded) {
        rulesLoaded = true;
        const body = formatRules(rules);
        if (body) {
          systemPromptOut = _event.systemPrompt + '\n\n' + LOAD_RULES_DIRECTIVE + '\n\n---\n\n' + body;
        }
      }

      // JIT injection on every turn — match rules against the current user prompt
      const userPrompt: string = (_event as any)?.prompt ?? '';
      if (userPrompt && allRulesFlat.length > 0) {
        const matches = rankRulesForToolCall('agent_turn', { command: userPrompt }, allRulesFlat);
        if (matches.length > 0) {
          const reminder = formatJitReminder(matches);
          systemPromptOut = (systemPromptOut ?? _event.systemPrompt) + '\n\n' + reminder;

          // Record each injection so we can correlate with success/failure later
          try {
            const outcomeStorage = OutcomeStorage.getInstance();
            for (const m of matches) {
              outcomeStorage.recordRuleInjection({
                rule_key: m.rule.key,
                tool_name: 'pi:agent_turn',
                tool_use_id: `pi_turn_${Date.now()}`,
                project_id: projectId,
                match_score: m.score,
                matched_tokens: m.matchedTokens,
              });
            }
          } catch { /* non-critical */ }
        }
      }

      if (systemPromptOut) {
        return { systemPrompt: systemPromptOut };
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

    // Collect for session extraction
    collectedToolResults.push({
      role: 'tool_result',
      text: output.substring(0, 300),
      toolName: event.toolName,
      isError: event.isError,
    });

    // Append to chronologically interleaved log for auto-checkpoint
    collectedEntries.push({
      role: 'tool_result',
      text: output.substring(0, 300),
      toolName: event.toolName,
      isError: event.isError,
    });
    if (collectedEntries.length > MAX_COLLECTED_ENTRIES) {
      collectedEntries.splice(0, collectedEntries.length - MAX_COLLECTED_ENTRIES);
    }

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

  pi.on('input', (event, ctx) => {
    collectedUserTexts.push(event.text);
    collectedEntries.push({ role: 'user', text: event.text });
    if (collectedEntries.length > MAX_COLLECTED_ENTRIES) {
      collectedEntries.splice(0, collectedEntries.length - MAX_COLLECTED_ENTRIES);
    }
    processUserInput(event.text, sessionId).then(msg => {
      if (msg && ctx.hasUI) {
        try { ctx.ui.notify(`📌 ${msg}`, 'info'); } catch { /* non-critical */ }
      }
    }).catch(() => {});
    return { action: 'continue' as const };
  });

  // --- Event: session end — episode + promotion + session extraction ---

  pi.on('session_shutdown', (_event, ctx) => {
    processSessionEnd(collectedUserTexts, sessionId, projectId).then(result => {
      if (ctx.hasUI) {
        try {
          if (result.stored > 0) {
            ctx.ui.notify(`📝 Recall: captured ${result.stored} memories from this session`, 'info');
          }
          if (result.promoted > 0) {
            ctx.ui.notify(`⬆️ Recall: ${result.promoted} lesson(s) promoted to active rules`, 'info');
          }
        } catch { /* non-critical */ }
      }
    }).catch(() => {});

    // Session extraction: learn from long coding sessions
    const allEntries: ConversationEntry[] = [
      ...collectedUserTexts.map(t => ({ role: 'user' as const, text: t })),
      ...collectedToolResults,
    ];
    if (allEntries.length >= 10) {
      extractSessionLearnings(allEntries, sessionId, projectId, 5).then(extracted => {
        if (extracted > 0 && ctx.hasUI) {
          try { ctx.ui.notify(`🔍 Recall: extracted ${extracted} learnings from session`, 'info'); } catch { /* non-critical */ }
        }
      }).catch(() => {});
    }

    // Auto-checkpoint: extract "where I left off" hint for next Pi session.
    // Critical for Pi which has no `--resume` flag — without this, the next
    // Pi session has no memory of what came before. Uses chronologically
    // interleaved entries (collectedEntries) so the LLM sees the actual
    // most-recent task, not user texts followed by all tool results.
    if (collectedEntries.length >= 3 && projectId) {
      extractCheckpoint(collectedEntries, projectId, 'pi').then(saved => {
        if (saved && ctx.hasUI) {
          try {
            ctx.ui.notify('📌 Recall: saved task checkpoint for next session', 'info');
          } catch { /* non-critical */ }
        }
      }).catch(() => {});
    }
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

        // Checkpoint hint — surface existence without dumping content
        let checkpointHint = '';
        try {
          if (ms.hasCheckpoint(projectId)) {
            const cp = ms.loadCheckpoint(projectId);
            if (cp) {
              const updatedDate = new Date(cp.updated_at).toLocaleString();
              checkpointHint = `📌 You have an unfinished task checkpoint from ${updatedDate} — call \`recall_load_checkpoint\` to see completed/remaining/blockers before starting work.\n\n`;
            }
          }
        } catch { /* non-critical */ }

        const text = body
          ? `${LOAD_RULES_DIRECTIVE}\n\n${checkpointHint}---\n\n${body}`
          : (checkpointHint || 'No active rules found. This may be a new project.');

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

  // --- Tool: recall_save_checkpoint ---

  pi.registerTool({
    name: 'recall_save_checkpoint',
    label: 'Save Task Checkpoint',
    description: 'Save a structured snapshot of work in progress (completed/remaining/blockers/notes). Replaces any previous checkpoint for this project. Call when ending a session or pausing on a task.',
    promptSnippet: 'Save a task checkpoint with what is done, what remains, and any blockers',
    parameters: {},
    async execute(_id, params: any, _signal, _onUpdate, _ctx) {
      try {
        const { completed, remaining, blockers, notes } = params || {};
        if (typeof completed !== 'string' || typeof remaining !== 'string' || typeof blockers !== 'string') {
          return {
            content: [{ type: 'text' as const, text: 'Error: completed, remaining, and blockers are required string fields' }],
            isError: true,
          };
        }
        const ms = MemoryService.getInstance();
        ms.saveCheckpoint(projectId, { completed, remaining, blockers, notes });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            success: true,
            projectId,
            message: `Checkpoint saved for project: ${projectId}`,
          }) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Failed to save checkpoint: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  });

  // --- Tool: recall_load_checkpoint ---

  pi.registerTool({
    name: 'recall_load_checkpoint',
    label: 'Load Task Checkpoint',
    description: 'Load the latest task checkpoint for the current project. Returns null if none exists. Call at session start to recall where you left off.',
    promptSnippet: 'Load the saved task checkpoint to see what was in progress',
    parameters: {},
    async execute(_id, _params: any, _signal, _onUpdate, _ctx) {
      try {
        const ms = MemoryService.getInstance();
        const checkpoint = ms.loadCheckpoint(projectId);
        if (!checkpoint) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ found: false, projectId }) }],
          };
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            found: true,
            projectId,
            ...checkpoint,
            updated_at_iso: new Date(checkpoint.updated_at).toISOString(),
          }) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Failed to load checkpoint: ${(err as Error).message}` }],
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

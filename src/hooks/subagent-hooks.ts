/**
 * Sub-agent hooks — fires on SubagentStart and SubagentStop events.
 *
 * SubagentStart: injects active recall rules into the sub-agent's context
 * via additionalContext (CC adds this as a message the sub-agent sees).
 *
 * SubagentStop: captures the sub-agent's outcome as an outcome event.
 *
 * SubagentStart input: { hook_event_name, agent_id, agent_type, session_id, cwd }
 * SubagentStop input:  { hook_event_name, agent_id, agent_type, agent_transcript_path,
 *                        last_assistant_message, stop_hook_active, session_id, cwd }
 */

import { hookLog, safeErrorMessage } from './shared';
import { MemoryService, ActiveRules } from '../services/memory';
import { ConfigService } from '../services/config';
import { OutcomeStorage } from '../services/outcome-storage';

function extractVal(value: any): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null) {
    return value.content || value.value || JSON.stringify(value);
  }
  return String(value ?? '');
}

function formatRulesCompact(rules: ActiveRules): string {
  const sections: string[] = [];

  if (rules.preferences.length > 0) {
    sections.push('Preferences:\n' + rules.preferences.map(m => `- ${extractVal(m.value)}`).join('\n'));
  }
  if (rules.corrections.length > 0) {
    sections.push('Corrections:\n' + rules.corrections.map(m => `- ${extractVal(m.value)}`).join('\n'));
  }
  if (rules.failures.length > 0) {
    sections.push('Failures:\n' + rules.failures.map(m => `- ${extractVal(m.value)}`).join('\n'));
  }
  if (rules.devops.length > 0) {
    sections.push('DevOps:\n' + rules.devops.map(m => `- ${extractVal(m.value)}`).join('\n'));
  }

  return sections.join('\n\n');
}

/**
 * SubagentStart — inject recall rules into the sub-agent's context.
 * stdout JSON with additionalContext is injected as a message the sub-agent sees.
 */
export async function handleSubagentStart(input: any): Promise<void> {
  try {
    const agentType = input?.agent_type ?? 'unknown';
    const projectId = ConfigService.getInstance().getProjectId();
    const rules = MemoryService.getInstance().loadActiveRules(projectId);

    const totalRules = rules.preferences.length + rules.corrections.length +
      rules.failures.length + rules.devops.length;

    if (totalRules === 0) return;

    const body = formatRulesCompact(rules);
    const context =
      `[Claude Recall] Apply these rules from the user's memory:\n\n${body}\n\n` +
      'Cite each rule at the point where it influences your action: (applied from memory: <rule>)';

    // Structured output — CC reads additionalContext and injects it
    console.log(JSON.stringify({
      hookEventName: 'SubagentStart',
      additionalContext: context,
    }));

    // User notification via stderr (stdout is structured hook output)
    console.error(`🤖 Recall: ${totalRules} rules loaded for sub-agent (${agentType})`);

    hookLog('subagent', `SubagentStart: injected ${totalRules} rules for ${agentType} (${input?.agent_id ?? '?'})`);
  } catch (err) {
    hookLog('subagent', `SubagentStart error: ${safeErrorMessage(err)}`);
  }
}

/**
 * SubagentStop — capture the sub-agent's outcome.
 */
export async function handleSubagentStop(input: any): Promise<void> {
  try {
    const agentType = input?.agent_type ?? 'unknown';
    const agentId = input?.agent_id ?? 'unknown';
    const lastMessage = input?.last_assistant_message ?? '';

    // Record outcome event
    try {
      const outcomeStorage = OutcomeStorage.getInstance();
      outcomeStorage.createOutcomeEvent({
        event_type: 'subagent_result',
        actor: 'tool',
        action_summary: `Sub-agent (${agentType}) completed`,
        next_state_summary: lastMessage.substring(0, 300) || 'No final message',
        tags: ['agent', 'subagent', agentType],
      });
    } catch {
      // Non-critical
    }

    console.error(`🤖 Recall: sub-agent (${agentType}) outcome captured`);

    hookLog('subagent', `SubagentStop: captured outcome for ${agentType} (${agentId})`);
  } catch (err) {
    hookLog('subagent', `SubagentStop error: ${safeErrorMessage(err)}`);
  }
}

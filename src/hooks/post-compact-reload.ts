/**
 * post-compact-reload hook — fires on SessionStart with source "compact".
 *
 * After context compaction, recall rules loaded earlier in the session are
 * gone from the model's context. This hook re-injects them by outputting
 * the active rules to stdout, which CC injects as a system message.
 *
 * Input: { session_id, hook_event_name: "SessionStart", source: "compact" }
 */

import { hookLog } from './shared';
import { MemoryService, ActiveRules } from '../services/memory';
import { ConfigService } from '../services/config';

const DIRECTIVE =
  'These rules were re-loaded after context compaction.\n' +
  'Continue applying them. Cite at the point of application: (applied from memory: <rule>)';

function extractVal(value: any): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null) {
    return value.content || value.value || JSON.stringify(value);
  }
  return String(value ?? '');
}

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

export async function handlePostCompactReload(input: any): Promise<void> {
  try {
    const projectId = ConfigService.getInstance().getProjectId();
    const rules = MemoryService.getInstance().loadActiveRules(projectId);

    const totalRules = rules.preferences.length + rules.corrections.length +
      rules.failures.length + rules.devops.length;

    if (totalRules === 0) return;

    const body = formatRules(rules);
    console.log(`🔄 Recall: ${totalRules} rules re-loaded after context compaction\n\n${DIRECTIVE}\n\n---\n\n${body}`);

    hookLog('post-compact-reload', `Re-injected ${totalRules} rules after compaction`);
  } catch (err) {
    hookLog('post-compact-reload', `Error: ${(err as Error).message}`);
  }
}

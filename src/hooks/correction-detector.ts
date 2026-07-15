/**
 * correction-detector hook — fires on UserPromptSubmit.
 *
 * Input: { session_id, prompt }
 * Classifies the user's prompt for corrections/preferences.
 * Stores matching content and outputs a <user-prompt-submit-hook> message.
 */

import {
  classifyContent,
  isDuplicate,
  storeMemory,
  searchExisting,
  hookLog,
  safeErrorMessage,
} from './shared';
import { OutcomeStorage } from '../services/outcome-storage';

const REASK_PATTERNS = [
  /still broken/i,
  /that'?s not what I (?:meant|asked|wanted)/i,
  /wrong file/i,
  /try again/i,
  /that didn'?t (?:work|fix|help)/i,
  /you (?:missed|forgot|ignored)/i,
];

export async function handleCorrectionDetector(input: any): Promise<void> {
  const prompt: string = input?.prompt ?? '';

  // Skip trivial / non-text input
  if (prompt.length < 20 || prompt.length > 2000) return;
  if (prompt.startsWith('```') || prompt.startsWith('{')) return;

  // Detect reask signals before classification
  try {
    for (const pattern of REASK_PATTERNS) {
      if (pattern.test(prompt)) {
        OutcomeStorage.getInstance().createOutcomeEvent({
          event_type: 'reask_signal',
          actor: 'user',
          next_state_summary: `User reask detected: ${prompt.substring(0, 100)}`,
          tags: ['reask'],
        });
        break;
      }
    }
  } catch (err) {
    hookLog('correction-detector', `Reask signal detection error: ${safeErrorMessage(err)}`);
  }

  const result = await classifyContent(prompt);
  if (!result) {
    // Terse trace so "did the hook fire?" is answerable from the log alone:
    // absence of any line = hook never ran; "no rule detected" = ran but the
    // prompt wasn't a storable rule; "Captured X" = ran and stored. Prompt
    // text is NOT logged (privacy) — only its length.
    hookLog('correction-detector', `no rule detected in prompt (len=${prompt.length})`);
    return;
  }

  // Reject short/garbage extracts and raw dumps (not clean rules)
  if (result.extract.length < 10 || result.extract.length > 200) return;

  // Corrections, preferences, and devops need high confidence to prevent noise
  if ((result.type === 'correction' || result.type === 'preference' || result.type === 'devops') && result.confidence < 0.75) return;
  if (result.confidence < 0.6) return;

  // Dedup check
  const existing = searchExisting(result.extract.substring(0, 100));
  if (isDuplicate(result.extract, existing)) {
    hookLog('correction-detector', `Skipped duplicate: ${result.extract.substring(0, 80)}`);
    return;
  }

  // fuzzyNewestWins: a user restating an existing rule in new words is a
  // deliberate refinement — the new phrasing supersedes the old row instead
  // of being absorbed into it. needsPrecision: vague-but-durable rules are
  // stored (losing what the user said is worse) but flagged so injection
  // nudges the agent to ask for a precise restatement.
  storeMemory(result.extract, result.type, undefined, result.confidence, {
    needsPrecision: result.precision === 'vague',
    fuzzyNewestWins: true,
  });

  const summary = result.extract.length > 60
    ? result.extract.substring(0, 60) + '...'
    : result.extract;

  // Output hook message that Claude sees
  console.log(
    `<user-prompt-submit-hook>📌 Recall: auto-captured ${result.type} — ${summary}</user-prompt-submit-hook>`
  );

  hookLog('correction-detector', `Captured ${result.type}: ${result.extract.substring(0, 80)}`);
}

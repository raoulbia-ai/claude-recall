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
  if (!result) return;

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

  storeMemory(result.extract, result.type, undefined, result.confidence);

  const summary = result.extract.length > 60
    ? result.extract.substring(0, 60) + '...'
    : result.extract;

  // Output hook message that Claude sees
  console.log(
    `<user-prompt-submit-hook>📌 Recall: auto-captured ${result.type} — ${summary}</user-prompt-submit-hook>`
  );

  hookLog('correction-detector', `Captured ${result.type}: ${result.extract.substring(0, 80)}`);
}

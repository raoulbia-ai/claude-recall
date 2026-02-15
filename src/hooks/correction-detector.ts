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
} from './shared';

export async function handleCorrectionDetector(input: any): Promise<void> {
  const prompt: string = input?.prompt ?? '';

  // Skip trivial / non-text input
  if (prompt.length < 10 || prompt.length > 2000) return;
  if (prompt.startsWith('```') || prompt.startsWith('{')) return;

  const result = await classifyContent(prompt);
  if (!result) return;

  // Corrections and preferences need high confidence; others need moderate
  if ((result.type === 'correction' || result.type === 'preference') && result.confidence < 0.7) return;
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
    `<user-prompt-submit-hook>[Memory] Auto-captured ${result.type}: ${summary}</user-prompt-submit-hook>`
  );

  hookLog('correction-detector', `Captured ${result.type}: ${result.extract.substring(0, 80)}`);
}

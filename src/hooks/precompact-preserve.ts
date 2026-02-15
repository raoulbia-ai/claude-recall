/**
 * precompact-preserve hook — fires on PreCompact event.
 *
 * Input: { session_id, transcript_path, cwd, hook_event_name }
 * Reads up to 50 transcript entries, uses broader matching (>=0.5),
 * dedup-checks, and stores up to 5 memories with [PreCompact] prefix.
 */

import {
  classifyBatch,
  isDuplicate,
  storeMemory,
  searchExisting,
  hookLog,
  readTranscriptTail,
  extractTextFromEntry,
} from './shared';

const MAX_STORE = 5;
const MIN_CONFIDENCE = 0.5;

export async function handlePrecompactPreserve(input: any): Promise<void> {
  const transcriptPath: string = input?.transcript_path ?? '';

  if (!transcriptPath) {
    hookLog('precompact', 'No transcript_path provided');
    return;
  }

  const entries = readTranscriptTail(transcriptPath, 50);
  if (entries.length === 0) {
    hookLog('precompact', 'No transcript entries found');
    return;
  }

  // Extract all texts, filter, then batch-classify in one API call
  const textsWithIndex: { text: string; idx: number }[] = [];
  for (let i = 0; i < entries.length; i++) {
    const text = extractTextFromEntry(entries[i]);
    if (text && text.length >= 10 && text.length <= 2000) {
      textsWithIndex.push({ text, idx: i });
    }
  }

  if (textsWithIndex.length === 0) {
    hookLog('precompact', 'No classifiable text in transcript entries');
    return;
  }

  const results = await classifyBatch(textsWithIndex.map((t) => t.text));
  let stored = 0;

  for (let i = 0; i < results.length; i++) {
    if (stored >= MAX_STORE) break;

    const result = results[i];
    if (!result) continue;
    if (result.confidence < MIN_CONFIDENCE) continue;

    // Dedup
    const existing = searchExisting(result.extract.substring(0, 100));
    if (isDuplicate(result.extract, existing)) continue;

    const prefixed = `[PreCompact] ${result.extract}`;
    storeMemory(prefixed, result.type, undefined, result.confidence);
    stored++;

    hookLog('precompact', `Captured ${result.type}: ${result.extract.substring(0, 80)}`);
  }

  hookLog('precompact', `PreCompact sweep: stored ${stored} memories from ${entries.length} entries`);
}

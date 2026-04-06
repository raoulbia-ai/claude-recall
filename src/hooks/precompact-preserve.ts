/**
 * precompact-preserve hook — fires on PreCompact event.
 *
 * Input: { session_id, transcript_path, cwd, hook_event_name }
 * Reads up to 50 transcript entries, uses broader matching (>=0.5),
 * dedup-checks, and stores up to 5 memories with [PreCompact] prefix.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  classifyBatch,
  isDuplicate,
  storeMemory,
  searchExisting,
  hookLog,
  readTranscriptTail,
  extractTextFromEntry,
  isUserEntry,
} from './shared';

const MAX_STORE = 5;
const MIN_CONFIDENCE = 0.6;

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

  // Extract user-only texts, filter, then batch-classify in one API call
  const textsWithIndex: { text: string; idx: number }[] = [];
  for (let i = 0; i < entries.length; i++) {
    if (!isUserEntry(entries[i])) continue;
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
    if (result.extract.length < 10 || result.extract.length > 200) continue;
    if (result.confidence < MIN_CONFIDENCE) continue;

    // Dedup
    const existing = searchExisting(result.extract.substring(0, 100));
    if (isDuplicate(result.extract, existing)) continue;

    const prefixed = `[PreCompact] ${result.extract}`;
    storeMemory(prefixed, result.type, undefined, result.confidence);
    stored++;

    hookLog('precompact', `Captured ${result.type}: ${result.extract.substring(0, 80)}`);
  }

  if (stored > 0) {
    console.log(`💾 Recall: preserved ${stored} memories before context compression`);
  }
  hookLog('precompact', `PreCompact sweep: stored ${stored} memories from ${entries.length} entries`);

  // Reset search enforcer hook-state so Claude is forced to re-load rules
  // after context compression. Without this, the enforcer thinks rules are
  // still loaded even though they may have been lost during compaction.
  resetEnforcerState(input?.session_id);
}

/**
 * Delete the search enforcer's hook-state file for this session,
 * forcing a fresh load_rules gate on the next tool call.
 */
function resetEnforcerState(sessionId?: string): void {
  if (!sessionId) {
    hookLog('precompact', 'No session_id — cannot reset enforcer state');
    return;
  }

  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_') || 'default';
  const stateFile = path.join(os.homedir(), '.claude-recall', 'hook-state', `${safeId}.json`);

  try {
    if (fs.existsSync(stateFile)) {
      fs.unlinkSync(stateFile);
      hookLog('precompact', `Reset enforcer state for session ${safeId} — rules will re-gate`);
    }
  } catch (err: any) {
    hookLog('precompact', `Failed to reset enforcer state: ${err.message}`);
  }
}

/**
 * memory-stop-hook — fires on Stop event.
 *
 * Input: { session_id, transcript_path, cwd, hook_event_name }
 * Reads the last 6 transcript entries, classifies them,
 * dedup-checks, and stores up to 3 new memories.
 */

import {
  classifyBatch,
  isDuplicate,
  storeMemory,
  searchExisting,
  hookLog,
  readTranscriptTail,
  extractTextFromEntry,
  isUserEntry,
  jaccardSimilarity,
} from './shared';
import { MemoryService } from '../services/memory';

const MAX_STORE = 3;

export async function handleMemoryStop(input: any): Promise<void> {
  const transcriptPath: string = input?.transcript_path ?? '';

  if (!transcriptPath) {
    hookLog('memory-stop', 'No transcript_path provided');
    return;
  }

  const entries = readTranscriptTail(transcriptPath, 6);
  if (entries.length === 0) {
    hookLog('memory-stop', 'No transcript entries found');
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
    hookLog('memory-stop', 'No classifiable text in transcript entries');
    // Still scan for citations — assistant messages may contain them
    scanForCitations(transcriptPath);
    return;
  }

  const results = await classifyBatch(textsWithIndex.map((t) => t.text));
  let stored = 0;

  for (let i = 0; i < results.length; i++) {
    if (stored >= MAX_STORE) break;

    const result = results[i];
    if (!result) continue;

    // Reject extracts that are too short or too long (not clean rules)
    if (result.extract.length < 10 || result.extract.length > 200) continue;

    // Corrections and preferences need higher confidence
    if ((result.type === 'correction' || result.type === 'preference') && result.confidence < 0.7) continue;
    if (result.confidence < 0.6) continue;

    // Dedup
    const existing = searchExisting(result.extract.substring(0, 100));
    if (isDuplicate(result.extract, existing)) continue;

    storeMemory(result.extract, result.type, undefined, result.confidence);
    stored++;

    hookLog('memory-stop', `Captured ${result.type}: ${result.extract.substring(0, 80)}`);
  }

  hookLog('memory-stop', `Session end: stored ${stored} memories from ${entries.length} entries`);

  // Scan for citations in assistant messages to track compliance
  scanForCitations(transcriptPath);
}

/**
 * Scan transcript for (applied from memory: ...) citations and increment cite_count.
 * Uses a wider window (last 50 entries) since citations appear throughout assistant responses.
 */
function scanForCitations(transcriptPath: string): void {
  try {
    const entries = readTranscriptTail(transcriptPath, 50);
    if (entries.length === 0) {
      hookLog('memory-stop', 'Citation scan: no entries in transcript tail');
      return;
    }

    const citationRegex = /\(applied from memory:\s*(.+?)\)/g;
    const citations: string[] = [];
    let assistantEntries = 0;
    let textsExtracted = 0;

    for (const entry of entries) {
      // Only scan assistant entries (opposite of isUserEntry)
      if (isUserEntry(entry)) continue;
      assistantEntries++;
      const text = extractTextFromEntry(entry);
      if (!text) continue;
      textsExtracted++;

      let match;
      while ((match = citationRegex.exec(text)) !== null) {
        citations.push(match[1].trim());
      }
    }

    hookLog('memory-stop', `Citation scan: ${entries.length} entries, ${assistantEntries} assistant, ${textsExtracted} with text, ${citations.length} citations`);

    if (citations.length === 0) return;

    hookLog('memory-stop', `Found ${citations.length} citation(s) in transcript`);

    const memoryService = MemoryService.getInstance();

    // Get all loaded rules across all projects — citations may reference rules from any project
    const loadedRules = memoryService.getAllLoadedRules();
    hookLog('memory-stop', `Matching citations against ${loadedRules.length} loaded rules`);

    // Log first 3 rules for diagnostics
    for (let di = 0; di < Math.min(loadedRules.length, 3); di++) {
      const r = loadedRules[di];
      hookLog('memory-stop', `Rule[${di}] key=${r.key} type=${r.type} valType=${typeof r.value} val="${String(r.value).substring(0, 100)}"`);
    }

    for (const cite of citations) {
      hookLog('memory-stop', `Citation text: "${cite.substring(0, 80)}"`);

      let bestScore = 0;
      let bestKey = '';
      let bestContent = '';

      for (const rule of loadedRules) {
        // Extract clean text content — value may be JSON string with content/value fields
        const ruleContent = extractRuleContent(rule.value);

        const score = jaccardSimilarity(cite, ruleContent);
        if (score > bestScore) {
          bestScore = score;
          bestKey = rule.key;
          bestContent = ruleContent.substring(0, 60);
        }
      }

      hookLog('memory-stop', `Best match: "${bestContent}" jaccard=${bestScore.toFixed(3)} key=${bestKey}`);

      if (bestScore >= 0.3) {
        memoryService.incrementCiteCount(bestKey);
        hookLog('memory-stop', `Citation matched: "${cite.substring(0, 50)}" → rule ${bestKey} (jaccard=${bestScore.toFixed(3)})`);
      } else {
        hookLog('memory-stop', `No match found for citation (best=${bestScore.toFixed(3)})`);
      }
    }
  } catch (error) {
    hookLog('memory-stop', `Citation scan error: ${error}`);
  }
}

/**
 * Extract plain text content from a rule value (may be JSON string, object, or plain string).
 */
function extractRuleContent(value: any): string {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'string') return parsed;
      if (typeof parsed?.content === 'string') return parsed.content;
      if (typeof parsed?.value === 'string') return parsed.value;
      // content might be an object — stringify it
      if (parsed?.content) return JSON.stringify(parsed.content);
      return value;
    } catch {
      return value;
    }
  }
  if (typeof value === 'object' && value !== null) {
    if (typeof value.content === 'string') return value.content;
    if (typeof value.value === 'string') return value.value;
    return JSON.stringify(value);
  }
  return String(value ?? '');
}

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
  hookSource,
  searchExisting,
  hookLog,
  hookStateDir,
  safeErrorMessage,
  readTranscriptTail,
  extractTextFromEntry,
  isUserEntry,
  extractToolInteractions,
} from './shared';
import * as fs from 'fs';
import * as path from 'path';
import { MemoryService } from '../services/memory';
import { ConfigService } from '../services/config';
import { DetectedFailure } from './failure-detectors';
import { OutcomeStorage } from '../services/outcome-storage';
import { extractCitations, matchCitations } from '../shared/citations';
import { generateCandidateLessons, runPromotionCycle, storeDetectedFailures } from '../shared/session-distillation';
import { extractSessionLearnings, ConversationEntry, setLogFunction } from '../shared/event-processors';

const MAX_STORE = 3;

/**
 * Debounce state for the heavy pipeline. Claude Code fires Stop after EVERY
 * assistant turn, not at session end — without a debounce the full pipeline
 * (episode insert, up to two Haiku calls, failure scan, promotion cycle,
 * prune) runs per turn. Citations are still scanned every turn (cheap, and
 * they keep cite_count — the anti-demotion signal — fresh).
 */
const STOP_DEBOUNCE_MS = (() => {
  const raw = parseInt(process.env.CLAUDE_RECALL_STOP_DEBOUNCE_MS || '300000', 10); // 5 min
  return Number.isFinite(raw) && raw >= 0 ? raw : 300000;
})();

function stopStateFile(sessionId: string): string {
  return path.join(hookStateDir(), `memory-stop-${sessionId.replace(/[^a-zA-Z0-9-]/g, '_')}.json`);
}

function shouldRunHeavyPipeline(sessionId: string): boolean {
  if (STOP_DEBOUNCE_MS === 0) return true; // debounce disabled
  const file = stopStateFile(sessionId);
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (typeof state.lastHeavyRun === 'number' && Date.now() - state.lastHeavyRun < STOP_DEBOUNCE_MS) {
      return false;
    }
  } catch {
    // Missing/corrupt state file → treat as never run
  }
  try {
    fs.writeFileSync(file, JSON.stringify({ lastHeavyRun: Date.now() }));
  } catch {
    // Non-fatal: worst case the pipeline runs again next turn
  }
  return true;
}

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

  // Debounced: run only the cheap citation scan on most turns
  const sessionId: string = input?.session_id || 'default';
  if (!shouldRunHeavyPipeline(sessionId)) {
    scanForCitations(transcriptPath);
    return;
  }

  const outcomeStorage = OutcomeStorage.getInstance();
  const projectId = ConfigService.getInstance().getProjectId();

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
    // Still scan for citations — assistant messages may contain them.
    // No episode was created yet, so this early return leaves no dangling row.
    scanForCitations(transcriptPath);
    return;
  }

  // Create an episode for this session — AFTER the early returns so the
  // frequent no-classifiable-text path doesn't leave permanently
  // outcome-less episode rows.
  const episodeId = outcomeStorage.createEpisode({
    project_id: projectId,
    session_id: input?.session_id,
    source: 'memory-stop',
  });

  const results = await classifyBatch(textsWithIndex.map((t) => t.text));
  let stored = 0;

  for (let i = 0; i < results.length; i++) {
    if (stored >= MAX_STORE) break;

    const result = results[i];
    if (!result) continue;

    // Reject extracts that are too short or too long (not clean rules)
    if (result.extract.length < 10 || result.extract.length > 200) continue;

    // Corrections, preferences, and devops need higher confidence to prevent noise
    if ((result.type === 'correction' || result.type === 'preference' || result.type === 'devops') && result.confidence < 0.75) continue;
    if (result.confidence < 0.6) continue;

    // Dedup
    const existing = searchExisting(result.extract.substring(0, 100));
    if (isDuplicate(result.extract, existing)) continue;

    storeMemory(result.extract, result.type, undefined, result.confidence, {
      source: hookSource(input, entries[textsWithIndex[i].idx], textsWithIndex[i].text),
    });
    stored++;

    hookLog('memory-stop', `Captured ${result.type}: ${result.extract.substring(0, 80)}`);
  }

  if (stored > 0) {
    console.log(`📝 Recall: captured ${stored} memories from this session`);
  }
  hookLog('memory-stop', `Session end: stored ${stored} memories from ${entries.length} entries`);

  // Session extraction: learn from long coding sessions (reads wider window)
  try {
    setLogFunction(hookLog);
    const sessionEntries = readTranscriptTail(transcriptPath, 50);
    if (sessionEntries.length >= 10) {
      const conversationEntries = buildConversationEntries(sessionEntries);

      // Record failed subagent outcomes
      for (const entry of conversationEntries) {
        if (entry.toolName === 'Agent' && entry.isError) {
          try {
            outcomeStorage.createOutcomeEvent({
              event_type: 'agent_failure',
              actor: 'tool',
              action_summary: entry.text,
              next_state_summary: entry.text,
              tags: ['agent', 'subagent'],
            });
          } catch { /* non-critical */ }
        }
      }

      const extracted = await extractSessionLearnings(conversationEntries, input?.session_id ?? '', projectId, 5);
      if (extracted > 0) {
        console.log(`🔍 Recall: extracted ${extracted} learnings from session analysis`);
        hookLog('memory-stop', `Session extraction: stored ${extracted} learnings`);
        stored += extracted;
      }
    }
  } catch (err) {
    hookLog('memory-stop', `Session extraction error: ${safeErrorMessage(err)}`);
  }

  // Scan for citations in assistant messages to track compliance
  scanForCitations(transcriptPath);

  // Scan transcript for failure signals (non-zero exits, test cycles, backtracking, etc.)
  const failures = detectAndStoreFailures(transcriptPath, episodeId);

  // Incorporate structured tool_failure events captured by PostToolUseFailure
  // hook — scoped to THIS session so concurrent sessions (or another
  // project's session within the hour) don't contaminate this episode
  const toolFailures = getToolFailureEvents(outcomeStorage, input?.session_id);
  const allFailures = [...failures, ...toolFailures];

  outcomeStorage.updateEpisode(episodeId, {
    outcome_type: allFailures.length > 0 ? 'failure' : 'success',
    severity: allFailures.length > 0 ? 'medium' : 'low',
    outcome_summary: `${stored} memories, ${allFailures.length} failures (${toolFailures.length} from tool events)`,
  });

  // Generate candidate lessons from high-confidence failures
  await generateCandidateLessons(allFailures, episodeId, projectId);

  runPromotionCycle(projectId);

  // Prune old outcome data to prevent unbounded table growth
  try {
    const pruned = outcomeStorage.pruneOldData();
    const total = pruned.episodes + pruned.events + pruned.lessons + pruned.stats + pruned.injections;
    if (total > 0) {
      hookLog('memory-stop', `Pruned: ${pruned.episodes} episodes, ${pruned.events} events, ${pruned.lessons} lessons, ${pruned.stats} orphaned stats, ${pruned.injections} injections`);
    }
  } catch (err) {
    hookLog('memory-stop', `Prune error: ${safeErrorMessage(err)}`);
  }
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

      citations.push(...extractCitations(text));
    }

    hookLog('memory-stop', `Citation scan: ${entries.length} entries, ${assistantEntries} assistant, ${textsExtracted} with text, ${citations.length} citations`);

    if (citations.length === 0) return;

    hookLog('memory-stop', `Found ${citations.length} citation(s) in transcript`);

    const memoryService = MemoryService.getInstance();

    // Get ALL rule-type memories — citations may reference rules not loaded via load_rules
    const allRules = memoryService.getAllRulesForCitationMatching();
    hookLog('memory-stop', `Matching citations against ${allRules.length} rules`);

    const matches = matchCitations(citations, allRules);

    for (const { citation, key, containment } of matches) {
      memoryService.incrementCiteCount(key);
      try {
        OutcomeStorage.getInstance().recordHelpful(key);
      } catch { /* best-effort — ignore */ }
      hookLog('memory-stop', `Citation matched: "${citation.substring(0, 50)}" → rule ${key} (containment=${containment.toFixed(3)})`);
    }

    if (matches.length < citations.length) {
      hookLog('memory-stop', `${citations.length - matches.length} citation(s) matched no rule above threshold`);
    }
  } catch (error) {
    hookLog('memory-stop', `Citation scan error: ${error}`);
  }
}



/**
 * Scan the last 200 transcript entries for failure signals and store up to 3.
 */
function detectAndStoreFailures(transcriptPath: string, _episodeId?: string): DetectedFailure[] {
  return storeDetectedFailures(readTranscriptTail(transcriptPath, 200));
}

/**
 * Convert structured tool_failure outcome events into DetectedFailure format
 * so they feed into the candidate lessons pipeline.
 */
function getToolFailureEvents(outcomeStorage: OutcomeStorage, sessionId?: string): DetectedFailure[] {
  try {
    // Session-scoped when the Stop payload carries a session_id (it always
    // does in practice); an undefined id falls back to the raw time window.
    const events = outcomeStorage.getEventsByType('tool_failure', 1, sessionId); // last 1 hour
    return events.slice(0, 5).map(e => ({
      signal: 'tool_failure' as const,
      confidence: 0.8,
      content: {
        what_failed: e.action_summary || 'Tool failure',
        why_failed: e.next_state_summary,
        what_should_do: 'Check inputs and prerequisites before retrying',
        context: `Captured by PostToolUseFailure hook`,
        preventative_checks: ['Verify tool inputs are correct'],
      },
    }));
  } catch (err) {
    hookLog('memory-stop', `Tool failure events error: ${safeErrorMessage(err)}`);
    return [];
  }
}


/**
 * Convert raw JSONL transcript entries to ConversationEntry[] for session extraction.
 */
function buildConversationEntries(entries: object[]): ConversationEntry[] {
  const result: ConversationEntry[] = [];

  for (const entry of entries) {
    if (isUserEntry(entry)) {
      const text = extractTextFromEntry(entry);
      if (text && text.length > 5) {
        result.push({ role: 'user', text: text.substring(0, 300) });
      }
    } else {
      const text = extractTextFromEntry(entry);
      if (text && text.length > 5) {
        // Detect subagent task notifications
        const notifMatch = text.match(/<task-notification>[\s\S]*?<\/task-notification>/);
        if (notifMatch) {
          const status = notifMatch[0].match(/<status>(.*?)<\/status>/)?.[1] ?? 'unknown';
          const summary = notifMatch[0].match(/<summary>(.*?)<\/summary>/)?.[1] ?? '';
          result.push({
            role: 'tool_result',
            text: `Agent ${status}: ${summary}`.substring(0, 300),
            toolName: 'Agent',
            isError: status === 'failed' || status === 'killed',
          });
        } else {
          result.push({ role: 'assistant', text: text.substring(0, 300) });
        }
      }
    }
  }

  // Extract paired tool interactions across all entries
  try {
    const interactions = extractToolInteractions(entries);
    for (const ti of interactions) {
      if (ti.call) {
        result.push({
          role: 'assistant',
          text: JSON.stringify(ti.call.input || {}).substring(0, 150),
          toolName: ti.call.name,
        });
      }
      if (ti.result) {
        result.push({
          role: 'tool_result',
          text: ti.result.content.substring(0, 200),
          toolName: ti.call.name,
          isError: ti.result.isError,
        });
      }
    }
  } catch {
    // Skip if parsing fails
  }

  return result;
}

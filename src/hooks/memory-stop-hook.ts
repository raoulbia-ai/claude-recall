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
  safeErrorMessage,
  readTranscriptTail,
  extractTextFromEntry,
  isUserEntry,
  extractToolInteractions,
} from './shared';
import { MemoryService } from '../services/memory';
import { ConfigService } from '../services/config';
import { detectTranscriptFailures } from './failure-detectors';
import { DetectedFailure } from './failure-detectors';
import { OutcomeStorage } from '../services/outcome-storage';
import { extractSessionLearnings, ConversationEntry, setLogFunction } from '../shared/event-processors';

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

  // Create an episode for this session
  const outcomeStorage = OutcomeStorage.getInstance();
  const projectId = ConfigService.getInstance().getProjectId();
  const episodeId = outcomeStorage.createEpisode({
    project_id: projectId,
    session_id: input?.session_id,
    source: 'memory-stop',
  });

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

    // Corrections, preferences, and devops need higher confidence to prevent noise
    if ((result.type === 'correction' || result.type === 'preference' || result.type === 'devops') && result.confidence < 0.75) continue;
    if (result.confidence < 0.6) continue;

    // Dedup
    const existing = searchExisting(result.extract.substring(0, 100));
    if (isDuplicate(result.extract, existing)) continue;

    storeMemory(result.extract, result.type, undefined, result.confidence);
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

  // Incorporate structured tool_failure events captured by PostToolUseFailure hook
  const toolFailures = getToolFailureEvents(outcomeStorage);
  const allFailures = [...failures, ...toolFailures];

  outcomeStorage.updateEpisode(episodeId, {
    outcome_type: allFailures.length > 0 ? 'failure' : 'success',
    severity: allFailures.length > 0 ? 'medium' : 'low',
    outcome_summary: `${stored} memories, ${allFailures.length} failures (${toolFailures.length} from tool events)`,
  });

  // Generate candidate lessons from high-confidence failures
  generateCandidateLessons(allFailures, episodeId, projectId);

  // Run promotion cycle
  try {
    const { PromotionEngine } = await import('../services/promotion-engine');
    const result = PromotionEngine.getInstance().runCycle(projectId);
    if (result.promoted > 0 || result.archived > 0) {
      if (result.promoted > 0) {
        console.log(`⬆️ Recall: ${result.promoted} lesson(s) promoted to active rules`);
      }
      hookLog('memory-stop', `Promotion: ${result.promoted} promoted, ${result.archived} archived`);
    }
  } catch (err) {
    hookLog('memory-stop', `Promotion error: ${safeErrorMessage(err)}`);
  }

  // Prune old outcome data to prevent unbounded table growth
  try {
    const pruned = outcomeStorage.pruneOldData();
    const total = pruned.episodes + pruned.events + pruned.lessons + pruned.stats;
    if (total > 0) {
      hookLog('memory-stop', `Pruned: ${pruned.episodes} episodes, ${pruned.events} events, ${pruned.lessons} lessons, ${pruned.stats} orphaned stats`);
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

    // Get ALL rule-type memories — citations may reference rules not loaded via load_rules
    const allRules = memoryService.getAllRulesForCitationMatching();
    hookLog('memory-stop', `Matching citations against ${allRules.length} rules`);

    for (const cite of citations) {
      hookLog('memory-stop', `Citation text: "${cite.substring(0, 80)}"`);

      let bestScore = 0;
      let bestKey = '';
      let bestContent = '';

      for (const rule of allRules) {
        // Extract clean text content — value may be JSON string with content/value fields
        const ruleContent = extractRuleContent(rule.value);

        const score = citationContainment(cite, ruleContent);
        if (score > bestScore) {
          bestScore = score;
          bestKey = rule.key;
          bestContent = ruleContent.substring(0, 60);
        }
      }

      hookLog('memory-stop', `Best match: "${bestContent}" containment=${bestScore.toFixed(3)} key=${bestKey}`);

      if (bestScore >= 0.5) {
        memoryService.incrementCiteCount(bestKey);
        try {
          OutcomeStorage.getInstance().recordHelpful(bestKey);
        } catch {}
        hookLog('memory-stop', `Citation matched: "${cite.substring(0, 50)}" → rule ${bestKey} (containment=${bestScore.toFixed(3)})`);
      } else {
        hookLog('memory-stop', `No match found for citation (best=${bestScore.toFixed(3)})`);
      }
    }
  } catch (error) {
    hookLog('memory-stop', `Citation scan error: ${error}`);
  }
}

/**
 * What fraction of the citation's tokens appear in the rule text?
 * Better than Jaccard for short citations matching long rules.
 */
function citationContainment(citation: string, ruleText: string): number {
  const tokenize = (s: string) =>
    new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
  const citeTokens = tokenize(citation);
  const ruleTokens = tokenize(ruleText);
  if (citeTokens.size === 0) return 0;
  let found = 0;
  for (const w of citeTokens) {
    if (ruleTokens.has(w)) found++;
  }
  return found / citeTokens.size;
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

/**
 * Scan the last 200 transcript entries for failure signals and store up to 3.
 */
function detectAndStoreFailures(transcriptPath: string, episodeId?: string): DetectedFailure[] {
  try {
    const entries = readTranscriptTail(transcriptPath, 200);
    if (entries.length === 0) {
      hookLog('memory-stop', '[FailureDetector] No entries to scan');
      return [];
    }

    const failures = detectTranscriptFailures(entries);
    if (failures.length === 0) {
      hookLog('memory-stop', '[FailureDetector] No failure signals detected');
      return [];
    }

    hookLog('memory-stop', `[FailureDetector] Detected ${failures.length} failure signal(s)`);

    const projectId = ConfigService.getInstance().getProjectId();
    let stored = 0;

    for (const failure of failures) {
      // Dedup against existing failure memories
      const searchQuery = failure.content.what_failed.substring(0, 100);
      const existing = searchExisting(searchQuery);
      if (isDuplicate(failure.content.what_failed, existing, 0.6)) {
        hookLog('memory-stop', `[FailureDetector] Skipped duplicate: ${failure.signal}`);
        continue;
      }

      const key = `hook_failure_${failure.signal}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const memoryService = MemoryService.getInstance();

      memoryService.store({
        key,
        value: {
          title: `Avoid: ${failure.content.what_failed.substring(0, 50)}`,
          description: failure.content.why_failed.substring(0, 100),
          content: failure.content,
        },
        type: 'failure',
        context: {
          projectId: projectId,
          timestamp: Date.now(),
        },
        relevanceScore: failure.confidence,
      });

      stored++;
      hookLog('memory-stop', `[FailureDetector] Stored ${failure.signal}: ${failure.content.what_failed.substring(0, 80)}`);
    }

    hookLog('memory-stop', `[FailureDetector] Stored ${stored} failure(s) from ${failures.length} detected`);
    return failures;
  } catch (error) {
    hookLog('memory-stop', `[FailureDetector] Error: ${error}`);
    return [];
  }
}

/**
 * Convert structured tool_failure outcome events into DetectedFailure format
 * so they feed into the candidate lessons pipeline.
 */
function getToolFailureEvents(outcomeStorage: OutcomeStorage): DetectedFailure[] {
  try {
    const events = outcomeStorage.getEventsByType('tool_failure', 1); // last 1 hour
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
 * Generate candidate lessons from high-confidence failures.
 * Deduplicates against existing lessons and increments evidence count for similar ones.
 */
function generateCandidateLessons(
  failures: DetectedFailure[],
  episodeId: string,
  projectId: string,
): void {
  try {
    const outcomeStorage = OutcomeStorage.getInstance();
    for (const f of failures) {
      if (f.confidence < 0.7) continue;
      const similar = outcomeStorage.findSimilarLessons(f.content.what_should_do, projectId);
      if (similar.length > 0) {
        outcomeStorage.incrementEvidenceCount(similar[0].id);
      } else {
        outcomeStorage.createCandidateLesson({
          project_id: projectId,
          episode_id: episodeId,
          lesson_text: f.content.what_should_do,
          lesson_kind: 'failure_preventer',
          applies_when: extractTagsFromContext(f.content.context),
          outcome_type: 'negative',
          reward_band: -1,
          confidence: f.confidence,
          durability: 'project',
        });
      }
    }
  } catch (err) {
    hookLog('memory-stop', `Candidate lesson generation error: ${safeErrorMessage(err)}`);
  }
}

function extractTagsFromContext(context: string): string[] {
  const tags: string[] = [];
  const words = context.toLowerCase().split(/\s+/).filter(w => w.length >= 4);
  // Take up to 5 significant words as tags
  for (const w of words) {
    if (tags.length >= 5) break;
    if (!['that', 'this', 'with', 'from', 'were', 'been'].includes(w)) {
      tags.push(w);
    }
  }
  return tags;
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

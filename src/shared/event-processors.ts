/**
 * Shared event processors — agent-agnostic functions that both
 * Claude Code hooks and the Pi extension call.
 *
 * These operate on in-memory data (strings, arrays) rather than
 * file paths or stdin, so they work in any runtime environment.
 */

import {
  classifyContent,
  classifyBatch,
  isDuplicate,
  storeMemory,
  searchExisting,
  jaccardSimilarity,
  safeErrorMessage,
} from '../hooks/shared';
import { MemoryService } from '../services/memory';
import { OutcomeStorage } from '../services/outcome-storage';
import { FailureMemoryContent } from '../services/failure-extractor';

// --- Logging ---

type LogFn = (source: string, message: string) => void;
let logFn: LogFn = () => {}; // silent by default

/** Set the log function (hookLog for CC hooks, console for Pi, etc.) */
export function setLogFunction(fn: LogFn): void {
  logFn = fn;
}

// --- Fix Pairing (in-memory) ---

interface PendingFailure {
  toolName: string;
  /** Command string (Bash) or file path (Edit/Write) — used for similarity matching */
  identifier: string;
  memoryKey: string;
  timestamp: number;
}

const MAX_PENDING = 10;
const FIX_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const FIX_SIMILARITY_THRESHOLD = 0.3;

let pendingFailures: PendingFailure[] = [];

/** Reset pending failures (e.g. on session start). */
export function resetPendingFailures(): void {
  pendingFailures = [];
}

/** Extract an identifier string from tool input for similarity comparison. */
function getToolIdentifier(toolName: string, toolInput: any): string {
  if ((toolName === 'Bash' || toolName === 'bash') && toolInput?.command) {
    return toolInput.command;
  }
  if (toolInput?.file_path) {
    return `${toolName}:${toolInput.file_path}`;
  }
  return toolName;
}

/**
 * Check if a successful tool result matches a recent failure and pair the fix.
 * Returns true if a fix was paired.
 */
function tryPairFix(toolName: string, toolInput: any, output: string): boolean {
  if (pendingFailures.length === 0) return false;

  const now = Date.now();
  const identifier = getToolIdentifier(toolName, toolInput);
  let matched = false;

  const remaining: PendingFailure[] = [];
  for (const pf of pendingFailures) {
    if (now - pf.timestamp > FIX_WINDOW_MS) continue; // expired

    if (!matched && pf.toolName === toolName &&
        jaccardSimilarity(pf.identifier, identifier) >= FIX_SIMILARITY_THRESHOLD) {
      try {
        MemoryService.getInstance().update(pf.memoryKey, {
          value: { what_should_do: `Fix: ${truncate(identifier, 200)}` },
        });
        logFn('event-processor', `Paired fix: "${truncate(identifier, 60)}" → ${pf.memoryKey}`);
        matched = true;
        // Don't add to remaining — consumed
      } catch {
        remaining.push(pf); // keep if update fails
      }
    } else {
      remaining.push(pf);
    }
  }

  pendingFailures = remaining;
  return matched;
}

// --- Tool Outcome Processing ---

/** Error patterns for Edit/Write tools */
const WRITE_ERROR_PATTERNS = [
  /permission denied/i,
  /EACCES/i,
  /ENOENT/i,
  /file not found/i,
  /no such file/i,
  /read-?only file/i,
  /conflict/i,
  /old_string.*not found/i,
  /not unique in the file/i,
];

/** Error patterns for MCP/custom tools */
const TOOL_ERROR_PATTERNS = [
  /error/i,
  /failed/i,
  /exception/i,
  /timeout/i,
];

function truncate(s: string, maxLen: number): string {
  return s.length <= maxLen ? s : s.substring(0, maxLen - 3) + '...';
}

function firstLine(s: string): string {
  const idx = s.indexOf('\n');
  return idx === -1 ? s : s.substring(0, idx);
}

export interface ToolOutcomeResult {
  captured: boolean;   // failure was stored
  fixPaired: boolean;  // success was paired with a previous failure
}

/**
 * Process a tool outcome — capture failures as memories, record outcome events.
 * When a tool succeeds after a similar recent failure, pairs the fix.
 * Works for any tool type (Bash, Edit, Write, MCP, generic).
 */
export function processToolOutcome(
  toolName: string,
  toolInput: any,
  toolOutput: string,
  isError: boolean,
  sessionId: string,
): ToolOutcomeResult {
  const result: ToolOutcomeResult = { captured: false, fixPaired: false };

  try {
    // Skip own tools
    if (toolName.includes('claude-recall') || toolName.includes('claude_recall') ||
        toolName.startsWith('recall_')) return result;

    const isFail = isError || isToolFailureOutput(toolName, toolOutput);

    if (isFail) {
      storeToolFailure(toolName, toolInput, toolOutput, sessionId);
      result.captured = true;
    } else {
      // Success — check if this fixes a recent failure
      result.fixPaired = tryPairFix(toolName, toolInput, toolOutput);
    }

    // Record outcome event for all tools
    recordOutcomeEvent(toolName, toolInput, toolOutput);
  } catch (err) {
    logFn('event-processor', `processToolOutcome error: ${safeErrorMessage(err)}`);
  }

  return result;
}

function isToolFailureOutput(toolName: string, output: string): boolean {
  if (toolName === 'Bash' || toolName === 'bash') {
    return /Exit code (\d+)/.test(output) && !/Exit code 0/.test(output);
  }
  if (toolName === 'Edit' || toolName === 'Write' || toolName === 'edit' || toolName === 'write') {
    return WRITE_ERROR_PATTERNS.some(p => p.test(output));
  }
  // For other tools, only flag short error outputs (avoid false positives on long results)
  if (output.length < 500) {
    return TOOL_ERROR_PATTERNS.some(p => p.test(output));
  }
  return false;
}

function storeToolFailure(
  toolName: string,
  toolInput: any,
  output: string,
  sessionId: string,
): void {
  const filePath = toolInput?.file_path ?? '';
  const command = toolInput?.command ?? '';

  let whatFailed: string;
  if ((toolName === 'Bash' || toolName === 'bash') && command) {
    whatFailed = `Command failed: ${truncate(command, 100)}`;
  } else if (filePath) {
    whatFailed = `${toolName} failed on ${truncate(filePath, 80)}`;
  } else {
    whatFailed = `${toolName} failed`;
  }

  // Dedup
  const existing = searchExisting(whatFailed);
  if (isDuplicate(whatFailed, existing, 0.7)) return;

  const failureContent: FailureMemoryContent = {
    what_failed: whatFailed,
    why_failed: truncate(firstLine(output), 200),
    what_should_do: 'Check inputs and prerequisites before retrying',
    context: `${toolName} error`,
    preventative_checks: ['Verify inputs are correct', 'Check preconditions'],
  };

  const key = `hook_failure_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  MemoryService.getInstance().store({
    key,
    value: failureContent,
    type: 'failure',
    context: { timestamp: Date.now() },
    relevanceScore: 0.75,
  });

  // Track for fix pairing — when a similar tool succeeds, we update this memory
  const identifier = getToolIdentifier(toolName, toolInput);
  pendingFailures.push({ toolName, identifier, memoryKey: key, timestamp: Date.now() });
  while (pendingFailures.length > MAX_PENDING) pendingFailures.shift();

  logFn('event-processor', `Stored failure: ${truncate(whatFailed, 60)}`);
}

function recordOutcomeEvent(toolName: string, toolInput: any, output: string): void {
  try {
    const tags: string[] = [toolName.toLowerCase()];
    if (toolInput?.file_path) {
      const ext = (toolInput.file_path as string).split('.').pop();
      if (ext) tags.push(ext);
    }

    OutcomeStorage.getInstance().createOutcomeEvent({
      event_type: 'tool_result',
      actor: 'tool',
      action_summary: `${toolName}: ${truncate(firstLine(output), 100)}`,
      next_state_summary: truncate(firstLine(output), 200),
      tags,
    });
  } catch {
    // Non-critical
  }
}

// --- User Input Processing (Correction Detection) ---

const REASK_PATTERNS = [
  /still broken/i,
  /that'?s not what I (?:meant|asked|wanted)/i,
  /wrong file/i,
  /try again/i,
  /that didn'?t (?:work|fix|help)/i,
  /you (?:missed|forgot|ignored)/i,
];

/**
 * Process user input text — detect corrections, preferences, and reask signals.
 * Returns a summary message if something was captured, or null.
 */
export async function processUserInput(text: string, sessionId: string): Promise<string | null> {
  if (text.length < 20 || text.length > 2000) return null;
  if (text.startsWith('```') || text.startsWith('{')) return null;

  // Detect reask signals
  try {
    for (const pattern of REASK_PATTERNS) {
      if (pattern.test(text)) {
        OutcomeStorage.getInstance().createOutcomeEvent({
          event_type: 'reask_signal',
          actor: 'user',
          next_state_summary: `User reask detected: ${text.substring(0, 100)}`,
          tags: ['reask'],
        });
        break;
      }
    }
  } catch {
    // Non-critical
  }

  const result = await classifyContent(text);
  if (!result) return null;

  if (result.extract.length < 10 || result.extract.length > 200) return null;
  if ((result.type === 'correction' || result.type === 'preference') && result.confidence < 0.7) return null;
  if (result.confidence < 0.6) return null;

  // Dedup
  const existing = searchExisting(result.extract.substring(0, 100));
  if (isDuplicate(result.extract, existing)) return null;

  storeMemory(result.extract, result.type, undefined, result.confidence);

  const summary = result.extract.length > 60 ? result.extract.substring(0, 60) + '...' : result.extract;
  logFn('event-processor', `Captured ${result.type}: ${result.extract.substring(0, 80)}`);

  return `Auto-captured ${result.type}: ${summary}`;
}

// --- Session End Processing ---

/**
 * Process end-of-session: batch classify user texts, store memories,
 * run promotion cycle.
 *
 * @param userTexts Array of user message texts from the session
 * @param sessionId Current session ID
 * @param projectId Current project ID
 * @param maxStore Max memories to store (default 3)
 */
export async function processSessionEnd(
  userTexts: string[],
  sessionId: string,
  projectId: string,
  maxStore: number = 3,
): Promise<{ stored: number; promoted: number }> {
  let stored = 0;
  let promoted = 0;

  try {
    // Create episode
    const outcomeStorage = OutcomeStorage.getInstance();
    const episodeId = outcomeStorage.createEpisode({
      project_id: projectId,
      session_id: sessionId,
      source: 'session-end',
    });

    // Filter to classifiable texts
    const classifiable = userTexts
      .filter(t => t.length >= 10 && t.length <= 2000)
      .slice(-6); // last 6 entries

    if (classifiable.length > 0) {
      const results = await classifyBatch(classifiable);

      for (const result of results) {
        if (stored >= maxStore) break;
        if (!result) continue;
        if (result.extract.length < 10 || result.extract.length > 200) continue;
        if ((result.type === 'correction' || result.type === 'preference') && result.confidence < 0.7) continue;
        if (result.confidence < 0.6) continue;

        const existing = searchExisting(result.extract.substring(0, 100));
        if (isDuplicate(result.extract, existing)) continue;

        storeMemory(result.extract, result.type, projectId, result.confidence);
        stored++;
      }
    }

    // Update episode
    outcomeStorage.updateEpisode(episodeId, {
      outcome_type: stored > 0 ? 'success' : 'unclear',
      severity: 'low',
      outcome_summary: `Session end: ${stored} memories captured`,
    });

    // Run promotion cycle
    try {
      const { PromotionEngine } = await import('../services/promotion-engine');
      const result = PromotionEngine.getInstance().runCycle(projectId);
      promoted = result.promoted;
    } catch {
      // Non-critical
    }

    // Prune old data
    try {
      outcomeStorage.pruneOldData();
    } catch {
      // Non-critical
    }
  } catch (err) {
    logFn('event-processor', `processSessionEnd error: ${safeErrorMessage(err)}`);
  }

  return { stored, promoted };
}

// --- Pre-Compact Processing ---

/**
 * Aggressive memory capture before context compression.
 * Batch classifies user texts with lower confidence threshold.
 *
 * @param userTexts Array of user message texts about to be compacted
 * @param sessionId Current session ID
 * @param maxStore Max memories to store (default 5)
 */
export async function processPreCompact(
  userTexts: string[],
  sessionId: string,
  maxStore: number = 5,
): Promise<number> {
  let stored = 0;

  try {
    const classifiable = userTexts
      .filter(t => t.length >= 10 && t.length <= 2000);

    if (classifiable.length === 0) return 0;

    const results = await classifyBatch(classifiable);

    for (const result of results) {
      if (stored >= maxStore) break;
      if (!result) continue;
      if (result.extract.length < 10 || result.extract.length > 200) continue;
      if (result.confidence < 0.6) continue;

      const existing = searchExisting(result.extract.substring(0, 100));
      if (isDuplicate(result.extract, existing)) continue;

      const prefixed = `[PreCompact] ${result.extract}`;
      storeMemory(prefixed, result.type, undefined, result.confidence);
      stored++;

      logFn('event-processor', `PreCompact captured ${result.type}: ${result.extract.substring(0, 80)}`);
    }
  } catch (err) {
    logFn('event-processor', `processPreCompact error: ${safeErrorMessage(err)}`);
  }

  return stored;
}

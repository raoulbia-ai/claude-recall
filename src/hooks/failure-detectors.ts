/**
 * Transcript-based failure detectors (v0.16.0)
 *
 * Scans Claude Code transcript entries for 5 signal types that indicate
 * Claude struggled during a session:
 *   1. Non-zero exit codes from Bash commands
 *   2. Silent test failures (exit 0 but output contains FAIL)
 *   3. Edit-test cycles (edit → test → edit → test repeating 3+)
 *   4. Backtracking language ("let me try a different approach")
 *   5. Retry loops (same tool call repeated 3+ times)
 *
 * Detected failures are returned as DetectedFailure[] for storage
 * via the existing FailureMemoryContent format.
 */

import { FailureMemoryContent } from '../services/failure-extractor';
import {
  ToolInteraction,
  extractToolInteractions,
  extractAssistantTexts,
} from './shared';

export interface DetectedFailure {
  signal:
    | 'non-zero-exit'
    | 'silent-test-failure'
    | 'edit-test-cycle'
    | 'backtracking'
    | 'retry-loop'
    | 'tool_failure';
  content: FailureMemoryContent;
  confidence: number;
}

const MAX_FAILURES = 3;

// --- Detector 1: Non-zero exit codes ---

function detectNonZeroExits(
  interactions: ToolInteraction[],
  consumed: Set<number>,
): DetectedFailure[] {
  const failures: DetectedFailure[] = [];
  const seenCommands = new Map<string, DetectedFailure>();

  for (const ix of interactions) {
    if (!ix.result) continue;
    if (ix.call.name !== 'Bash') continue;
    if (!ix.result.isError) continue;
    if (consumed.has(ix.call.entryIndex)) continue;

    const output = ix.result.content;
    // Skip hook infrastructure errors
    if (output.includes('PreToolUse') || output.includes('PostToolUse')) continue;

    const exitMatch = output.match(/Exit code (\d+)/);
    if (!exitMatch) continue;

    const command = ix.call.input?.command ?? 'unknown command';
    const commandKey = command.substring(0, 200);

    const failure: DetectedFailure = {
      signal: 'non-zero-exit',
      confidence: 0.85,
      content: {
        what_failed: `Command failed: ${truncate(command, 100)}`,
        why_failed: `Exit code ${exitMatch[1]}: ${truncate(firstLine(output), 150)}`,
        what_should_do: 'Check command syntax, file paths, and prerequisites before running',
        context: `Bash command returned non-zero exit code ${exitMatch[1]}`,
        preventative_checks: [
          'Verify command arguments and paths exist',
          'Check required tools are installed',
        ],
      },
    };

    // Dedup: keep last failure per unique command
    seenCommands.set(commandKey, failure);
    consumed.add(ix.call.entryIndex);
    if (ix.result) consumed.add(ix.result.entryIndex);
  }

  failures.push(...seenCommands.values());
  return failures;
}

// --- Detector 2: Silent test failures ---

const SILENT_FAIL_PATTERNS = [
  /\bFAIL\b/,
  /AssertionError/i,
  /AssertionError/i,
  /Expected .+ but received/,
  /[✗✘]/,
  /\bFAILED\b/,
  /Tests:\s+\d+ failed/,
];

function detectSilentTestFailures(
  interactions: ToolInteraction[],
  consumed: Set<number>,
): DetectedFailure[] {
  const failures: DetectedFailure[] = [];

  for (const ix of interactions) {
    if (!ix.result) continue;
    if (ix.call.name !== 'Bash') continue;
    if (ix.result.isError) continue; // Already caught by detector 1
    if (consumed.has(ix.call.entryIndex)) continue;

    const output = ix.result.content;
    const matched = SILENT_FAIL_PATTERNS.some((p) => p.test(output));
    if (!matched) continue;

    const command = ix.call.input?.command ?? 'unknown';
    // Only detect test-like commands
    if (!isTestCommand(command)) continue;

    const failLine = output.split('\n').find((line) =>
      SILENT_FAIL_PATTERNS.some((p) => p.test(line)),
    ) ?? '';

    failures.push({
      signal: 'silent-test-failure',
      confidence: 0.80,
      content: {
        what_failed: `Test command reported failures: ${truncate(command, 100)}`,
        why_failed: truncate(failLine, 200) || 'Test output contained failure indicators',
        what_should_do: 'Read test output carefully — exit code 0 does not mean all tests passed',
        context: 'Test runner exited successfully but output contained failure markers',
        preventative_checks: [
          'Check test output for FAIL/FAILED markers even on exit 0',
          'Use --bail or strict mode to fail fast on test errors',
        ],
      },
    });
    consumed.add(ix.call.entryIndex);
    if (ix.result) consumed.add(ix.result.entryIndex);
  }

  return failures;
}

// --- Detector 3: Edit-test cycles ---

function detectEditTestCycles(
  interactions: ToolInteraction[],
  consumed: Set<number>,
): DetectedFailure[] {
  // Build sequence of (tool, hasFailure) tuples
  const seq: { type: 'test' | 'edit' | 'other'; failed: boolean; file?: string; idx: number }[] = [];

  for (const ix of interactions) {
    const name = ix.call.name;
    const command = ix.call.input?.command ?? '';

    if (name === 'Bash' && isTestCommand(command)) {
      const failed = ix.result
        ? ix.result.isError || SILENT_FAIL_PATTERNS.some((p) => p.test(ix.result!.content))
        : false;
      seq.push({ type: 'test', failed, idx: ix.call.entryIndex });
    } else if (name === 'Edit' || name === 'Write') {
      const file = ix.call.input?.file_path ?? ix.call.input?.path ?? '';
      seq.push({ type: 'edit', failed: false, file, idx: ix.call.entryIndex });
    } else {
      seq.push({ type: 'other', failed: false, idx: ix.call.entryIndex });
    }
  }

  // Scan for test → edit → test → edit → test (3+ test runs with edits between)
  let cycleCount = 0;
  let cycleStart = -1;
  let lastType: 'test' | 'edit' | 'other' = 'other';
  let testFailCount = 0;
  const modifiedFiles = new Set<string>();
  const cycleIndices: number[] = [];

  for (let i = 0; i < seq.length; i++) {
    const s = seq[i];
    if (s.type === 'test' && s.failed) {
      if (lastType === 'edit' || cycleCount === 0) {
        cycleCount++;
        if (cycleStart === -1) cycleStart = i;
        testFailCount++;
        cycleIndices.push(s.idx);
      }
      lastType = 'test';
    } else if (s.type === 'edit' && lastType === 'test') {
      lastType = 'edit';
      if (s.file) modifiedFiles.add(s.file);
      cycleIndices.push(s.idx);
    } else if (s.type === 'test' && !s.failed && lastType === 'edit' && cycleCount >= 2) {
      // Resolved after cycles — still worth recording
      cycleCount++;
      cycleIndices.push(s.idx);
      break;
    } else {
      // Break in pattern — evaluate what we have, then reset
      if (cycleCount >= 3) break;
      cycleCount = 0;
      cycleStart = -1;
      lastType = 'other';
      testFailCount = 0;
      modifiedFiles.clear();
      cycleIndices.length = 0;
    }
  }

  if (cycleCount < 3) return [];

  // Check consumed
  if (cycleIndices.some((idx) => consumed.has(idx))) return [];
  for (const idx of cycleIndices) consumed.add(idx);

  const files = [...modifiedFiles].map((f) => f.split('/').pop()).join(', ');

  return [{
    signal: 'edit-test-cycle',
    confidence: 0.75,
    content: {
      what_failed: `Edit-test cycle repeated ${cycleCount} times${files ? ` on ${truncate(files, 80)}` : ''}`,
      why_failed: `${testFailCount} consecutive test failures required multiple code edits`,
      what_should_do: 'Read the full error message before editing. Consider a different approach after 2 failures.',
      context: `Detected ${cycleCount}-iteration edit-test cycle`,
      preventative_checks: [
        'After 2 failed attempts, re-read the error and reconsider the approach',
        'Run smaller, targeted tests instead of full suite during debugging',
      ],
    },
  }];
}

// --- Detector 4: Backtracking language ---

const BACKTRACKING_PHRASES = [
  /let me try a different approach/i,
  /that didn'?t work/i,
  /actually,?\s+let me/i,
  /actually,?\s+I need to/i,
  /scratch that/i,
  /instead,?\s+let me/i,
  /going back to/i,
  /let me reconsider/i,
  /let me try (?:something|another)/i,
  /that approach (?:didn'?t|doesn'?t|won'?t) work/i,
];

function detectBacktracking(
  entries: object[],
  consumed: Set<number>,
): DetectedFailure[] {
  const texts = extractAssistantTexts(entries);
  const matches: { phrase: string; context: string; entryIndex: number }[] = [];

  for (const { text, entryIndex } of texts) {
    if (consumed.has(entryIndex)) continue;
    for (const pattern of BACKTRACKING_PHRASES) {
      const m = text.match(pattern);
      if (m) {
        const matchPos = m.index ?? 0;
        const before = text.substring(Math.max(0, matchPos - 100), matchPos).trim();
        const after = text.substring(matchPos + m[0].length, matchPos + m[0].length + 100).trim();
        matches.push({
          phrase: m[0],
          context: `${before} [...] ${after}`,
          entryIndex,
        });
        break; // One match per text block
      }
    }
  }

  if (matches.length === 0) return [];

  // Group matches within 5 entry indices of each other
  const groups: typeof matches[] = [];
  let currentGroup: typeof matches = [matches[0]];

  for (let i = 1; i < matches.length; i++) {
    if (matches[i].entryIndex - currentGroup[currentGroup.length - 1].entryIndex <= 5) {
      currentGroup.push(matches[i]);
    } else {
      groups.push(currentGroup);
      currentGroup = [matches[i]];
    }
  }
  groups.push(currentGroup);

  const failures: DetectedFailure[] = [];
  for (const group of groups) {
    const representative = group[0];
    if (consumed.has(representative.entryIndex)) continue;
    for (const m of group) consumed.add(m.entryIndex);

    failures.push({
      signal: 'backtracking',
      confidence: 0.65,
      content: {
        what_failed: `Claude backtracked: "${truncate(representative.phrase, 60)}"`,
        why_failed: `Initial approach didn't work, requiring a course correction`,
        what_should_do: 'Consider the problem more carefully before starting. Check for similar past failures.',
        context: truncate(representative.context, 200),
        preventative_checks: [
          'Verify assumptions before implementing',
          'Check existing code patterns before trying a new approach',
        ],
      },
    });
  }

  return failures;
}

// --- Detector 5: Retry loops ---

function detectRetryLoops(
  interactions: ToolInteraction[],
  consumed: Set<number>,
): DetectedFailure[] {
  const WINDOW = 10;
  const failures: DetectedFailure[] = [];

  if (interactions.length === 0) return failures;

  const windowCount = Math.max(1, interactions.length - WINDOW + 1);
  for (let start = 0; start < windowCount; start++) {
    const window = interactions.slice(start, start + WINDOW);
    const hashes: { hash: string; ix: ToolInteraction }[] = [];

    for (const ix of window) {
      // Exclude Read calls — normal to read files repeatedly
      if (ix.call.name === 'Read') continue;
      if (consumed.has(ix.call.entryIndex)) continue;
      const hash = `${ix.call.name}:${JSON.stringify(ix.call.input)}`;
      hashes.push({ hash, ix });
    }

    // Count occurrences
    const counts = new Map<string, ToolInteraction[]>();
    for (const { hash, ix } of hashes) {
      const list = counts.get(hash) ?? [];
      list.push(ix);
      counts.set(hash, list);
    }

    for (const [hash, ixList] of counts) {
      if (ixList.length < 3) continue;
      // All already consumed?
      if (ixList.every((ix) => consumed.has(ix.call.entryIndex))) continue;

      for (const ix of ixList) consumed.add(ix.call.entryIndex);

      const toolName = ixList[0].call.name;
      const input = truncate(JSON.stringify(ixList[0].call.input), 100);

      failures.push({
        signal: 'retry-loop',
        confidence: 0.70,
        content: {
          what_failed: `${toolName} called ${ixList.length} times with identical arguments`,
          why_failed: `Repeated the same action expecting different results`,
          what_should_do: 'If a tool call fails, investigate the error rather than retrying the same command',
          context: `Retry loop detected: ${toolName}(${input})`,
          preventative_checks: [
            'After 2 identical failures, try a different approach',
            'Read error output carefully before retrying',
          ],
        },
      });
      // Only report first retry loop found per window
      break;
    }

    if (failures.length > 0) break; // One retry loop per session is enough
  }

  return failures;
}

// --- Orchestrator ---

export function detectTranscriptFailures(entries: object[]): DetectedFailure[] {
  if (entries.length === 0) return [];

  const interactions = extractToolInteractions(entries);
  const consumed = new Set<number>();
  const allFailures: DetectedFailure[] = [];

  // Run detectors in priority order.
  // Edit-test cycles run before silent test failures to avoid consuming
  // individual test failures that are part of a larger cycle pattern.
  const detectors: (() => DetectedFailure[])[] = [
    () => detectNonZeroExits(interactions, consumed),
    () => detectEditTestCycles(interactions, consumed),
    () => detectSilentTestFailures(interactions, consumed),
    () => detectBacktracking(entries, consumed),
    () => detectRetryLoops(interactions, consumed),
  ];

  for (const detect of detectors) {
    if (allFailures.length >= MAX_FAILURES) break;
    const results = detect();
    for (const r of results) {
      if (allFailures.length >= MAX_FAILURES) break;
      allFailures.push(r);
    }
  }

  return allFailures;
}

// --- Helpers ---

function isTestCommand(command: string): boolean {
  const lower = command.toLowerCase();
  return /\b(test|jest|pytest|cargo\s+test|go\s+test|vitest|mocha|rspec|phpunit)\b/.test(lower);
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.substring(0, maxLen - 3) + '...';
}

function firstLine(s: string): string {
  const idx = s.indexOf('\n');
  return idx === -1 ? s : s.substring(0, idx);
}

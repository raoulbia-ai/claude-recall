/**
 * Bash Failure Watcher — PostToolUse hook (v0.17.0)
 *
 * Captures bash command failures immediately after they happen (not at session end).
 * When a previously failed command succeeds, pairs the fix with the failure record.
 *
 * Input (PostToolUse stdin from Claude Code):
 * {
 *   "tool_name": "Bash",
 *   "tool_input": { "command": "npm test" },
 *   "tool_output": "... Exit code 1 ...",
 *   "session_id": "abc-123"
 * }
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FailureMemoryContent } from '../services/failure-extractor';
import {
  hookLog,
  storeMemory,
  searchExisting,
  isDuplicate,
  jaccardSimilarity,
} from './shared';
import { MemoryService } from '../services/memory';

const HOOK_NAME = 'bash-failure-watcher';
const EXIT_CODE_REGEX = /Exit code (\d+)/;
const MAX_PENDING = 5;
const FIX_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const FIX_JACCARD_THRESHOLD = 0.3;

export interface PendingFailure {
  command: string;
  memoryKey: string;
  timestamp: number;
}

function getStateDir(): string {
  return path.join(os.homedir(), '.claude-recall', 'hook-state');
}

function getStatePath(sessionId: string): string {
  return path.join(getStateDir(), `${sessionId}-failures.json`);
}

function readPendingFailures(sessionId: string): PendingFailure[] {
  try {
    const statePath = getStatePath(sessionId);
    if (!fs.existsSync(statePath)) return [];
    const data = fs.readFileSync(statePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function writePendingFailures(sessionId: string, pending: PendingFailure[]): void {
  try {
    const stateDir = getStateDir();
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }
    fs.writeFileSync(getStatePath(sessionId), JSON.stringify(pending));
  } catch {
    // Never fail on state file writes
  }
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.substring(0, maxLen - 3) + '...';
}

function firstLine(s: string): string {
  const idx = s.indexOf('\n');
  return idx === -1 ? s : s.substring(0, idx);
}

export async function handleBashFailureWatcher(input: any): Promise<void> {
  try {
    if (!input || typeof input !== 'object') return;

    const toolName = input.tool_name;
    if (toolName !== 'Bash') return;

    const command = input.tool_input?.command;
    if (!command || typeof command !== 'string' || command.length < 3) return;

    const output = input.tool_output ?? '';
    const sessionId = input.session_id ?? 'unknown';

    // Skip hook infrastructure errors
    if (output.includes('PreToolUse') || output.includes('PostToolUse')) return;

    const exitMatch = output.match(EXIT_CODE_REGEX);
    const isFailure = exitMatch && exitMatch[1] !== '0';

    if (isFailure) {
      await handleFailure(command, exitMatch![1], output, sessionId);
    } else {
      await handleSuccess(command, sessionId);
    }
  } catch (err) {
    hookLog(HOOK_NAME, `Error: ${err}`);
    // Never throw — hooks must not block Claude
  }
}

async function handleFailure(
  command: string,
  exitCode: string,
  output: string,
  sessionId: string,
): Promise<void> {
  // Dedup check
  const existing = searchExisting(command);
  if (isDuplicate(command, existing, 0.7)) {
    hookLog(HOOK_NAME, `Skipped duplicate: ${truncate(command, 60)}`);
    return;
  }

  const failureContent: FailureMemoryContent = {
    what_failed: `Command failed: ${truncate(command, 100)}`,
    why_failed: `Exit code ${exitCode}: ${truncate(firstLine(output), 150)}`,
    what_should_do: 'Check command syntax, file paths, and prerequisites before running',
    context: `Bash command returned non-zero exit code ${exitCode}`,
    preventative_checks: [
      'Verify command arguments and paths exist',
      'Check required tools are installed',
    ],
  };

  const key = `hook_failure_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const memoryService = MemoryService.getInstance();
  memoryService.store({
    key,
    value: failureContent,
    type: 'failure',
    context: { timestamp: Date.now() },
    relevanceScore: 0.85,
  });

  hookLog(HOOK_NAME, `Stored failure: ${truncate(command, 60)} (exit ${exitCode})`);

  // Track pending failure for fix pairing
  const pending = readPendingFailures(sessionId);
  pending.push({ command, memoryKey: key, timestamp: Date.now() });

  // Keep max 5, evict oldest
  while (pending.length > MAX_PENDING) {
    pending.shift();
  }
  writePendingFailures(sessionId, pending);

  // Notify Claude
  console.log(`⚠️ Failure stored: "${truncate(command, 60)}" (exit ${exitCode}). Use search_memory for similar past failures.`);
}

async function handleSuccess(command: string, sessionId: string): Promise<void> {
  const pending = readPendingFailures(sessionId);
  if (pending.length === 0) return;

  const now = Date.now();
  let matched = false;

  // Filter expired and find matches
  const remaining: PendingFailure[] = [];
  for (const pf of pending) {
    if (now - pf.timestamp > FIX_WINDOW_MS) {
      // Expired — evict
      continue;
    }
    if (!matched && jaccardSimilarity(pf.command, command) >= FIX_JACCARD_THRESHOLD) {
      // Match found — update the failure memory with the fix
      try {
        const memoryService = MemoryService.getInstance();
        memoryService.update(pf.memoryKey, {
          value: {
            what_should_do: `Fix: ${truncate(command, 200)}`,
          },
        });
        hookLog(HOOK_NAME, `Paired fix: "${truncate(command, 60)}" → ${pf.memoryKey}`);
        matched = true;
        // Don't add to remaining — consumed
      } catch (err) {
        hookLog(HOOK_NAME, `Fix pairing error: ${err}`);
        remaining.push(pf);
      }
    } else {
      remaining.push(pf);
    }
  }

  writePendingFailures(sessionId, remaining);
}

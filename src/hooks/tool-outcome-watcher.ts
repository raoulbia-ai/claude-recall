/**
 * Tool Outcome Watcher — PostToolUse hook (v0.19.0)
 *
 * Captures tool outcomes for ALL tools (not just Bash).
 * Extends the original bash-failure-watcher with tool-specific handlers.
 *
 * Input (PostToolUse stdin from Claude Code):
 * {
 *   "tool_name": "Bash" | "Edit" | "Write" | "Grep" | "mcp__*" | ...,
 *   "tool_input": { ... },
 *   "tool_output": "...",
 *   "session_id": "abc-123"
 * }
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FailureMemoryContent } from '../services/failure-extractor';
import {
  hookLog,
  safeErrorMessage,
  storeMemory,
  searchExisting,
  isDuplicate,
  jaccardSimilarity,
} from './shared';
import { MemoryService } from '../services/memory';
import { OutcomeStorage } from '../services/outcome-storage';

const HOOK_NAME = 'tool-outcome-watcher';
const EXIT_CODE_REGEX = /Exit code (\d+)/;
const MAX_PENDING = 5;
const FIX_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const FIX_JACCARD_THRESHOLD = 0.3;

// Error patterns for Edit/Write tools
const WRITE_ERROR_PATTERNS = [
  /permission denied/i,
  /EACCES/i,
  /ENOENT/i,
  /file not found/i,
  /no such file/i,
  /is a directory/i,
  /read-?only file/i,
  /conflict/i,
  /old_string.*not found/i,
  /not unique in the file/i,
];

// Error patterns for MCP tools
const MCP_ERROR_PATTERNS = [
  /error/i,
  /failed/i,
  /exception/i,
  /timeout/i,
];

export interface PendingFailure {
  command: string;
  memoryKey: string;
  timestamp: number;
}

// --- State management (Bash fix pairing only) ---

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

/**
 * Extract tags from a tool name and input.
 */
function extractToolTags(toolName: string, toolInput: any): string[] {
  const tags: string[] = [];

  if (toolName === 'Bash') {
    const cmd = toolInput?.command || '';
    const parts = cmd.trim().split(/\s+/).filter(Boolean);
    for (const part of parts) {
      if (part.startsWith('-')) continue;
      if (part.includes('/') && part.length > 20) continue;
      tags.push(part.toLowerCase());
      if (tags.length >= 2) break;
    }
  } else {
    tags.push(toolName.toLowerCase());
    if (toolInput?.file_path) {
      const ext = path.extname(toolInput.file_path).replace('.', '');
      if (ext) tags.push(ext);
    }
  }

  return tags;
}

/**
 * Create an outcome event for any tool.
 */
function recordOutcomeEvent(
  toolName: string,
  toolInput: any,
  summary: string,
  exitCode?: number,
): void {
  try {
    const outcomeStorage = OutcomeStorage.getInstance();
    outcomeStorage.createOutcomeEvent({
      event_type: 'tool_result',
      actor: 'tool',
      action_summary: `${toolName}: ${truncate(summary, 100)}`,
      next_state_summary: truncate(summary, 200),
      exit_code: exitCode,
      tags: extractToolTags(toolName, toolInput),
    });
  } catch (err) {
    hookLog(HOOK_NAME, `Outcome event error: ${safeErrorMessage(err)}`);
  }
}

// --- Main dispatcher ---

export async function handleToolOutcomeWatcher(input: any): Promise<void> {
  try {
    if (!input || typeof input !== 'object') return;

    const toolName = input.tool_name;
    if (!toolName || typeof toolName !== 'string') return;

    switch (toolName) {
      case 'Bash':
        return handleBashOutcome(input);
      case 'Edit':
      case 'Write':
        return handleWriteToolOutcome(input);
      default:
        if (toolName.startsWith('mcp__')) return handleMcpToolOutcome(input);
        return handleGenericToolOutcome(input);
    }
  } catch (err) {
    hookLog(HOOK_NAME, `Error: ${safeErrorMessage(err)}`);
    // Never throw — hooks must not block Claude
  }
}

// Backward compatibility alias
export const handleBashFailureWatcher = handleToolOutcomeWatcher;

// --- Bash handler (original bash-failure-watcher logic) ---

async function handleBashOutcome(input: any): Promise<void> {
  const command = input.tool_input?.command;
  if (!command || typeof command !== 'string' || command.length < 3) return;

  const output = input.tool_output ?? '';
  const sessionId = input.session_id ?? 'unknown';

  // Skip hook infrastructure errors
  if (output.includes('PreToolUse') || output.includes('PostToolUse')) return;

  const exitMatch = output.match(EXIT_CODE_REGEX);
  const isFailure = exitMatch && exitMatch[1] !== '0';

  if (isFailure) {
    await handleBashFailure(command, exitMatch![1], output, sessionId);
  } else {
    await handleBashSuccess(command, sessionId);
  }
}

async function handleBashFailure(
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
    value: {
      content: `${failureContent.what_failed}. ${failureContent.why_failed}`,
      ...failureContent,
    },
    type: 'failure',
    context: { timestamp: Date.now() },
    relevanceScore: 0.85,
  });

  // Write outcome event
  recordOutcomeEvent('Bash', { command }, `Exit code ${exitCode}: ${truncate(firstLine(output), 150)}`, parseInt(exitCode));

  hookLog(HOOK_NAME, `Stored failure: ${truncate(command, 60)} (exit ${exitCode})`);

  // Track pending failure for fix pairing
  const pending = readPendingFailures(sessionId);
  pending.push({ command, memoryKey: key, timestamp: Date.now() });
  while (pending.length > MAX_PENDING) {
    pending.shift();
  }
  writePendingFailures(sessionId, pending);

  console.log(`⚠️ Failure stored: "${truncate(command, 60)}" (exit ${exitCode}). Use search_memory for similar past failures.`);
}

async function handleBashSuccess(command: string, sessionId: string): Promise<void> {
  const pending = readPendingFailures(sessionId);
  if (pending.length === 0) return;

  const now = Date.now();
  let matched = false;

  const remaining: PendingFailure[] = [];
  for (const pf of pending) {
    if (now - pf.timestamp > FIX_WINDOW_MS) {
      continue;
    }
    if (!matched && jaccardSimilarity(pf.command, command) >= FIX_JACCARD_THRESHOLD) {
      try {
        const memoryService = MemoryService.getInstance();
        memoryService.update(pf.memoryKey, {
          value: { what_should_do: `Fix: ${truncate(command, 200)}` },
        });
        recordOutcomeEvent('Bash', { command }, `Success after previous failure: ${truncate(pf.command, 100)}`, 0);
        hookLog(HOOK_NAME, `Paired fix: "${truncate(command, 60)}" → ${pf.memoryKey}`);
        console.log(`✅ Recall: fix paired — "${truncate(command, 40)}" (learned from previous failure)`);
        matched = true;
      } catch (err) {
        hookLog(HOOK_NAME, `Fix pairing error: ${safeErrorMessage(err)}`);
        remaining.push(pf);
      }
    } else {
      remaining.push(pf);
    }
  }

  writePendingFailures(sessionId, remaining);
}

// --- Edit/Write handler ---

async function handleWriteToolOutcome(input: any): Promise<void> {
  const output = input.tool_output ?? '';
  const toolName = input.tool_name;
  const filePath = input.tool_input?.file_path ?? '';
  const sessionId = input.session_id ?? 'unknown';

  // Check for error patterns
  const errorMatch = WRITE_ERROR_PATTERNS.find(p => p.test(output));

  if (errorMatch) {
    // Dedup check
    const summary = `${toolName} failed on ${filePath}: ${truncate(firstLine(output), 100)}`;
    const existing = searchExisting(summary);
    if (isDuplicate(summary, existing, 0.7)) {
      hookLog(HOOK_NAME, `Skipped duplicate ${toolName} failure`);
      return;
    }

    const failureContent: FailureMemoryContent = {
      what_failed: `${toolName} failed on ${truncate(filePath, 80)}`,
      why_failed: truncate(firstLine(output), 200),
      what_should_do: `Verify file path exists and is writable before using ${toolName}`,
      context: `${toolName} tool error on ${filePath}`,
      preventative_checks: [
        'Check file path exists',
        'Check file permissions',
        'Verify old_string is unique (for Edit)',
      ],
    };

    storeMemory(JSON.stringify(failureContent), 'failure', undefined, 0.75);
    hookLog(HOOK_NAME, `Stored ${toolName} failure: ${truncate(filePath, 60)}`);
  }

  // Always record outcome event
  const eventSummary = errorMatch
    ? `${toolName} error on ${filePath}: ${truncate(firstLine(output), 100)}`
    : `${toolName} success on ${truncate(filePath, 100)}`;
  recordOutcomeEvent(toolName, input.tool_input, eventSummary);
}

// --- MCP tool handler ---

async function handleMcpToolOutcome(input: any): Promise<void> {
  const output = input.tool_output ?? '';
  const toolName = input.tool_name;
  const sessionId = input.session_id ?? 'unknown';

  // Skip Claude Recall's own tools to avoid self-referential loops
  if (toolName.includes('claude-recall') || toolName.includes('claude_recall')) return;

  const outputStr = typeof output === 'string' ? output : JSON.stringify(output);
  const hasError = MCP_ERROR_PATTERNS.some(p => p.test(outputStr)) && outputStr.length < 500;

  if (hasError) {
    const summary = `${toolName}: ${truncate(firstLine(outputStr), 100)}`;
    const existing = searchExisting(summary);
    if (!isDuplicate(summary, existing, 0.7)) {
      storeMemory(
        JSON.stringify({
          what_failed: `MCP tool ${toolName} returned error`,
          why_failed: truncate(firstLine(outputStr), 200),
          what_should_do: 'Check tool input parameters and server availability',
          context: `MCP tool error from ${toolName}`,
        }),
        'failure',
        undefined,
        0.7,
      );
      hookLog(HOOK_NAME, `Stored MCP failure: ${truncate(toolName, 40)}`);
    }
  }

  // Record outcome event for all MCP tool calls
  recordOutcomeEvent(toolName, input.tool_input, truncate(firstLine(outputStr), 200));
}

// --- Generic handler (all other tools) ---

async function handleGenericToolOutcome(input: any): Promise<void> {
  const toolName = input.tool_name;
  const output = input.tool_output ?? '';
  const outputStr = typeof output === 'string' ? output : JSON.stringify(output);

  // Outcome event only — no memory storage for generic tools
  recordOutcomeEvent(toolName, input.tool_input, truncate(firstLine(outputStr), 200));
}

// --- PostToolUseFailure handler ---

/**
 * Handle PostToolUseFailure events. These have a structured `error` field
 * from Claude Code — more reliable than parsing tool_output for errors.
 *
 * Input: { tool_name, tool_input, error, tool_use_id, session_id }
 */
export async function handleToolFailure(input: any): Promise<void> {
  try {
    if (!input || typeof input !== 'object') return;

    const toolName = input.tool_name;
    const error = input.error;
    if (!toolName || typeof toolName !== 'string') return;
    if (!error || typeof error !== 'string') return;

    // Skip claude-recall's own tools
    if (toolName.includes('claude-recall') || toolName.includes('claude_recall')) return;

    // Skip user interrupts
    if (input.is_interrupt) return;

    const filePath = input.tool_input?.file_path ?? '';
    const command = input.tool_input?.command ?? '';

    // Build tool-specific context
    let whatFailed: string;
    let context: string;
    if (toolName === 'Bash' && command) {
      whatFailed = `Bash command failed: ${truncate(command, 100)}`;
      context = `Bash error: ${truncate(error, 200)}`;
    } else if ((toolName === 'Edit' || toolName === 'Write') && filePath) {
      whatFailed = `${toolName} failed on ${truncate(filePath, 80)}`;
      context = `${toolName} error: ${truncate(error, 200)}`;
    } else {
      whatFailed = `${toolName} failed`;
      context = `Error: ${truncate(error, 200)}`;
    }

    // Dedup check
    const existing = searchExisting(whatFailed);
    if (isDuplicate(whatFailed, existing, 0.7)) {
      hookLog(HOOK_NAME, `Skipped duplicate failure: ${truncate(whatFailed, 60)}`);
      return;
    }

    const failureContent: FailureMemoryContent = {
      what_failed: whatFailed,
      why_failed: truncate(error, 200),
      what_should_do: 'Check inputs and prerequisites before retrying',
      context,
      preventative_checks: ['Verify tool inputs are correct', 'Check preconditions'],
    };

    storeMemory(JSON.stringify(failureContent), 'failure', undefined, 0.8);

    // Record structured outcome event
    try {
      const outcomeStorage = OutcomeStorage.getInstance();
      outcomeStorage.createOutcomeEvent({
        event_type: 'tool_failure',
        actor: 'tool',
        action_summary: whatFailed,
        next_state_summary: truncate(error, 200),
        tags: extractToolTags(toolName, input.tool_input),
      });
    } catch (err) {
      hookLog(HOOK_NAME, `Failure outcome event error: ${safeErrorMessage(err)}`);
    }

    hookLog(HOOK_NAME, `Stored tool failure: ${truncate(whatFailed, 60)}`);
  } catch (err) {
    hookLog(HOOK_NAME, `handleToolFailure error: ${safeErrorMessage(err)}`);
  }
}

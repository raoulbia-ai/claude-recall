import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MemoryService } from '../services/memory';
import { ConfigService } from '../services/config';
import { ScoredMemory } from '../core/retrieval';
import { classifyWithLLM, classifyBatchWithLLM } from './llm-classifier';

export interface ClassifyResult {
  type: string;
  confidence: number;
  extract: string;
}

// NOTE on confidence calibration: consumers (correction-detector, memory-stop,
// event-processors) gate corrections/preferences/devops at >= 0.75. Any
// pattern below that threshold can never store anything — don't add one.
// (The previous list carried eight 0.7-confidence patterns that were silently
// dead for exactly this reason; the weak ones — "actually", "I like",
// "I want", "I use" — were deleted rather than promoted because they match
// ordinary conversation far too often.)
const CORRECTION_PATTERNS = [
  { regex: /^no[,.]?\s+(.+)/i, confidence: 0.8 },
  { regex: /^wrong[,.]?\s+(.+)/i, confidence: 0.8 },
  { regex: /\bnever\s+(.+)/i, confidence: 0.75 },
  { regex: /\bdon'?t\s+ever\s+(.+)/i, confidence: 0.8 },
  { regex: /\bstop\s+(doing|using|adding)\s+(.+)/i, confidence: 0.75 },
];

const PREFERENCE_PATTERNS = [
  // "remember ..." / "recall ..." are explicit store requests in any phrasing —
  // "remember that X", "remember to X", "remember my favourite color is green",
  // "recall my favourite color is green". This is the resilient (no-LLM,
  // no-MCP) capture path, which matters under enterprise Kiro governance that
  // blocks the MCP tools. The interrogative/question-mark guards below keep
  // "do you remember that config file?" / "do you recall X?" out.
  { regex: /\b(?:remember|recall)\s+(?:that\s+|this\s+|to\s+)?(.+)/i, confidence: 0.8 },
  { regex: /\bfrom\s+now\s+on[,.]?\s+(.+)/i, confidence: 0.8 },
  { regex: /\bgoing\s+forward[,.]?\s+(.+)/i, confidence: 0.8 },
  { regex: /\balways\s+(.+)/i, confidence: 0.75 },
  { regex: /\bI\s+prefer\s+(.+)/i, confidence: 0.75 },
];

// Questions are never rules ("do you remember that config file we used?" must
// not become a stored preference), and "no ..." pleasantries are not
// corrections ("no worries, that looks good").
const INTERROGATIVE_START = /^(do|does|did|can|could|would|should|shall|is|are|was|were|will|have|has|what|why|how|when|where|who|which)\b/i;
const PLEASANTRY_NO = /^no\s+(worries|problem|problems|prob|thanks|thank|rush|need|biggie|sweat|pressure)\b/i;

// Failure, devops, and project-knowledge patterns removed — single-keyword
// matches ("error", "git", "build") are too broad for regex. These types
// require context that only the LLM classifier can assess. When the LLM is
// unavailable, regex fallback only captures corrections and preferences.

/**
 * Read and parse JSON from stdin (synchronous for reliability with piped data).
 */
export function readStdin(): any {
  const data = fs.readFileSync(0, 'utf-8').trim();
  if (!data) throw new Error('Empty stdin');
  return JSON.parse(data);
}

/**
 * Classify text content by regex patterns only.
 * Returns the highest-confidence match, prioritizing corrections > preferences.
 */
export function classifyContentRegex(text: string): ClassifyResult | null {
  const trimmed = text.trim();

  // Interrogatives and pleasantries are conversation, not rules
  if (trimmed.endsWith('?') || INTERROGATIVE_START.test(trimmed) || PLEASANTRY_NO.test(trimmed)) {
    return null;
  }

  // Priority order: correction > preference > failure > devops > project-knowledge
  for (const p of CORRECTION_PATTERNS) {
    const m = text.match(p.regex);
    if (m) {
      const extract = m[m.length - 1] || text;
      return { type: 'correction', confidence: p.confidence, extract: extract.trim() };
    }
  }

  for (const p of PREFERENCE_PATTERNS) {
    const m = text.match(p.regex);
    if (m) {
      const extract = m[1] || text;
      return { type: 'preference', confidence: p.confidence, extract: extract.trim() };
    }
  }

  // Failure, devops, project-knowledge: LLM-only (no regex fallback)
  return null;
}

/**
 * Classify text content — LLM-first, regex fallback.
 * Precedence:
 *   1. Claude Haiku via ANTHROPIC_API_KEY (Claude Code sets this automatically).
 *   2. Kiro's headless LLM (`kiro-cli chat --no-interactive`) when running under
 *      Kiro — no API key needed. Gated on CLAUDE_RECALL_KIRO_CLASSIFIER, which
 *      the kiro-capture-worker sets; the classify call is ~3s so it only runs
 *      from that detached worker, never inline. See docs/kiro-llm-capture.md.
 *   3. Regex patterns, if neither LLM path yields a result.
 */
export async function classifyContent(text: string): Promise<ClassifyResult | null> {
  const llmResult = await classifyWithLLM(text);
  if (llmResult) return llmResult;

  if (process.env.CLAUDE_RECALL_KIRO_CLASSIFIER) {
    // Dynamic import keeps kiro-classifier (and child_process) out of the
    // module graph for every non-Kiro hook invocation.
    const { classifyWithKiro } = await import('./kiro-classifier');
    const kiroResult = await classifyWithKiro(text);
    if (kiroResult) return kiroResult;
  }

  return classifyContentRegex(text);
}

/**
 * Classify multiple texts — single LLM API call, regex fallback per item.
 */
export async function classifyBatch(texts: string[]): Promise<(ClassifyResult | null)[]> {
  const llmResults = await classifyBatchWithLLM(texts);
  if (llmResults) return llmResults;
  // Fallback: classify each with regex
  return texts.map((t) => classifyContentRegex(t));
}

/**
 * Word-level Jaccard similarity coefficient.
 */
export function jaccardSimilarity(a: string, b: string): number {
  // Tokenize: lowercase, replace non-alphanumeric with spaces, split on whitespace
  const tokenize = (s: string) =>
    new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
  const wordsA = tokenize(a);
  const wordsB = tokenize(b);
  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Check if content is a near-duplicate of any existing memory.
 */
export function isDuplicate(
  content: string,
  existingMemories: ScoredMemory[],
  threshold: number = 0.7
): boolean {
  for (const mem of existingMemories) {
    const memContent = typeof mem.value === 'string'
      ? mem.value
      : JSON.stringify(mem.value);
    if (jaccardSimilarity(content, memContent) >= threshold) {
      return true;
    }
  }
  return false;
}

/**
 * Store a memory via MemoryService (in-process, no subprocess).
 */
export function storeMemory(
  content: string,
  type: string,
  projectId?: string,
  confidence: number = 0.8,
): void {
  const memoryService = MemoryService.getInstance();
  const key = `hook_${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  memoryService.store({
    key,
    value: {
      content,
      confidence,
      source: 'hook-auto-capture',
      timestamp: Date.now(),
    },
    type,
    context: {
      projectId: projectId || ConfigService.getInstance().getProjectId(),
      timestamp: Date.now(),
    },
    relevanceScore: confidence,
  });
}

/**
 * Search existing memories for dedup comparison.
 */
export function searchExisting(query: string): ScoredMemory[] {
  const memoryService = MemoryService.getInstance();
  return memoryService.search(query);
}

/**
 * Base data directory — same as the database. The env override keeps tests
 * (and custom setups) away from the real ~/.claude-recall.
 */
export function claudeRecallDir(): string {
  return process.env.CLAUDE_RECALL_DB_PATH || path.join(os.homedir(), '.claude-recall');
}

/**
 * Directory for per-session hook state files (pending failures, debounce
 * markers). Created on demand.
 */
export function hookStateDir(): string {
  const dir = path.join(claudeRecallDir(), 'hook-state');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Extract a safe error message without exposing stack traces or internal paths.
 */
export function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'unknown error';
}

/**
 * Append a log line to ~/.claude-recall/hook-logs/{hookName}.log
 */
export function hookLog(hookName: string, message: string): void {
  try {
    const logDir = path.join(claudeRecallDir(), 'hook-logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logFile = path.join(logDir, `${hookName}.log`);
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`);
  } catch {
    // Never fail on logging
  }
}

/**
 * Read the last N lines from a JSONL transcript file.
 */
export function readTranscriptTail(transcriptPath: string, n: number): object[] {
  try {
    if (!fs.existsSync(transcriptPath)) return [];
    const content = fs.readFileSync(transcriptPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const tail = lines.slice(-n);
    const entries: object[] = [];
    for (const line of tail) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Skip unparseable lines
      }
    }
    return entries;
  } catch {
    return [];
  }
}

/**
 * Check if a transcript entry is from the user (not the assistant).
 * Hooks should only classify user messages — assistant responses are not
 * user preferences, corrections, or decisions worth storing.
 */
export function isUserEntry(entry: any): boolean {
  if (entry?.role === 'user') return true;
  if (entry?.message?.role === 'user') return true;
  if (entry?.type === 'human') return true;
  return false;
}

/**
 * Extract readable text from a transcript JSONL entry.
 * Handles various shapes: assistant messages, user messages, tool results, etc.
 */
// --- Transcript tool interaction types and helpers ---

export interface ToolCall {
  id: string;
  name: string;
  input: any;
  entryIndex: number;
}

export interface ToolResult {
  toolUseId: string;
  content: string;
  isError: boolean;
  entryIndex: number;
}

export interface ToolInteraction {
  call: ToolCall;
  result: ToolResult | null;
}

/**
 * Extract tool_use blocks from an assistant entry.
 */
export function extractToolCalls(entry: any, entryIndex: number): ToolCall[] {
  const content = entry?.message?.content ?? entry?.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((block: any) => block.type === 'tool_use')
    .map((block: any) => ({
      id: block.id,
      name: block.name,
      input: block.input,
      entryIndex,
    }));
}

/**
 * Extract tool_result blocks from a user entry.
 */
export function extractToolResults(entry: any, entryIndex: number): ToolResult[] {
  const content = entry?.message?.content ?? entry?.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((block: any) => block.type === 'tool_result')
    .map((block: any) => {
      let text = '';
      if (typeof block.content === 'string') {
        text = block.content;
      } else if (Array.isArray(block.content)) {
        text = block.content
          .filter((c: any) => c.type === 'text' && typeof c.text === 'string')
          .map((c: any) => c.text)
          .join('\n');
      }
      return {
        toolUseId: block.tool_use_id,
        content: text,
        isError: block.is_error === true,
        entryIndex,
      };
    });
}

/**
 * Pair tool calls with their results by tool_use_id.
 */
export function extractToolInteractions(entries: object[]): ToolInteraction[] {
  const calls: ToolCall[] = [];
  const results = new Map<string, ToolResult>();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] as any;
    const role = entry?.message?.role ?? entry?.role;
    if (role === 'assistant') {
      calls.push(...extractToolCalls(entry, i));
    } else if (role === 'user') {
      for (const r of extractToolResults(entry, i)) {
        results.set(r.toolUseId, r);
      }
    }
  }

  return calls.map((call) => ({
    call,
    result: results.get(call.id) ?? null,
  }));
}

/**
 * Extract text blocks from assistant entries.
 */
export function extractAssistantTexts(entries: object[]): { text: string; entryIndex: number }[] {
  const texts: { text: string; entryIndex: number }[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] as any;
    const role = entry?.message?.role ?? entry?.role;
    if (role !== 'assistant') continue;
    const content = entry?.message?.content ?? entry?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        texts.push({ text: block.text, entryIndex: i });
      }
    }
  }
  return texts;
}

export function extractTextFromEntry(entry: any): string {
  if (!entry) return '';

  // Direct message content
  if (typeof entry.content === 'string') return entry.content;

  // Array of content blocks (Claude API format)
  if (Array.isArray(entry.content)) {
    return entry.content
      .filter((block: any) => block.type === 'text' && typeof block.text === 'string')
      .map((block: any) => block.text)
      .join(' ');
  }

  // Message wrapper
  if (entry.message) return extractTextFromEntry(entry.message);

  // Tool result
  if (entry.result && typeof entry.result === 'string') return entry.result;

  // Fallback
  if (typeof entry.text === 'string') return entry.text;

  return '';
}

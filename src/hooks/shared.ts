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
  // "no ..." only counts as a correction when the remainder carries a durable-
  // rule signal (use/not/instead/always/...). Without the lookahead, one-off
  // task imperatives were stored: "no first fix the sentence" became the
  // correction "first fix the sentence".
  { regex: /^no[,.]?\s+(?=.*\b(?:use|not|instead|never|always|don'?t|stop|should|must)\b)(.+)/i, confidence: 0.8 },
  { regex: /^wrong[,.]?\s+(.+)/i, confidence: 0.8 },
  // "never" must start the message or a sentence. Mid-clause "never" fired on
  // QUOTED text the user was discussing: pasting "it never touches your token
  // allowance" stored "touches your token allowance..." as a correction.
  { regex: /(?:^|[.!?;:]\s+)never\s+(.+)/i, confidence: 0.75 },
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
  //
  // Two hazards from talking ABOUT this tool (both observed in the wild):
  //   1. The product name: "claude-recall" / "claude recall" contains the
  //      trigger word — "how claude recall is used" stored "is used...". The
  //      lookbehind skips "recall" when preceded by "claude-"/"claude ".
  //   2. Non-imperative uses where "recall" is a noun/subject followed by a
  //      copula or auxiliary ("the recall is broken") — an imperative
  //      "remember/recall X" is never followed by a bare auxiliary, so the
  //      negative lookahead rejects those.
  { regex: /(?<!claude[- ])\b(?:remember|recall)\s+(?:that\s+|this\s+|to\s+)?(?!(?:is|was|are|were|has|have|had|does|did|will|would|can|could|should|may|might)\b)(.+)/i, confidence: 0.8 },
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

/**
 * True when a prompt reads as conversation rather than a storable rule: it ends
 * with a question mark, opens with an interrogative, or is a "no worries"-style
 * pleasantry. Applied to EVERY classifier path (regex, Haiku, Kiro) — the LLMs
 * otherwise trust their own judgement and have stored questions like "what
 * memories do you have?" as preferences.
 */
export function isConversationalNotRule(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.endsWith('?') || INTERROGATIVE_START.test(trimmed) || PLEASANTRY_NO.test(trimmed);
}

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
  // Interrogatives and pleasantries are conversation, not rules
  if (isConversationalNotRule(text)) {
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
 * Classify text content — LLM-first, regex fallback. No API key is ever
 * required: each runtime brings its own LLM.
 *
 * Precedence (the included-LLM backends run only inside the detached capture
 * workers, which set the *_CLASSIFIER env vars — a ~4s CLI call can't run
 * inline on a turn):
 *   - Under Claude Code (CLAUDE_RECALL_CC_CLASSIFIER set by cc-capture-worker):
 *     headless `claude -p` on the user's Claude SUBSCRIPTION → regex.
 *   - Under Kiro (CLAUDE_RECALL_KIRO_CLASSIFIER set by kiro-capture-worker):
 *     Kiro's own headless LLM (`kiro-cli chat --no-interactive`, Kiro credits)
 *     → regex.
 *   - Inline callers: straight to regex.
 *
 * The ANTHROPIC_API_KEY path is STRICTLY OPT-IN via
 * CLAUDE_RECALL_PREFER_API_KEY — an exported key is never consulted
 * otherwise, not even as a fallback. (It is always a personal key the user
 * exported — Claude Code does NOT provide one from the subscription.)
 * See docs/cc-llm-capture.md and docs/kiro-llm-capture.md.
 */
export async function classifyContent(text: string): Promise<ClassifyResult | null> {
  // Guard the LLM paths the same way the regex path is guarded: a question or
  // pleasantry is conversation, never a rule. Haiku/Kiro don't apply this on
  // their own and have stored prompts like "what memories do you have?".
  if (isConversationalNotRule(text)) return null;

  const result = await classifyContentInner(text);

  // Reject if the classifier echoed a question instead of distilling a rule:
  // a stored directive is declarative, so a '?' in the extract signals a
  // conversational false positive (e.g. an LLM regurgitating the prompt).
  if (result && result.extract.includes('?')) return null;

  return result;
}

async function classifyContentInner(text: string): Promise<ClassifyResult | null> {
  const underKiro = !!process.env.CLAUDE_RECALL_KIRO_CLASSIFIER;
  const underCc = !!process.env.CLAUDE_RECALL_CC_CLASSIFIER;
  const preferApiKey = !!process.env.CLAUDE_RECALL_PREFER_API_KEY;

  const tryApiKey = () => classifyWithLLM(text);
  // Dynamic imports keep the CLI classifiers (and child_process) out of the
  // module graph for hook invocations that don't run in a capture worker.
  const tryKiro = async () => (await import('./kiro-classifier')).classifyWithKiro(text);
  const tryCc = async () => (await import('./cc-classifier')).classifyWithClaudeCli(text);

  // Pick the LLM backends. The ANTHROPIC_API_KEY path is STRICTLY OPT-IN
  // (CLAUDE_RECALL_PREFER_API_KEY): claude-recall was built for runtimes that
  // bring their own LLM — Kiro via `kiro-cli chat --no-interactive` (Kiro
  // credits), Claude Code via `claude -p` (the user's Claude subscription) —
  // and a key exported for other tools must NEVER be spent silently, not even
  // as a fallback. Without the opt-in, the chain is included LLM → regex.
  // The opt-in exists for Pi-only users (no `claude` binary; their key is how
  // they run Pi itself) and anyone deliberately paying for a stronger model.
  // The CLI backends only run inside their detached capture workers (which
  // set the *_CLASSIFIER env vars) — inline hook paths go straight to regex,
  // since a ~4s CLI call can't block a turn.
  const backends: Array<() => Promise<ClassifyResult | null>> = [];
  if (preferApiKey) backends.push(tryApiKey);
  if (underKiro) {
    backends.push(tryKiro);
  } else if (underCc) {
    backends.push(tryCc);
  }

  for (const backend of backends) {
    const result = await backend();
    if (result) return result;
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

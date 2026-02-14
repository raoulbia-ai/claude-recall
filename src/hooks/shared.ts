import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MemoryService } from '../services/memory';
import { ConfigService } from '../services/config';
import { ScoredMemory } from '../core/retrieval';

export interface ClassifyResult {
  type: string;
  confidence: number;
  extract: string;
}

const CORRECTION_PATTERNS = [
  { regex: /^no[,.]?\s+(.+)/i, confidence: 0.8 },
  { regex: /^wrong[,.]?\s+(.+)/i, confidence: 0.8 },
  { regex: /^actually[,.]?\s+(.+)/i, confidence: 0.7 },
  { regex: /\bnever\s+(.+)/i, confidence: 0.7 },
  { regex: /\bdon'?t\s+ever\s+(.+)/i, confidence: 0.8 },
  { regex: /\bstop\s+(doing|using|adding)\s+(.+)/i, confidence: 0.7 },
];

const PREFERENCE_PATTERNS = [
  { regex: /\bremember\s+(?:that|this|to)\s+(.+)/i, confidence: 0.8 },
  { regex: /\bfrom\s+now\s+on[,.]?\s+(.+)/i, confidence: 0.8 },
  { regex: /\bgoing\s+forward[,.]?\s+(.+)/i, confidence: 0.8 },
  { regex: /\balways\s+(.+)/i, confidence: 0.7 },
  { regex: /\bI\s+prefer\s+(.+)/i, confidence: 0.7 },
  { regex: /\bI\s+like\s+(.+)/i, confidence: 0.7 },
  { regex: /\bI\s+want\s+(.+)/i, confidence: 0.7 },
  { regex: /\bI\s+use\s+(.+)/i, confidence: 0.7 },
];

const FAILURE_PATTERNS = [
  { regex: /\bfailed\b/i, confidence: 0.6 },
  { regex: /\berror\b/i, confidence: 0.6 },
  { regex: /\bbroke\b/i, confidence: 0.6 },
  { regex: /\bdoesn'?t\s+work\b/i, confidence: 0.6 },
  { regex: /\bcrashed\b/i, confidence: 0.6 },
];

const DEVOPS_PATTERNS = [
  { regex: /\bdeploy\b/i, confidence: 0.6 },
  { regex: /\bbuild\b/i, confidence: 0.6 },
  { regex: /\bpipeline\b/i, confidence: 0.6 },
  { regex: /\bdocker\b/i, confidence: 0.6 },
  { regex: /\bci\/cd\b/i, confidence: 0.6 },
  { regex: /\bgit\b/i, confidence: 0.6 },
];

const PROJECT_KNOWLEDGE_PATTERNS = [
  { regex: /\barchitecture\b/i, confidence: 0.6 },
  { regex: /\bstack\b/i, confidence: 0.6 },
  { regex: /\bdatabase\b/i, confidence: 0.6 },
  { regex: /\bour\s+API\b/i, confidence: 0.6 },
];

/**
 * Read and parse JSON from stdin (synchronous for reliability with piped data).
 */
export function readStdin(): any {
  const data = fs.readFileSync(0, 'utf-8').trim();
  if (!data) throw new Error('Empty stdin');
  return JSON.parse(data);
}

/**
 * Classify text content by regex patterns.
 * Returns the highest-confidence match, prioritizing corrections > preferences.
 */
export function classifyContent(text: string): ClassifyResult | null {
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

  for (const p of FAILURE_PATTERNS) {
    if (p.regex.test(text)) {
      return { type: 'failure', confidence: p.confidence, extract: text.trim() };
    }
  }

  for (const p of DEVOPS_PATTERNS) {
    if (p.regex.test(text)) {
      return { type: 'devops', confidence: p.confidence, extract: text.trim() };
    }
  }

  for (const p of PROJECT_KNOWLEDGE_PATTERNS) {
    if (p.regex.test(text)) {
      return { type: 'project-knowledge', confidence: p.confidence, extract: text.trim() };
    }
  }

  return null;
}

/**
 * Word-level Jaccard similarity coefficient.
 */
export function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
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
  threshold: number = 0.55
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
export function storeMemory(content: string, type: string, projectId?: string): void {
  const memoryService = MemoryService.getInstance();
  const key = `hook_${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  memoryService.store({
    key,
    value: {
      content,
      confidence: 0.8,
      source: 'hook-auto-capture',
      timestamp: Date.now(),
    },
    type,
    context: {
      projectId: projectId || ConfigService.getInstance().getProjectId(),
      timestamp: Date.now(),
    },
    relevanceScore: 0.8,
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
 * Append a log line to ~/.claude-recall/hook-logs/{hookName}.log
 */
export function hookLog(hookName: string, message: string): void {
  try {
    const logDir = path.join(os.homedir(), '.claude-recall', 'hook-logs');
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
 * Extract readable text from a transcript JSONL entry.
 * Handles various shapes: assistant messages, user messages, tool results, etc.
 */
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

/**
 * LLM-powered memory classification using Claude Haiku.
 *
 * Picks up ANTHROPIC_API_KEY from the environment (Claude Code sets it
 * automatically for child processes). Falls back gracefully when unavailable.
 */

import { ClassifyResult } from './shared';

// Lazy singleton — avoid import cost when API key is absent
let clientInstance: any | null | undefined; // undefined = not yet checked

const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `You are a memory classifier for a developer tool. Classify user text into one of these types:

- correction: User correcting a mistake ("no, use X not Y", "wrong, it should be...")
- preference: User stating a clear, reusable directive about how they want things done going forward ("we use tabs", "always use TypeScript", "I prefer X"). Must be a rule that applies beyond this conversation. NOT observations, complaints, questions, debugging statements, or one-off instructions like "fix this" or "tell me about X"
- failure: Something broke or failed ("build failed", "error in deployment")
- devops: CI/CD, deployment, Docker, git workflow patterns
- project-knowledge: Architecture, stack, database, API patterns
- none: Casual conversation, questions, code snippets, or anything not worth remembering

Respond with ONLY valid JSON (no markdown fences). Format:
{"type":"<type>","confidence":<0.0-1.0>,"extract":"<the key fact to remember, concise>"}

Rules:
- Be very conservative — when in doubt, classify as "none". Only store things worth remembering across sessions
- Questions, observations, complaints, task instructions, and sentence fragments are "none" — not preferences
- If the text doesn't make sense as a standalone rule or directive, classify as "none"
- confidence >= 0.7 for corrections and preferences
- confidence >= 0.6 for other types
- "none" type should have confidence 0.0
- extract should be a clean, imperative statement of the rule/fact (e.g. "Use tabs for indentation")
- If the text is a question, greeting, or code block, classify as "none"`;

const BATCH_SYSTEM_PROMPT = `You are a memory classifier for a developer tool. You will receive multiple texts separated by "---ITEM---" markers. Classify each into one of these types:

- correction: User correcting a mistake ("no, use X not Y", "wrong, it should be...")
- preference: User stating a clear, reusable directive about how they want things done going forward ("we use tabs", "always use TypeScript", "I prefer X"). Must be a rule that applies beyond this conversation. NOT observations, complaints, questions, debugging statements, or one-off instructions like "fix this" or "tell me about X"
- failure: Something broke or failed ("build failed", "error in deployment")
- devops: CI/CD, deployment, Docker, git workflow patterns
- project-knowledge: Architecture, stack, database, API patterns
- none: Casual conversation, questions, code snippets, or anything not worth remembering

Respond with ONLY a valid JSON array (no markdown fences). One object per input text, in order:
[{"type":"<type>","confidence":<0.0-1.0>,"extract":"<the key fact to remember, concise>"}, ...]

Rules:
- Be very conservative — when in doubt, classify as "none". Only store things worth remembering across sessions
- Questions, observations, complaints, task instructions, and sentence fragments are "none" — not preferences
- If the text doesn't make sense as a standalone rule or directive, classify as "none"
- confidence >= 0.7 for corrections and preferences
- confidence >= 0.6 for other types
- "none" type should have confidence 0.0
- extract should be a clean, imperative statement of the rule/fact
- If a text is a question, greeting, or code block, classify as "none"`;

/**
 * Lazy-init the Anthropic client. Returns null if SDK or API key unavailable.
 */
function getClient(): any | null {
  if (clientInstance !== undefined) return clientInstance;

  if (!process.env.ANTHROPIC_API_KEY) {
    clientInstance = null;
    return null;
  }

  try {
    // Dynamic require to avoid hard failure when SDK not installed
    const Anthropic = require('@anthropic-ai/sdk');
    clientInstance = new Anthropic();
    return clientInstance;
  } catch {
    clientInstance = null;
    return null;
  }
}

/**
 * Parse a JSON response, stripping markdown fences if present.
 */
function parseJSON(text: string): any {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  return JSON.parse(cleaned);
}

/**
 * Classify a single text using Claude Haiku.
 * Returns null on any failure (no API key, network error, parse error).
 */
export async function classifyWithLLM(text: string): Promise<ClassifyResult | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: text }],
    });

    const content = response.content?.[0];
    if (content?.type !== 'text') return null;

    const result = parseJSON(content.text);

    if (!result.type || typeof result.confidence !== 'number' || !result.extract) {
      return null;
    }

    if (result.type === 'none') return null;

    return {
      type: result.type,
      confidence: result.confidence,
      extract: result.extract,
    };
  } catch {
    return null;
  }
}

/**
 * Classify multiple texts in a single Haiku API call.
 * Returns an array of results (null for unclassifiable items).
 * Falls back to null array on total failure (caller should use regex).
 */
export async function extractHindsightHint(
  failureDescription: string,
  context: string
): Promise<{ hint_text: string; hint_kind: string; applies_when: string[] } | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: 'You extract actionable hindsight lessons from failures. Given a failure description and context, produce a JSON object with: hint_text (imperative rule to prevent recurrence), hint_kind (one of: rule, preference, anti_pattern, workflow, debug_fix, failure_preventer), applies_when (array of 1-3 situation tags). Respond with ONLY valid JSON.',
      messages: [{ role: 'user', content: `Failure: ${failureDescription}\nContext: ${context}` }],
    });

    const content = response.content?.[0];
    if (content?.type !== 'text') return null;

    const result = parseJSON(content.text);
    if (!result.hint_text || !result.hint_kind) return null;

    return {
      hint_text: result.hint_text,
      hint_kind: result.hint_kind,
      applies_when: Array.isArray(result.applies_when) ? result.applies_when : [],
    };
  } catch {
    return null;
  }
}

// --- Session Extraction ---

export interface SessionLearning {
  type: 'project-knowledge' | 'preference' | 'devops' | 'failure';
  content: string;
  confidence: number;
}

const SESSION_EXTRACTION_PROMPT = `You are analyzing a coding session transcript to extract durable lessons.

The transcript shows tool calls (Bash, Edit, Read, Grep, etc.) and their results, plus user and assistant messages. Your primary job is to identify CAUSE-AND-EFFECT patterns — what failed, why, and what fixed it.

PRIORITY 1 — Failure → Fix sequences:
Look for tool calls that failed (errors, timeouts, non-zero exits) followed by a different approach that succeeded. Extract the lesson as an imperative rule.
Examples:
- Command timed out because of interactive prompt → "scripts/upgrade-sandbox.sh requires interactive confirmation — pipe 'y' to auto-confirm"
- Edit failed with old_string not found → "File X uses tabs not spaces — match exact indentation when editing"
- Build failed after dependency change → "Run npm install after modifying package.json before building"

PRIORITY 2 — Project conventions discovered:
- File structure, naming patterns, build tools, test frameworks
- Workflow patterns (e.g. "tests must be run from project root")
- Technical constraints or gotchas (e.g. "this project uses ESM, not CJS")
- Environment requirements (e.g. "needs Node 20+", "uses pnpm not npm")

PRIORITY 3 — User corrections applied:
- When the user corrected the agent's approach mid-session

Do NOT extract:
- Task-specific details (what was built, which files changed)
- One-off debugging steps unlikely to recur
- Code patterns derivable from reading the codebase
- Anything in the EXISTING MEMORIES list below

Respond with ONLY valid JSON (no markdown fences):
[{"type":"project-knowledge|preference|devops|failure","content":"<imperative statement>","confidence":0.0-1.0}]

Return [] if nothing durable was learned. Max 10 items. Each content should be a concise, actionable rule (e.g. "Pipe 'y' to scripts/upgrade-sandbox.sh — it has an interactive confirmation prompt").`;

/**
 * Extract durable session learnings from a conversation summary using Haiku.
 * Returns null if no API key or on any failure.
 */
export async function extractSessionLearningsWithLLM(
  summary: string,
  existingMemories: string[],
): Promise<SessionLearning[] | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const memList = existingMemories.length > 0
      ? existingMemories.map(m => `- ${m}`).join('\n')
      : '(none)';

    const systemPrompt = SESSION_EXTRACTION_PROMPT + `\n\nEXISTING MEMORIES (do not duplicate):\n${memList}`;

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: 'user', content: summary }],
    });

    const content = response.content?.[0];
    if (content?.type !== 'text') return null;

    const results: any[] = parseJSON(content.text);
    if (!Array.isArray(results)) return null;

    const validTypes = ['project-knowledge', 'preference', 'devops', 'failure'];
    return results
      .filter((r: any) => r && validTypes.includes(r.type) && typeof r.content === 'string' && r.content.length > 5)
      .map((r: any) => ({
        type: r.type,
        content: r.content,
        confidence: typeof r.confidence === 'number' ? r.confidence : 0.7,
      }));
  } catch {
    return null;
  }
}

export async function classifyBatchWithLLM(
  texts: string[]
): Promise<(ClassifyResult | null)[] | null> {
  if (texts.length === 0) return [];

  const client = getClient();
  if (!client) return null;

  try {
    const joined = texts.join('\n---ITEM---\n');

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: texts.length * 200,
      system: BATCH_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: joined }],
    });

    const content = response.content?.[0];
    if (content?.type !== 'text') return null;

    const results: any[] = parseJSON(content.text);

    if (!Array.isArray(results) || results.length !== texts.length) return null;

    return results.map((r: any) => {
      if (!r || !r.type || typeof r.confidence !== 'number' || !r.extract) return null;
      if (r.type === 'none') return null;
      return { type: r.type, confidence: r.confidence, extract: r.extract };
    });
  } catch {
    return null;
  }
}

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
- preference: User stating a preference or convention ("we use tabs", "always use TypeScript", "I prefer X")
- failure: Something broke or failed ("build failed", "error in deployment")
- devops: CI/CD, deployment, Docker, git workflow patterns
- project-knowledge: Architecture, stack, database, API patterns
- none: Casual conversation, questions, code snippets, or anything not worth remembering

Respond with ONLY valid JSON (no markdown fences). Format:
{"type":"<type>","confidence":<0.0-1.0>,"extract":"<the key fact to remember, concise>"}

Rules:
- confidence >= 0.7 for corrections and preferences
- confidence >= 0.6 for other types
- "none" type should have confidence 0.0
- extract should be a clean, imperative statement of the rule/fact (e.g. "Use tabs for indentation")
- If the text is a question, greeting, or code block, classify as "none"`;

const BATCH_SYSTEM_PROMPT = `You are a memory classifier for a developer tool. You will receive multiple texts separated by "---ITEM---" markers. Classify each into one of these types:

- correction: User correcting a mistake ("no, use X not Y", "wrong, it should be...")
- preference: User stating a preference or convention ("we use tabs", "always use TypeScript", "I prefer X")
- failure: Something broke or failed ("build failed", "error in deployment")
- devops: CI/CD, deployment, Docker, git workflow patterns
- project-knowledge: Architecture, stack, database, API patterns
- none: Casual conversation, questions, code snippets, or anything not worth remembering

Respond with ONLY a valid JSON array (no markdown fences). One object per input text, in order:
[{"type":"<type>","confidence":<0.0-1.0>,"extract":"<the key fact to remember, concise>"}, ...]

Rules:
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

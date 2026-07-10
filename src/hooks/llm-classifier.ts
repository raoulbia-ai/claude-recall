/**
 * LLM-powered memory classification using Claude Haiku via the Anthropic API.
 *
 * Requires ANTHROPIC_API_KEY in the environment — a personal pay-as-you-go
 * API key the user exported themselves. Claude Code does NOT mint one from
 * the user's subscription (hooks just inherit the user's environment), which
 * is why this backend is STRICTLY OPT-IN (CLAUDE_RECALL_PREFER_API_KEY): the
 * default chains use each runtime's included LLM only (claude -p / kiro-cli —
 * see cc-classifier.ts and kiro-classifier.ts), and an exported key is never
 * spent silently. Falls back gracefully (returns null) when unavailable.
 */

import { ClassifyResult } from './shared';
import { completeWithClaudeCli } from './cc-classifier';

// Lazy singleton — avoid import cost when API key is absent
let clientInstance: any | null | undefined; // undefined = not yet checked

const MODEL = 'claude-haiku-4-5-20251001';

/**
 * Per-call cap for `claude -p` in these SECONDARY features. Unlike capture
 * (detached worker, 30s budget), hindsight hints / session extraction / batch
 * classification run INLINE in the Stop hook (~40s total budget, possibly
 * several calls) — a hung CLI must not eat the whole hook.
 */
const SECONDARY_CLI_TIMEOUT_MS = 10000;

const SYSTEM_PROMPT = `You are a memory classifier for a developer tool. Classify user text into one of these types:

- correction: User durably correcting how something should ALWAYS be done ("no, use X not Y", "wrong, it should be..."). Correcting a one-off action in the current task is NOT durable — only store it if the rule generalizes beyond this moment.
- preference: User stating a clear, reusable directive about how they want things done going forward ("we use tabs", "always use TypeScript", "I prefer X"). Must be a rule that applies beyond this conversation.
- failure: Something broke or failed ("build failed", "error in deployment")
- devops: CI/CD, deployment, Docker, git workflow patterns. ONLY durable rules — not transient operational events like "sandbox rebuilt" or "background task exited"
- project-knowledge: Architecture, stack, database, API patterns
- none: Casual conversation, questions, code snippets, one-off task instructions, meta-conversation, sentence fragments, or anything not worth remembering across sessions

Respond with ONLY valid JSON (no markdown fences). Format:
{"type":"<type>","confidence":<0.0-1.0>,"extract":"<the key fact to remember, concise>"}

THE STANDALONE TEST — apply this BEFORE classifying anything as correction/preference/devops:
A durable rule must make complete sense on its own, read cold in a future session with NO knowledge of this conversation. If the text needs the surrounding chat to be understood, it is "none".
- Reject text that references the current task or moment with no concrete standalone subject: "this", "that", "the sentence", "here", "it", "again", "first", "now".
- Reject one-off imperatives aimed at the task in progress ("fix the sentence", "change that", "add a line", "do X first") — even when phrased forcefully. A preference describes what the user ALWAYS wants, not what to do right now.
- Reject sentence fragments and mid-thought clauses (e.g. "is used in practice", "then run the setup command"). A rule is a complete directive, not a snippet.
- Reject meta-conversation about this tool, this chat, or what to write/say/do next.

Rules:
- Be very conservative — when in doubt, classify as "none". Only store things worth remembering across sessions
- Questions, observations, complaints, task instructions, and sentence fragments are "none" — not preferences
- confidence >= 0.7 for corrections and preferences
- confidence >= 0.6 for other types
- "none" type should have confidence 0.0
- extract should be a clean, imperative statement of the rule/fact, understandable standalone (e.g. "Use tabs for indentation")
- If the text is a question, greeting, or code block, classify as "none"

Examples:
- "we use pnpm here, not npm" → {"type":"preference","confidence":0.9,"extract":"Use pnpm, not npm"}
- "always run tests before pushing" → {"type":"preference","confidence":0.85,"extract":"Run tests before pushing"}
- "first fix the sentence" → {"type":"none","confidence":0.0,"extract":""}
- "is used in practice" → {"type":"none","confidence":0.0,"extract":""}
- "then run claude-recall kiro setup" → {"type":"none","confidence":0.0,"extract":""}
- "what memories do you have?" → {"type":"none","confidence":0.0,"extract":""}`;

const BATCH_SYSTEM_PROMPT = `You are a memory classifier for a developer tool. You will receive a JSON array of texts. Classify each into one of these types:

- correction: User durably correcting how something should ALWAYS be done ("no, use X not Y", "wrong, it should be..."). Correcting a one-off action in the current task is NOT durable — only store it if the rule generalizes beyond this moment.
- preference: User stating a clear, reusable directive about how they want things done going forward ("we use tabs", "always use TypeScript", "I prefer X"). Must be a rule that applies beyond this conversation.
- failure: Something broke or failed ("build failed", "error in deployment")
- devops: CI/CD, deployment, Docker, git workflow patterns. ONLY durable rules — not transient operational events like "sandbox rebuilt" or "background task exited"
- project-knowledge: Architecture, stack, database, API patterns
- none: Casual conversation, questions, code snippets, one-off task instructions, meta-conversation, sentence fragments, or anything not worth remembering across sessions

Respond with ONLY a valid JSON array (no markdown fences). One object per input text, in order:
[{"type":"<type>","confidence":<0.0-1.0>,"extract":"<the key fact to remember, concise>"}, ...]

THE STANDALONE TEST — apply this BEFORE classifying anything as correction/preference/devops:
A durable rule must make complete sense on its own, read cold in a future session with NO knowledge of this conversation. If a text needs the surrounding chat to be understood, it is "none".
- Reject text that references the current task or moment with no concrete standalone subject: "this", "that", "the sentence", "here", "it", "again", "first", "now".
- Reject one-off imperatives aimed at the task in progress ("fix the sentence", "change that", "add a line", "do X first") — even when phrased forcefully.
- Reject sentence fragments and mid-thought clauses (e.g. "is used in practice", "then run the setup command").
- Reject meta-conversation about this tool, this chat, or what to write/say/do next.

Rules:
- Be very conservative — when in doubt, classify as "none". Only store things worth remembering across sessions
- Questions, observations, complaints, task instructions, and sentence fragments are "none" — not preferences
- confidence >= 0.7 for corrections and preferences
- confidence >= 0.6 for other types
- "none" type should have confidence 0.0
- extract should be a clean, imperative statement of the rule/fact, understandable standalone
- If a text is a question, greeting, or code block, classify as "none"`;

/**
 * Lazy-init the Anthropic client. Returns null if SDK or API key unavailable.
 *
 * Hook context: these calls run inside Claude Code hooks, some of them
 * synchronously blocking the user's prompt (UserPromptSubmit). The SDK's
 * defaults (10-minute timeout, 2 retries) would stall the session on a slow
 * or hung connection, so we cap the timeout and disable retries — a missed
 * classification degrades to the regex fallback, which is the right trade.
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
    const timeoutMs = parseInt(process.env.CLAUDE_RECALL_LLM_TIMEOUT_MS || '5000', 10);
    clientInstance = new Anthropic({
      timeout: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5000,
      maxRetries: 0,
    });
    return clientInstance;
  } catch {
    clientInstance = null;
    return null;
  }
}

/**
 * Parse a JSON response, stripping markdown fences if present. Falls back to
 * slicing the first balanced-looking JSON region — `claude -p` occasionally
 * wraps output in prose or a trailing fence the strict strip misses.
 */
function parseJSON(text: string): any {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const starts = [cleaned.indexOf('{'), cleaned.indexOf('[')].filter((i) => i !== -1);
    if (starts.length === 0) throw err;
    const start = Math.min(...starts);
    const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
    if (end <= start) throw err;
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

/**
 * Run one completion for the SECONDARY LLM features (hindsight hints, session
 * extraction, checkpoint extraction, batch classification) and return raw
 * text, or null when no backend is available.
 *
 * Backend policy matches capture: the user's Claude SUBSCRIPTION (headless
 * `claude -p`) is the only default backend — a personally-exported
 * ANTHROPIC_API_KEY is STRICTLY OPT-IN via CLAUDE_RECALL_PREFER_API_KEY and
 * never consulted otherwise, not even as a fallback. The opt-in exists for
 * Pi-only users (no `claude` binary; their key is how they run Pi itself)
 * and anyone deliberately paying for a stronger model.
 *
 * The CLI backend is skipped inside a nested headless session
 * (CLAUDE_RECALL_NESTED): if `claude -p` fires user-scope hooks of its own,
 * those hooks must not spawn further `claude -p` calls.
 */
async function completeText(
  systemPrompt: string,
  userContent: string,
  maxTokens: number,
): Promise<string | null> {
  const viaApi = async (): Promise<string | null> => {
    const client = getClient();
    if (!client) return null;
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
      });
      const content = response.content?.[0];
      return content?.type === 'text' ? content.text : null;
    } catch {
      return null;
    }
  };

  // `claude -p` takes a single argument (no system-prompt channel), so
  // instruction and payload are combined — same shape as the Kiro backend.
  const viaCli = (): Promise<string | null> =>
    process.env.CLAUDE_RECALL_NESTED
      ? Promise.resolve(null)
      : completeWithClaudeCli(`${systemPrompt}\n\n${userContent}`, { timeoutMs: SECONDARY_CLI_TIMEOUT_MS });

  const backends = process.env.CLAUDE_RECALL_PREFER_API_KEY
    ? [viaApi, viaCli]
    : [viaCli];

  for (const backend of backends) {
    const text = await backend();
    if (text !== null && text.trim().length > 0) return text;
  }
  return null;
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
 * Extract a failure-specific hindsight lesson from a failure description.
 * Returns null on any failure (no API key, network error, parse error) —
 * callers fall back to grounding the detector's generic remedy text.
 */
export async function extractHindsightHint(
  failureDescription: string,
  context: string
): Promise<{ hint_text: string; hint_kind: string; applies_when: string[] } | null> {
  const text = await completeText(
    'You extract actionable hindsight lessons from failures. Given a failure description and context, produce a JSON object with: hint_text (imperative rule to prevent recurrence), hint_kind (one of: rule, preference, anti_pattern, workflow, debug_fix, failure_preventer), applies_when (array of 1-3 situation tags). Respond with ONLY valid JSON.',
    `Failure: ${failureDescription}\nContext: ${context}`,
    300,
  );
  if (!text) return null;

  try {
    const result = parseJSON(text);
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
  const memList = existingMemories.length > 0
    ? existingMemories.map(m => `- ${m}`).join('\n')
    : '(none)';

  const systemPrompt = SESSION_EXTRACTION_PROMPT + `\n\nEXISTING MEMORIES (do not duplicate):\n${memList}`;

  const text = await completeText(systemPrompt, summary, 1000);
  if (!text) return null;

  try {
    const results: any[] = parseJSON(text);
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

// --- Auto-Checkpoint Extraction ---

export interface CheckpointExtraction {
  completed: string;
  remaining: string;
  blockers: string;
}

const CHECKPOINT_EXTRACTION_PROMPT = `You are extracting a "where I left off" checkpoint from a coding session that just ended. The next session — possibly minutes from now, possibly days later — needs a brief, accurate hint to resume from. Your output will overwrite any existing checkpoint, so it MUST be either accurate or empty. NEVER fabricate.

You will see the FINAL portion of a session transcript. Your job is to extract THREE fields:

- completed: what the user/agent finished in THIS recent task (concrete, brief, max 200 chars). Empty string if nothing was clearly completed.
- remaining: what was still in flight when the session ended — the actual hand-off (concrete, brief, max 300 chars). MUST be non-empty if there is real unfinished work. EMPTY STRING if the task is done.
- blockers: anything that was blocking progress (tools failing, decisions pending, dependencies). "none" if no blockers.

THE MOST IMPORTANT RULE — completion detection:
If the transcript ends with ANY signal that the task is finished, return remaining="". Completion signals include:
- assistant says "Done.", "All set.", "All done.", "Finished.", "That's it.", "Complete.", or similar terminal acknowledgement
- last user message is thanks/acknowledgement ("thanks", "perfect", "great") with no follow-up question
- tool calls succeeded and there is no explicit next step in the user's most recent prompt
- the conversation has reached a natural stopping point

When in doubt, prefer remaining="". An empty checkpoint is far better than a fabricated one.

THE SECOND MOST IMPORTANT RULE — no fabrication:
- ONLY use information present in the transcript. Do NOT extrapolate, do NOT invent follow-up work.
- If the most recent task is clearly complete, do NOT manufacture next steps from your imagination.
- If you cannot determine what was happening with high confidence, return all-empty: {"completed":"","remaining":"","blockers":""}
- "remaining" must be a SPECIFIC unfinished item visible in the transcript. Never generic ("continue work", "more testing", "documentation").

Other rules:
- Focus ONLY on the most recent coherent task. Ignore earlier work in the session.
- Return JSON: {"completed":"...","remaining":"...","blockers":"..."}
- Be terse and specific. Each field should help the future session pick up the thread.
- Do NOT include markdown fences. Respond with raw JSON only.

Examples of GOOD output:

Scenario A — task finished, agent said "Done.":
{"completed":"Copied cc-source-code into a dedicated dir under claude-recall/cc-source-code/","remaining":"","blockers":"none"}

Scenario B — task in progress, midway through implementation:
{"completed":"Added saveCheckpoint() to storage and MemoryService","remaining":"Wire CLI checkpoint command and add MCP/Pi tool wrappers","blockers":"none"}

Scenario C — task in progress, blocked on something:
{"completed":"Diagnosed [object Object] rendering bug in handleLoadRules","remaining":"Write failing test, extract formatRuleValue helper, replace 5 call sites","blockers":"none"}

Scenario D — uncertain, sparse context, can't tell what's happening:
{"completed":"","remaining":"","blockers":""}

Scenario E — just a question, no work done:
{"completed":"","remaining":"","blockers":""}

Examples of BAD output (DO NOT DO THIS):
{"completed":"various changes","remaining":"more work","blockers":"none"}              # too vague
{"completed":"explored architecture","remaining":"document findings","blockers":"none"} # FABRICATED — there was no documentation task
{"completed":"finished everything","remaining":"finish everything","blockers":"none"}   # nonsense filler`;

export async function extractCheckpointWithLLM(
  conversationSummary: string,
): Promise<CheckpointExtraction | null> {
  if (!conversationSummary || conversationSummary.trim().length < 30) {
    return null;
  }

  const text = await completeText(CHECKPOINT_EXTRACTION_PROMPT, conversationSummary, 600);
  if (!text) return null;

  try {
    const result = parseJSON(text);
    if (typeof result !== 'object' || result === null) return null;

    return {
      completed: typeof result.completed === 'string' ? result.completed : '',
      remaining: typeof result.remaining === 'string' ? result.remaining : '',
      blockers: typeof result.blockers === 'string' ? result.blockers : '',
    };
  } catch {
    return null;
  }
}

export async function classifyBatchWithLLM(
  texts: string[]
): Promise<(ClassifyResult | null)[] | null> {
  if (texts.length === 0) return [];

  // JSON array, not delimiter-joined text: a user message that happened to
  // contain the old "---ITEM---" marker desynced item counts and silently
  // dropped the entire batch to the regex fallback. JSON boundaries can't
  // be forged by content.
  const joined = JSON.stringify(texts);

  const text = await completeText(BATCH_SYSTEM_PROMPT, joined, texts.length * 200);
  if (!text) return null;

  try {
    const results: any[] = parseJSON(text);

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

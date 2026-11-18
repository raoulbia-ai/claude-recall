/**
 * Write-time guardrails for memories (docs/design-memory-poisoning-defense.md).
 *
 * Two checks run on every write, whatever the path:
 *
 * - **Secret redaction.** Tokens and keys in captured text (tool output, a
 *   pasted config) are replaced before anything is stored, so they never reach
 *   the database, a source excerpt, an export or a future session's context.
 * - **Attack-pattern screening.** Text that reads like an instruction to
 *   download-and-run, override prior instructions, or carry an encoded payload
 *   is flagged. The caller decides what a flag means for the write's origin.
 *
 * Both are pattern-based: cheap, and they catch the obvious cases. They are
 * one layer, not the defense; quarantine of untrusted origins is the other.
 */

const REDACTED = '[REDACTED]';

/** Credential shapes worth catching. Each is specific enough to rarely misfire. */
const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g, // GitLab
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, // Anthropic
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g, // OpenAI-style
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, // Slack
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
];

/** `password=…`, `api_key: …`, `token "…"`: keep the name, drop the value. */
const ASSIGNED_SECRET = /\b((?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|passwd|client[_-]?secret)\s*["']?\s*[:=]\s*["']?)([^\s"',;]{8,})/gi;

export function redactSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, REDACTED);
  return out.replace(ASSIGNED_SECRET, (_m, name: string) => `${name}${REDACTED}`);
}

/** Redact every string inside a memory value (string, object or array). */
export function redactValue<T>(value: T): T {
  if (typeof value === 'string') return redactSecrets(value) as unknown as T;
  if (Array.isArray(value)) return value.map(v => redactValue(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactValue(v);
    return out as T;
  }
  return value;
}

/** Shapes of text that try to act on the agent rather than inform it. */
const ATTACK_PATTERNS: Array<{ reason: string; re: RegExp }> = [
  { reason: 'download piped to a shell', re: /\b(?:curl|wget|iwr|invoke-webrequest)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b/i },
  { reason: 'download piped to an interpreter', re: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:python3?|node|perl|ruby)\b/i },
  { reason: 'instruction override', re: /\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all|any|your)\b[^.\n]{0,20}\b(?:instructions?|rules?|prompts?|guidelines?)\b/i },
  { reason: 'role or system-prompt injection', re: /(?:^|\n)\s*(?:system|assistant)\s*:|<\s*\/?\s*(?:system|instructions?)\s*>/i },
  { reason: 'encoded payload', re: /[A-Za-z0-9+/]{200,}={0,2}/ },
  { reason: 'decode-and-execute', re: /\bbase64\s+(?:-d|--decode)\b[^\n|]*\|\s*(?:ba)?sh\b/i },
];

/** Reasons the text looks like an attack; empty when it doesn't. */
export function screenForAttack(text: string): string[] {
  return ATTACK_PATTERNS.filter(p => p.re.test(text)).map(p => p.reason);
}

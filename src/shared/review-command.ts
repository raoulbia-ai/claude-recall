/**
 * In-session review of quarantined memories, driven only by what the USER types
 * (docs/design-memory-poisoning-defense.md, Phase 3).
 *
 * The runtime hands us the user's literal prompt before the agent sees it
 * (Claude Code's UserPromptSubmit hook, Pi's interactive `input` event). If it
 * is a review command, or a reply during an active review, we act on it and
 * return a message for the runtime to show the user directly; the prompt never
 * reaches the agent. The agent can't type into this channel, so it can neither
 * start a review nor answer one.
 *
 *   recall review [all]           step through pending memories (all = every project)
 *     y / n / s / all / q         approve / reject / skip / approve the rest / quit
 *     nyy (or "n y y")             several answers at once, applied in order
 *   recall pending [all]          list them
 *   recall approve <ids|all>      approve by id, or everything pending
 *   recall reject <ids|all>       reject by id, or everything pending
 *   recall rules | list           everything that steers the agent here, with ids
 *   recall <other word>           shows this list instead of reaching the agent
 *   recall knowledge              just the project notes
 */
import * as fs from 'fs';
import * as path from 'path';
import { MemoryService } from '../services/memory';
import { ConfigService } from '../services/config';
import type { Memory } from '../memory/storage';

/** A review left idle this long is over; the next ordinary prompt goes to the agent. */
const REVIEW_TTL_MS = 60 * 60 * 1000;

interface ReviewState {
  queue: number[];
  position: number;
  approved: number;
  rejected: number;
  allProjects: boolean;
  updatedAt: number;
}

function stateFile(stateDir: string, sessionKey: string): string {
  const safe = sessionKey.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128) || 'default';
  return path.join(stateDir, `review-${safe}.json`);
}

function readState(file: string): ReviewState | null {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8')) as ReviewState;
    if (Date.now() - s.updatedAt > REVIEW_TTL_MS) return null;
    return s;
  } catch {
    return null;
  }
}

function writeState(file: string, s: ReviewState | null): void {
  try {
    if (s === null) fs.rmSync(file, { force: true });
    else fs.writeFileSync(file, JSON.stringify({ ...s, updatedAt: Date.now() }), { mode: 0o600 });
  } catch { /* review still works for this prompt */ }
}

/** One line of memory text, as stored (never paraphrased). */
export function memoryText(value: any): string {
  const parse = (x: any) => {
    if (typeof x === 'string' && /^\s*[{[]/.test(x)) { try { return JSON.parse(x); } catch { /* plain text */ } }
    return x;
  };
  let v = parse(value);
  if (v && typeof v === 'object' && v.content !== undefined) {
    const inner = parse(v.content);
    if (inner && typeof inner === 'object') v = inner;
  }
  const failure = v && typeof v === 'object' && v.what_failed
    ? `${v.what_failed}${v.why_failed ? ` — ${v.why_failed}` : ''}`
    : undefined;
  const s = typeof v === 'string' ? v : failure ?? v?.content ?? v?.value ?? JSON.stringify(v);
  return String(typeof s === 'string' ? s : JSON.stringify(s)).replace(/\s+/g, ' ').slice(0, 300);
}

/**
 * What approving a memory of this type does, in plain words — so the user
 * knows what they're agreeing to, not just what the text says.
 */
export const APPROVE_MEANS: Record<string, string> = {
  preference: 'approve → the agent follows this as your preference',
  correction: 'approve → the agent treats this as a correction you made',
  devops: 'approve → the agent follows this as a workflow rule',
  failure: 'approve → shown to the agent as a past mistake to avoid. Reject it if nothing really went wrong',
  solution: 'approve → offered to the agent as a proven fix to reuse',
  'project-knowledge': 'approve → given to the agent as a fact about this project',
};

export function approveMeans(type: string): string {
  return APPROVE_MEANS[type] ?? 'approve → loaded into the agent\'s context as a rule';
}

/** Where a memory came from, said so a person can judge it. */
export function originLabel(origin: string | null | undefined): string {
  switch (origin) {
    case 'agent': return 'stored by the agent';
    case 'tool': return 'captured from tool output';
    case 'import': return 'imported from a file';
    case 'user': return 'your own words';
    default: return 'stored before origins were recorded';
  }
}

function describe(m: Memory): string {
  const words = m.source_excerpt ? `\n    your words: "${m.source_excerpt.replace(/\s+/g, ' ').slice(0, 200)}"` : '';
  return `#${m.id} ${m.type} (${originLabel(m.origin)})\n    ${memoryText(m.value)}${words}\n    ${approveMeans(m.type)}`;
}

function pending(allProjects: boolean): Memory[] {
  MemoryService.getInstance().expireStalePending();
  return MemoryService.getInstance().getPendingRules({
    projectId: allProjects ? undefined : ConfigService.getInstance().getProjectId(),
  });
}

const COMMAND_HELP = [
  'Claude Recall commands (handled here, never sent to the agent):',
  '  recall rules              everything that steers the agent in this project, with ids (also: recall list)',
  '  recall knowledge          just the project notes',
  '  recall review             step through what is waiting for your review',
  '  recall pending            list what is waiting, with ids',
  '  recall approve <ids|all>  approve by id',
  '  recall reject <ids|all>   drop by id (works on approved rules too)',
].join('\n');

const PROMPT_LINE = 'Reply: y = approve · n = reject · s = skip · all = approve the rest · q = stop · several at once: nyy';

function showCurrent(s: ReviewState, prefix = ''): string {
  const ms = MemoryService.getInstance();
  // Skip anything decided elsewhere since the review started
  while (s.position < s.queue.length) {
    const m = ms.getStorage().getPendingRules({}).find(p => p.id === s.queue[s.position]);
    if (m) return `${prefix}[${s.position + 1}/${s.queue.length}] ${describe(m)}\n\n${PROMPT_LINE}`;
    s.position++;
  }
  return `${prefix}✓ Review done: ${s.approved} approved, ${s.rejected} rejected.`;
}

/** Ids in a command like "recall approve 12 15,18". */
function parseIds(rest: string): number[] {
  return (rest.match(/\d+/g) || []).map(n => parseInt(n, 10)).filter(n => n > 0);
}

/**
 * Handle the user's prompt if it's a review command or a review reply.
 * Returns the message to show the user (and the prompt must not reach the
 * agent), or null to let the prompt through untouched.
 */
export function handleReviewInput(text: string, sessionKey: string, stateDir: string): string | null {
  const t = (text || '').trim();
  const lower = t.toLowerCase();
  const file = stateFile(stateDir, sessionKey);
  const ms = MemoryService.getInstance();

  // A reply during an active review: only these exact words are captured, so
  // an ordinary prompt still reaches the agent (and ends the review).
  const state = readState(file);
  // Several answers at once, applied in order: "nyy", "n y y", "y,n,s"
  const batch = state && state.position < state.queue.length && /^[yns](?:[\s,]*[yns])+$/.test(lower)
    ? lower.replace(/[\s,]/g, '')
    : null;
  if (state && batch) {
    let applied = 0;
    for (const answer of batch) {
      if (state.position >= state.queue.length) break;
      const current = state.queue[state.position];
      if (answer === 'y') state.approved += ms.approveRules([current]);
      else if (answer === 'n') state.rejected += ms.rejectRules([current]);
      state.position++;
      applied++;
    }
    const extra = batch.length - applied;
    const msg = showCurrent(state, extra > 0 ? `(${extra} extra answer${extra === 1 ? '' : 's'} ignored: the review ran out of items)\n` : '');
    writeState(file, state.position < state.queue.length ? state : null);
    return msg;
  }
  if (state && state.position < state.queue.length) {
    const id = state.queue[state.position];
    switch (lower) {
      case 'y': case 'yes': case 'a': case 'approve':
        state.approved += ms.approveRules([id]); state.position++; break;
      case 'n': case 'no': case 'r': case 'reject':
        state.rejected += ms.rejectRules([id]); state.position++; break;
      case 's': case 'skip':
        state.position++; break;
      case 'all': case 'approve all': {
        const rest = state.queue.slice(state.position);
        state.approved += ms.approveRules(rest); state.position = state.queue.length; break;
      }
      case 'q': case 'quit': case 'stop': case 'done':
        writeState(file, null);
        return `Review stopped: ${state.approved} approved, ${state.rejected} rejected. Type "recall review" to continue later.`;
      default:
        if (!/^recall\s/i.test(t)) { writeState(file, null); return null; }
    }
    if (!/^recall\s/i.test(t)) {
      const msg = showCurrent(state);
      writeState(file, state.position < state.queue.length ? state : null);
      return msg;
    }
  }

  if (/^recall\s+(rules|list|ls|show)\s*$/i.test(t)) return showRules();
  if (/^recall\s+(knowledge|facts|notes)\s*$/i.test(t)) return showKnowledge();

  const m = /^recall\s+(review|pending|approve|reject)\b\s*(.*)$/i.exec(t);
  // "recall <one word>" that isn't a command: show the commands rather than
  // hand a mistyped command to the agent. Longer sentences ("recall what we
  // decided about X") still go to the agent.
  if (!m) return /^recall\s+[a-z-]+[?!.]?\s*$/i.test(t) ? COMMAND_HELP : null;
  const verb = m[1].toLowerCase();
  const rest = m[2].trim();
  const allProjects = /\ball[-\s]?projects\b|\beverywhere\b/i.test(rest) || (verb !== 'approve' && verb !== 'reject' && /^all\b/i.test(rest));

  if (verb === 'review') {
    const queue = pending(allProjects).map(p => p.id!).filter(Boolean);
    if (queue.length === 0) { writeState(file, null); return '✓ Nothing waiting for review.'; }
    const s: ReviewState = { queue, position: 0, approved: 0, rejected: 0, allProjects, updatedAt: Date.now() };
    const msg = showCurrent(s, `⏳ ${queue.length} memor${queue.length === 1 ? 'y' : 'ies'} to review. Approved ones load as rules; rejected ones are deactivated.\n\n`);
    writeState(file, s);
    return msg;
  }

  if (verb === 'pending') {
    const list = pending(allProjects);
    if (list.length === 0) return '✓ Nothing waiting for review.';
    const shown = list.slice(0, 30).map(describe).join('\n');
    const more = list.length > 30 ? `\n…and ${list.length - 30} more.` : '';
    return `⏳ ${list.length} waiting for review:\n\n${shown}${more}\n\nType "recall review" to step through, or "recall approve <ids>" / "recall reject <ids>".`;
  }

  // approve / reject
  const ids = /^all\b/i.test(rest) ? pending(allProjects).map(p => p.id!).filter(Boolean) : parseIds(rest);
  if (ids.length === 0) return `Name the memories: "recall ${verb} 12 15", or "recall ${verb} all".`;
  const n = verb === 'approve' ? ms.approveRules(ids) : ms.rejectRules(ids);
  const left = pending(false).length;
  return `✓ ${verb === 'approve' ? 'Approved' : 'Rejected'} ${n} memor${n === 1 ? 'y' : 'ies'}.${left > 0 ? ` ${left} still waiting here.` : ''}`;
}

function line(m: Memory): string {
  return `  #${m.id} ${memoryText(m.value).replace(/\s+/g, ' ').slice(0, 220)}`;
}

function waitingNote(): string {
  const n = pending(false).length;
  return n > 0 ? `\n\n⏳ ${n} more waiting for your review: type "recall review".` : '';
}

/** A mistake to avoid, in full: what went wrong, why, and what to do instead. */
function failureDetail(m: Memory): string {
  const parse = (x: any) => {
    if (typeof x === 'string' && /^\s*[{[]/.test(x)) { try { return JSON.parse(x); } catch { /* plain text */ } }
    return x;
  };
  let v = parse(m.value);
  if (v && typeof v === 'object' && v.content !== undefined && typeof parse(v.content) === 'object') v = parse(v.content);
  if (!v || typeof v !== 'object' || !v.what_failed) return line(m);
  const clean = (x: any) => String(x).replace(/\s+/g, ' ').slice(0, 300);
  const generic = /^(Check (inputs|command syntax)|Verify)/i;
  const rows = [`  #${m.id} ${clean(v.what_failed)}`];
  if (v.why_failed) rows.push(`      why: ${clean(v.why_failed)}`);
  if (v.what_should_do && !generic.test(v.what_should_do)) rows.push(`      instead: ${clean(v.what_should_do)}`);
  return rows.join('\n');
}

/**
 * Everything that steers the agent in this project, shown to the user: the
 * rules it's given every session, mistakes to avoid (in full), and project
 * notes it's given when relevant. The status line shows only the total.
 */
function showRules(): string {
  const ms = MemoryService.getInstance();
  const r = ms.loadActiveRules(undefined, { countLoad: false });
  const notes = ms.getActiveKnowledge();
  const sections: Array<[string, Memory[], (m: Memory) => string]> = [
    ['Your preferences', r.preferences, line],
    ['Corrections', r.corrections, line],
    ['Mistakes to avoid', r.failures, failureDetail],
    ['DevOps', r.devops, line],
    ['Solutions', r.solutions, line],
    ['Project notes (given when relevant)', notes, line],
  ];
  const body = sections
    .filter(([, list]) => list.length > 0)
    .map(([title, list, fmt]) => `${title} (${list.length})\n${list.map(fmt).join('\n')}`)
    .join('\n\n');
  const total = sections.reduce((n, [, list]) => n + list.length, 0);
  const project = ConfigService.getInstance().getProjectId();
  if (total === 0) return `No rules yet for "${project}".${waitingNote()}`;
  return `🧠 ${total} rule${total === 1 ? '' : 's'} for "${project}":\n\n${body}\n\nTo drop one: "recall reject <id>".${waitingNote()}`;
}

/** Facts kept about this project; given to the agent when relevant, not as rules. */
function showKnowledge(): string {
  const list = MemoryService.getInstance().getActiveKnowledge();
  const project = ConfigService.getInstance().getProjectId();
  if (list.length === 0) return `No project knowledge kept for "${project}" yet.${waitingNote()}`;
  const shown = list.slice(0, 40).map(line).join('\n');
  const more = list.length > 40 ? `\n  …and ${list.length - 40} more (claude-recall list -t project-knowledge --all).` : '';
  return `📚 ${list.length} fact${list.length === 1 ? '' : 's'} kept about "${project}" (brought up when relevant, not loaded as rules):\n\n${shown}${more}${waitingNote()}`;
}

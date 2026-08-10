/**
 * memory-sync-hook — fires on Stop and PreCompact events.
 *
 * Exports active rules from Claude Recall's SQLite database to individual
 * typed .md files in Claude Code's auto-memory directory, using CC's native
 * YAML frontmatter format so rules participate in CC's memory retrieval.
 *
 * Input: { session_id, cwd, hook_event_name }
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { hookLog } from './shared';
import { MemoryService, SyncRule } from '../services/memory';
import { ConfigService } from '../services/config';

/** Max number of recall files to write (leave room for CC's own memory files) */
const MAX_SYNC_FILES = 30;

/** Prefix for all recall memory files — prevents namespace collisions */
const FILE_PREFIX = 'recall_';

/** Keys that look like test data */
const TEST_KEY_PATTERNS = [/^Test /i, /^Session test /i, /^test_/i];

/** Values that may contain secrets */
const SECRET_PATTERNS = [/api_key/i, /token/i, /password/i, /secret/i, /credential/i, /private_key/i];

/**
 * Derive the auto-memory directory path from a cwd.
 * Matches Claude Code's convention: ~/.claude/projects/{sanitized cwd}/memory/
 * where the sanitizer replaces EVERY non-alphanumeric with '-', not just '/'.
 * Replacing only slashes wrote to ".../projects/-home-u-my_app.v2/memory"
 * while Claude Code reads "-home-u-my-app-v2" — the entire sync output was
 * silently invisible for any project path containing a dot or underscore.
 */
export function deriveAutoMemoryPath(cwd: string, homedir?: string): string {
  const home = homedir || os.homedir();
  const sanitized = cwd.replace(/[^a-zA-Z0-9]/g, '-');
  return path.join(home, '.claude', 'projects', sanitized, 'memory');
}

/**
 * Extract display value from a memory record.
 */
function extractValue(value: any): string {
  // Always resolve to readable text. Handles every historical shape:
  //  - clean structured `{ title, description, content }` → prefer the title
  //  - failure content objects → "what_failed → what_should_do"
  //  - nested `{ content: { ... } }` / `{ content: "{...json...}" }` wrappers
  //  - stringified-JSON stored as a plain string
  // Without this, a failure stored as `JSON.stringify(content)` rendered its
  // raw JSON as the file title/slug (e.g. `[{"what_failed":"Bash command...`),
  // and clean object-content memories stringified to "[object Object]".
  let v: any = value;
  for (let depth = 0; depth < 6; depth++) {
    if (typeof v === 'string') {
      const t = v.trim();
      if (t.startsWith('{') || t.startsWith('[')) {
        try { v = JSON.parse(t); continue; } catch { return v; }
      }
      return v;
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (typeof v.title === 'string' && v.title.trim()) return v.title.trim();
      if (typeof v.what_failed === 'string') {
        return v.what_should_do ? `${v.what_failed} → ${v.what_should_do}` : v.what_failed;
      }
      const next = v.content ?? v.value ?? v.text;
      if (next === undefined) return JSON.stringify(v);
      v = next;
      continue;
    }
    break;
  }
  return typeof v === 'string' ? v : JSON.stringify(v ?? '');
}

/**
 * Generic default "lessons" the failure detectors emit when no fix has been
 * paired yet. A promoted memory whose only takeaway is one of these teaches
 * nothing — it just costs context. We skip syncing those to the file-based
 * memory; the specific failure still lives in the DB, so fix-pairing and
 * evidence counting are unaffected, and once a fix enriches what_should_do
 * (e.g. "Fix: <command>") the memory syncs normally.
 */
const BOILERPLATE_LESSONS = new Set([
  'check inputs and prerequisites before retrying',
  'check command syntax, file paths, and prerequisites before running',
  'review error details and adjust approach',
]);

/** Unwrap a memory value to the object that carries the failure fields, or null. */
function unwrapToFailureObject(value: any): any {
  let v: any = value;
  for (let depth = 0; depth < 6; depth++) {
    if (typeof v === 'string') {
      const t = v.trim();
      if (t.startsWith('{')) { try { v = JSON.parse(t); continue; } catch { return null; } }
      return null;
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (typeof v.what_should_do === 'string' || typeof v.what_failed === 'string') return v;
      const next = v.content ?? v.value;
      if (next === undefined) return null;
      v = next;
      continue;
    }
    return null;
  }
  return null;
}

function isBoilerplateFailure(rule: SyncRule): boolean {
  if (rule.crType !== 'failure') return false;
  const obj = unwrapToFailureObject(rule.value);
  const wsd = obj && typeof obj.what_should_do === 'string' ? obj.what_should_do.trim().toLowerCase() : '';
  return BOILERPLATE_LESSONS.has(wsd);
}

/**
 * Check if a memory key matches test data patterns.
 */
function isTestData(key: string): boolean {
  return TEST_KEY_PATTERNS.some(p => p.test(key));
}

/**
 * Check if a value contains secret-like content.
 */
function containsSecret(value: string): boolean {
  return SECRET_PATTERNS.some(p => p.test(value));
}

/**
 * Sanitize a string for use as a filename slug.
 */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50);
}

/**
 * Generate a descriptive name from a rule's key and value.
 */
function generateName(rule: SyncRule): string {
  const val = extractValue(rule.value);
  // Use the key if it's human-readable (not auto-generated)
  const isAutoKey = rule.key.startsWith('memory_') || rule.key.startsWith('auto_') ||
    rule.key.startsWith('pref_') || rule.key.startsWith('hook_');
  if (!isAutoKey && rule.key.length > 3 && rule.key.length < 60) {
    return rule.key.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  // Derive from value content
  const firstSentence = val.split(/[.\n]/)[0].trim();
  return firstSentence.length > 60 ? firstSentence.substring(0, 57) + '...' : firstSentence;
}

/**
 * Generate a one-line description for CC's relevance selector.
 */
function generateDescription(rule: SyncRule): string {
  const val = extractValue(rule.value);
  const typeLabel = rule.crType === 'correction' ? 'Correction'
    : rule.crType === 'failure' ? 'Failure lesson'
    : rule.crType === 'preference' ? 'User preference'
    : rule.crType === 'devops' ? 'DevOps convention'
    : 'Project knowledge';
  const snippet = val.length > 80 ? val.substring(0, 77) + '...' : val;
  return `${typeLabel}: ${snippet}`;
}

/**
 * Generate a unique filename for a rule.
 */
function generateFilename(rule: SyncRule, index: number): string {
  const slug = slugify(extractValue(rule.value).substring(0, 40)) || `rule-${index}`;
  return `${FILE_PREFIX}${rule.ccType}_${slug}.md`;
}

/**
 * Render a single memory file with CC-compatible YAML frontmatter.
 */
function renderMemoryFile(rule: SyncRule): string {
  const name = generateName(rule);
  const description = generateDescription(rule);
  const val = extractValue(rule.value);

  const lines = [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    `type: ${rule.ccType}`,
    '---',
    '',
    val,
    '',
  ];

  return lines.join('\n');
}

/**
 * Update MEMORY.md with pointers to recall files.
 * Replaces any existing "## Claude Recall" section, preserves everything else.
 */
function updateMemoryMdIndex(memoryDir: string, files: Array<{ filename: string; name: string; description: string }>): void {
  const memoryMdPath = path.join(memoryDir, 'MEMORY.md');

  let existing = '';
  if (fs.existsSync(memoryMdPath)) {
    existing = fs.readFileSync(memoryMdPath, 'utf-8');
  }

  // Remove existing Claude Recall section (everything from ## Claude Recall to next ## or end)
  const sectionRegex = /\n?## Claude Recall\n[\s\S]*?(?=\n## |\n*$)/;
  const cleaned = existing.replace(sectionRegex, '').trimEnd();

  // Build new section
  const recallLines = ['', '## Claude Recall'];
  if (files.length === 0) {
    recallLines.push('- No recall rules synced');
  } else {
    for (const f of files) {
      const hook = f.description.length > 80 ? f.description.substring(0, 77) + '...' : f.description;
      recallLines.push(`- [${f.name}](${f.filename}) — ${hook}`);
    }
  }
  recallLines.push('');

  const newContent = cleaned + recallLines.join('\n');
  fs.writeFileSync(memoryMdPath, newContent);
}

/**
 * Clean up stale recall_* files that are no longer in the current sync set.
 */
function cleanupStaleFiles(memoryDir: string, currentFilenames: Set<string>): number {
  let removed = 0;
  try {
    const files = fs.readdirSync(memoryDir);
    for (const f of files) {
      if (f.startsWith(FILE_PREFIX) && f.endsWith('.md') && !currentFilenames.has(f)) {
        fs.unlinkSync(path.join(memoryDir, f));
        removed++;
      }
    }
  } catch {
    // Ignore cleanup errors
  }
  return removed;
}

/**
 * Remove old recall-rules.md if it exists (migration from v0.18.x).
 */
function removeOldRulesFile(memoryDir: string): void {
  const oldPath = path.join(memoryDir, 'recall-rules.md');
  try {
    if (fs.existsSync(oldPath)) {
      fs.unlinkSync(oldPath);
      hookLog('memory-sync', 'Removed old recall-rules.md');
    }
  } catch {
    // Ignore
  }
}

export async function handleMemorySync(input: any): Promise<void> {
  const cwd: string = input?.cwd ?? '';

  if (!cwd) {
    hookLog('memory-sync', 'No cwd provided — skipping sync');
    return;
  }

  try {
    const projectId = ConfigService.getInstance().getProjectId();
    const memoryService = MemoryService.getInstance();

    // Get top rules ranked for sync
    const rules = memoryService.getTopRulesForSync(projectId, MAX_SYNC_FILES);

    // Filter out test data, secrets, and boilerplate-only failure lessons.
    const filtered = rules.filter(r => {
      if (isTestData(r.key)) return false;
      // Scan the FULL raw value for secrets, not just the display gist —
      // extractValue now returns a summary that could omit a secret buried in
      // a non-title field.
      let raw: string;
      try { raw = typeof r.value === 'string' ? r.value : JSON.stringify(r.value); }
      catch { raw = String(r.value ?? ''); }
      if (containsSecret(raw)) return false;
      if (isBoilerplateFailure(r)) return false;
      return true;
    });

    // Derive auto-memory path and ensure directory exists
    const memoryDir = deriveAutoMemoryPath(cwd);
    if (!fs.existsSync(memoryDir)) {
      fs.mkdirSync(memoryDir, { recursive: true });
    }

    // Remove old flat rules file (v0.18.x migration)
    removeOldRulesFile(memoryDir);

    // Write individual files
    const writtenFiles: Array<{ filename: string; name: string; description: string }> = [];
    const currentFilenames = new Set<string>();

    for (let i = 0; i < filtered.length; i++) {
      const rule = filtered[i];
      const filename = generateFilename(rule, i);
      const content = renderMemoryFile(rule);

      // Deduplicate filenames (in case two rules produce the same slug)
      let uniqueFilename = filename;
      if (currentFilenames.has(uniqueFilename)) {
        uniqueFilename = uniqueFilename.replace('.md', `-${i}.md`);
      }

      fs.writeFileSync(path.join(memoryDir, uniqueFilename), content);
      currentFilenames.add(uniqueFilename);

      writtenFiles.push({
        filename: uniqueFilename,
        name: generateName(rule),
        description: generateDescription(rule),
      });
    }

    // Clean up stale recall_* files from previous syncs
    const removed = cleanupStaleFiles(memoryDir, currentFilenames);

    // Update MEMORY.md index
    updateMemoryMdIndex(memoryDir, writtenFiles);

    hookLog('memory-sync', `Synced ${writtenFiles.length} files to ${memoryDir} (removed ${removed} stale)`);
  } catch (error) {
    hookLog('memory-sync', `Error: ${(error as Error).message}`);
  }
}

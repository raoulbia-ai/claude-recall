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
 * Matches Claude Code's convention: ~/.claude/projects/{cwd with / replaced by -}/memory/
 */
export function deriveAutoMemoryPath(cwd: string, homedir?: string): string {
  const home = homedir || os.homedir();
  const sanitized = cwd.replace(/\//g, '-');
  return path.join(home, '.claude', 'projects', sanitized, 'memory');
}

/**
 * Extract display value from a memory record.
 */
function extractValue(value: any): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null) {
    return value.content || value.value || JSON.stringify(value);
  }
  return String(value ?? '');
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

    // Filter out test data and secrets
    const filtered = rules.filter(r => {
      if (isTestData(r.key)) return false;
      const val = extractValue(r.value);
      if (containsSecret(val)) return false;
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

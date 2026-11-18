import * as fs from 'fs';
import * as path from 'path';

/**
 * Removal of skill files that older releases generated from memories.
 *
 * Auto-generated skills were removed as a feature (a skill is a persistent
 * instruction, and building one from stored memories let a steered agent
 * plant one; docs/design-memory-poisoning-defense.md). Files they left behind
 * are still loaded by Claude Code, so `claude-recall skills clean` deletes
 * them — only folders whose SKILL.md says claude-recall generated them, so a
 * hand-written skill named auto-something is never touched.
 */
export function isGeneratedSkill(skillDir: string): boolean {
  try {
    const head = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8').slice(0, 2000);
    const frontmatter = head.startsWith('---') ? head.slice(3, head.indexOf('\n---', 3)) : '';
    return /^\s*auto-generated:\s*true\s*$/m.test(frontmatter) && /^\s*source:\s*claude-recall\s*$/m.test(frontmatter);
  } catch {
    return false;
  }
}

/** Generated skill folders under <projectDir>/.claude/skills (names only). */
export function findGeneratedSkills(projectDir: string): string[] {
  const base = path.join(projectDir, '.claude', 'skills');
  try {
    return fs.readdirSync(base, { withFileTypes: true })
      .filter(e => e.isDirectory() && e.name.startsWith('auto-') && isGeneratedSkill(path.join(base, e.name)))
      .map(e => e.name);
  } catch {
    return [];
  }
}

/** Delete them. Returns the folder names removed. */
export function cleanGeneratedSkills(projectDir: string): string[] {
  const base = path.join(projectDir, '.claude', 'skills');
  const found = findGeneratedSkills(projectDir);
  for (const name of found) fs.rmSync(path.join(base, name), { recursive: true, force: true });
  return found;
}

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { cleanGeneratedSkills, findGeneratedSkills } from '../../src/services/auto-skill-cleanup';

/** `skills clean` deletes only folders claude-recall generated, never a hand-written skill. */
describe('auto-skill cleanup', () => {
  let dir: string;
  const skill = (name: string, frontmatter: string) => {
    const d = path.join(dir, '.claude', 'skills', name);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'SKILL.md'), `---\n${frontmatter}\n---\n\n# x\n`);
  };

  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-skills-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('finds and removes generated skills only', () => {
    skill('auto-preferences', 'name: auto-preferences\nauto-generated: true\nsource: claude-recall');
    skill('auto-mine', 'name: auto-mine\ndescription: written by hand');
    skill('memory-management', 'name: memory-management\nsource: claude-recall');

    expect(findGeneratedSkills(dir)).toEqual(['auto-preferences']);
    expect(cleanGeneratedSkills(dir)).toEqual(['auto-preferences']);
    const left = fs.readdirSync(path.join(dir, '.claude', 'skills')).sort();
    expect(left).toEqual(['auto-mine', 'memory-management']);
  });

  it('copes with a project that has no skills folder', () => {
    expect(findGeneratedSkills(dir)).toEqual([]);
    expect(cleanGeneratedSkills(dir)).toEqual([]);
  });
});

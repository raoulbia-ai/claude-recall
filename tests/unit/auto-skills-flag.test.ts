import { autoSkillsEnabled } from '../../src/mcp/tools/memory-tools';

/**
 * Auto-skills are opt-in. A skill file is a persistent instruction Claude Code
 * loads, and building one from whatever store_memory just received turns any
 * steered store into a lasting instruction.
 */
describe('autoSkillsEnabled', () => {
  const prev = process.env.CLAUDE_RECALL_AUTO_SKILLS;
  afterEach(() => {
    if (prev === undefined) delete process.env.CLAUDE_RECALL_AUTO_SKILLS;
    else process.env.CLAUDE_RECALL_AUTO_SKILLS = prev;
  });

  it('is off by default', () => {
    delete process.env.CLAUDE_RECALL_AUTO_SKILLS;
    expect(autoSkillsEnabled()).toBe(false);
  });

  it('turns on only for an explicit yes', () => {
    for (const v of ['1', 'true', 'on', 'ON']) {
      process.env.CLAUDE_RECALL_AUTO_SKILLS = v;
      expect(autoSkillsEnabled()).toBe(true);
    }
    for (const v of ['0', 'false', 'off', 'yes please', '']) {
      process.env.CLAUDE_RECALL_AUTO_SKILLS = v;
      expect(autoSkillsEnabled()).toBe(false);
    }
  });
});

/**
 * CLAUDE_RECALL_PROJECT_ID pins the project scope, overriding cwd detection.
 *
 * Motivation: `kiro --resume` restores the resumed conversation's working
 * directory, which may be a different project than the user intends. Pinning
 * forces a fixed project regardless of the reported cwd.
 */
describe('ConfigService project pin', () => {
  const saved = {
    recall: process.env.CLAUDE_RECALL_PROJECT_ID,
    legacy: process.env.CLAUDE_PROJECT_ID,
    dir: process.env.CLAUDE_PROJECT_DIR,
  };

  afterEach(() => {
    for (const [k, v] of [
      ['CLAUDE_RECALL_PROJECT_ID', saved.recall],
      ['CLAUDE_PROJECT_ID', saved.legacy],
      ['CLAUDE_PROJECT_DIR', saved.dir],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    jest.resetModules();
  });

  function freshProjectId(): string {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ConfigService } = require('../../src/services/config');
    return ConfigService.getInstance().getProjectId();
  }

  it('CLAUDE_RECALL_PROJECT_ID overrides the working directory', () => {
    process.env.CLAUDE_PROJECT_DIR = '/some/path/rapp-generator';
    delete process.env.CLAUDE_RECALL_PROJECT_ID;
    delete process.env.CLAUDE_PROJECT_ID;
    expect(freshProjectId()).toBe('rapp-generator'); // from cwd

    process.env.CLAUDE_RECALL_PROJECT_ID = 'epic-workflow-cicd';
    expect(freshProjectId()).toBe('epic-workflow-cicd'); // pinned wins
  });

  it('falls back to CLAUDE_PROJECT_ID for backward compatibility', () => {
    process.env.CLAUDE_PROJECT_DIR = '/some/path/rapp-generator';
    delete process.env.CLAUDE_RECALL_PROJECT_ID;
    process.env.CLAUDE_PROJECT_ID = 'legacy-pin';
    expect(freshProjectId()).toBe('legacy-pin');
  });

  it('CLAUDE_RECALL_PROJECT_ID takes precedence over CLAUDE_PROJECT_ID', () => {
    process.env.CLAUDE_RECALL_PROJECT_ID = 'recall-pin';
    process.env.CLAUDE_PROJECT_ID = 'legacy-pin';
    expect(freshProjectId()).toBe('recall-pin');
  });
});

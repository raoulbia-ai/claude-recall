/**
 * CLAUDE_RECALL_PROJECT_ID pins the project scope, overriding cwd detection.
 *
 * Motivation: force a fixed project id regardless of the reported cwd —
 * e.g. when one logical project spans several directories (worktrees,
 * subrepos) or a runtime reports an unexpected working directory.
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

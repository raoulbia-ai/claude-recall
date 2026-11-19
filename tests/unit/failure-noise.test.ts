import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  failureNoiseReason, isLookupCommand, isKilledExit, isKnownFailure, externalFailureRepeats,
} from '../../src/shared/failure-noise';
import { MemoryService } from '../../src/services/memory';

const bash = (command: string, text: string) => failureNoiseReason({ toolName: 'Bash', command, text });

/** Examples are taken from failures a user rejected or the janitor demoted. */
describe('failure noise filter', () => {
  describe('1. lookups that answered "no"', () => {
    it.each([
      ['ls tests/unit/x.test.ts; git check-ignore -v tests/unit/x.test.ts', "Exit code 1\nls: cannot access 'tests/unit/x.test.ts': No such file or directory"],
      ['ls ~/docs; ls ~/docs/*linkedin* 2>/dev/null', 'Exit code 2\ndgx-spark-ssh-setup.md'],
      ['ls -la /tmp/docs', "Exit code 2\nls: cannot access '/tmp/docs': No such file or directory"],
      ['cat results/study2-pilot.log; wc -l results/episodes.jsonl 2>/dev/null', 'Exit code 1\ncat: results/study2-pilot.log: No such file'],
      ["grep -n -iE 'refresh|token' ~/bin/start.sh | head -30; echo ===; grep -n sso ~/bin/x", 'Exit code 1\n=== nothing found here'],
    ])('skips %s', (command, text) => {
      expect(bash(command, text)).toMatch(/lookup answered "no"/);
    });

    it('keeps a lookup that failed in an unusual way (exit 127, say)', () => {
      expect(isLookupCommand('ls foo')).toBe(true);
      expect(bash('ls foo', 'Exit code 3\nls: weird failure on the device')).toBeNull();
    });

    it('does not treat writing commands as lookups', () => {
      expect(isLookupCommand('cat > out.txt')).toBe(false);
      expect(isLookupCommand('echo hi >> notes.md')).toBe(false);
      expect(isLookupCommand('npm run build && ls dist')).toBe(false);
      expect(isLookupCommand('ls foo 2>/dev/null; grep x y 2>&1')).toBe(true);
    });

    it('keeps real failures', () => {
      expect(bash('npm run build', 'Exit code 2\nsrc/a.ts(3,1): error TS2304: Cannot find name x')).toBeNull();
      expect(bash('gh pr merge 132 --squash', 'Exit code 1\nGraphQL: Base branch policy prohibits the merge')).toBeNull();
    });
  });

  describe('2. processes that were killed', () => {
    it.each(['124', '130', '137', '143', '144'])('exit %s is not a failure', code => {
      expect(isKilledExit(code)).toBe(true);
      expect(bash('pkill -f jest; timeout 500 npx jest --forceExit', `Exit code ${code}`)).toMatch(/killed or timed out/);
    });

    it('ordinary and ssh exit codes are not "killed"', () => {
      expect(isKilledExit('1')).toBe(false);
      expect(isKilledExit('128')).toBe(false);
      expect(isKilledExit('255')).toBe(false);
    });
  });

  describe('3. the same failure through two capture paths', () => {
    const db = () => MemoryService.getInstance().getStorage().getDatabase();
    beforeEach(() => db().prepare('DELETE FROM memories').run());

    it('finds a command already recorded, in any state', () => {
      const cmd = 'gh pr review 132 --approve --body "Thanks for splitting this out — merging."';
      expect(isKnownFailure(db(), cmd)).toBe(false);
      MemoryService.getInstance().store({
        key: 'f1', origin: 'tool', type: 'failure',
        value: { what_failed: `Bash command failed: ${cmd}`, why_failed: 'Exit code 1' },
      });
      // the other path words it differently but carries the same command
      expect(isKnownFailure(db(), cmd)).toBe(true);
      // still found after the user rejected it: it must not come back for review
      db().prepare("UPDATE memories SET is_active = 0, superseded_by = 'user-rejected'").run();
      expect(isKnownFailure(db(), cmd)).toBe(true);
    });
  });

  describe('4. the outside world', () => {
    let dir: string;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-ext-')); });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('keeps an external failure only once a second session sees it', () => {
      const err = "API Error: 400 The following domains are not accessible: ['reddit.com']";
      expect(externalFailureRepeats(dir, 'WebSearch', err, 's1')).toBe(false);
      expect(externalFailureRepeats(dir, 'WebSearch', err, 's1')).toBe(false);
      expect(externalFailureRepeats(dir, 'WebSearch', err, 's2')).toBe(true);
    });
  });

  describe('5. nothing to learn', () => {
    it('skips a bare exit code with no message', () => {
      expect(bash('ssh -q dgx-spark "run-job --now"', 'Exit code 1')).toMatch(/no error message/);
    });

    it.each([
      [`python3 - <<'EOF'\nimport json\nd=json.load(open('plan.json'))\nprint(d['scenes'][0])\nEOF`, 'Exit code 1\nTraceback (most recent call last):\n  File "<stdin>", line 3, in <module>\nKeyError: \'scenes\''],
      [`ssh -q dgx-spark 'python3 - <<"EOF"\nprint(f"{r[\\"clip\\"]}")\nEOF'`, 'Exit code 1\n  File "<stdin>", line 6\n    print(f"{r[\\"clip\\"]:<13\nSyntaxError: unexpected character'],
      ['cat > $CLAUDE_JOB_DIR/tmp/film.py <<\'EOF\'\nimport sqlite3\nEOF\npython3 $CLAUDE_JOB_DIR/tmp/film.py', 'Exit code 1\nstate preparing | shots done []'],
    ])('skips a failing one-off script: %s', (command, text) => {
      expect(bash(command, text)).toMatch(/scratch directory|one-off inline script/);
    });

    it('keeps a one-off script that failed on a missing module (an environment lesson)', () => {
      expect(bash('python3 -c "import fitz"', 'Exit code 1\nTraceback (most recent call last):\n  File "<string>", line 1\nModuleNotFoundError: No module named \'fitz\'')).toBeNull();
    });

    it('skips one-off commands in the agent scratch directory', () => {
      const cmd = 'cd /tmp/claude-1000/-home-u-repo/abc/scratchpad && python3 probe.py';
      expect(bash(cmd, 'Exit code 1\nTraceback: KeyError: missing column')).toMatch(/scratch directory/);
    });
  });

  it('leaves non-Bash failures to the caller', () => {
    expect(failureNoiseReason({ toolName: 'Edit', text: 'old_string not found' })).toBeNull();
  });
});

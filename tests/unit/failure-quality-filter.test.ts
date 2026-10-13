/**
 * Fix B — Quality filter for failure capture.
 *
 * Pre-fix bug: tool-outcome-watcher stores ANY non-zero exit code as a failure
 * memory with generic boilerplate advice. Commands like `apptool sandbox list
 * 2>/dev/null`, `mytool eristatus`, `which nonexistent-tool` get stored as
 * permanent failure lessons with no actionable insight.
 *
 * Post-fix contract:
 *   - Exploratory probes (commands ending in `2>/dev/null`) are skipped.
 *   - Command-existence checks (`which`, `type`, `command -v`) are skipped.
 *   - Command-not-found errors are skipped (the user already knows the command doesn't exist).
 *   - Very short commands (< 5 chars) are skipped.
 *   - Failures that pass quality filters are still stored normally.
 */

// We test the filter function directly, not the full hook pipeline
// Import will be from the module once the filter is implemented
import { shouldCaptureFailure, isBenignNonZeroExit } from '../../src/hooks/tool-outcome-watcher';

describe('failure quality filter', () => {
  test('skips commands ending in 2>/dev/null (exploratory probes)', () => {
    expect(shouldCaptureFailure('apptool sandbox list 2>/dev/null', '1', 'command not found')).toBe(false);
    expect(shouldCaptureFailure('some-tool --check 2>/dev/null', '1', '')).toBe(false);
  });

  test('skips command-existence checks (which, type, command -v)', () => {
    expect(shouldCaptureFailure('which apptool', '1', '')).toBe(false);
    expect(shouldCaptureFailure('type mytool', '1', '')).toBe(false);
    expect(shouldCaptureFailure('command -v nonexistent', '127', '')).toBe(false);
  });

  test('skips command-not-found errors regardless of command', () => {
    expect(shouldCaptureFailure('mytool eristatus', '127', 'mytool: command not found')).toBe(false);
    expect(shouldCaptureFailure('apptool sandbox list', '127', 'apptool: command not found')).toBe(false);
  });

  test('skips very short commands', () => {
    expect(shouldCaptureFailure('ls', '1', '')).toBe(false);
    expect(shouldCaptureFailure('cd', '1', '')).toBe(false);
  });

  test('allows legitimate build/test failures', () => {
    expect(shouldCaptureFailure('npm run build', '1', 'error TS2345: Argument of type...')).toBe(true);
    expect(shouldCaptureFailure('npx jest tests/unit/storage.test.ts', '1', 'Tests: 2 failed')).toBe(true);
    expect(shouldCaptureFailure('python manage.py migrate', '1', 'django.db.utils.OperationalError')).toBe(true);
  });

  test('allows failures with substantial output even for unknown commands', () => {
    expect(shouldCaptureFailure(
      'docker compose up',
      '1',
      'Error response from daemon: driver failed programming external connectivity',
    )).toBe(true);
  });

  test('skips read/stat probes on files (EISDIR, ENOENT from quick checks)', () => {
    expect(shouldCaptureFailure('cat /some/dir', '1', 'Is a directory')).toBe(false);
    expect(shouldCaptureFailure('cat nonexistent 2>/dev/null', '1', '')).toBe(false);
  });

  test('skips exit-code-only failures with no useful output', () => {
    expect(shouldCaptureFailure('some-unknown-tool --flag', '1', '')).toBe(false);
    expect(shouldCaptureFailure('some-unknown-tool --flag', '1', '(no output)')).toBe(false);
  });
});

// --- Regressions from a real report: benign non-zero exits captured as "failures" ---
// A user saw "🧠 Recall · 3 rules" where all three were noise: a `git config --get`
// that exited 1 only because the key was unset, curl health checks that timed out
// against a service that was actually fine, and one genuine (since-resolved) failure.
describe('benign non-zero exits are not failures', () => {
  it('does not capture a query-style exit 1 (the report\'s case #1)', () => {
    // exit 1 from `git config --get` just means "not set"
    expect(shouldCaptureFailure('git config --get tag.gpgsign', '1', '')).toBe(false);
    expect(shouldCaptureFailure('git config --get-all user.email', '1', '')).toBe(false);
    expect(shouldCaptureFailure('git diff --quiet HEAD', '1', '')).toBe(false);
    expect(shouldCaptureFailure('git ls-files --error-unmatch .claude/settings.json', '1', 'error: pathspec')).toBe(false);
  });

  it('does not capture grep/test/diff "no match / false / differs"', () => {
    expect(shouldCaptureFailure('grep -n "needle" haystack.txt', '1', '')).toBe(false);
    expect(shouldCaptureFailure('rg "pattern" src/', '1', '')).toBe(false);
    expect(shouldCaptureFailure('test -f /some/missing/path', '1', '')).toBe(false);
    expect(shouldCaptureFailure('diff a.txt b.txt', '1', '< line one')).toBe(false);
  });

  it('does not capture a pipeline whose tail is a query command', () => {
    expect(shouldCaptureFailure('cat big.log | grep "ERROR"', '1', '')).toBe(false);
    expect(shouldCaptureFailure('ps aux | grep -c somedaemon', '1', '')).toBe(false);
  });

  it('does not capture transient network/timeout exits (the report\'s case #2)', () => {
    expect(shouldCaptureFailure('curl -sS http://localhost:5173/health', '28', 'timed out')).toBe(false);
    expect(shouldCaptureFailure('curl -f https://spark.local/api', '7', 'Failed to connect')).toBe(false);
    expect(shouldCaptureFailure('timeout 5 ./wait-for-it.sh', '124', '')).toBe(false);
  });

  it('STILL captures genuine failures — including the report\'s case #3', () => {
    // the real one: a commit that failed on GPG signing (resolved later, but a real failure)
    expect(shouldCaptureFailure(
      'git commit -m "add CLAUDE.md"', '1',
      'error: gpg failed to sign the data\nfatal: failed to write commit object',
    )).toBe(true);
    // grep exit 2 is a real error, not "no match"
    expect(shouldCaptureFailure('grep -r "x" /nope', '2', 'grep: /nope: No such file or directory')).toBe(true);
    expect(shouldCaptureFailure('npm run build', '1', 'error TS2345: Argument of type...')).toBe(true);
  });
});

describe('isBenignNonZeroExit', () => {
  it('treats exit 1 as benign only for query-style commands', () => {
    expect(isBenignNonZeroExit('git config --get x.y', '1')).toBe(true);
    expect(isBenignNonZeroExit('grep foo bar', '1')).toBe(true);
    expect(isBenignNonZeroExit('grep foo bar', '2')).toBe(false); // real grep error
    expect(isBenignNonZeroExit('npm run build', '1')).toBe(false);
  });
  it('treats known transient network/timeout exits as benign', () => {
    expect(isBenignNonZeroExit('curl http://x', '28')).toBe(true);
    expect(isBenignNonZeroExit('curl http://x', '22')).toBe(false); // HTTP error is real
  });
});

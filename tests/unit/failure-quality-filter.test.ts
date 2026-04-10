/**
 * Fix B — Quality filter for failure capture.
 *
 * Pre-fix bug: tool-outcome-watcher stores ANY non-zero exit code as a failure
 * memory with generic boilerplate advice. Commands like `openshell sandbox list
 * 2>/dev/null`, `ericai eristatus`, `which nonexistent-tool` get stored as
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
import { shouldCaptureFailure } from '../../src/hooks/tool-outcome-watcher';

describe('failure quality filter', () => {
  test('skips commands ending in 2>/dev/null (exploratory probes)', () => {
    expect(shouldCaptureFailure('openshell sandbox list 2>/dev/null', '1', 'command not found')).toBe(false);
    expect(shouldCaptureFailure('some-tool --check 2>/dev/null', '1', '')).toBe(false);
  });

  test('skips command-existence checks (which, type, command -v)', () => {
    expect(shouldCaptureFailure('which openshell', '1', '')).toBe(false);
    expect(shouldCaptureFailure('type ericai', '1', '')).toBe(false);
    expect(shouldCaptureFailure('command -v nonexistent', '127', '')).toBe(false);
  });

  test('skips command-not-found errors regardless of command', () => {
    expect(shouldCaptureFailure('ericai eristatus', '127', 'ericai: command not found')).toBe(false);
    expect(shouldCaptureFailure('openshell sandbox list', '127', 'openshell: command not found')).toBe(false);
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

import { detectTranscriptFailures, DetectedFailure } from '../../src/hooks/failure-detectors';
import {
  extractToolCalls,
  extractToolResults,
  extractToolInteractions,
  extractAssistantTexts,
} from '../../src/hooks/shared';

// --- Test helpers: create mock transcript entries ---

function makeAssistantToolUse(
  name: string,
  input: any,
  id: string,
): object {
  return {
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id, name, input }],
    },
  };
}

function makeUserToolResult(
  toolUseId: string,
  content: string,
  isError: boolean = false,
): object {
  return {
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: isError }],
    },
  };
}

function makeAssistantText(text: string): object {
  return {
    message: {
      role: 'assistant',
      content: [{ type: 'text', text }],
    },
  };
}

// --- Helper tests ---

describe('extractToolCalls', () => {
  it('extracts tool_use blocks from assistant entries', () => {
    const entry = makeAssistantToolUse('Bash', { command: 'ls' }, 'tc1');
    const calls = extractToolCalls(entry, 0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      id: 'tc1',
      name: 'Bash',
      input: { command: 'ls' },
      entryIndex: 0,
    });
  });

  it('returns empty for non-array content', () => {
    expect(extractToolCalls({ message: { content: 'text' } }, 0)).toEqual([]);
    expect(extractToolCalls({}, 0)).toEqual([]);
  });
});

describe('extractToolResults', () => {
  it('extracts tool_result blocks from user entries', () => {
    const entry = makeUserToolResult('tc1', 'output text', false);
    const results = extractToolResults(entry, 1);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      toolUseId: 'tc1',
      content: 'output text',
      isError: false,
      entryIndex: 1,
    });
  });

  it('handles array content blocks in tool results', () => {
    const entry = {
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'tc2',
          content: [{ type: 'text', text: 'line1' }, { type: 'text', text: 'line2' }],
          is_error: true,
        }],
      },
    };
    const results = extractToolResults(entry, 2);
    expect(results[0].content).toBe('line1\nline2');
    expect(results[0].isError).toBe(true);
  });
});

describe('extractToolInteractions', () => {
  it('pairs calls with results', () => {
    const entries = [
      makeAssistantToolUse('Bash', { command: 'ls' }, 'tc1'),
      makeUserToolResult('tc1', 'file.txt'),
    ];
    const interactions = extractToolInteractions(entries);
    expect(interactions).toHaveLength(1);
    expect(interactions[0].call.name).toBe('Bash');
    expect(interactions[0].result?.content).toBe('file.txt');
  });

  it('handles unpaired calls', () => {
    const entries = [
      makeAssistantToolUse('Bash', { command: 'ls' }, 'tc1'),
    ];
    const interactions = extractToolInteractions(entries);
    expect(interactions).toHaveLength(1);
    expect(interactions[0].result).toBeNull();
  });
});

describe('extractAssistantTexts', () => {
  it('extracts text from assistant entries', () => {
    const entries = [
      makeAssistantText('hello'),
      makeUserToolResult('tc1', 'output'),
      makeAssistantText('world'),
    ];
    const texts = extractAssistantTexts(entries);
    expect(texts).toHaveLength(2);
    expect(texts[0]).toEqual({ text: 'hello', entryIndex: 0 });
    expect(texts[1]).toEqual({ text: 'world', entryIndex: 2 });
  });

  it('skips empty text', () => {
    const entries = [makeAssistantText('  ')];
    expect(extractAssistantTexts(entries)).toHaveLength(0);
  });
});

// --- Detector tests ---

describe('detectTranscriptFailures', () => {
  it('returns empty array for empty transcript', () => {
    expect(detectTranscriptFailures([])).toEqual([]);
  });

  it('returns empty for clean transcript', () => {
    const entries = [
      makeAssistantToolUse('Bash', { command: 'ls' }, 'tc1'),
      makeUserToolResult('tc1', 'file.txt'),
      makeAssistantText('Here are the files.'),
    ];
    expect(detectTranscriptFailures(entries)).toEqual([]);
  });

  describe('non-zero exit codes', () => {
    it('detects non-zero exit code', () => {
      const entries = [
        makeAssistantToolUse('Bash', { command: 'ls /nonexistent' }, 'tc1'),
        makeUserToolResult('tc1', 'ls: cannot access: No such file or directory\nExit code 1', true),
      ];
      const failures = detectTranscriptFailures(entries);
      expect(failures).toHaveLength(1);
      expect(failures[0].signal).toBe('non-zero-exit');
      expect(failures[0].confidence).toBe(0.85);
      expect(failures[0].content.what_failed).toContain('ls /nonexistent');
    });

    it('skips hook infrastructure errors', () => {
      const entries = [
        makeAssistantToolUse('Bash', { command: 'test' }, 'tc1'),
        makeUserToolResult('tc1', 'PreToolUse hook failed\nExit code 1', true),
      ];
      expect(detectTranscriptFailures(entries)).toEqual([]);
    });

    it('deduplicates same command', () => {
      const entries = [
        makeAssistantToolUse('Bash', { command: 'npm test' }, 'tc1'),
        makeUserToolResult('tc1', 'Error\nExit code 1', true),
        makeAssistantToolUse('Bash', { command: 'npm test' }, 'tc2'),
        makeUserToolResult('tc2', 'Error again\nExit code 1', true),
      ];
      const failures = detectTranscriptFailures(entries);
      // Should dedup to 1
      expect(failures.filter(f => f.signal === 'non-zero-exit')).toHaveLength(1);
    });
  });

  describe('silent test failures', () => {
    it('detects FAIL in test output with exit 0', () => {
      const entries = [
        makeAssistantToolUse('Bash', { command: 'npx jest tests/unit/foo.test.ts' }, 'tc1'),
        makeUserToolResult('tc1', 'FAIL tests/unit/foo.test.ts\n  ● test one\nTests: 1 failed, 1 total'),
      ];
      const failures = detectTranscriptFailures(entries);
      expect(failures).toHaveLength(1);
      expect(failures[0].signal).toBe('silent-test-failure');
      expect(failures[0].confidence).toBe(0.80);
    });

    it('ignores non-test commands', () => {
      const entries = [
        makeAssistantToolUse('Bash', { command: 'npm run build' }, 'tc1'),
        makeUserToolResult('tc1', 'FAIL something'),
      ];
      expect(detectTranscriptFailures(entries)).toEqual([]);
    });

    it('skips clean test passes', () => {
      const entries = [
        makeAssistantToolUse('Bash', { command: 'npx jest' }, 'tc1'),
        makeUserToolResult('tc1', 'PASS tests/unit/foo.test.ts\nTests: 5 passed, 5 total'),
      ];
      expect(detectTranscriptFailures(entries)).toEqual([]);
    });
  });

  describe('edit-test cycles', () => {
    it('detects 3+ edit-test cycles', () => {
      const entries = [
        // Cycle 1: test fails
        makeAssistantToolUse('Bash', { command: 'npx jest tests/foo.test.ts' }, 'tc1'),
        makeUserToolResult('tc1', 'FAIL tests/foo.test.ts\nTests: 1 failed', false),
        // Edit
        makeAssistantToolUse('Edit', { file_path: '/src/foo.ts', old_string: 'a', new_string: 'b' }, 'tc2'),
        makeUserToolResult('tc2', 'File edited'),
        // Cycle 2: test fails again
        makeAssistantToolUse('Bash', { command: 'npx jest tests/foo.test.ts' }, 'tc3'),
        makeUserToolResult('tc3', 'FAIL tests/foo.test.ts\nTests: 1 failed', false),
        // Edit again
        makeAssistantToolUse('Edit', { file_path: '/src/foo.ts', old_string: 'b', new_string: 'c' }, 'tc4'),
        makeUserToolResult('tc4', 'File edited'),
        // Cycle 3: test fails yet again
        makeAssistantToolUse('Bash', { command: 'npx jest tests/foo.test.ts' }, 'tc5'),
        makeUserToolResult('tc5', 'FAIL tests/foo.test.ts\nTests: 1 failed', false),
      ];
      const failures = detectTranscriptFailures(entries);
      const cycles = failures.filter(f => f.signal === 'edit-test-cycle');
      expect(cycles).toHaveLength(1);
      expect(cycles[0].content.what_failed).toContain('3');
    });

    it('does not detect fewer than 3 cycles', () => {
      const entries = [
        makeAssistantToolUse('Bash', { command: 'npx jest' }, 'tc1'),
        makeUserToolResult('tc1', 'FAIL\nTests: 1 failed', false),
        makeAssistantToolUse('Edit', { file_path: '/src/foo.ts', old_string: 'a', new_string: 'b' }, 'tc2'),
        makeUserToolResult('tc2', 'File edited'),
        makeAssistantToolUse('Bash', { command: 'npx jest' }, 'tc3'),
        makeUserToolResult('tc3', 'PASS\nTests: 1 passed', false),
      ];
      const failures = detectTranscriptFailures(entries);
      const cycles = failures.filter(f => f.signal === 'edit-test-cycle');
      expect(cycles).toHaveLength(0);
    });
  });

  describe('backtracking', () => {
    it('detects backtracking language', () => {
      const entries = [
        makeAssistantText('I\'ll try modifying the config file.'),
        makeAssistantText('Hmm, that didn\'t work. Let me try a different approach.'),
      ];
      const failures = detectTranscriptFailures(entries);
      expect(failures).toHaveLength(1);
      expect(failures[0].signal).toBe('backtracking');
      expect(failures[0].confidence).toBe(0.65);
    });

    it('groups nearby matches', () => {
      const entries = [
        makeAssistantText('Let me try a different approach.'),
        makeAssistantText('filler'),
        makeAssistantText('Actually, let me reconsider.'),
      ];
      const failures = detectTranscriptFailures(entries);
      // Should be grouped into 1 failure since entries are within 5 of each other
      const backtrack = failures.filter(f => f.signal === 'backtracking');
      expect(backtrack).toHaveLength(1);
    });

    it('returns empty for normal text', () => {
      const entries = [
        makeAssistantText('Here is the implementation.'),
        makeAssistantText('The tests pass successfully.'),
      ];
      const failures = detectTranscriptFailures(entries);
      const backtrack = failures.filter(f => f.signal === 'backtracking');
      expect(backtrack).toHaveLength(0);
    });
  });

  describe('retry loops', () => {
    it('detects 3x same call', () => {
      const input = { command: 'npm install' };
      const entries = [
        makeAssistantToolUse('Bash', input, 'tc1'),
        makeUserToolResult('tc1', 'error', true),
        makeAssistantToolUse('Bash', input, 'tc2'),
        makeUserToolResult('tc2', 'error', true),
        makeAssistantToolUse('Bash', input, 'tc3'),
        makeUserToolResult('tc3', 'error', true),
      ];
      const failures = detectTranscriptFailures(entries);
      const retries = failures.filter(f => f.signal === 'retry-loop');
      expect(retries).toHaveLength(1);
      expect(retries[0].content.what_failed).toContain('3 times');
    });

    it('skips Read calls', () => {
      const entries = [
        makeAssistantToolUse('Read', { file_path: '/src/foo.ts' }, 'tc1'),
        makeUserToolResult('tc1', 'content'),
        makeAssistantToolUse('Read', { file_path: '/src/foo.ts' }, 'tc2'),
        makeUserToolResult('tc2', 'content'),
        makeAssistantToolUse('Read', { file_path: '/src/foo.ts' }, 'tc3'),
        makeUserToolResult('tc3', 'content'),
      ];
      const failures = detectTranscriptFailures(entries);
      const retries = failures.filter(f => f.signal === 'retry-loop');
      expect(retries).toHaveLength(0);
    });
  });

  describe('orchestrator', () => {
    it('caps at 3 total failures', () => {
      // Create many failures
      const entries: object[] = [];
      for (let i = 0; i < 10; i++) {
        entries.push(
          makeAssistantToolUse('Bash', { command: `failing-cmd-${i}` }, `tc${i * 2}`),
          makeUserToolResult(`tc${i * 2}`, `Error output\nExit code 1`, true),
        );
      }
      const failures = detectTranscriptFailures(entries);
      expect(failures.length).toBeLessThanOrEqual(3);
    });

    it('prioritizes by detector order (non-zero > silent > cycle > backtrack > retry)', () => {
      const entries = [
        // Non-zero exit
        makeAssistantToolUse('Bash', { command: 'false' }, 'tc1'),
        makeUserToolResult('tc1', 'Exit code 1', true),
        // Backtracking
        makeAssistantText('Let me try a different approach.'),
      ];
      const failures = detectTranscriptFailures(entries);
      expect(failures.length).toBeGreaterThanOrEqual(1);
      expect(failures[0].signal).toBe('non-zero-exit');
    });
  });
});

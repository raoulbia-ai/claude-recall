import { HookCapture, HookEvent } from '../../src/hooks/capture';

describe('HookCapture', () => {
  let capture: HookCapture;

  beforeEach(() => {
    capture = new HookCapture();
  });

  it('should capture events correctly', () => {
    const event: HookEvent = {
      type: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file: 'test.ts' },
      timestamp: Date.now(),
      session_id: 'test-session'
    };
    
    capture.capture(event);
    expect(capture.getEvents()).toHaveLength(1);
    expect(capture.getEvents()[0]).toEqual(event);
  });

  it('should store multiple events', () => {
    const event1: HookEvent = {
      type: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file: 'test1.ts' },
      timestamp: Date.now(),
      session_id: 'test-session-1'
    };

    const event2: HookEvent = {
      type: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      timestamp: Date.now(),
      session_id: 'test-session-2'
    };

    capture.capture(event1);
    capture.capture(event2);

    expect(capture.getEvents()).toHaveLength(2);
    expect(capture.getEventCount()).toBe(2);
  });

  it('should return a copy of events array', () => {
    const event: HookEvent = {
      type: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { file_path: 'test.ts' },
      timestamp: Date.now(),
      session_id: 'test-session'
    };

    capture.capture(event);
    const events = capture.getEvents();
    events.pop(); // Modify the returned array

    // Original events should not be affected
    expect(capture.getEvents()).toHaveLength(1);
  });

  it('should clear events when requested', () => {
    const event: HookEvent = {
      type: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: 'test.ts', content: 'test' },
      timestamp: Date.now(),
      session_id: 'test-session'
    };

    capture.capture(event);
    expect(capture.getEventCount()).toBe(1);

    capture.clearEvents();
    expect(capture.getEventCount()).toBe(0);
    expect(capture.getEvents()).toHaveLength(0);
  });
});
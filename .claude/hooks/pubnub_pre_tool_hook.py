#!/usr/bin/env python3
"""
PubNub-enabled pre-tool hook for Claude Recall.

This lightweight hook:
1. Publishes tool execution event to PubNub (async, non-blocking)
2. Allows execution to proceed immediately
3. Memory Agent subscribes to events and provides context asynchronously

No blocking, no waiting - just publish and continue.
This makes hooks fast and Claude Code responsive.

Exit codes:
- 0: Always allow (non-blocking design)
"""
import json
import sys
import subprocess
import os
from typing import Dict, Any

# Path to Node.js publisher
PUBLISHER_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    'dist', 'pubnub', 'publisher-cli.js'
)


def publish_tool_event(hook_data: Dict[str, Any]) -> bool:
    """
    Publish tool execution event to PubNub.
    Fire-and-forget - doesn't wait for response.
    """
    try:
        tool_name = hook_data.get('tool_name', '')
        tool_input = hook_data.get('tool_input', {})
        session_id = hook_data.get('session_id', '')
        project_id = hook_data.get('project_id', '')

        # Construct event data
        event_data = {
            'sessionId': session_id,
            'toolName': tool_name,
            'toolInput': tool_input,
            'projectId': project_id
        }

        # Publish via Node.js CLI (non-blocking)
        subprocess.Popen(
            ['node', PUBLISHER_PATH, 'tool-pre', json.dumps(event_data)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True  # Detach from parent
        )

        return True

    except Exception as e:
        # Never block on errors - just log and continue
        print(f"[PubNub Hook] Warning: Event publish failed: {e}", file=sys.stderr)
        return False


def main():
    """
    Main hook entry point.
    Always allows execution - memory context will arrive asynchronously.
    """
    try:
        # Read hook data from stdin
        hook_data = json.load(sys.stdin)

        # Publish event (non-blocking)
        publish_tool_event(hook_data)

        # Always allow execution to proceed
        # Memory Agent will provide context asynchronously via PubNub
        sys.exit(0)

    except json.JSONDecodeError as e:
        # Parse error - log warning but don't block
        print(f"[PubNub Hook] Warning: Failed to parse hook input: {e}", file=sys.stderr)
        sys.exit(0)

    except Exception as e:
        # Any other error - log but don't block
        print(f"[PubNub Hook] Warning: Hook error: {e}", file=sys.stderr)
        sys.exit(0)


if __name__ == '__main__':
    main()

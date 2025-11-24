#!/usr/bin/env python3
"""
PubNub-enabled prompt capture hook for Claude Recall.

Publishes user prompts to PubNub for the Memory Agent to analyze
and extract preferences/patterns autonomously.

Non-blocking, fire-and-forget design.

Exit codes:
- 0: Always allow (non-blocking)
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


def publish_prompt_event(hook_data: Dict[str, Any]) -> bool:
    """
    Publish user prompt to PubNub for Memory Agent analysis.
    Fire-and-forget - doesn't wait for response.
    """
    try:
        # Extract prompt content (handle different Claude Code versions)
        prompt_content = (
            hook_data.get('prompt', '') or
            hook_data.get('content', '') or
            hook_data.get('message', '')
        )

        if not prompt_content:
            return False

        session_id = hook_data.get('session_id', '')
        project_id = hook_data.get('project_id', '')

        # Construct event data
        event_data = {
            'sessionId': session_id,
            'content': prompt_content,
            'projectId': project_id
        }

        # Publish via Node.js CLI (non-blocking)
        subprocess.Popen(
            ['node', PUBLISHER_PATH, 'prompt', json.dumps(event_data)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True  # Detach from parent
        )

        return True

    except Exception as e:
        # Never block on errors
        print(f"[PubNub Hook] Warning: Prompt publish failed: {e}", file=sys.stderr)
        return False


def main():
    """
    Main hook entry point.
    Always allows execution - prompt analysis happens asynchronously.
    """
    try:
        # Read hook data from stdin
        hook_data = json.load(sys.stdin)

        # Publish prompt event (non-blocking)
        publish_prompt_event(hook_data)

        # Always allow prompt to proceed
        sys.exit(0)

    except json.JSONDecodeError as e:
        print(f"[PubNub Hook] Warning: Failed to parse hook input: {e}", file=sys.stderr)
        sys.exit(0)

    except Exception as e:
        print(f"[PubNub Hook] Warning: Hook error: {e}", file=sys.stderr)
        sys.exit(0)


if __name__ == '__main__':
    main()

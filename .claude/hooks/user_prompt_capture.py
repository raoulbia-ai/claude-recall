#!/usr/bin/env python3
"""
User prompt capture hook for Claude Recall.
Captures user prompts and passes them to the MCP server for processing.

This hook is part of Phase 3 (Post-Action) of the learning loop:
- Captures user prompts for preference extraction
- Logs prompt submission events
- Enables pattern detection and learning

Exit codes:
- 0: Always allow (this hook is non-blocking)
"""
import json
import sys
import subprocess
from typing import Dict, Any


def capture_prompt(hook_data: Dict[str, Any]) -> None:
    """Send prompt data to Claude Recall for processing."""
    try:
        # Extract prompt content
        # The structure varies based on Claude Code version
        prompt_content = (
            hook_data.get('prompt', '') or
            hook_data.get('content', '') or
            hook_data.get('message', '')
        )

        if not prompt_content:
            return

        session_id = hook_data.get('session_id', '')

        # Store prompt metadata via CLI
        # This will be picked up by the MCP server's hook event processor
        subprocess.run(
            [
                'claude-recall',
                'capture-prompt',
                '--session', session_id,
                '--content', prompt_content
            ],
            capture_output=True,
            text=True,
            timeout=2
        )

    except Exception as e:
        # Don't block on errors - this is best-effort capture
        print(f"Warning: Prompt capture failed: {e}", file=sys.stderr)


def main():
    # Read JSON from stdin
    try:
        hook_data = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(f"Warning: Failed to parse hook input: {e}", file=sys.stderr)
        sys.exit(0)  # Always allow

    # Capture the prompt (non-blocking)
    capture_prompt(hook_data)

    # Always allow prompt to proceed
    sys.exit(0)


if __name__ == '__main__':
    main()

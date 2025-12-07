#!/usr/bin/env python3
"""
MCP Tool Tracker Hook for Claude Recall.

This hook fires on mcp__claude-recall__* tool calls and records them
to a session state file. This enables the search enforcer hook to
verify that memory search was performed before file operations.

State file location: ~/.claude-recall/hook-state/{session_id}.json

Exit codes:
- 0: Always allow (this is a tracking hook, never blocks)
"""
import json
import sys
import os
from pathlib import Path
from typing import Dict, Any
from datetime import datetime

# State directory
STATE_DIR = Path.home() / '.claude-recall' / 'hook-state'

# Maximum tool history entries to keep per session
MAX_TOOL_HISTORY = 20

# Tools we specifically track (for search enforcement)
TRACKED_TOOLS = [
    'mcp__claude-recall__search',
    'mcp__claude-recall__mcp__claude-recall__search',
    'mcp__claude-recall__retrieve_memory',
    'mcp__claude-recall__mcp__claude-recall__retrieve_memory',
]


def ensure_state_dir() -> None:
    """Ensure the state directory exists."""
    STATE_DIR.mkdir(parents=True, exist_ok=True)


def get_state_file(session_id: str) -> Path:
    """Get the state file path for a session."""
    # Sanitize session_id for filesystem
    safe_id = "".join(c if c.isalnum() or c in '-_' else '_' for c in session_id)
    if not safe_id:
        safe_id = 'default'
    return STATE_DIR / f'{safe_id}.json'


def load_state(session_id: str) -> Dict[str, Any]:
    """Load existing state or return empty state."""
    state_file = get_state_file(session_id)
    if state_file.exists():
        try:
            with open(state_file, 'r') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {
        'sessionId': session_id,
        'lastSearchAt': None,
        'searchQuery': None,
        'toolHistory': []
    }


def save_state(session_id: str, state: Dict[str, Any]) -> None:
    """Save state to file."""
    ensure_state_dir()
    state_file = get_state_file(session_id)
    try:
        with open(state_file, 'w') as f:
            json.dump(state, f, indent=2)
    except IOError as e:
        print(f"[MCP Tracker] Warning: Could not save state: {e}", file=sys.stderr)


def record_tool_call(session_id: str, tool_name: str, tool_input: Dict[str, Any]) -> None:
    """Record a tool call to the session state."""
    state = load_state(session_id)
    timestamp = int(datetime.now().timestamp() * 1000)

    # Add to tool history
    state['toolHistory'].append({
        'tool': tool_name,
        'at': timestamp
    })

    # Keep only recent entries
    if len(state['toolHistory']) > MAX_TOOL_HISTORY:
        state['toolHistory'] = state['toolHistory'][-MAX_TOOL_HISTORY:]

    # If this is a search tool, update search timestamp
    if any(tracked in tool_name for tracked in TRACKED_TOOLS):
        state['lastSearchAt'] = timestamp
        # Extract query if present
        query = tool_input.get('query', '')
        if query:
            state['searchQuery'] = query

    save_state(session_id, state)


def main():
    """
    Main hook entry point.
    Always allows execution - this is just tracking.
    """
    try:
        # Read hook data from stdin
        hook_data = json.load(sys.stdin)

        tool_name = hook_data.get('tool_name', '')
        tool_input = hook_data.get('tool_input', {})
        session_id = hook_data.get('session_id', '') or 'default'

        # Only track claude-recall MCP tools
        if 'claude-recall' in tool_name.lower():
            record_tool_call(session_id, tool_name, tool_input)

        # Always allow execution
        sys.exit(0)

    except json.JSONDecodeError as e:
        print(f"[MCP Tracker] Warning: Failed to parse hook input: {e}", file=sys.stderr)
        sys.exit(0)

    except Exception as e:
        print(f"[MCP Tracker] Warning: Hook error: {e}", file=sys.stderr)
        sys.exit(0)


if __name__ == '__main__':
    main()

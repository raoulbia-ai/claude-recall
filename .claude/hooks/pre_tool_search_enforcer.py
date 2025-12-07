#!/usr/bin/env python3
"""
Pre-tool hook to enforce memory search before file operations.
Ensures Phase 1 (Pre-Action) of the learning loop always happens.

This hook intercepts Write/Edit tool calls and blocks execution if
memory search wasn't performed first. It reads session state from
a file written by mcp_tool_tracker.py.

State file location: ~/.claude-recall/hook-state/{session_id}.json

Exit codes:
- 0: Allow execution (search was performed recently)
- 2: Block execution (search required)
"""
import json
import sys
import os
from pathlib import Path
from typing import Dict, Any, Optional
from datetime import datetime

# State directory (same as mcp_tool_tracker.py)
STATE_DIR = Path.home() / '.claude-recall' / 'hook-state'

# How long a search is considered "valid" (in milliseconds)
# Default: 5 minutes
SEARCH_TTL_MS = int(os.environ.get('CLAUDE_RECALL_SEARCH_TTL', 5 * 60 * 1000))

# Enforcement mode: 'block' (default), 'warn', 'off'
ENFORCE_MODE = os.environ.get('CLAUDE_RECALL_ENFORCE_MODE', 'block')


def get_state_file(session_id: str) -> Path:
    """Get the state file path for a session."""
    safe_id = "".join(c if c.isalnum() or c in '-_' else '_' for c in session_id)
    if not safe_id:
        safe_id = 'default'
    return STATE_DIR / f'{safe_id}.json'


def load_state(session_id: str) -> Optional[Dict[str, Any]]:
    """Load session state from file."""
    state_file = get_state_file(session_id)
    if not state_file.exists():
        return None
    try:
        with open(state_file, 'r') as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return None


def check_recent_search(session_id: str) -> tuple[bool, Optional[str], Optional[int]]:
    """
    Check if memory search was performed recently.

    Returns:
        (was_searched, query, ms_ago) - whether search was done, the query used, and how long ago
    """
    state = load_state(session_id)
    if not state:
        return (False, None, None)

    last_search = state.get('lastSearchAt')
    if not last_search:
        return (False, None, None)

    now = int(datetime.now().timestamp() * 1000)
    ms_ago = now - last_search

    # Check if within TTL
    if ms_ago <= SEARCH_TTL_MS:
        return (True, state.get('searchQuery'), ms_ago)

    return (False, state.get('searchQuery'), ms_ago)


def generate_search_query(tool_name: str, tool_input: Dict[str, Any]) -> str:
    """Generate suggested search query based on tool and input."""
    queries = []

    # Extract file path if present
    file_path = tool_input.get('file_path', '')
    if file_path:
        parts = file_path.split('/')
        filename = parts[-1].split('.')[0] if parts else ''
        if filename and filename not in ['.', '..']:
            queries.append(filename)
        if '.' in file_path:
            ext = file_path.split('.')[-1]
            queries.append(ext)

    # Add tool-specific keywords
    if tool_name == 'Write':
        queries.extend(['create', 'new file', 'template'])
    elif tool_name == 'Edit':
        queries.extend(['update', 'modify', 'pattern'])

    # Always include learning loop keywords
    queries.extend(['preferences', 'correction'])

    # Deduplicate and limit
    seen = set()
    unique = []
    for q in queries:
        if q.lower() not in seen:
            seen.add(q.lower())
            unique.append(q)

    return ' '.join(unique[:6])


def format_time_ago(ms: int) -> str:
    """Format milliseconds ago as human-readable string."""
    seconds = ms // 1000
    if seconds < 60:
        return f"{seconds} seconds ago"
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes} minute{'s' if minutes != 1 else ''} ago"
    hours = minutes // 60
    return f"{hours} hour{'s' if hours != 1 else ''} ago"


def main():
    # Check enforcement mode
    if ENFORCE_MODE == 'off':
        sys.exit(0)

    try:
        hook_data = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(f"[Search Enforcer] Warning: Failed to parse hook input: {e}", file=sys.stderr)
        sys.exit(0)  # Be permissive on parse errors

    tool_name = hook_data.get('tool_name', '')
    tool_input = hook_data.get('tool_input', {})
    session_id = hook_data.get('session_id', '') or 'default'

    # Check if search was performed recently
    was_searched, last_query, ms_ago = check_recent_search(session_id)

    if was_searched:
        # Search was done recently, allow execution
        sys.exit(0)

    # Generate suggested query
    suggested_query = generate_search_query(tool_name, tool_input)

    # Build message
    if ms_ago is not None:
        time_info = f"Last search was {format_time_ago(ms_ago)} (TTL: {SEARCH_TTL_MS // 60000} min)"
        if last_query:
            time_info += f"\nPrevious query: \"{last_query}\""
    else:
        time_info = "No memory search found in this session"

    error_msg = f"""
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 MEMORY SEARCH REQUIRED (Phase 1 - Pre-Action)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Before executing {tool_name}, please search memories first:

  mcp__claude-recall__search({{ "query": "{suggested_query}" }})

{time_info}

WHY THIS MATTERS:
  ✓ User preferences (coding style, tools, conventions)
  ✓ Past successes (what worked before)
  ✓ Past failures (what to avoid)
  ✓ Recent corrections (highest priority!)

THE LEARNING LOOP:
  1. Search memories BEFORE task  ← YOU ARE HERE (Phase 1)
  2. Execute with found context   (Phase 2)
  3. Capture outcome after task   (Phase 3)

This ensures Claude never repeats mistakes and applies learned patterns.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
To disable: set CLAUDE_RECALL_ENFORCE_MODE=off
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

    print(error_msg.strip(), file=sys.stderr)

    if ENFORCE_MODE == 'warn':
        sys.exit(0)  # Warning only, allow execution
    else:
        sys.exit(2)  # Block execution


if __name__ == '__main__':
    main()

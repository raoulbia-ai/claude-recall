#!/usr/bin/env python3
"""
Pre-tool hook to enforce memory search before file operations.
Ensures Phase 1 (Pre-Action) of the learning loop always happens.

This hook intercepts tool calls and blocks execution if memory search
wasn't performed first. It's part of Claude Recall's learning loop:

Phase 1: Search memories BEFORE task (enforced by this hook)
Phase 2: Execute with found context
Phase 3: Capture outcome after task

Exit codes:
- 0: Allow execution (search was performed)
- 2: Block execution (search required)
"""
import json
import sys
import subprocess
from typing import Dict, Any, List

# Tools that require memory search before execution
SEARCH_REQUIRED_TOOLS = ['Write', 'Edit']

# Tools that benefit from search but aren't strictly required
SEARCH_RECOMMENDED_TOOLS = ['Read', 'Bash']

# Keywords that indicate dangerous/important operations
CRITICAL_BASH_KEYWORDS = ['rm', 'git', 'npm', 'build', 'test', 'deploy', 'publish']


def should_require_search(tool_name: str, tool_input: Dict[str, Any]) -> bool:
    """Determine if this tool call requires a memory search first."""
    # Always require search for file creation/modification
    if tool_name in SEARCH_REQUIRED_TOOLS:
        return True

    # Require search for critical bash commands
    if tool_name == 'Bash':
        command = tool_input.get('command', '')
        if any(keyword in command.lower() for keyword in CRITICAL_BASH_KEYWORDS):
            return True

    return False


def check_recent_search(session_id: str) -> bool:
    """Check if memory search was performed recently in this session."""
    if not session_id:
        # No session ID, be permissive
        return True

    try:
        # Call claude-recall CLI to check recent tool usage
        result = subprocess.run(
            ['claude-recall', 'recent-tools', '--session', session_id, '--limit', '5'],
            capture_output=True,
            text=True,
            timeout=2
        )

        if result.returncode != 0:
            # Command failed, be permissive (don't block)
            return True

        # Check if mcp__claude-recall__search was called recently
        return 'mcp__claude-recall__search' in result.stdout

    except (subprocess.TimeoutExpired, FileNotFoundError, Exception):
        # If check fails, be permissive (don't block)
        return True


def generate_search_query(tool_name: str, tool_input: Dict[str, Any]) -> str:
    """Generate suggested search query based on tool and input."""
    queries: List[str] = []

    # Extract file path if present
    file_path = tool_input.get('file_path', '')
    if file_path:
        # Extract relevant keywords from path
        parts = file_path.split('/')
        filename = parts[-1].split('.')[0] if parts else ''
        if filename and filename not in ['.', '..']:
            queries.append(filename)

        # Add file extension for language-specific preferences
        if '.' in file_path:
            ext = file_path.split('.')[-1]
            queries.append(ext)

    # Add tool-specific keywords
    if tool_name == 'Write':
        queries.extend(['create', 'new file'])
    elif tool_name == 'Edit':
        queries.extend(['update', 'modify'])
    elif tool_name == 'Bash':
        command = tool_input.get('command', '')
        if 'git' in command:
            queries.append('git')
        if 'npm' in command or 'yarn' in command:
            queries.append('build')
        if 'test' in command:
            queries.append('testing')

    # Always include learning loop keywords
    queries.extend(['preferences', 'success', 'failure', 'correction'])

    # Deduplicate and limit to 8 keywords
    seen = set()
    unique_queries = []
    for q in queries:
        if q.lower() not in seen:
            seen.add(q.lower())
            unique_queries.append(q)

    return ' '.join(unique_queries[:8])


def main():
    # Read JSON from stdin
    try:
        hook_data = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        # If we can't parse input, be permissive
        print(f"Warning: Failed to parse hook input: {e}", file=sys.stderr)
        sys.exit(0)

    tool_name = hook_data.get('tool_name', '')
    tool_input = hook_data.get('tool_input', {})
    session_id = hook_data.get('session_id', '')

    # Check if this tool requires a memory search
    if not should_require_search(tool_name, tool_input):
        sys.exit(0)  # Allow execution

    # Check if search was performed recently
    if check_recent_search(session_id):
        sys.exit(0)  # Search was done, allow execution

    # BLOCK: Search not performed
    search_query = generate_search_query(tool_name, tool_input)

    error_msg = f"""
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 MEMORY SEARCH REQUIRED (Phase 1 - Pre-Action)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Before executing {tool_name}, please search memories first:

  mcp__claude-recall__search("{search_query}")

WHY THIS MATTERS:
  ✓ User preferences (coding style, tools, conventions)
  ✓ Past successes (what worked before)
  ✓ Past failures (what to avoid)
  ✓ Recent corrections (highest priority!)

THE LEARNING LOOP:
  1. Search memories BEFORE task  ← YOU ARE HERE (Phase 1)
  2. Execute with found context   (Phase 2)
  3. Capture outcome after task   (Phase 3)

This ensures you never repeat yourself and apply learned patterns automatically.

Suggested search query: "{search_query}"

To disable this check, remove the PreToolUse hook from .claude/settings.json
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

    print(error_msg.strip(), file=sys.stderr)
    sys.exit(2)  # Block tool execution


if __name__ == '__main__':
    main()

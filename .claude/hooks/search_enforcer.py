#!/usr/bin/env python3
"""
Minimal Search Enforcer for Claude Recall v0.9.3+

Ensures memory search is performed before Write/Edit/Bash/Task operations.
Works alongside native Claude Skills - skill teaches, hook enforces.

State file: ~/.claude-recall/hook-state/{session_id}.json
Exit codes: 0 = allow, 2 = block
"""
import json
import sys
import os
from pathlib import Path
from datetime import datetime

STATE_DIR = Path.home() / '.claude-recall' / 'hook-state'
SEARCH_TTL_MS = int(os.environ.get('CLAUDE_RECALL_SEARCH_TTL', 24 * 60 * 60 * 1000))  # 24h default (once per session)
ENFORCE_MODE = os.environ.get('CLAUDE_RECALL_ENFORCE_MODE', 'block')  # block, warn, off

# Tools that count as "search performed"
SEARCH_TOOLS = [
    'mcp__claude-recall__load_rules',
    'mcp__claude-recall__search_memory',
]

# Tools that require search first
ENFORCE_TOOLS = ['Write', 'Edit', 'Bash', 'Task']

# Read-only bash commands that don't need memory search
READ_ONLY_BASH = [
    'ls', 'cat', 'head', 'tail', 'less', 'more', 'file', 'stat', 'wc',
    'find', 'locate', 'which', 'whereis', 'type', 'pwd', 'whoami',
    'git status', 'git log', 'git diff', 'git show', 'git branch',
    'git remote', 'git fetch', 'git stash list', 'git tag',
    'npm list', 'npm ls', 'npm view', 'npm outdated', 'npm audit',
    'npm test', 'npm run test', 'npm run build', 'npm run lint',
    'pip list', 'pip show', 'pip freeze',
    'pytest', 'jest', 'cargo test', 'go test', 'tsc --noEmit',
    'grep', 'rg', 'ag', 'awk', 'sed', 'sort', 'uniq', 'diff',
    'tree', 'realpath', 'dirname', 'basename', 'date', 'env', 'echo',
    'ps', 'top', 'df', 'du', 'free', 'uptime', 'hostname',
]


def get_state_file(session_id: str) -> Path:
    safe_id = "".join(c if c.isalnum() or c in '-_' else '_' for c in session_id) or 'default'
    return STATE_DIR / f'{safe_id}.json'


def load_state(session_id: str) -> dict:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    state_file = get_state_file(session_id)
    if state_file.exists():
        try:
            return json.load(open(state_file))
        except:
            pass
    return {'lastSearchAt': None, 'searchQuery': None}


def save_state(session_id: str, state: dict):
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    try:
        json.dump(state, open(get_state_file(session_id), 'w'), indent=2)
    except:
        pass


def is_search_tool(tool_name: str) -> bool:
    return any(s in tool_name for s in SEARCH_TOOLS)


def is_read_only_bash(command: str) -> bool:
    if not command:
        return False
    cmd = command.strip().lower()
    # Check direct match or pipe starting with read-only
    for ro in READ_ONLY_BASH:
        if cmd.startswith(ro):
            return True
    if '|' in cmd:
        first = cmd.split('|')[0].strip()
        for ro in READ_ONLY_BASH:
            if first.startswith(ro):
                return True
    return False


def main():
    if ENFORCE_MODE == 'off':
        sys.exit(0)

    try:
        data = json.load(sys.stdin)
    except:
        sys.exit(0)

    tool_name = data.get('tool_name', '')
    tool_input = data.get('tool_input', {})
    session_id = data.get('session_id', '') or 'default'

    # Track search calls
    if is_search_tool(tool_name):
        state = load_state(session_id)
        state['lastSearchAt'] = int(datetime.now().timestamp() * 1000)
        state['searchQuery'] = tool_input.get('query', '')
        save_state(session_id, state)
        sys.exit(0)

    # Only enforce on specific tools
    if tool_name not in ENFORCE_TOOLS:
        sys.exit(0)

    # Skip read-only bash
    if tool_name == 'Bash' and is_read_only_bash(tool_input.get('command', '')):
        sys.exit(0)

    # Check if search was recent
    state = load_state(session_id)
    last_search = state.get('lastSearchAt')

    if last_search:
        now = int(datetime.now().timestamp() * 1000)
        if (now - last_search) <= SEARCH_TTL_MS:
            sys.exit(0)

    # Block or warn
    msg = f"""
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LOAD RULES REQUIRED before {tool_name}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Run: mcp__claude-recall__load_rules({{}})

This ensures you apply user preferences and avoid past mistakes.

To disable: CLAUDE_RECALL_ENFORCE_MODE=off
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
    print(msg.strip(), file=sys.stderr)
    sys.exit(0 if ENFORCE_MODE == 'warn' else 2)


if __name__ == '__main__':
    main()

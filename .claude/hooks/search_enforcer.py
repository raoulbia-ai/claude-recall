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
SEARCH_TTL_MS = int(os.environ.get('CLAUDE_RECALL_SEARCH_TTL', 60 * 1000))  # 1 min default (once per task)
ENFORCE_MODE = os.environ.get('CLAUDE_RECALL_ENFORCE_MODE', 'block')  # block, warn, off
MAX_BLOCKS = int(os.environ.get('CLAUDE_RECALL_MAX_BLOCKS', 3))  # degrade to warn after N blocks

# Tools that count as "search performed"
SEARCH_TOOLS = [
    'mcp__claude-recall__load_rules',
    'mcp__claude-recall__search_memory',
]

# Tools that require search first (mutation tools)
ENFORCE_TOOLS = ['Write', 'Edit', 'Bash', 'Task']

# Tools that should NEVER be blocked — infrastructure/bootstrap tools
# that Claude needs to function (including calling load_rules itself)
PASSTHROUGH_TOOLS = [
    'Agent', 'Skill', 'ToolSearch',          # Claude internal tools
    'TodoRead', 'TodoWrite',                  # Task management
    'AskUserQuestion',                        # User interaction
]

# Bash command prefixes exempt from the load-rules gate. NOT all read-only:
# alongside inspection commands, routine dev-workflow commands (git commit,
# npm test, ...) are deliberately exempt — the gate exists to get rules loaded
# before Claude starts shaping code, and blocking mid-workflow git/npm calls
# adds friction without a safety benefit. This is an advisory nudge, not a
# security boundary.
EXEMPT_BASH_PREFIXES = [
    'ls', 'cat', 'head', 'tail', 'less', 'more', 'file', 'stat', 'wc',
    'find', 'locate', 'which', 'whereis', 'type', 'pwd', 'whoami',
    'git status', 'git log', 'git diff', 'git show', 'git branch',
    'git remote', 'git fetch', 'git stash', 'git tag',
    'git add', 'git commit', 'git push', 'git pull', 'git merge',
    'git rebase', 'git checkout', 'git switch', 'git cherry-pick',
    'npm install', 'npm version', 'npm publish', 'npm pack',
    'npx',
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
        except Exception:
            pass
    return {'lastSearchAt': None, 'searchQuery': None}


def save_state(session_id: str, state: dict):
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    try:
        json.dump(state, open(get_state_file(session_id), 'w'), indent=2)
    except Exception:
        pass


def is_search_tool(tool_name: str) -> bool:
    return any(s in tool_name for s in SEARCH_TOOLS)


def _has_command_prefix(cmd: str, prefix: str) -> bool:
    """Word-boundary prefix match: 'cat foo' matches 'cat', but
    'catastrophic-script.sh' and 'envsubst' do not match 'cat'/'env'."""
    if not cmd.startswith(prefix):
        return False
    rest = cmd[len(prefix):]
    return rest == '' or rest[0] in ' \t;|&'


def is_exempt_bash(command: str) -> bool:
    if not command:
        return False
    cmd = command.strip().lower()
    # Check direct match, or the first segment of a pipeline
    candidates = [cmd]
    if '|' in cmd:
        candidates.append(cmd.split('|')[0].strip())
    for candidate in candidates:
        for prefix in EXEMPT_BASH_PREFIXES:
            if _has_command_prefix(candidate, prefix):
                return True
    return False


def main():
    if ENFORCE_MODE == 'off':
        sys.exit(0)

    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_name = data.get('tool_name', '')
    tool_input = data.get('tool_input', {})
    session_id = data.get('session_id', '') or 'default'

    # Track search calls — also reset block counter on success
    if is_search_tool(tool_name):
        state = load_state(session_id)
        state['lastSearchAt'] = int(datetime.now().timestamp() * 1000)
        state['searchQuery'] = tool_input.get('query', '')
        state['blockCount'] = 0
        save_state(session_id, state)
        sys.exit(0)

    # Always allow passthrough tools (infrastructure/bootstrap) and MCP tools
    if tool_name in PASSTHROUGH_TOOLS or tool_name.startswith('mcp__'):
        sys.exit(0)

    # Check state to see if rules have ever been loaded this session
    state = load_state(session_id)
    last_search = state.get('lastSearchAt')

    # FIRST TOOL CALL GATE: If rules have never been loaded this session,
    # only block mutation tools. Read-only exploration (Read/Glob/Grep) passes
    # freely — reading a file can't bypass preferences or corrections, and
    # gating it added 1–3 blocked calls of friction per session with no safety
    # benefit. The guarantee that matters (load_rules before mutations) is
    # preserved by the ENFORCE_TOOLS check below.
    if not last_search:
        if tool_name not in ENFORCE_TOOLS:
            sys.exit(0)
        # Exempt bash passes even before rules are loaded — previously this
        # exemption only existed on the post-load branch, so the very first
        # `git status`/`ls` of a session was hard-blocked up to MAX_BLOCKS
        # times, contradicting the "read-only exploration passes freely" rule.
        if tool_name == 'Bash' and is_exempt_bash(tool_input.get('command', '')):
            sys.exit(0)
        # Other mutation tool on first call — fall through to blocking logic below.
    else:
        # Rules loaded at least once — only enforce on mutation tools
        if tool_name not in ENFORCE_TOOLS:
            sys.exit(0)

        # Skip exempt bash
        if tool_name == 'Bash' and is_exempt_bash(tool_input.get('command', '')):
            sys.exit(0)

    if last_search:
        now = int(datetime.now().timestamp() * 1000)
        if (now - last_search) <= SEARCH_TTL_MS:
            sys.exit(0)

        # TTL expired but rules were loaded earlier — degrade to warn, not block.
        # This prevents deadlock when MCP server disconnects mid-session.
        msg = f"""
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STALE RULES — consider reloading before {tool_name}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Rules were loaded earlier but TTL expired.
Run: mcp__claude-recall__load_rules({{}})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
        print(msg.strip(), file=sys.stderr)
        sys.exit(0)  # Warn only — allow the action

    # Never loaded in this session — block (with circuit breaker)
    block_count = state.get('blockCount', 0) + 1
    state['blockCount'] = block_count
    save_state(session_id, state)

    if block_count > MAX_BLOCKS:
        # Circuit breaker: MCP server is likely down — degrade to warn
        msg = f"""
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CLAUDE RECALL UNAVAILABLE — proceeding without rules
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Blocked {block_count}x but load_rules never succeeded.
The MCP server may be down. Allowing {tool_name} to proceed.

To reconnect: check 'claude mcp list' or restart Claude Code.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
        print(msg.strip(), file=sys.stderr)
        sys.exit(0)  # Allow — server is down, don't deadlock

    msg = f"""
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LOAD RULES REQUIRED before {tool_name} (attempt {block_count}/{MAX_BLOCKS})
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

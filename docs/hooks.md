# hooks

Claude Recall v0.9.3+ uses a hybrid approach: **Skills** teach Claude the workflow, and a **minimal hook** enforces memory search before code-modifying operations.

## search_enforcer.py

Located at `.claude/hooks/search_enforcer.py`, this is a PreToolUse hook that blocks Write, Edit, Bash, and Task operations until a memory search has been performed in the current session.

### How It Works

1. Claude invokes a tool (e.g., `Write`)
2. The hook checks a per-session state file for a recent search timestamp
3. If no search occurred within the TTL window, the hook blocks with exit code 2
4. Once Claude performs `mcp__claude-recall__load_rules`, `mcp__claude-recall__search`, or `mcp__claude-recall__retrieve_memory`, the state file is updated and subsequent tool calls are allowed

### State File

Per-session state is stored at:

```
~/.claude-recall/hook-state/{session_id}.json
```

Contents:

```json
{
  "lastSearchAt": 1700000000000,
  "searchQuery": "relevant keywords"
}
```

### Search TTL

The hook allows tool calls for a configurable window after the last search. Default: **5 minutes** (300,000 ms).

### Protected Tools

The following tools require a prior memory search:

- `Write`
- `Edit`
- `Bash` (except read-only commands)
- `Task`

### Read-Only Bash Exemptions

Common read-only commands are exempt from enforcement:

- File inspection: `ls`, `cat`, `head`, `tail`, `wc`, `file`, `stat`
- Search: `find`, `grep`, `rg`, `ag`
- Git read operations: `git status`, `git log`, `git diff`, `git show`, `git branch`
- Package managers: `npm list`, `npm test`, `npm run build`, `pip list`, `pip show`
- Test runners: `pytest`, `jest`, `cargo test`, `go test`

### Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `CLAUDE_RECALL_SEARCH_TTL` | `300000` (5 min) | Milliseconds a search remains valid |
| `CLAUDE_RECALL_ENFORCE_MODE` | `block` | `block` (exit 2), `warn` (exit 0 + stderr message), or `off` (disabled) |

### Exit Codes

| Code | Meaning |
|---|---|
| `0` | Allow the tool call |
| `2` | Block the tool call (triggers Claude to search first) |

### Integration with Skills

The hook works alongside the memory-management skill (`.claude/skills/memory-management/SKILL.md`):

- **Skill** teaches Claude to use `load_rules` at task start and `search` for targeted lookups
- **Hook** enforces that at least one memory call (`load_rules`, `search`, or `retrieve_memory`) occurs before code-modifying operations

### Installation

Installed automatically by `npx claude-recall setup --install` or `npx claude-recall repair`. The hook is registered in `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "mcp__claude-recall__.*|Write|Edit|Bash|Task",
        "hooks": [
          {
            "type": "command",
            "command": "python3 .claude/hooks/search_enforcer.py"
          }
        ]
      }
    ]
  }
}
```

### Troubleshooting

**Check hook status:**
```bash
npx claude-recall hooks check
```

**Test enforcement end-to-end:**
```bash
npx claude-recall hooks test-enforcement
```

**Disable temporarily:**
```bash
CLAUDE_RECALL_ENFORCE_MODE=off claude
```

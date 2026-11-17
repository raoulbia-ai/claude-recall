# cli

Full reference for the `claude-recall` CLI.

## Memory Commands

### search

Search memories by keyword query.

```bash
npx claude-recall search <query>
npx claude-recall search "testing patterns" --limit 20
npx claude-recall search "auth" --json
npx claude-recall search "config" --project my-project
npx claude-recall search "preferences" --global
```

| Flag | Description |
|---|---|
| `-l, --limit <n>` | Maximum results (default: 10) |
| `--json` | Output as JSON |
| `--project <id>` | Filter by project (includes universal memories) |
| `--global` | Search all projects |

### store

Store a memory directly from the CLI.

```bash
npx claude-recall store "prefer tabs over spaces"
npx claude-recall store "use pytest for testing" --type project-knowledge
npx claude-recall store "always use strict mode" --confidence 0.95
npx claude-recall store "deploy to staging first" --metadata '{"team":"backend"}'
```

| Flag | Description |
|---|---|
| `-t, --type <type>` | Memory type (default: `preference`) |
| `-c, --confidence <n>` | Confidence score 0.0-1.0 (default: 0.8) |
| `-m, --metadata <json>` | Additional metadata as JSON string |

### stats

Show memory statistics.

```bash
npx claude-recall stats
npx claude-recall stats --project my-project
npx claude-recall stats --global
```

| Flag | Description |
|---|---|
| `--project <id>` | Filter by project |
| `--global` | Show all projects |

### evolution

View memory evolution and sophistication metrics (L1-L4).

```bash
npx claude-recall evolution
npx claude-recall evolution --days 60
npx claude-recall evolution --project my-project
```

| Flag | Description |
|---|---|
| `--project <id>` | Filter by project |
| `--days <n>` | Analysis period (default: 30) |

### failures

View failure memories with counterfactual learning.

```bash
npx claude-recall failures
npx claude-recall failures --limit 20
npx claude-recall failures --project my-project
```

| Flag | Description |
|---|---|
| `--limit <n>` | Maximum failures to show (default: 10) |
| `--project <id>` | Filter by project |

### export

Export memories to a JSON file.

```bash
npx claude-recall export backup.json
```

| Flag | Description |
|---|---|
| `-f, --format <fmt>` | Export format (default: `json`) |

### import

Import memories from a JSON file.

```bash
npx claude-recall import backup.json
```

### clear

Delete memories. Requires `--force` to confirm.

```bash
npx claude-recall clear --force
npx claude-recall clear --type preference --force
```

| Flag | Description |
|---|---|
| `-t, --type <type>` | Clear only this memory type |
| `--force` | Required confirmation flag |

## Rule Hygiene Commands

These keep the active rule set small and accurate. None of them deletes a
memory: a demoted rule is excluded from `load_rules` and injection, and
`rules promote <id>` brings it back. Re-teaching a demoted rule also revives it.

### janitor

Review the stored rules with the runtime's own LLM (`claude -p` under Claude
Code, `kiro-cli` under Kiro). It runs automatically once a day; this command
runs it now. See the README's [Memory janitor](../README.md#memory-janitor).

```bash
npx claude-recall janitor --dry-run   # preview, change nothing
npx claude-recall janitor             # run now
npx claude-recall janitor --status    # show the last run's report
npx claude-recall janitor --runtime kiro
```

| Flag | Description |
|---|---|
| `--dry-run` | Preview actions without changing anything |
| `--runtime <cc\|kiro>` | LLM backend to use (default: `cc`) |
| `--status` | Show the last report instead of running |

Each action in the report is one of:

| Action | Effect |
|---|---|
| `demote` | Noise, or a rule its source words don't support (such as a fragment of pasted text) |
| `merge` | Several rules saying the same thing become one; the originals are demoted |
| `rewrite` | A vague rule is replaced by a precise one; the original is demoted |
| `confirm` | The user's source words plainly state the rule; confirmed rules load first |

Rules younger than `CLAUDE_RECALL_JANITOR_GRACE_HOURS` (default 24) are not
reviewed, and a run applies at most 10 actions. Disable the daily run with
`CLAUDE_RECALL_JANITOR=off`.

### rules demote

Demote rules that are loaded often but never cited, the counter-based
counterpart to the janitor. Runs on MCP startup when
`CLAUDE_RECALL_AUTO_DEMOTE=true`; this command runs it on demand.

```bash
npx claude-recall rules demote --dry-run
npx claude-recall rules demote --min-loads 30 --min-age-days 14
```

| Flag | Description |
|---|---|
| `--dry-run` | Preview without changing anything |
| `--min-loads <n>` | Minimum load count to qualify (default: 20) |
| `--min-age-days <n>` | Minimum rule age in days (default: 7) |

### rules dedup

Collapse near-duplicate rules that predate write-time dedup. In each group
the oldest rule is kept and takes over the others' load and cite counts.

```bash
npx claude-recall rules dedup --dry-run
npx claude-recall rules dedup --threshold 0.75
```

| Flag | Description |
|---|---|
| `--dry-run` | Preview without changing anything |
| `--threshold <n>` | Jaccard similarity threshold 0-1 (default: 0.65) |

### rules promote

Restore a rule demoted by `rules demote`, `rules dedup` or the janitor. Ids are
shown by `janitor --status` and the dry-run output of each command.

```bash
npx claude-recall rules promote 42
```

## Setup Commands

### setup

Show activation instructions or install Skills + hook.

```bash
npx claude-recall setup            # Show instructions
npx claude-recall setup --install  # Install skills and enforcement hook
```

### repair

Clean up old hooks and install current Skills + enforcement hook.

```bash
npx claude-recall repair
npx claude-recall repair --force   # Force overwrite existing config
```

## Hook Commands

### hooks check

Check if hooks are properly configured and working.

```bash
npx claude-recall hooks check
```

### hooks test-enforcement

Test that memory search enforcement blocks and allows correctly.

```bash
npx claude-recall hooks test-enforcement
```

## MCP Server Commands

### mcp start

Start Claude Recall as an MCP server (used by Claude Code).

```bash
npx claude-recall mcp start
```

### mcp stop

Stop a running MCP server.

```bash
npx claude-recall mcp stop
npx claude-recall mcp stop --project my-project
npx claude-recall mcp stop --force
```

### mcp status

Show the current project's MCP server status.

```bash
npx claude-recall mcp status
```

### mcp ps

List all running MCP servers.

```bash
npx claude-recall mcp ps
```

### mcp cleanup

Remove stale PID files or stop all servers.

```bash
npx claude-recall mcp cleanup
npx claude-recall mcp cleanup --dry-run
npx claude-recall mcp cleanup --all
npx claude-recall mcp cleanup --all --force
```

### mcp restart

Restart the MCP server.

```bash
npx claude-recall mcp restart
npx claude-recall mcp restart --force
```

## Project Commands

### project show

Show current project details.

```bash
npx claude-recall project show
```

### project list

List all registered projects.

```bash
npx claude-recall project list
```

### project register

Manually register the current project.

```bash
npx claude-recall project register
```

### project clean

Remove stale project registry entries.

```bash
npx claude-recall project clean
npx claude-recall project clean --dry-run
npx claude-recall project clean --days 60
```

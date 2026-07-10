# Claude Recall

### Persistent, local memory for coding agents — learn from every session.

Coding agents forget everything between sessions. Claude Recall fixes that: it captures your preferences, corrections, project facts, and failures **automatically as you work**, stores them in a local SQLite database, and injects them back into the agent's context in every future session.

It works with **Claude Code**, **[Pi](https://github.com/mariozechner/pi)**, and **[Kiro CLI](https://kiro.dev/cli/)** — all three share the same database, so a rule learned in one agent is applied in the others. Everything stays on your machine: no cloud, no telemetry, works offline.

---

## What it looks like in practice

**Tuesday — you correct the agent once, in plain language:**

> **You:** use pnpm here, not npm

```text
📌 Recall: auto-captured correction — Use pnpm, not npm
```

That one line did everything. A hook classified your prompt with an LLM, decided it was a durable rule (not chit-chat), and stored it locally. No "remember this" incantation, no tool call, no config file to edit.

**Friday — brand-new session, no shared history:**

> **You:** set up a test runner for this project
>
> **Agent:** Installing vitest with **pnpm** *(applied from memory: "Use pnpm, not npm")* …

Your rules are injected at session start and again right before each relevant tool call — at the moment of decision, not 50,000 tokens upstream. This works across agents too: correct Claude Code on Tuesday, and Kiro applies it on Friday.

**And you can audit what it knows at any time:**

```bash
$ claude-recall search "pnpm"
🔍 Found 1 memories (showing top 1):

1. [correction] Score: 7.9
   Content: {"content":"Use pnpm, not npm","confidence":0.95,"source":"hook-auto-capture",...}
```

---

## Features

- **Automatic capture** — an LLM classifier detects preferences, corrections, and project facts in your normal prompts (regex fallback when no LLM is available)
- **Applied where it counts** — rules load at session start *and* are re-surfaced just-in-time before each tool call
- **Project-scoped** — each project gets its own memory namespace; switch directories and the agent switches context
- **Learns from failures** — records what broke, why, and what fixed it, so mistakes aren't repeated
- **Outcome-aware** — tracks whether rules actually help (tool results, test cycles, re-asks) and promotes validated lessons into active rules
- **Local-only** — one SQLite file on your machine; inspect, export, or delete everything from the CLI

---

## Quick Start

**Requirements:** Node.js **20.19+**, macOS / Linux / Windows (WSL supported).

Install the global binary once per machine:

```bash
npm install -g claude-recall
```

> **Do NOT add claude-recall as a project dependency** (`npm install claude-recall` inside a project). All projects share one database, and a stale project-local copy silently shadows your global one. One global binary; per-project *activation* only.
> Hit `EACCES: permission denied`? See [Upgrade & install troubleshooting](#upgrading) below.

### Claude Code

In each project where you want it active:

```bash
claude-recall setup --install
claude mcp add claude-recall -- claude-recall mcp start
```

Restart Claude Code. Ask *"Load my rules"* to verify — Claude should call `load_rules`.

Prefer it available in **every** project? Register the MCP server once at user scope (memories stay isolated per project either way — scoping comes from the working directory, not the install):

```bash
claude mcp add --scope user claude-recall -- claude-recall mcp start
```

Hook-based auto-capture remains a per-project opt-in via `claude-recall setup --install`.

### Pi

```bash
pi install npm:claude-recall
```

That's it. Ask Pi to *"Load my rules"* to verify.

### Kiro CLI

Requires claude-recall ≥ 0.28.0. In the project directory, before starting Kiro:

```bash
claude-recall kiro setup      # writes a custom agent at .kiro/agents/recall.json
kiro                          # then inside the chat:  /agent swap recall
```

Already living in a custom agent of your own? Merge Claude Recall into it instead of swapping (backup written, idempotent, your config preserved):

```bash
claude-recall kiro setup --merge-into <agent-name>
```

> **⚠️ One-time rollover:** after `kiro setup` or `--merge-into`, start **one fresh conversation** (no `--resume`). Kiro snapshots the agent config when a conversation is *created*, so older conversations never see the new hooks — even resumed or after a restart. After that one fresh start, `--resume` works normally.

Capture under Kiro runs on **Kiro's own LLM** — no `ANTHROPIC_API_KEY`, no personal Anthropic subscription. It uses a dedicated fixed classifier model (default `claude-haiku-4.5`, independent of your chat model), costs ~0.06 Kiro credits per prompt, and never blocks your turn. Verify with `claude-recall kiro doctor`.

**Everything else Kiro** — MCP-only mode, project scoping and `--resume`, the classifier internals, enterprise-governance notes, troubleshooting: **[docs/kiro.md](docs/kiro.md)**.

---

## What happens automatically

Once installed, Claude Recall works in the background (CC = Claude Code):

| When | What happens | CC | Pi | Kiro |
|---|---|:-:|:-:|:-:|
| **Session start** | Active rules are injected into the agent's context | ✓ | ✓ | ✓ |
| **As you type** | Prompts are classified; durable preferences/corrections are stored | ✓ | ✓ | ✓ |
| **Before each tool call** | Relevant rules are re-surfaced next to the action (just-in-time injection) | ✓ | ✓ | ✓ |
| **Tool outcomes** | Failures are recorded; Bash failures are paired with their eventual fix | ✓ | ✓ | ✓ |
| **Re-ask detection** | Frustration signals (*"still broken"*) are recorded as outcome events | ✓ | ✓ | ✓ |
| **Before context compression** | Important context is captured before the window shrinks | ✓ | ✓ |  |
| **After context compression** | Rules are re-injected into the fresh context | ✓ |  |  |
| **Sub-agent spawned** | Rules are injected into the sub-agent; its outcome is captured | ✓ |  |  |
| **Session exit** | An auto-checkpoint (`{completed, remaining, blockers}`) is saved for next time | ✓ | ✓ |  |
| **End of session** | Failure patterns become candidate lessons; validated ones are promoted to rules | ✓ | ✓ |  |

Classification uses an LLM wherever one is available — Claude Code provides `ANTHROPIC_API_KEY` to its hooks; Kiro uses its own included LLM — with silent regex fallback. No configuration needed.

```bash
# Verify it's working
claude-recall stats
claude-recall search "preference"
```

---

## Everyday commands

```bash
claude-recall status                     # Installation health: hooks, MCP, DB path, project ID
claude-recall stats                      # What's in the DB for this project (--global for all)

claude-recall search "query"             # Search this project's memories (--global, --json, --project <id>)
claude-recall failures                   # What broke and what fixed it
claude-recall outcomes                   # Outcome-aware learning status

claude-recall store "content"            # Store a memory by hand (-t correction|devops|...)
claude-recall delete <key>               # Delete one memory (keys shown by search)
claude-recall export backup.json         # Export to JSON (import to restore)
claude-recall clear --force              # Wipe this project's memories (auto-backup first)

claude-recall upgrade                    # Update the global binary for all runtimes
```

### Task checkpoints

Persistent "where I left off" snapshots — one per project, replaced on each save:

```bash
claude-recall checkpoint save --completed "API layer" --remaining "wire the UI" --blockers "none"
claude-recall checkpoint load
```

Auto-checkpoints are also saved on session exit in Claude Code and Pi (Pi has no `--resume`, so this is its main recovery path). Extraction uses Haiku via `ANTHROPIC_API_KEY`; without a key, only manual checkpoints work. A quality gate refuses to overwrite a manual checkpoint with a fabricated one when the task was already complete.

### Troubleshooting

```bash
claude-recall status                     # Are hooks + MCP registered? Which project is this?
claude-recall hooks check                # Do the hook files exist and validate?
claude-recall mcp status                 # Is the MCP server running? (mcp ps lists all)
claude-recall project show               # Which project ID does this directory map to?
claude-recall repair                     # Fix broken hook paths (--dry-run to preview)
claude-recall mcp cleanup --all          # Stop stale MCP servers

# What did the hooks actually do?
tail -20 ~/.claude-recall/hook-logs/hook-dispatcher.log

# "error: unknown command '<x>'" → your binary predates the feature:
claude-recall upgrade
```

<details>
<summary><b>All commands</b></summary>

```bash
# ── Setup & Diagnostics ─────────────────────────────────────────────
claude-recall setup                      # Show activation instructions
claude-recall setup --install            # Install skills + hooks (Claude Code, current project)
claude-recall kiro setup                 # Write Kiro custom agent (--global for all projects)
claude-recall kiro setup --merge-into <agent>  # Merge into an existing Kiro agent
claude-recall kiro doctor                # Kiro integration health report
claude-recall upgrade                    # One-shot upgrade: global binary + clear stale MCP servers
claude-recall status                     # Installation and system status
claude-recall repair                     # Fix broken claude-recall hook paths (preserves your customizations)
claude-recall repair --auto              # Non-interactive; apply safe fixes without prompting
claude-recall repair --dry-run           # Report what would change without writing
claude-recall repair --scope user|project|all  # Scope the scan (default: all)
claude-recall repair --reinstall-hooks   # Opinionated: rewrite entire hook block from current template
claude-recall hooks check                # Verify hook files exist and are valid
claude-recall hooks test-enforcement     # Test if search enforcer hook works

# ── Memory ───────────────────────────────────────────────────────────
claude-recall stats                      # Memory statistics (--global for all projects)
claude-recall search "query"             # Search memories (--global, --json, --project <id>)
claude-recall store "content"            # Store memory directly
claude-recall store "content" -t <type>  # Type: preference, correction, failure, devops, project-knowledge
claude-recall export backup.json         # Export current project (--global for all)
claude-recall import backup.json         # Import memories from JSON
claude-recall delete <key>               # Delete one memory by key (get keys from `search`)
claude-recall clear --force              # Clear current project (--global for all; auto-backup written first)
claude-recall failures                   # View failure memories (--limit N)
claude-recall outcomes                   # Outcome-aware learning status (--section lessons|stats, --limit N)
claude-recall monitor                    # Memory search monitoring stats

# ── Rule Hygiene ─────────────────────────────────────────────────────
claude-recall rules demote [--dry-run]   # Demote rules loaded >=N times but never cited
claude-recall rules demote --min-loads 20 --min-age-days 7   # Tune thresholds
claude-recall rules promote <id>         # Restore an auto-demoted or auto-deduped rule
claude-recall rules dedup [--dry-run]    # Collapse near-duplicate rules (--threshold 0.8 for stricter)

# ── Task Checkpoints ────────────────────────────────────────────────
claude-recall checkpoint save --completed <text> --remaining <text> [--blockers <text>] [--notes <text>]
claude-recall checkpoint load [--json]
claude-recall checkpoint clear

# ── Skills ───────────────────────────────────────────────────────────
claude-recall skills generate            # Generate skills from memories (--dry-run, --force)
claude-recall skills list                # List generated skills
claude-recall skills clean --force       # Remove all auto-generated skills

# ── MCP Server ───────────────────────────────────────────────────────
claude-recall mcp status                 # Current project's server status
claude-recall mcp ps                     # List all running servers
claude-recall mcp stop [--force]         # Stop server
claude-recall mcp restart                # Stop server (Claude Code respawns it next session)
claude-recall mcp cleanup [--all]        # Remove stale PID files / stop all servers

# ── Project ──────────────────────────────────────────────────────────
claude-recall project show               # Current project info
claude-recall project list               # All registered projects
claude-recall project register           # Register current project
claude-recall project unregister [id]    # Unregister a project
claude-recall project clean              # Remove stale registry entries

# ── Database Maintenance ─────────────────────────────────────────────
claude-recall compact                    # Dedup + prune + VACUUM (--dry-run to preview; also runs on MCP boot)
claude-recall cleanup test-pollution [--dry-run]  # Delete legacy test-fixture rows

# ── Auto-Capture Hooks (run automatically, registered via setup --install) ──
claude-recall hook run correction-detector   # UserPromptSubmit hook
claude-recall hook run memory-stop           # Stop hook
claude-recall hook run precompact-preserve   # PreCompact hook
claude-recall hook run memory-sync           # Stop + PreCompact hook (syncs rules to auto-memory)
```

</details>

---

## How it works

Six memory tools (`load_rules`, `store_memory`, `search_memory`, `delete_memory`, `save_checkpoint`, `load_checkpoint`) backed by one local SQLite database (`~/.claude-recall/claude-recall.db`, WAL mode, content-hash dedup, auto-compaction). Exposure per agent:

- **Claude Code** — MCP server (`mcp__claude-recall__*` tools) + file-system hooks for automatic capture
- **Pi** — native extension (`recall_*` tools) + event handlers
- **Kiro CLI** — custom agent bundling the MCP server + Kiro hooks ([details](docs/kiro.md))

**Skills.** Claude Recall teaches agents *when* to use memory via skill files — Anthropic's [Agent Skills](https://agentskills.io/) standard for Claude Code (`.claude/skills/memory-management/`, plus auto-generated `.claude/skills/auto-*/` crystallized from accumulated memories), and a bundled skill file for Pi.

**Outcome-aware learning.** Claude Recall tracks what happens *after* the agent acts:

```
action → outcome event → episode → candidate lesson → promotion → active rule
                                                                      ↓
                                                    JIT-injected before the next action
                                                                      ↓
                                                    outcome resolved per injected rule
```

Failures become candidate lessons (deduplicated by similarity); lessons seen 2+ times (or once, if severe) are promoted to active rules; every just-in-time injection is recorded and resolved against the tool's outcome, building per-rule effectiveness data over time.

---

## Upgrading

One command upgrades the shared binary for **all** runtimes:

```bash
claude-recall upgrade
```

It checks the registry, refreshes the global binary, and clears any running MCP servers — they respawn on the next tool call with the new version.

Per-runtime notes:

- **Claude Code** — nothing else needed. If the release notes mention new or changed hooks, also re-run `claude-recall setup --install` in each active project (safe any time; a no-op when current).
- **Pi** — run `pi update npm:claude-recall` and restart Pi.
- **Kiro CLI** — the binary upgrade covers hook behaviour; when release notes change the agent *template*, re-run `kiro setup` once and start one fresh conversation — see [docs/kiro.md](docs/kiro.md#upgrading).

<details>
<summary><b>Install & upgrade troubleshooting</b> (EACCES, unknown command, pre-0.27 registrations)</summary>

**`EACCES: permission denied`** — your global npm prefix is root-owned (common when node came from `apt`). Quick fix: `sudo npm install -g claude-recall@latest`. Permanent fix — move the prefix to a user-owned directory so global installs never need sudo again:

```bash
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
npm install -g claude-recall@latest
claude-recall --version
```

**`error: unknown command '<anything>'`** — your installed binary is older than the docs you're reading (`kiro` needs ≥ 0.28.0, `compact` ≥ 0.26.0, `upgrade` ≥ 0.23.2). Run `claude-recall upgrade`; if `upgrade` itself is unknown, bootstrap with `npm install -g claude-recall@latest`.

**Claude Code registered before v0.27.x?** Older versions auto-registered the MCP server with an `npx`-based command, which can be shadowed by stale project-local installs. Switch to the direct binary form (run in each affected project):

```bash
claude mcp remove claude-recall
claude mcp add claude-recall -- claude-recall mcp start
```

**WSL: "invalid ELF header"** — mixed Windows/WSL `node_modules`. Use the global install (the default) and verify the binary resolves to a Linux path: `which claude-recall` should show `/home/<user>/...`, not a Windows path. Global installation does not affect project scoping.

</details>

---

## Project scoping

Each project gets isolated memory. The **project ID** is derived from the working directory the agent reports; universal memories (no project scope) are available everywhere. Switching projects switches memory automatically — no configuration.

To pin one logical project across several directories (worktrees, subrepos), set `CLAUDE_RECALL_PROJECT_ID`. Details: [docs/project-scoping.md](docs/project-scoping.md).

---

## Configuration

Defaults work out of the box; tune via environment variables as needed.

| Variable                                 | Default | Effect                                                                                                   |
| ---------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------- |
| `CLAUDE_RECALL_DB_PATH`                  | `~/.claude-recall/` | Database directory.                                                                          |
| `ANTHROPIC_API_KEY`                      | _(unset)_ | LLM classification via Haiku. Not required — Claude Code provides it to its hooks, and under Kiro the included LLM is used instead (and is preferred even if this is set). Regex is the final fallback. |
| `CLAUDE_RECALL_KIRO_MODEL`               | `claude-haiku-4.5` | Dedicated model for Kiro-LLM capture classification — **independent of your interactive Kiro chat model**. Raise to `claude-sonnet-4.6` for steadier judgement at more credits. See [docs/kiro-llm-capture.md](docs/kiro-llm-capture.md). |
| `CLAUDE_RECALL_PREFER_API_KEY`           | _(unset)_ | Under Kiro, force `ANTHROPIC_API_KEY`-based classification ahead of Kiro's included LLM (uses your Anthropic credits — e.g. for a stronger model). No effect under Claude Code. |
| `CLAUDE_RECALL_KIRO_LLM_TIMEOUT_MS`      | `30000` | Hard cap on the headless `kiro-cli` classify call before the capture worker gives up and falls back to regex. |
| `CLAUDE_RECALL_LOAD_BUDGET_TOKENS`       | `2000`  | Token budget for the `load_rules` payload. Rules are emitted in priority order (corrections → preferences by citation → devops by citation → failures) and dropped rules surface via `search_memory`. |
| `CLAUDE_RECALL_AUTO_DEMOTE`              | `false` | When `true`, auto-demote rules on MCP boot where `load_count >= CLAUDE_RECALL_DEMOTE_MIN_LOADS`, `cite_count = 0`, and age `> CLAUDE_RECALL_DEMOTE_MIN_AGE_DAYS`. Still reversible via `rules promote <id>`. |
| `CLAUDE_RECALL_DEMOTE_MIN_LOADS`         | `20`    | Minimum load count before a rule qualifies for auto-demotion.                                            |
| `CLAUDE_RECALL_DEMOTE_MIN_AGE_DAYS`      | `7`     | Minimum rule age before auto-demotion can fire (avoids demoting brand-new rules).                        |
| `CLAUDE_RECALL_AUTO_CLEANUP`             | `false` | Auto-kill stale MCP processes on start (otherwise reports and exits).                                    |
| `CLAUDE_RECALL_COMPACT_THRESHOLD`        | `10MB`  | DB size at which automatic compaction kicks in.                                                          |
| `CLAUDE_RECALL_MAX_MEMORIES`             | `10000` | Memory-row soft cap.                                                                                     |
| `CLAUDE_RECALL_ENFORCE_MODE`             | `on`    | Set to `off` to bypass the search-enforcer hook.                                                         |
| `CLAUDE_RECALL_LLM_TIMEOUT_MS`           | `5000`  | Timeout for hook-context LLM calls (classification, hindsight hints). Hooks fall back to regex when it fires. |
| `CLAUDE_RECALL_STOP_DEBOUNCE_MS`         | `300000` | Debounce for the heavy Stop-hook pipeline (episodes, session extraction, promotion). `0` disables. |
| `CLAUDE_RECALL_PROJECT_ID`               | *(cwd)*  | Pin the project scope to a fixed id, overriding working-directory detection. |

---

## Security & privacy

- SQLite memory never leaves your machine — no prompts, code, or memory content is transmitted
- Full transparency via CLI (`stats`, `search`, `export`)
- Never stores secrets (API keys, passwords, tokens)

Details in [docs/security.md](docs/security.md).

---

## Development & contributions

PRs welcome.

```bash
npm run build          # Compile TypeScript
npm test               # Run all tests
npm run test:watch     # Watch mode
npm run mcp:dev        # Start MCP server in dev mode
```

---

## License

MIT.

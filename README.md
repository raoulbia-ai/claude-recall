# Claude Recall

### Persistent, local memory for coding agents — learn from every session.

Coding agents forget everything between sessions. Claude Recall fixes that: it captures your preferences, corrections, project facts, and failures **automatically as you work**, stores them in a local SQLite database, and injects them back into the agent's context in every future session.

It works with **Claude Code**, **[Pi](https://github.com/mariozechner/pi)**, and **[Kiro CLI](https://kiro.dev/cli/)** — all three share the same database, so a rule learned in one agent is applied in the others. Everything stays on your machine: no cloud, no telemetry, works offline.

---

## What it looks like in practice

**Tuesday — you correct the agent once, in plain language:**

> **You:** use pnpm here, not npm

Seconds later, silently in the background (`~/.claude-recall/hook-logs/cc-classifier.log`):

```text
classified via claude -p (model=haiku, Claude subscription, no API key): correction — Use pnpm, not npm
```

That's the whole workflow. A background hook classified your prompt with an LLM — **the agent's own LLM** (your Claude subscription under Claude Code, Kiro's credits under Kiro; no API key involved) — decided it was a durable rule and stored it locally. No "remember this" incantation, no tool call, no config file to edit.

**Friday — brand-new session, no shared history:**

> **You:** set up a test runner for this project
>
> **Agent:** Installing vitest with **pnpm** *(applied from memory: "Use pnpm, not npm")* …

Your rules are injected at session start and kept alive mid-session — just-in-time before each relevant tool call (Claude Code, Pi), or as a periodic refresh (Kiro) — at the moment of decision, not 50,000 tokens upstream. This works across agents too: correct Claude Code on Tuesday, and Kiro applies it on Friday.

**And you can audit what it knows at any time:**

```bash
$ claude-recall search "pnpm"
🔍 Found 1 memories (showing top 1):

1. [correction] Score: 7.9
   Content: {"content":"Use pnpm, not npm","confidence":0.95,"source":"hook-auto-capture",...}
```

---

## Why not just steering files or CLAUDE.md?

Use them! They're the right tool for **team standards you already know** — written by hand, reviewed in PRs, shipped with the repo. Claude Recall covers what they structurally can't:

- **Nobody writes it down.** Steering files hold what you remembered to document. Recall captures rules *in the flow of work* — you correct the agent once, mid-session, and it's stored. The stuff that burns you repeatedly is exactly the stuff too small to feel worth documenting.
- **They can't learn from failure.** There's no steering-file mechanism for *tool failure → lesson → rule*. "Exit code 0 doesn't mean the tests passed" enters Recall because the agent got burned — not because someone wrote a postmortem.
- **One memory, every agent.** Steering is Kiro-only, CLAUDE.md is Claude-Code-only. Recall is one local DB behind Claude Code, Kiro, and Pi — correct one agent, all of them know.
- **They rot.** Nobody prunes a rules file. Recall tracks whether rules are actually used, demotes dead ones, and a daily LLM janitor merges duplicates and cleans noise.
- **Personal ≠ repo.** "GPG signing fails in *my* WSL" doesn't belong in a committed file. Recall is per-developer and never touches your repo.
- **They bloat context.** An always-included steering file ships its full text into every interaction, relevant or not, and only ever grows. Recall's injection is token-budgeted, surfaces rules relevant to the action at hand, and the corpus self-prunes — the context cost stays bounded as the memory grows.

In short: steering files are documentation — what your team decided. Claude Recall is memory — what your sessions taught.

---

## Features

- **Automatic capture** — an LLM classifier detects preferences, corrections, and project facts in your normal prompts, running on **the agent's own LLM** (Claude subscription / Kiro credits — never a separate API key), with regex fallback when no LLM is available
- **Applied where it counts** — rules load at session start and are re-surfaced mid-session: just-in-time before each tool call (Claude Code, Pi) or as a periodic refresh every N prompts (Kiro)
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

**Capture runs on your Claude subscription — no API key.** The capture hook classifies each prompt via a headless `claude -p` call on the same login that powers your session, in a detached background worker (your turn is never blocked; capture is silent and lands a few seconds later). If you happen to have `ANTHROPIC_API_KEY` exported for other tools, it is deliberately **not** used unless you set `CLAUDE_RECALL_PREFER_API_KEY=1` — a stray key shouldn't quietly spend your Anthropic API credits. Verify captures any time:

```bash
tail -5 ~/.claude-recall/hook-logs/cc-classifier.log   # which model ran, what was stored
claude-recall search "something you said"
```

Design details (the `claude -p` key-precedence gotcha, recursion guards, which features run on the subscription): [docs/cc-llm-capture.md](docs/cc-llm-capture.md).

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

> **⚠️ You must start ONE fresh conversation after setup — this is the most common reason "it does nothing."**
>
> After `kiro setup` or `--merge-into`, start **one new conversation without `--resume`**:
>
> ```bash
> kiro-cli chat --agent recall        # or: --agent <your-agent> if you merged
> ```
>
> Kiro snapshots the agent config at the moment a conversation is *created*. Any conversation that already existed — including one you reach with `--resume` or after restarting Kiro — was snapshotted **before** claude-recall was wired in, so it will **never** run the hooks and capture will silently do nothing. Once you've started that one fresh conversation, every conversation from then on carries the hooks and `--resume` works normally. This is a one-time rollover, once per project.
>
> Confirm the wiring is live before you rely on it:
>
> ```bash
> claude-recall kiro doctor           # green checks = hooks are active for this project
> ```

**Capture runs on Kiro's own LLM — no API key, no personal subscription.** It classifies each prompt with a dedicated fixed model (default `claude-haiku-4.5`, independent of your chat model) and costs **~0.06 Kiro credits per prompt** — cheap, but note it's *every* prompt, so budget accordingly across a team.

**What to expect from capture — read this so it doesn't feel broken:**

- **It's silent and asynchronous.** Capture runs in a background worker so it never blocks your turn — which also means there's **no "captured ✓" message** in the Kiro chat. Stating a preference and seeing nothing happen is normal.
- **It's a best-effort LLM judgement, not a guarantee.** The classifier decides what's a durable rule vs. chit-chat; it won't catch every phrasing, and near-identical wording can occasionally be judged differently. State preferences plainly ("use pnpm here, not npm") for the best hit rate.
- **There's a ~3s lag.** A preference you just stated isn't queryable for a couple of seconds while the worker finishes.

**Word your rules precisely — under Kiro this matters more.** Claude Code and Pi re-surface relevant rules right beside each tool call; Kiro has no channel for that, so rules act from a distance (session start + a refresh every 15 prompts). A vague rule tends to get overlooked mid-task; one that names the **trigger** and the **concrete pattern** gets applied. Real example, same session:

- ✗ *"name docs so they sort together in the file explorer"* → agent created `dummy_email.txt` anyway
- ✓ *"when creating a new file, match the naming prefix of similar files — email files are `email_*.txt`"* → agent named it correctly and cited the rule while doing it

**To verify capture actually worked** — from a second terminal (Kiro's chat can't shell out):

```bash
claude-recall search "pnpm"                             # did the rule land?
tail -5 ~/.claude-recall/hook-logs/kiro-classifier.log  # what the classifier decided, and which model ran
```

Or, from **inside the Kiro session**, just ask the agent to recall it (*"what do you remember about my package manager?"*) — it reads the same DB and will surface the stored rule if capture succeeded.

**Everything else Kiro** — MCP-only mode, project scoping and `--resume`, the classifier internals, enterprise-governance notes, troubleshooting: **[docs/kiro.md](docs/kiro.md)**.

---

## What happens automatically

Once installed, Claude Recall works in the background (CC = Claude Code):

| When | What happens | CC | Pi | Kiro |
|---|---|:-:|:-:|:-:|
| **Session start** | Active rules are injected into the agent's context | ✓ | ✓ | ✓ |
| **As you type** | Prompts are classified; durable preferences/corrections are stored | ✓ | ✓ | ✓ |
| **Before each tool call** | Relevant rules are re-surfaced next to the action (just-in-time injection) | ✓ | ✓ |  |
| **Every 15 prompts** | Active rules are re-injected so long sessions can't silently lose them (interval configurable) |  |  | ✓ |
| **Tool outcomes** | Failures are recorded; Bash failures are paired with their eventual fix | ✓ | ✓ | ✓ |
| **Re-ask detection** | Frustration signals (*"still broken"*) are recorded as outcome events | ✓ | ✓ | ✓ |
| **Before context compression** | Important context is captured before the window shrinks | ✓ | ✓ |  |
| **After context compression** | Rules are re-injected into the fresh context | ✓ |  |  |
| **Sub-agent spawned** | Rules are injected into the sub-agent; its outcome is captured | ✓ |  |  |
| **Session exit** | An auto-checkpoint (`{completed, remaining, blockers}`) is saved for next time | ✓ | ✓ |  |
| **End of session** | Failure patterns become candidate lessons; validated ones are promoted to rules | ✓ | ✓ |  |
| **Once a day** | The memory janitor reviews stored rules with the runtime's LLM: demotes noise, merges duplicates, rewrites vague rules ([details](#memory-janitor)) | ✓ |  | ✓ |

Classification runs on each runtime's **own** LLM — Claude Code via headless `claude -p` on your subscription; Kiro via `kiro-cli chat --no-interactive` on Kiro credits — with regex as the fallback. **An exported `ANTHROPIC_API_KEY` is never touched** unless you explicitly opt in with `CLAUDE_RECALL_PREFER_API_KEY=1`. No API key is ever required; no configuration needed.

Captured rules are kept **precise and current**: the classifier phrases each rule as *trigger + concrete pattern* where your message allows ("email files must start with email" → *"When creating an email text file, name it `email_*.txt`"*); a rule too vague to act on is stored but flagged, and the agent is nudged at injection time to ask you for a precise restatement. When you restate an existing rule in new words, the **new phrasing supersedes the old row** (counters carry over) instead of creating a duplicate or being swallowed by the old wording.

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

Auto-checkpoints are also saved on session exit in Claude Code and Pi (Pi has no `--resume`, so this is its main recovery path). Extraction runs on your **Claude subscription** (headless `claude -p`) — like capture, no API key needed and no key touched. The same applies to the other background LLM features (failure hindsight hints, end-of-session lesson extraction). Pi-only machines without the `claude` binary can opt in to an `ANTHROPIC_API_KEY` with `CLAUDE_RECALL_PREFER_API_KEY=1`. A quality gate refuses to overwrite a manual checkpoint with a fabricated one when the task was already complete.

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

Failures become candidate lessons (deduplicated by similarity); lessons seen 2+ times (or once, if severe) are promoted to active rules; every just-in-time injection (Claude Code, Pi) is recorded and resolved against the tool's outcome, building per-rule effectiveness data over time.

### Memory janitor

Automatic capture inevitably stores some noise — a conversational fragment misfiled as a preference, the same lesson in five wordings, a rule too vague to act on. Counters can flag *unused* rules (`CLAUDE_RECALL_AUTO_DEMOTE`), but they can't tell a rarely-cited gem from junk. Once a day, the **memory janitor** has the runtime's own LLM (same backend policy as capture — your Claude subscription or Kiro credits, never an API key unless you opted in) review the stored rules and:

- **demote** noise — misfiled conversation, malformed junk, zero-content platitudes
- **merge** duplicates into the single best phrasing
- **rewrite** vague rules into precise trigger-plus-pattern form

Guardrails: nothing is ever deleted (demotions are reversible via `rules promote <id>`, and re-teaching a demoted rule revives it); memories younger than 24h are never reviewed; at most 10 actions per run; malformed LLM output does nothing.

```bash
claude-recall janitor --dry-run   # preview what it would do
claude-recall janitor             # run it now
claude-recall janitor --status    # see the last automatic run
```

Disable with `CLAUDE_RECALL_JANITOR=off`.

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
| `ANTHROPIC_API_KEY`                      | _(unset)_ | Optional personal API key for Haiku-based LLM features. **Never required, never provided by Claude Code, and never touched unless you opt in** with `CLAUDE_RECALL_PREFER_API_KEY=1` — capture, checkpoint extraction, hindsight hints, and session lessons all run on each runtime's own LLM (Claude subscription via `claude -p`; Kiro credits via `kiro-cli`), with regex as the fallback. |
| `CLAUDE_RECALL_CC_MODEL`                 | `haiku` | Dedicated model for capture classification under Claude Code (passed to `claude -p --model`) — independent of your interactive session model. |
| `CLAUDE_RECALL_CC_LLM_TIMEOUT_MS`        | `30000` | Hard cap on the headless `claude -p` classify call before the capture worker gives up and falls through. |
| `CLAUDE_RECALL_KIRO_MODEL`               | `claude-haiku-4.5` | Dedicated model for Kiro-LLM capture classification — **independent of your interactive Kiro chat model**. Raise to `claude-sonnet-4.6` for steadier judgement at more credits. See [docs/kiro-llm-capture.md](docs/kiro-llm-capture.md). |
| `CLAUDE_RECALL_PREFER_API_KEY`           | _(unset)_ | **The only switch that enables the `ANTHROPIC_API_KEY` backend** (and prefers it first). For Pi-only machines without the `claude` binary, or a stronger model you deliberately pay for. Applies to all LLM features, under Claude Code, Kiro, and Pi. |
| `CLAUDE_RECALL_KIRO_LLM_TIMEOUT_MS`      | `30000` | Hard cap on the headless `kiro-cli` classify call before the capture worker gives up and falls back to regex. |
| `CLAUDE_RECALL_REFRESH_INTERVAL`         | `15`    | **Kiro only.** Re-inject the active rules into context every N prompts, so marathon sessions can't silently lose them to context rollover (Kiro has no post-compaction event). `0` disables. |
| `CLAUDE_RECALL_LOAD_BUDGET_TOKENS`       | `2000`  | Token budget for the `load_rules` payload. Rules are emitted in priority order (corrections → preferences by citation → devops by citation → failures) and dropped rules surface via `search_memory`. |
| `CLAUDE_RECALL_AUTO_DEMOTE`              | `false` | When `true`, auto-demote rules on MCP boot where `load_count >= CLAUDE_RECALL_DEMOTE_MIN_LOADS`, `cite_count = 0`, and age `> CLAUDE_RECALL_DEMOTE_MIN_AGE_DAYS`. Still reversible via `rules promote <id>`. |
| `CLAUDE_RECALL_JANITOR`                  | `on`    | Set to `off` to disable the daily memory-janitor pass (LLM review of stored rules — see [Memory janitor](#memory-janitor)). |
| `CLAUDE_RECALL_JANITOR_INTERVAL_HOURS`   | `24`    | Minimum hours between automatic janitor runs.                                                            |
| `CLAUDE_RECALL_JANITOR_GRACE_HOURS`      | `24`    | Memories younger than this are excluded from janitor review — a fresh learning can't be judged noise the day it was taught. |
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

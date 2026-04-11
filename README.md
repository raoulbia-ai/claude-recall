# Claude Recall

### Persistent, local memory for coding agents — learn from every session.

Claude Recall is a **local memory engine** that gives coding agents something they're missing by default:
**the ability to learn from you over time.**

Works with **Claude Code** (via MCP server + hooks) and **[Pi](https://github.com/mariozechner/pi)** (via native extension). Both share the same local database — a preference learned in one agent is available in the other.

Your preferences, project structure, workflows, corrections, and coding style are captured automatically and applied in future sessions — **securely stored on your machine**.

---

## Features

- **Smart Memory Capture** — LLM-powered classification (via Claude Haiku) detects preferences and corrections from natural language, with silent regex fallback
- **Project-Scoped Knowledge** — each project gets its own memory namespace; switch projects and the agent switches context automatically
- **Failure Learning** — captures what failed, why, and what to do instead — so the agent doesn't repeat mistakes
- **Outcome-Aware Learning** — tracks action outcomes (all tool results, test cycles, user corrections), synthesizes candidate lessons, and promotes validated patterns into active rules automatically
- **Skill Crystallization** — auto-generates `.claude/skills/auto-*/` files from accumulated memories, using Anthropic's [Agent Skills](https://agentskills.io/) open standard
- **Local-Only** — SQLite on your machine, no telemetry, no cloud, works fully offline

---

## Quick Start

### Requirements

| Component | Version                 | Notes                       |
| --------- | ----------------------- | --------------------------- |
| Node.js   | **20+**                 | required for better-sqlite3 |
| OS        | macOS / Linux / Windows | WSL supported               |

### Install for Claude Code

#### First-time install

Run this **once** on your machine:

```bash
npm install -g claude-recall
```

Then run these **in the project directory** where you want claude-recall active:

```bash
claude-recall setup --install
claude mcp add claude-recall -- claude-recall mcp start
```

Restart Claude Code. **Verify**: ask *"Load my rules"* — Claude should call `mcp__claude-recall__load_rules`.

#### Adding to another project

The global binary is already installed. Just `cd` into the new project and run the per-project commands:

```bash
claude-recall setup --install
claude mcp add claude-recall -- claude-recall mcp start
```

Restart Claude Code in that project.

### Install for Pi

```bash
pi install npm:claude-recall
```

That's it. The extension registers tools and loads a skill automatically. No further configuration needed.

**Verify:** Start Pi and ask *"Load my rules"* — Pi should call `recall_load_rules`.

### Shared Database

Both agents use the same database (`~/.claude-recall/claude-recall.db`). Memories are scoped per project by working directory. A correction learned in Claude Code is available in Pi and vice versa.

### Upgrading

#### If you use Claude Code

Run this **once** to update the global binary:

```bash
npm install -g claude-recall
```

Then run this **in each project directory** where you use claude-recall (the binary upgrade alone isn't enough — new releases sometimes add hook events that need to be registered in each project's `.claude/settings.json`):

```bash
claude-recall setup --install
```

Restart Claude Code so the new MCP server starts (or run `claude-recall mcp restart` from the project directory to keep the current session running).

**Verify**: `claude-recall --version` shows the new version, and asking *"Load my rules"* in Claude Code triggers `mcp__claude-recall__load_rules`.

#### If you use Pi

Run this **once** — the `npm:` prefix is required (it matches the original install command):

```bash
pi update npm:claude-recall
```

Restart Pi to load the updated extension.

**Verify**: `pi list` shows the new `claude-recall` version, and asking *"Load my rules"* in Pi triggers `recall_load_rules`.

#### If you use both

Both upgrades are independent — run the Claude Code section AND the Pi section. Both agents share the same `~/.claude-recall/claude-recall.db`, so memories captured in either are visible to the other.

---

## What to Expect

Once installed, Claude Recall works automatically in the background. Each row below is tagged with the runtime it applies to so you can skip what doesn't apply to you.

| When | What happens | CC | Pi |
|---|---|:-:|:-:|
| **Session start** | Active rules are loaded before the first action and injected into the agent's context | ✓ | ✓ |
| **As you work** | Every prompt is classified for corrections and preferences. Natural statements like *"we use tabs here"* are detected and stored | ✓ | ✓ |
| **Before each tool call / agent turn** | **Just-in-time rule injection** — relevant rules are surfaced as a `<system-reminder>` block adjacent to the action so the agent sees them at the moment of decision (not 50,000 tokens upstream). Per-tool-call in CC; per-turn in Pi | ✓ | ✓ |
| **Tool outcomes** | Tool results (Bash, Edit, Write, etc.) are captured. Failures are stored; Bash failures are paired with their successful fixes | ✓ | ✓ |
| **Reask detection** | Frustration signals (*"still broken"*, *"that didn't work"*) are recorded as outcome events | ✓ | ✓ |
| **Before context compression** | Aggressive memory sweep captures important context before the window shrinks | ✓ | ✓ |
| **After context compression** | Rules are automatically re-injected into the new context so they're not lost | ✓ |   |
| **Sub-agent spawned** | Active rules are injected into the sub-agent's context. Sub-agent outcomes (completed/failed/killed) are captured | ✓ |   |
| **Rules sync** | Top 30 rules are exported as typed `.md` files to Claude Code's native memory directory | ✓ |   |
| **Session exit** | **Auto-checkpoint** — the most recent task is extracted into a `{completed, remaining, blockers}` snapshot and saved for the next session. Critical for Pi (no `--resume` flag); safety net for CC users who exit without resuming | ✓ | ✓ |
| **End of session** | Session episodes are created, candidate lessons are extracted from failures, and validated patterns are promoted into active rules | ✓ | ✓ |

Classification and checkpoint extraction use Claude Haiku (via `ANTHROPIC_API_KEY`) with silent regex fallback. No configuration needed.

**Next session:** `load_rules` returns everything captured previously — the agent applies your preferences without being told twice.

```bash
# Verify it's working
claude-recall stats
claude-recall search "preference"
```

---

## How It Works

Claude Recall provides four memory tools backed by a local SQLite database with WAL mode, content-hash deduplication, and automatic compaction. The tools are exposed differently depending on the agent:

- **Claude Code** — MCP server with four tools and seven prompts, plus file-system hooks for automatic capture
- **Pi** — native extension with registered tools and event handlers, plus a skill file for behavioral guidance

| Tool | Claude Code | Pi |
| ---- | ----------- | --- |
| Load rules | `mcp__claude-recall__load_rules` | `recall_load_rules` |
| Store memory | `mcp__claude-recall__store_memory` | `recall_store_memory` |
| Search memory | `mcp__claude-recall__search_memory` | `recall_search_memory` |
| Delete memory | `mcp__claude-recall__delete_memory` | `recall_delete_memory` |

### Skills

Claude Recall uses skill files to teach agents when and how to use memory tools.

**Claude Code** uses Anthropic's [Agent Skills](https://agentskills.io/) open standard:

- `.claude/skills/memory-management/SKILL.md` — core skill, guides memory behavior
- `.claude/skills/auto-*/` — auto-generated, crystallized from accumulated memories

See Anthropic's [Agent Skills blog post](https://claude.com/blog/equipping-agents-for-the-real-world-with-agent-skills) for the standard.

**Pi** ships a single `skills/memory-management.md` loaded via Pi's package manifest. No setup needed.

### Outcome-Aware Learning

Claude Recall tracks what happens *after* the agent acts — not just what was said. The outcome processing pipeline:

```
action → outcome event → episode → candidate lesson → promotion → active rule
```

- **Outcome events** capture results from all tool types (Bash, Edit, Write, MCP), test outcomes, user corrections, and reask signals
- **Episodes** summarize entire sessions with outcome type, severity, and confidence
- **Candidate lessons** are extracted from failure patterns — deduplicated by Jaccard similarity
- **Promotion engine** graduates lessons into active rules after 2+ observations (or immediately for high-severity failures), and demotes never-helpful memories
- **Outcome-aware retrieval** boosts memories with evidence, penalizes stale/unhelpful ones

---

## CLI Reference

### Health Check (run these first)

```bash
claude-recall --version              # Confirm installed version
claude-recall status                 # Installation health: hooks, MCP, DB path, project ID
claude-recall stats                  # What's in the DB for this project
claude-recall stats --global         # What's in the DB across ALL projects
```

### Inspecting Memories

```bash
claude-recall search "query"             # Search current project's memories
claude-recall search "query" --global    # Search across all projects
claude-recall search "query" --json      # Machine-readable output
claude-recall search "query" --project <id>  # Search a specific project

claude-recall failures                   # View failure memories (current project)
claude-recall failures --limit 20        # Show more

claude-recall outcomes                   # Outcome-aware learning status
claude-recall outcomes --section lessons # Just candidate lessons
claude-recall outcomes --section stats   # Retrieval/helpfulness stats per memory
claude-recall outcomes --limit 20        # More items per section

claude-recall monitor                    # Memory search monitoring stats
```

### Managing Memories

```bash
claude-recall store "content"                # Store a memory (default type: preference)
claude-recall store "content" -t correction  # Store with specific type
claude-recall export backup.json             # Export all memories to JSON
claude-recall import backup.json             # Import memories from JSON
claude-recall clear --force                  # Delete all memories (irreversible)
```

### Task Checkpoints

Persistent "where I left off" snapshots — one per project, replaces previous on save. Not loaded as a rule; `load_rules` only hints that one exists.

```bash
claude-recall checkpoint save \
  --completed "inference layer, domain layer" \
  --remaining "wire server.js, strip 3GPP URNs" \
  --blockers "none" \
  --notes "see inference/README.md"

claude-recall checkpoint load              # Show the latest checkpoint
claude-recall checkpoint load --json       # Machine-readable
claude-recall checkpoint clear             # Delete the checkpoint
```

Agents can also save/load checkpoints via MCP tools (`mcp__claude-recall__save_checkpoint` / `mcp__claude-recall__load_checkpoint`) or Pi tools (`recall_save_checkpoint` / `recall_load_checkpoint`).

#### Auto-checkpoint on session exit (v0.21.2+)

Manual `checkpoint save` is the explicit path. **Auto-checkpoint** is the safety net: when a session ends, the most recent task is extracted into a checkpoint automatically so the next session can resume.

**When it fires:**

- **Pi** — every `session_shutdown` event. **This is the only way to recover context in Pi: there is no `pi --resume` equivalent.**
- **Claude Code** — voluntary `SessionEnd` reasons (`clear`, `prompt_input_exit`, `logout`). Skips `bypass_permissions_disabled` and `other` (system-driven exits, not user intent). Useful if you exit and start fresh instead of using `claude --resume`.

**Behavior (both runtimes):**

- Uses Haiku to extract `{completed, remaining, blockers}` from the most recent task in the transcript
- **Quality gate**: refuses to save if the LLM detects the task was already complete (e.g., agent said "Done.", user said "thanks"). **Manual checkpoints are never overwritten with garbage** — an empty checkpoint is far better than a fabricated one
- **Tagged**: auto-saved checkpoints include `[auto-saved on <pi|cc> session exit at <iso-timestamp>]` in their notes field
- **Requires `ANTHROPIC_API_KEY`**. Without it, no auto-checkpoint is saved and manual `checkpoint save` still works

**Disable:**

- **Claude Code**: remove the `SessionEnd` block from `.claude/settings.json`
- **Pi**: no per-project disable flag yet — [open an issue](https://github.com/raoulbia-ai/claude-recall/issues) if you need one

### Troubleshooting

```bash
# "Are my hooks installed?"
claude-recall status                     # Shows hook registration status
claude-recall hooks check                # Verify hook files exist and are valid

# "Is the MCP server running?"
claude-recall mcp status                 # Current project's server status
claude-recall mcp ps                     # List all running servers

# "Which project does this directory map to?"
claude-recall project show               # Shows project ID for current directory
claude-recall project list               # All registered projects

# "Why do I see memories from other projects?"
claude-recall search "query"             # Scoped to current project (default)
claude-recall search "query" --global    # Explicitly cross-project

# "How do I check what the DB actually contains?"
sqlite3 ~/.claude-recall/claude-recall.db "SELECT type, COUNT(*) FROM memories GROUP BY type"
sqlite3 ~/.claude-recall/claude-recall.db "SELECT type, COUNT(*) FROM memories WHERE project_id = '<id>' GROUP BY type"

# "Hook logs — what did the hooks actually do?"
tail -20 ~/.claude-recall/hook-logs/tool-outcome-watcher.log
tail -20 ~/.claude-recall/hook-logs/memory-stop.log
tail -20 ~/.claude-recall/hook-logs/correction-detector.log

# "Something is broken, start fresh"
claude-recall repair                     # Clean up old hooks, reinstall skills
claude-recall setup --install            # Reinstall skills + hooks
claude-recall mcp cleanup --all          # Stop all stale MCP servers
```

<details>
<summary>All commands</summary>

```bash
# ── Setup & Diagnostics ─────────────────────────────────────────────
claude-recall setup                      # Show activation instructions
claude-recall setup --install            # Install skills + hooks
claude-recall status                     # Installation and system status
claude-recall repair                     # Clean up old hooks, install skills
claude-recall hooks check                # Verify hook files exist and are valid
claude-recall hooks test-enforcement     # Test if search enforcer hook works

# ── Memory ───────────────────────────────────────────────────────────
claude-recall stats                      # Memory statistics (current project)
claude-recall stats --global             # Memory statistics (all projects)
claude-recall search "query"             # Search memories (current project)
claude-recall search "query" --global    # Search memories (all projects)
claude-recall search "query" --json      # Output as JSON
claude-recall search "query" --project <id>  # Search specific project
claude-recall store "content"            # Store memory directly
claude-recall store "content" -t <type>  # Store with type (preference, correction, failure, devops, project-knowledge)
claude-recall export backup.json         # Export memories to JSON
claude-recall import backup.json         # Import memories from JSON
claude-recall clear --force              # Clear all memories
claude-recall failures                   # View failure memories
claude-recall failures --limit 20        # Limit results
claude-recall outcomes                   # Outcome-aware learning status
claude-recall outcomes --section lessons # Just candidate lessons
claude-recall outcomes --section stats   # Retrieval/helpfulness stats
claude-recall outcomes --limit 20        # More items per section
claude-recall monitor                    # Memory search monitoring stats

# ── Task Checkpoints ────────────────────────────────────────────────
claude-recall checkpoint save --completed <text> --remaining <text> [--blockers <text>] [--notes <text>] [--project <id>]
claude-recall checkpoint load [--project <id>] [--json]
claude-recall checkpoint clear [--project <id>]

# ── Skills ───────────────────────────────────────────────────────────
claude-recall skills generate            # Generate skills from memories
claude-recall skills generate --dry-run  # Preview without writing
claude-recall skills generate --force    # Regenerate even if unchanged
claude-recall skills list                # List generated skills
claude-recall skills clean --force       # Remove all auto-generated skills

# ── MCP Server ───────────────────────────────────────────────────────
claude-recall mcp status                 # Current project's server status
claude-recall mcp ps                     # List all running servers
claude-recall mcp stop                   # Stop server
claude-recall mcp stop --force           # Force stop
claude-recall mcp restart                # Restart server
claude-recall mcp cleanup                # Remove stale PID files
claude-recall mcp cleanup --all          # Stop all servers

# ── Project ──────────────────────────────────────────────────────────
claude-recall project show               # Current project info
claude-recall project list               # All registered projects
claude-recall project register           # Register current project
claude-recall project unregister [id]    # Unregister a project
claude-recall project clean              # Remove stale registry entries

# ── Database Migration ──────────────────────────────────────────────
claude-recall migrate check              # Check if migration needed
claude-recall migrate schema             # Show current schema version
claude-recall migrate export             # Export pre-migration backup
claude-recall migrate import             # Import from backup
claude-recall migrate complete           # Run pending migrations

# ── Auto-Capture Hooks (run automatically, registered via setup --install) ──
claude-recall hook run correction-detector   # UserPromptSubmit hook
claude-recall hook run memory-stop           # Stop hook
claude-recall hook run precompact-preserve   # PreCompact hook
claude-recall hook run memory-sync           # Stop + PreCompact hook (syncs rules to auto-memory)
```

</details>

---

## Project Scoping

Each project gets isolated memory based on its working directory. **Project ID** is derived from the `cwd` passed by the agent. Universal memories (no project scope) are available everywhere. Switching projects switches memory automatically.

Database location: `~/.claude-recall/claude-recall.db` (shared file, scoped by `project_id` column).

---

## Security & Privacy

- SQLite memory never leaves your machine
- No prompts, code, or memory content is transmitted
- Full transparency via CLI (`stats`, `search`, `export`)
- Never stores secrets (API keys, passwords, tokens)

Details in [docs/security.md](docs/security.md).

---

<details>
<summary>WSL Users</summary>

If you hit "invalid ELF header" errors from mixed Windows/WSL `node_modules`, ensure you're using the global install (now the default). Verify the binary resolves to a Linux path:

```bash
which claude-recall
# Should show: /home/<user>/.nvm/.../bin/claude-recall (NOT a Windows path)
```

Global installation does **not** affect project scoping — project ID is still detected from Claude Code's working directory.

</details>

---

## Development & Contributions

PRs welcome — Claude Recall is open to contributors.

```bash
npm run build          # Compile TypeScript
npm test               # Run all tests
npm run test:watch     # Watch mode
npm run mcp:dev        # Start MCP server in dev mode
```

---

## Acknowledgments

The outcome-aware learning pipeline (v0.18.0) was inspired by [OpenClaw-RL](https://github.com/Gen-Verse/OpenClaw-RL) from Gen-Verse. Their core ideas — treating the next state as a first-class learning signal, separating evaluative and directive feedback, and promoting only durable lessons — shaped Claude Recall's episode tracking, candidate lesson extraction, and promotion engine. Claude Recall adapts these concepts for a closed-model runtime using memory promotion rather than gradient updates.

---

## License

MIT.

# Claude Recall

### Persistent, local memory for coding agents — learn from every session.

Every coding session starts the same way: the agent has forgotten everything. That you use pnpm, not npm. That the deploy script needs a dry run first. That the test suite lies about passing unless you read the summary line. You explain it again, and next week you explain it again.

Claude Recall gives the agent a memory. It listens while you work, notices when you state a preference or correct a mistake, and remembers it in a small database on your machine. Next session, the agent already knows. It works with **Claude Code**, **[Pi](https://github.com/mariozechner/pi)** and **[Kiro CLI](https://kiro.dev/cli/)**, all sharing one memory, so something you teach one agent, the others know too. Nothing leaves your machine except what your agent already sends to its own AI: no cloud service, no telemetry, and it works offline.

**Jump to:** [A week with Claude Recall](#a-week-with-claude-recall) · [Getting started](#getting-started) · [What happens while you work](#what-happens-while-you-work) · [Reviewing memories](#reviewing-what-it-learned) · [Janitor](#memory-janitor) · [Commands](#everyday-commands) · [Under the hood](#under-the-hood) · [Upgrading](#upgrading) · [Configuration](#configuration) · [Security](#security--privacy)

---

## A week with Claude Recall

**Tuesday.** Halfway through a task, you correct the agent once, in plain words:

> **You:** use pnpm here, not npm

You don't say "remember this", and nothing appears on screen. But a few seconds later, in the background, Claude Recall has asked the agent's own AI whether that was a lasting rule, and stored it (`~/.claude-recall/hook-logs/cc-classifier.log`):

```text
classified via claude -p (model=haiku, Claude subscription, no API key): correction — Use pnpm, not npm
```

It ran on the same Claude subscription your session already uses. No API key, no tool call, no file to edit.

**Wednesday.** The agent runs a command that fails because a tool isn't installed. Claude Recall notices the failure too. Because the agent didn't hear it from *you*, it doesn't trust it yet: it puts it aside for you to look at, and your status bar shows `⏳ 1 to review`.

**Thursday.** The [janitor](#memory-janitor), a daily tidy-up that leaves anything new alone for a day, has rewritten the raw error into a sentence a person can judge: *"Reading a PDF as page images fails on this machine because poppler-utils isn't installed; extract the text instead."* You type `recall review` in the chat, read it, and press `y`. From now on the agent knows.

**Friday.** A brand-new session, with no shared history:

> **You:** set up a test runner for this project
>
> **Agent:** Installing vitest with **pnpm** *(applied from memory: "Use pnpm, not npm")* …

Your rules were loaded when the session started, and the relevant one was put back in front of the agent right before it ran the command: at the moment of decision, not 50,000 tokens earlier. It works across agents too: correct Claude Code on Tuesday, and Kiro applies it on Friday.

**Any day,** you can see exactly what it knows:

```bash
$ claude-recall search "pnpm"
🔍 Found 1 memories (showing top 1):

1. [correction] Score: 7.9
   Content: {"content":"Use pnpm, not npm","confidence":0.95,"source":"hook-auto-capture",...}
```

---

## Getting started

**Requirements:** Node.js **20.19+** on macOS, Linux or Windows (WSL supported).

Install the program once, globally:

```bash
npm install -g claude-recall
```

> **Don't add claude-recall as a project dependency** (`npm install claude-recall` inside a project). All your projects share one memory, and a stale project-local copy silently shadows the global one. One global install; switch it on per agent below.
> Hit `EACCES: permission denied`? See [Install & upgrade troubleshooting](#upgrading).

> **Using nvm?** A global install lives under the *active* Node version, so switching versions hides it (`claude-recall: command not found`, and capture stops). Make it follow you across versions:
> ```bash
> echo 'claude-recall' >> ~/.nvm/default-packages   # every future `nvm install` includes it
> ```
> `claude-recall doctor` spots an install left behind by a version switch. Works in your terminal but not in the Claude desktop app or an IDE? See *nvm: "Executable not found"* under [Install & upgrade troubleshooting](#upgrading).

Then connect it to your agent.

### Claude Code

The simplest setup turns memory on for every project at once:

```bash
claude-recall setup --install --global      # hooks → ~/.claude (every project)
claude mcp add --scope user claude-recall -- claude-recall mcp start
```

Restart Claude Code, and every project, current and future, has memory. Each project still keeps its own memories (the working directory decides which), so a rule about one codebase doesn't leak into another. To check it's on, ask *"Load my rules"*: Claude should call `load_rules`.

If you'd rather try it in one project first:

```bash
claude-recall setup --install               # hooks → ./.claude
claude mcp add claude-recall -- claude-recall mcp start
```

> Set up projects one by one before and want to switch to the global setup? Run the global pair above, then `claude-recall doctor --fix`. It repairs stale config and **removes the now-redundant per-project hooks**, keeping any hooks of your own.

**It runs on your Claude subscription, never an API key.** Each prompt is classified by a headless `claude -p` call on the same login that runs your session, in a background worker, so your turn is never held up and a capture lands a few seconds later. If you happen to have `ANTHROPIC_API_KEY` set for other tools, Claude Recall deliberately ignores it unless you set `CLAUDE_RECALL_PREFER_API_KEY=1`: a stray key shouldn't quietly spend your API credits. To watch captures land:

```bash
tail -5 ~/.claude-recall/hook-logs/cc-classifier.log   # which model ran, what was stored
claude-recall search "something you said"
```

The design (the `claude -p` key-precedence gotcha, recursion guards, which features use the subscription): [docs/cc-llm-capture.md](docs/cc-llm-capture.md).

### Pi

```bash
pi install npm:claude-recall
```

That's all. Ask Pi to *"Load my rules"* to check.

### Kiro CLI

Kiro needs claude-recall 0.28.0 or later. In the project directory, before starting Kiro:

```bash
claude-recall kiro setup      # writes a custom agent at .kiro/agents/recall.json
kiro                          # then inside the chat:  /agent swap recall
```

Already working in a custom agent of your own? Merge Claude Recall into it instead (backup written, safe to repeat, your config kept):

```bash
claude-recall kiro setup --merge-into <agent-name>
```

> **⚠️ Start ONE fresh conversation after setup. This is the most common reason "it does nothing".**
>
> After `kiro setup` or `--merge-into`, start **one new conversation without `--resume`**:
>
> ```bash
> kiro-cli chat --agent recall        # or: --agent <your-agent> if you merged
> ```
>
> Kiro takes a snapshot of the agent config when a conversation is *created*. Any conversation that already existed, including one you reach with `--resume` or after restarting Kiro, was snapshotted **before** Claude Recall was wired in, so it will **never** run the hooks and capture silently does nothing. After that one fresh conversation, every conversation carries the hooks and `--resume` works normally. It's a one-time rollover per project.
>
> Check the wiring before relying on it:
>
> ```bash
> claude-recall kiro doctor           # green checks = hooks are active for this project
> ```

**It runs on Kiro's own AI, not an API key or a personal subscription.** Each prompt is classified with a fixed model (default `claude-haiku-4.5`, separate from your chat model) at **about 0.06 Kiro credits per prompt**: cheap, but it's every prompt, so budget for it across a team.

**What capture feels like under Kiro**, so it doesn't seem broken:

- **It's silent.** Capture runs in a background worker so it never blocks your turn, which also means there's **no "captured ✓" message** in the Kiro chat. Stating a preference and seeing nothing happen is normal.
- **It's a judgement, not a guarantee.** The AI decides what's a lasting rule and what's chit-chat; it won't catch every phrasing. Plain statements ("use pnpm here, not npm") work best.
- **There's a few seconds' lag** before a new rule can be found.

**Word your rules precisely, especially under Kiro.** Claude Code and Pi put relevant rules right next to each command the agent runs; Kiro can't, so its rules work from a distance (session start, plus a refresh every 15 prompts). A vague rule gets overlooked mid-task; one that names the **situation** and the **concrete pattern** gets applied. From a real session:

- ✗ *"name docs so they sort together in the file explorer"* → the agent created `dummy_email.txt` anyway
- ✓ *"when creating a new file, match the naming prefix of similar files — email files are `email_*.txt`"* → named correctly, and the agent cited the rule while doing it

**To check a capture worked**, from a second terminal (Kiro's chat can't run shell commands):

```bash
claude-recall search "pnpm"                             # did the rule land?
tail -5 ~/.claude-recall/hook-logs/kiro-classifier.log  # what the classifier decided, and which model ran
```

Or just ask inside the Kiro session (*"what do you remember about my package manager?"*): it reads the same memory.

**Everything else about Kiro** (MCP-only mode, project scoping and `--resume`, the classifier internals, enterprise governance, troubleshooting): **[docs/kiro.md](docs/kiro.md)**.

---

## What happens while you work

Once it's installed you don't operate Claude Recall; it works alongside you. Here's a session from its point of view.

When the session **starts**, it hands the agent your rules for this project. As you **type**, it reads each message in the background and keeps the ones that are lasting preferences or corrections. Before the agent **runs a command or edits a file**, it puts the rules that matter for that action back in front of it, because a rule mentioned an hour ago is easy to forget. When a command **fails**, it records what broke (and, for shell commands, the fix that eventually worked), setting it aside for your review. When the conversation gets long and is **compressed**, it saves what matters first and re-loads your rules afterwards. When you **leave**, it writes a short "where I left off" note for next time. And **once a day**, the janitor tidies up.

The full list, by agent (CC = Claude Code):

| When | What happens | CC | Pi | Kiro |
|---|---|:-:|:-:|:-:|
| **Session start** | Your rules for this project are given to the agent | ✓ | ✓ | ✓ |
| **As you type** | Your messages are classified; lasting preferences and corrections are stored | ✓ | ✓ | ✓ |
| **Before each command or edit** | Rules relevant to that action are put back in front of the agent | ✓ | ✓ |  |
| **Every 15 prompts** | Rules are re-sent so long sessions can't lose them (interval configurable) |  |  | ✓ |
| **When something fails** | The failure is recorded for your review; shell failures are paired with their eventual fix | ✓ | ✓ | ✓ |
| **Before the conversation is compressed** | Important context is captured first | ✓ | ✓ |  |
| **After it's compressed** | Rules are re-loaded into the fresh context | ✓ |  |  |
| **A sub-agent starts** | It's given your rules too | ✓ |  |  |
| **Session ends** | A checkpoint (`{completed, remaining, blockers}`) is saved for next time | ✓ | ✓ |  |
| **A hard-won success** | A goal that failed repeatedly before it worked is kept as a reusable `solution` ([details](#success-capture)) | ✓ | ✓ |  |
| **Once a day** | The [janitor](#memory-janitor) cleans up: drops noise, merges duplicates, sharpens vague rules, confirms rules you stated, tidies the review queue | ✓ |  | ✓ |

Every one of these uses the agent's **own** AI: Claude Code through headless `claude -p` on your subscription, Kiro through `kiro-cli chat --no-interactive` on Kiro credits, with simple pattern matching as the fallback when no AI is available. **An exported `ANTHROPIC_API_KEY` is never touched** unless you opt in with `CLAUDE_RECALL_PREFER_API_KEY=1`. Nothing needs configuring.

**Rules are kept precise and current.** Where your message allows, a rule is phrased as *situation + concrete pattern* ("email files must start with email" becomes *"When creating an email text file, name it `email_*.txt`"*). A rule too vague to act on is still kept, but flagged, and the agent is nudged to ask you for a precise version. When you restate a rule in new words, **the new wording replaces the old one** (its usage history carries over) instead of piling up a duplicate.

**You can see it's on.** Because the work happens out of sight, Claude Recall puts a line at the bottom of the Claude Code terminal for the whole session: `🧠 Recall · N rules · <project>`, plus `⏳ N to review` when something is waiting for you. `setup --install` adds it, and never replaces a status line you already have (add `claude-recall statusline` to yours). After the conversation is compressed you'll also see `🔄 Recall: N rules re-loaded`. For a full check-up:

```bash
claude-recall doctor                     # full health check (install, config, hooks, server, database)
claude-recall stats
claude-recall search "preference"
```

---

## Reviewing what it learned

A memory only steers the agent once you've vouched for it. **Rules in your own words are used straight away.** Everything else waits for your review: memories the agent stored itself, failures and session learnings derived from tool output, imports, and memories from before this was introduced. This keeps text the agent merely *read* (a web page, a file, an error message) from quietly becoming an instruction.

You'll know when something is waiting: the status bar shows `⏳ N to review`, and the agent mentions it at the start of a session. Review right in the chat (Claude Code, Pi):

| Type | Does |
|---|---|
| `recall review` | Steps through them one at a time: `y` approve, `n` reject, `s` skip, `all` approve the rest, `q` stop (or several at once, like `nyy`) |
| `recall pending` | Lists them with ids |
| `recall approve 12 15` · `recall approve all` | Approves by id, or everything waiting |
| `recall reject 12` | Rejects; the same text won't be accepted again from an untrusted source |

Each item says where it came from and what approving it would do. These commands are handled before the agent sees your message, so the agent can't approve anything on your behalf. In a terminal, use `claude-recall rules review` (or `rules pending` / `approve` / `reject`).

To keep the queue short, the daily [janitor](#memory-janitor) rewrites cryptic failures into plain descriptions and drops ones that weren't real, and failures nobody reviewed leave the queue after 14 days. To switch reviewing off and load everything as before, set `CLAUDE_RECALL_QUARANTINE=off`.

---

## Memory janitor

The janitor is a once-a-day tidy-up of your memory, done by the same AI that powers your sessions.

Automatic capture is quick, and sometimes wrong. Now and then it keeps a stray half-sentence as a "preference", stores the same rule in five wordings, or records a "failure" that was really just a search result containing the word FAIL. Usage counters can spot rules nobody uses (`CLAUDE_RECALL_AUTO_DEMOTE`), but they can't tell a rarely-needed gem from junk. So on the first prompt of each day, the janitor reads through what's stored and:

- **drops noise**: misfiled chatter, broken fragments, advice so generic nobody needs it stored
- **merges duplicates** into the single best wording
- **sharpens vague rules** into a precise situation-plus-pattern form
- **confirms rules you actually said**, by checking them against your own words
- **tidies the review queue**: rewrites cryptic failures (a raw command and error) into a plain description of what went wrong and what to do instead, and drops "failures" that weren't real. A rewritten memory still waits for your review

When a memory carries a [source](#under-the-hood), the janitor sees the words it was captured from, and drops rules those words don't support. The usual case is a fragment of something you pasted (a log, a document, a bug report) that was mistaken for a preference. A merged or rewritten rule keeps the source of the rule it replaces.

When your words plainly state a rule, the janitor marks it **confirmed**, and confirmed rules load first: when a section's limit or the size budget cuts rules, unconfirmed ones go first. A rule stays unconfirmed when it has no source, was only inferred, or hasn't been reviewed yet; changing its content clears the confirmation.

It's careful by design. Nothing is ever deleted (anything it switches off comes back with `rules promote <id>`, and teaching the same rule again revives it); nothing less than 24 hours old is touched; it makes at most 10 changes per run; and if the AI's answer is malformed, it does nothing.

```bash
claude-recall janitor --dry-run   # preview what it would do
claude-recall janitor             # run it now
claude-recall janitor --status    # see the last automatic run
```

Switch it off with `CLAUDE_RECALL_JANITOR=off`.

---

## Why not just steering files or CLAUDE.md?

Use them! They're the right tool for **team standards you already know**: written by hand, reviewed in pull requests, shipped with the repo. Claude Recall covers what they can't:

- **Nobody writes it down.** A steering file holds what someone remembered to document. Claude Recall captures rules *in the flow of work*: you correct the agent once, mid-session, and it's kept. The things that burn you repeatedly are exactly the things too small to feel worth documenting.
- **They can't learn from failure.** No steering file turns *a tool failure into a rule*. "Exit code 0 doesn't mean the tests passed" enters Claude Recall because the agent got burned, not because someone wrote a postmortem.
- **One memory, every agent.** Steering files are Kiro-only and CLAUDE.md is Claude-Code-only. Claude Recall is one memory behind Claude Code, Kiro and Pi: correct one agent, and they all know.
- **They rot.** Nobody prunes a rules file. Claude Recall tracks which rules are used, retires dead ones, and a daily janitor merges duplicates and clears noise.
- **Personal isn't the repo.** "GPG signing fails in *my* WSL" doesn't belong in a committed file. Claude Recall is per-developer and never touches your repo.
- **They bloat context.** An always-included steering file puts its full text into every interaction, relevant or not, and only grows. Claude Recall works within a size budget, brings up the rules that matter for the action at hand, and prunes itself, so the cost stays bounded as memory grows.

In short: steering files are documentation, what your team decided. Claude Recall is memory, what your sessions taught.

---

## Everyday commands

Most days you won't need any of these; they're for looking inside and tidying up.

```bash
claude-recall status                     # Installation health: hooks, MCP, database path, project ID
claude-recall stats                      # What's stored for this project (--global for all)

claude-recall list                       # List memories, newest first (-t <type>, --all, --json, --global)
claude-recall search "query"             # Search this project's memories (--global, --json, --project <id>)
claude-recall failures                   # What broke and what fixed it

claude-recall store "content"            # Store a memory by hand (-t correction|devops|...)
claude-recall delete <key>               # Delete one memory (keys shown by search)
claude-recall export backup.json         # Export to JSON (import to restore)
claude-recall clear --force              # Wipe this project's memories (backup written first)
```

### Task checkpoints

A checkpoint is a "where I left off" note: one per project, replaced each time you save.

```bash
claude-recall checkpoint save --completed "API layer" --remaining "wire the UI" --blockers "none"
claude-recall checkpoint load
```

Claude Code and Pi also save one automatically when a session ends (Pi has no `--resume`, so this is how it picks up again). Like capture, it's written by your agent's own AI on your subscription, with no API key involved; the same goes for the other background features (session learnings, batch classification). Pi-only machines without the `claude` program can opt in to an `ANTHROPIC_API_KEY` with `CLAUDE_RECALL_PREFER_API_KEY=1`. A safeguard stops an automatic checkpoint from overwriting your own when the task was already done.

### When something seems wrong

```bash
claude-recall doctor                     # One-shot health check: install, MCP config, hooks, live server, database
claude-recall doctor --fix               # Repair MCP-config drift and broken hook paths (backups first)
claude-recall status                     # Are hooks + MCP registered? Which project is this?
claude-recall hooks check                # Do the hook files exist and validate?
claude-recall mcp status                 # Is the MCP server running? (mcp ps lists all)
claude-recall project show               # Which project ID does this directory map to?
claude-recall repair                     # Fix broken hook paths (--dry-run to preview)
claude-recall mcp cleanup --all          # Stop stale MCP servers

# What did the hooks actually do?
tail -20 ~/.claude-recall/hook-logs/hook-dispatcher.log
```

`error: unknown command '<x>'` means your installed version is older than these docs: see [Upgrading](#upgrading).

<details>
<summary><b>All commands</b></summary>

```bash
# ── Setup & Diagnostics ─────────────────────────────────────────────
claude-recall setup                      # Show activation instructions
claude-recall setup --install            # Install skills + hooks (Claude Code, current project)
claude-recall kiro setup                 # Write Kiro custom agent (--global for all projects)
claude-recall kiro setup --merge-into <agent>  # Merge into an existing Kiro agent
claude-recall kiro doctor                # Kiro integration health report
claude-recall doctor                     # Health check: install, MCP config, hooks, live server, DB (--fix repairs config + hooks)
claude-recall statusline                 # One-line memory indicator for Claude Code's settings.json "statusLine" (added by setup)
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
claude-recall list                       # List memories, newest first (-t <type>, --all, --json, --global)
claude-recall search "query"             # Search memories (--global, --json, --project <id>)
claude-recall store "content"            # Store memory directly
claude-recall store "content" -t <type>  # Type: preference, correction, failure, devops, project-knowledge, solution
claude-recall export backup.json         # Export current project (--global for all)
claude-recall import backup.json         # Import memories from JSON
claude-recall delete <key>               # Delete one memory by key (get keys from `search`)
claude-recall clear --force              # Clear current project (--global for all; auto-backup written first)
claude-recall failures                   # View failure memories (--limit N)
claude-recall outcomes                   # Outcome history, when CLAUDE_RECALL_OUTCOME_TRACKING=on (--section episodes|events|stats, --limit N)
claude-recall monitor                    # Memory search monitoring stats

# ── Reviewing & Rule Hygiene ─────────────────────────────────────────
claude-recall rules review               # Step through memories waiting for your review: approve / reject / skip
claude-recall rules pending              # List them (--type, --origin, --all-projects)
claude-recall rules approve <id...>      # Approve (or --all [--type t] [--origin o]); reject works the same
claude-recall rules history [id]         # How a memory was created and changed (latest changes with no id)
claude-recall rules demote [--dry-run]   # Demote rules loaded >=N times but never cited
                                         # (citations are counted under both Claude Code and Pi)
claude-recall rules demote --min-loads 20 --min-age-days 7   # Tune thresholds
claude-recall rules promote <id>         # Restore an auto-demoted, auto-deduped or janitor-demoted rule
claude-recall rules dedup [--dry-run]    # Collapse near-duplicate rules (--threshold 0.8 for stricter)
claude-recall janitor [--dry-run|--status]  # Run the daily memory janitor now

# ── Task Checkpoints ────────────────────────────────────────────────
claude-recall checkpoint save --completed <text> --remaining <text> [--blockers <text>] [--notes <text>]
claude-recall checkpoint load [--json]
claude-recall checkpoint clear

# ── Skills ───────────────────────────────────────────────────────────
claude-recall skills clean               # Delete skill files older releases generated from memories (--force)

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
claude-recall hook run correction-detector   # UserPromptSubmit hook (also handles `recall …` review commands)
claude-recall hook run memory-stop           # Stop hook
claude-recall hook run precompact-preserve   # PreCompact hook
claude-recall hook run memory-sync           # Stop + PreCompact hook (syncs rules to auto-memory)
```

</details>

---

## Under the hood

Everything lives in one local SQLite database (`~/.claude-recall/claude-recall.db`, in WAL mode, with content-hash deduplication and automatic compaction). The agent reaches it through six memory tools: `load_rules`, `store_memory`, `search_memory`, `delete_memory`, `save_checkpoint` and `load_checkpoint`. Each agent connects in its own way:

- **Claude Code**: an MCP server (`mcp__claude-recall__*` tools) plus hooks that do the automatic capture
- **Pi**: a native extension (`recall_*` tools) plus event handlers
- **Kiro CLI**: a custom agent that bundles the MCP server and Kiro hooks ([details](docs/kiro.md))

**Every memory remembers where it came from.** Its origin (your words, the agent, tool output, an import) decides whether it's used straight away or [waits for your review](#reviewing-what-it-learned), and every change to it is logged (`claude-recall rules history`). A memory captured by a Claude Code hook also records the session, transcript file and entry it came from, and keeps a copy of your words (up to 2,000 characters). `search_memory` shows this source under the memory, so the agent can read exactly what you said when the one-line summary isn't enough. Claude Code deletes old transcripts after a while (`cleanupPeriodDays`, 30 days by default); after that, `search_memory` quotes the saved text instead. Memories stored through `store_memory`, the CLI, Pi or Kiro, and those captured before 0.46.0, have no source.

**Skills.** Claude Recall teaches agents *when* to use memory through skill files: Anthropic's [Agent Skills](https://agentskills.io/) standard for Claude Code (`.claude/skills/memory-management/`), and a bundled skill file for Pi. Earlier releases also generated skills from your memories (`.claude/skills/auto-*/`). That's gone: a skill is a standing instruction, and building one from stored memories let a misled agent plant one. Files it left behind are still loaded by Claude Code; remove them with `claude-recall skills clean --force` in each project.

### Success capture

Most automatic learning comes from what breaks. But a hard-won *success* is just as worth keeping: the command, flag or sequence you finally found after several dead ends. Claude Recall keeps those as a `solution` memory, two ways:

- **Automatically**, when a session shows a goal that failed **repeatedly** (at least two distinct failed attempts) and then finally worked. It keeps the reusable technique, generalised away from the one-off task. Requiring repeated failure is deliberate: a first-try success or an unresolved struggle captures nothing, so routine wins don't become noise.
- **Deliberately**, when you (or the agent) call `store_memory` with `type: "solution"`, the intended place for "I cracked this, don't make me work it out again."

A solution doesn't wait for a second occurrence (you rarely crack the same hard thing twice). Like any memory you didn't state yourself, it waits for your [review](#reviewing-what-it-learned) first; once approved, it's given to the agent everywhere your other rules are, ranked just below your corrections. List them with `claude-recall list --type solution`. Unlike other rules, solutions are never retired for being rarely used, so a valuable but rarely-needed win isn't lost.

---

## Upgrading

One command upgrades Claude Recall for **all** your agents:

```bash
claude-recall upgrade
```

It checks for the latest version, updates the global install, and stops any running MCP servers so they restart on the new version. It also checks your Claude Code hooks, and tells you if any need `claude-recall repair --auto` (for example after switching Node versions).

**Upgrading to the first release with review (0.51.0): review your memories once.** Memories stored before it have no recorded origin, so they wait for your review and don't load until you approve them. Type `recall review` in a Claude Code or Pi chat (or run `claude-recall rules review`), or approve whole groups at once (`claude-recall rules approve --all --type devops`). Rules you state from now on load straight away.

Per agent:

- **Claude Code**: nothing else needed. If the release notes mention new or changed hooks, also re-run `claude-recall setup --install` in each active project (safe any time; does nothing when current).
- **Pi**: run `pi update npm:claude-recall` and restart Pi.
- **Kiro CLI**: the upgrade covers hook behaviour; when release notes change the agent *template*, re-run `kiro setup` once and start one fresh conversation (see [docs/kiro.md](docs/kiro.md#upgrading)).

<details>
<summary><b>Install & upgrade troubleshooting</b> (EACCES, unknown command, pre-0.27 registrations, nvm + desktop app)</summary>

**`EACCES: permission denied`**: your global npm folder is owned by root (common when Node came from `apt`). Quick fix: `sudo npm install -g claude-recall@latest`. Permanent fix: move it to a folder you own, so global installs never need sudo again:

```bash
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
npm install -g claude-recall@latest
claude-recall --version
```

**`error: unknown command '<anything>'`**: your installed version is older than the docs you're reading (`kiro` needs 0.28.0 or later, `compact` 0.26.0, `upgrade` 0.23.2). Run `claude-recall upgrade`; if `upgrade` itself is unknown, start over with `npm install -g claude-recall@latest`.

**Claude Code registered before v0.27.x?** Older versions registered the MCP server with an `npx`-based command, which a stale project-local install can shadow. Switch to the direct form (in each affected project):

```bash
claude mcp remove claude-recall
claude mcp add claude-recall -- claude-recall mcp start
```

**WSL: "invalid ELF header"**: Windows and WSL `node_modules` got mixed. Use the global install (the default) and check the program resolves to a Linux path: `which claude-recall` should show `/home/<user>/...`, not a Windows path. A global install doesn't affect per-project memory.

**nvm: "Executable not found" in the Claude desktop app or an IDE, but fine in a terminal**: nvm only puts Node on your `PATH` in interactive shells (`~/.bashrc`). Apps that start Claude Code without one (the Claude desktop app, some IDEs) then can't find `claude-recall` or `node`: the MCP server fails with `ENOENT: Executable not found in $PATH: "claude-recall"` and every hook fails with `claude-recall: not found`. `claude-recall doctor` reports this under *Launch outside a terminal*. The fix is to register Claude Recall by absolute path, through a small wrapper that puts nvm's Node on `PATH`:

```bash
mkdir -p ~/.local/bin
cat > ~/.local/bin/claude-recall-wrap <<'EOF'
#!/bin/sh
# newest nvm Node that has claude-recall; no nvm.sh, so hooks stay fast
for d in $(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V -r); do
  if [ -x "$d/claude-recall" ]; then PATH="$d:$PATH"; export PATH; exec "$d/claude-recall" "$@"; fi
done
echo "claude-recall-wrap: claude-recall not found under ~/.nvm" >&2; exit 127
EOF
chmod +x ~/.local/bin/claude-recall-wrap

# check it works without your shell's PATH (as the desktop app sees it)
env -i HOME=$HOME PATH=/usr/bin:/bin ~/.local/bin/claude-recall-wrap --version
```

Then use the wrapper's absolute path (`/home/<user>/.local/bin/claude-recall-wrap`) instead of `claude-recall` in three places: the MCP server command (`claude mcp remove claude-recall`, then `claude mcp add --scope user claude-recall -- /home/<user>/.local/bin/claude-recall-wrap mcp start`), every hook command in `~/.claude/settings.json` (`… hook run …`), and the `statusLine` command. Restart Claude Code and re-run `claude-recall doctor`. From 0.45.0, `setup --install` and `doctor --fix` keep the wrapper rather than rewriting it back to `claude-recall`. The wrapper picks the **newest** nvm Node that has Claude Recall installed, so it keeps working after `nvm install` as long as Claude Recall comes along (see `~/.nvm/default-packages` above).

</details>

---

## Project scoping

Each project has its own memory. The **project ID** comes from the working directory the agent reports, and universal memories (not tied to a project) are available everywhere. Switch projects and the memory switches with you, with nothing to configure.

To treat several directories as one project (worktrees, sub-repos), set `CLAUDE_RECALL_PROJECT_ID`. Details: [docs/project-scoping.md](docs/project-scoping.md).

---

## Configuration

The defaults work out of the box. If you want to tune something, these environment variables are the knobs:

| Variable                                 | Default | Effect                                                                                                   |
| ---------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------- |
| `CLAUDE_RECALL_DB_PATH`                  | `~/.claude-recall/` | Database directory.                                                                          |
| `ANTHROPIC_API_KEY`                      | _(unset)_ | Optional personal API key for Haiku-based AI features. **Never required, never provided by Claude Code, and never touched unless you opt in** with `CLAUDE_RECALL_PREFER_API_KEY=1`; capture, checkpoint extraction, session learnings and the janitor all run on each agent's own AI (Claude subscription via `claude -p`; Kiro credits via `kiro-cli`), with pattern matching as the fallback. |
| `CLAUDE_RECALL_CC_MODEL`                 | `haiku` | Model used for capture under Claude Code (passed to `claude -p --model`), separate from your session's model. |
| `CLAUDE_RECALL_CC_LLM_TIMEOUT_MS`        | `30000` | Time limit for the headless `claude -p` classify call before the capture worker gives up. |
| `CLAUDE_RECALL_KIRO_MODEL`               | `claude-haiku-4.5` | Model used for capture under Kiro, **separate from your Kiro chat model**. Raise to `claude-sonnet-4.6` for steadier judgement at more credits. See [docs/kiro-llm-capture.md](docs/kiro-llm-capture.md). |
| `CLAUDE_RECALL_PI_LLM`                   | _(unset)_ | Set to `1` to let a Pi host use Pi's own headless mode (`pi -p`) for session learnings, checkpoint extraction and batch classification. **Off by default**: these are extra model calls on your Pi provider (paid, if you run Pi on an API key), and they send session text to it. The nested call can only answer: it runs with no tools, no MCP, no session file and none of your skills, prompt templates or context files. **Needs Pi 1.0.4 or later** (the first release with `--no-mcp`); an older Pi rejects the flag, so every call fails: nothing is learned, nothing breaks, and the log says why (`pi exited 1: Error: Unknown option: --no-mcp`). Has no effect outside a Pi session. |
| `CLAUDE_RECALL_PI_MODEL`                 | _(Pi's default)_ | Model for Pi's headless mode (`pi -p`), when `CLAUDE_RECALL_PI_LLM` is on. The nested call runs with `--no-extensions`, so this must name a model from Pi's own configuration; models added by an extension aren't visible to it. |
| `CLAUDE_RECALL_PI_EXTENSIONS`            | _(unset)_ | Set to `1` when Pi's models come from an extension (the headless child runs with `--no-extensions` by default and wouldn't see them). Recursion is then stopped by `CLAUDE_RECALL_NESTED`, which the extension honours by doing nothing. |
| `CLAUDE_RECALL_PREFER_API_KEY`           | _(unset)_ | **The only switch that turns on the `ANTHROPIC_API_KEY` backend** (and prefers it). For Pi-only machines without the `claude` program, or a stronger model you deliberately pay for. Applies to all AI features, under Claude Code, Kiro and Pi. |
| `CLAUDE_RECALL_KIRO_LLM_TIMEOUT_MS`      | `30000` | Time limit for the headless `kiro-cli` classify call before the capture worker falls back to pattern matching. |
| `CLAUDE_RECALL_REFRESH_INTERVAL`         | `15`    | **Kiro only.** Re-send your rules every N prompts, so long sessions can't lose them when context rolls over (Kiro has no after-compression event). `0` disables. |
| `CLAUDE_RECALL_LOAD_BUDGET_TOKENS`       | `2000`  | Size budget for the `load_rules` payload. Rules are included in priority order (corrections → preferences by use → devops by use → failures); anything left out can still be found with `search_memory`. |
| `CLAUDE_RECALL_QUARANTINE`               | `on`    | Memories you didn't state load only after you approve them ([Reviewing what it learned](#reviewing-what-it-learned)). `off` loads everything as before. |
| `CLAUDE_RECALL_PENDING_FAILURE_DAYS`     | `14`    | Unreviewed failures leave the review queue after this many days without recurring. `-1` keeps them. |
| `CLAUDE_RECALL_JANITOR`                  | `on`    | Set to `off` to stop the daily [memory janitor](#memory-janitor). |
| `CLAUDE_RECALL_JANITOR_INTERVAL_HOURS`   | `24`    | Minimum hours between automatic janitor runs.                                                            |
| `CLAUDE_RECALL_JANITOR_GRACE_HOURS`      | `24`    | Memories younger than this are left alone by the janitor: a fresh lesson can't be judged noise the day it was taught. |
| `CLAUDE_RECALL_AUTO_DEMOTE`              | `false` | When `true`, retire rules on MCP start that were loaded at least `CLAUDE_RECALL_DEMOTE_MIN_LOADS` times, never cited, and are older than `CLAUDE_RECALL_DEMOTE_MIN_AGE_DAYS`. Reversible with `rules promote <id>`. |
| `CLAUDE_RECALL_DEMOTE_MIN_LOADS`         | `20`    | Minimum loads before a rule can be retired automatically.                                                |
| `CLAUDE_RECALL_DEMOTE_MIN_AGE_DAYS`      | `7`     | Minimum age before a rule can be retired automatically (so new rules aren't).                            |
| `CLAUDE_RECALL_AUTO_CLEANUP`             | `false` | Stop stale MCP processes on start (otherwise reports and exits).                                         |
| `CLAUDE_RECALL_COMPACT_THRESHOLD`        | `10MB`  | Database size at which automatic compaction starts.                                                      |
| `CLAUDE_RECALL_MAX_MEMORIES`             | `10000` | Soft limit on the number of memories.                                                                    |
| `CLAUDE_RECALL_RETAIN_FAILURES`          | `1000`  | Failures kept at compaction, strongest first. `-1` keeps all. Confirmed rules are never removed, and inactive ones go first. Failures are the most frequent automatic write, so without a limit the store grows until every turn pays to load it. |
| `CLAUDE_RECALL_RETAIN_HISTORY_DAYS`      | `365`   | How long the change history (`rules history`) is kept. `-1` keeps all. |
| `CLAUDE_RECALL_RETAIN_TELEMETRY_DAYS`    | `30`    | Age limit for outcome history (only written with `CLAUDE_RECALL_OUTCOME_TRACKING=on`). `-1` keeps all. |
| `CLAUDE_RECALL_OUTCOME_TRACKING`         | `auto`  | Outcome history (`outcome_events`, `rule_injection_events`, episodes) for the `outcomes` command. `on` records it; `auto` and `off` record nothing. A debugging aid: failures are stored regardless. |
| `CLAUDE_RECALL_ENFORCE_MODE`             | `warn`  | `block` / `warn` / `off` for the search-enforcer hook. The variable wins, else `~/.claude-recall/config.json` `"enforceMode"`, else `warn`. |
| `CLAUDE_RECALL_LLM_TIMEOUT_MS`           | `5000`  | Time limit for in-hook AI calls (classification). Hooks fall back to pattern matching when it's reached. |
| `CLAUDE_RECALL_STOP_DEBOUNCE_MS`         | `300000` | Minimum gap between runs of the heavier end-of-turn work (session learnings, failure scan). `0` disables. |
| `CLAUDE_RECALL_PROJECT_ID`               | *(cwd)*  | Pin the project to a fixed ID instead of working it out from the directory. |
| `CLAUDE_RECALL_RETRIEVAL`                | `like`  | Search engine: `fts` uses SQLite FTS5 / BM25 ranking, better at matching rephrasings; `like` (default) uses plain substring matching. Opt-in; falls back to `like` automatically if your SQLite lacks FTS5. See [docs/design-hybrid-retrieval-fts5.md](docs/design-hybrid-retrieval-fts5.md). |

---

## Security & privacy

- **Your memory stays on your machine.** The database never leaves it, and `~/.claude-recall` is readable only by your user account (`0700`).
- **Your messages are read by your agent's AI.** To decide what's worth remembering, each message is sent to the agent's own AI: headless `claude -p` on your Claude login under Claude Code, Kiro's AI under Kiro, or the Anthropic API only if you opt in with `CLAUDE_RECALL_PREFER_API_KEY=1`. That's the provider your session already talks to, but avoid pasting secrets into prompts.
- **Captured memories keep a copy of your words.** Since 0.46.0, a hook capture stores the message it came from (up to 2,000 characters, including anything pasted into it) and the path of the Claude Code transcript. That text stays in the local database and in `export` files; the daily janitor sends it, shortened to 400 characters per rule, to the same AI as capture.
- **Secrets are removed before storing.** Tokens, keys and `password=…`-style values are replaced with `[REDACTED]` on every way a memory can be written.
- **Memories you didn't state wait for your review** before they can steer the agent, and only you can approve them ([details](#reviewing-what-it-learned)). Claude Code deny rules (added by `setup` and `doctor --fix`) also stop the agent approving through its shell.
- **Every memory records where it came from**, and every change is logged (`claude-recall rules history`). Text that looks like an attack (`curl … | sh`, "ignore previous instructions", encoded payloads) is refused unless it's your own words. Design: [docs/design-memory-poisoning-defense.md](docs/design-memory-poisoning-defense.md).
- **You can always look.** `stats`, `search`, `list` and `export` show everything that's stored.

More detail in [docs/security.md](docs/security.md).

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

**[MIT](LICENSE)** · SPDX `MIT` · Copyright © 2025-2026 Raoul Biagioni

Free to use, modify and distribute, including commercially and in closed-source work, provided the copyright notice and permission notice are retained. The software is provided "as is", without warranty of any kind. Full text: [LICENSE](LICENSE).

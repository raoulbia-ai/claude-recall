# Claude Recall + Kiro CLI — the full guide

Everything about running Claude Recall under [Kiro CLI](https://kiro.dev/cli/): setup options, the one-time conversation rollover, how capture works without an API key, project scoping, and troubleshooting.

Requires claude-recall **≥ 0.28.0** (`claude-recall --version` to check; `claude-recall upgrade` to update). Kiro uses the same global binary and the same database as Claude Code and Pi — a memory captured in one agent is available in the others.

---

## Setup Option A — full integration (recommended)

Memory **plus** hooks (auto-capture, rule injection) via a Kiro custom agent.

In your shell, in the project directory, **before** starting Kiro:

```bash
claude-recall kiro setup
```

This writes a Kiro custom agent at `.kiro/agents/recall.json` (use `--global` for `~/.kiro/agents` so it's available in every project). It does **not** touch your `mcp.json` — the agent config carries its own `mcpServers` entry for claude-recall, so no separate MCP registration is needed. It also sets `includeMcpJson: true`, so any other servers you have in `mcp.json` keep working alongside it.

Then start Kiro from your shell:

```bash
kiro
```

and inside the Kiro chat, switch to the agent:

```
/agent swap recall
```

You get: active rules injected into context automatically at agent start (no tool call needed), just-in-time rule injection before each tool call, automatic capture of corrections/preferences from your prompts, tool-outcome tracking with Bash fix-pairing, and the full MCP tool surface (read-only tools pre-approved).

### Merging into an agent you already use

Don't want to swap agents? Merge Claude Recall into your own:

```bash
claude-recall kiro setup --merge-into <agent-name>
```

This finds the agent config (workspace `.kiro/agents/` first, then `~/.kiro/agents/`; `--global` to target the global one directly), writes a timestamped backup, and appends the claude-recall pieces — MCP server, pre-approved read-only tools, and the four hooks — while leaving your own config untouched. It only rewrites claude-recall's own entries: superseded ones from an older version are swapped for the current wiring (any unrelated hook you have on the same event is preserved). Idempotent: on an already-current agent, re-running changes nothing. If the agent restricts tools with an explicit list, `@claude-recall` is added to it.

---

## The one-time conversation rollover

> **⚠️ After `kiro setup` or `--merge-into`: start ONE fresh conversation per project (no `--resume`).**

Kiro snapshots the agent config into each conversation **at creation** — `--resume` restores that snapshot and ignores agent-config changes made since. So conversations created *before* you wired claude-recall will **never** run its hooks, no matter how often you resume them or restart Kiro. Start one fresh conversation after wiring; every conversation created from then on carries the hooks, **including when resumed** (`--resume` works normally afterwards — this is a one-time rollover per project).

The rollover, concretely (add your usual flags, e.g. `--classic`, `--trust-all-tools`):

```bash
cd ~/path/to/your-project
kiro-cli chat --agent <your-agent>
```

In that session state something memorable (e.g. `recall the deploy pipeline uses helm`), exit, then verify it was captured:

```bash
claude-recall search "helm"
tail -5 ~/.claude-recall/hook-logs/hook-dispatcher.log
```

The log should show a `scope [...] → project=your-project` line; `claude-recall kiro doctor` gives a fuller health report.

---

## How capture works under Kiro — no API key needed

To decide what's worth remembering, the capture hook classifies each prompt via a headless `kiro-cli chat --no-interactive --model …` call (through a bundled bare `claude-recall-classifier` agent). So natural statements like "my favourite color is green" are captured without any `ANTHROPIC_API_KEY` and without the `store_memory` MCP tool — which matters under enterprise governance that blocks the MCP server. It runs in a detached background worker, so your turn is never blocked; it spends ~0.06 Kiro credits per prompt.

**The classifier uses a dedicated, fixed model — not your chat model.** It always runs the model in `CLAUDE_RECALL_KIRO_MODEL` (default `claude-haiku-4.5`, chosen because classification is cheap and high-volume), **independent of your interactive Kiro chat model** (e.g. `auto`). This keeps classification cost predictable no matter what your chat is set to. Set `CLAUDE_RECALL_KIRO_MODEL` to any model from `kiro-cli chat --list-models` to change it. Every successful classification is logged to `~/.claude-recall/hook-logs/kiro-classifier.log` as `classified via kiro-cli (model=…, Kiro credits, no API key)`, so you can always see which model ran.

**Under Kiro the included LLM is used first even if you happen to have `ANTHROPIC_API_KEY` set** — so a key exported for other tools won't quietly spend your Anthropic credits. Order: Kiro's LLM → `ANTHROPIC_API_KEY` (if present) → regex; set `CLAUDE_RECALL_PREFER_API_KEY=1` to force your key first (e.g. for a stronger model you pay for).

Design details, latency measurements, and output-parsing internals: [kiro-llm-capture.md](kiro-llm-capture.md).

---

## Setup Option B — MCP tools only (no hooks)

Works in Kiro's default agent; nothing happens automatically. Register just the MCP server in Kiro's config — create or merge into `.kiro/settings/mcp.json` (project) or `~/.kiro/settings/mcp.json` (all projects):

```json
{
  "mcpServers": {
    "claude-recall": {
      "command": "claude-recall",
      "args": ["mcp", "start"],
      "autoApprove": ["load_rules", "search_memory", "load_checkpoint"]
    }
  }
}
```

With Option B the agent has the memory tools (`load_rules`, `store_memory`, `search_memory`, checkpoints) but no rules at session start and no auto-capture. Ask it to *"load my rules"*.

---

## Project scoping and `--resume`

Memories scope to the **working directory Kiro reports for the session** — normally the directory you launched Kiro from. `kiro --resume` resumes the most recent conversation *from the current directory* (it's per-project), so scoping and `--resume` naturally agree. Just remember the snapshot rule above: only conversations **created after** wiring run the hooks.

To force a fixed project id regardless of directory, pin it with `CLAUDE_RECALL_PROJECT_ID`. A per-project shell alias makes it seamless:

```bash
alias kiro-myproj='CLAUDE_RECALL_PROJECT_ID=my-project kiro-cli chat --agent <your-agent> --resume'
```

`claude-recall kiro doctor` always prints the resolved project (and whether it's pinned) so you can confirm where memories are landing before trusting it.

---

## Enterprise governance

Under enterprise governance that restricts MCP to a trusted registry, Kiro drops the claude-recall MCP server — so the agent may say it "has no memory tools." Ignore that: **the hooks capture and inject against the local DB regardless.** The agent is told this at session start and will confirm it's remembering; only the on-demand tools (the agent calling `search_memory` itself) need an admin to allowlist claude-recall.

---

## What's not available under Kiro

Kiro's hooks expose no transcript, so two features are off with either setup option:

- transcript-based failure detection
- session-end auto-checkpoints (existing checkpoints are still surfaced at agent start)

---

## Upgrading

`claude-recall upgrade` refreshes the shared global binary, which is all hook *behaviour* needs — the agent config points at the `claude-recall` command, not a pinned path.

But when release notes change the agent *template* (new hooks, the classifier agent, revised wiring — e.g. the **0.29.x** Kiro-LLM capture), re-run setup once so the agent picks it up:

- `claude-recall kiro setup --force` for the standalone `recall` agent, or
- `claude-recall kiro setup --merge-into <agent>` for an agent you merged into.

That also writes the `claude-recall-classifier` agent and strips any superseded hooks. Then start one fresh conversation per project (the snapshot rollover above). `claude-recall kiro doctor` confirms the result.

---

## Troubleshooting

```bash
claude-recall kiro doctor                              # full health report: agent config, hooks, classifier, project scope
claude-recall search "something you just said"         # did capture land?
tail -5 ~/.claude-recall/hook-logs/hook-dispatcher.log # which hooks fired, which project
tail -5 ~/.claude-recall/hook-logs/kiro-classifier.log # which LLM classified (model, credits)
```

Common cases:

- **Hooks never fire** → you're in a conversation created before wiring; do the [rollover](#the-one-time-conversation-rollover).
- **Nothing captured from a natural statement** → check `kiro-classifier.log`; if it shows `kiro-cli error: ENOENT`, `kiro-cli` isn't on the hook's `PATH` and capture fell back to regex.
- **Agent says it has no memory tools** → see [Enterprise governance](#enterprise-governance); capture still works.
- **Memories landing in the wrong project** → `claude-recall kiro doctor` shows the resolved project id; pin with `CLAUDE_RECALL_PROJECT_ID` if needed.

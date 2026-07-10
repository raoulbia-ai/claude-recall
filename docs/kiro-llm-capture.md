# Using Kiro's LLM for memory capture (no API key)

## The problem

Claude Recall captures memories with an LLM classifier: it reads each user
prompt and decides whether it contains a durable preference, correction, or
project fact worth storing. At the time of this finding, that classifier called
Claude Haiku through `ANTHROPIC_API_KEY` — a personal API key the user had
exported themselves. (Claude Code does **not** mint a key from the user's
subscription; hooks merely inherit the environment. The headless-CLI approach
documented here was later applied back to Claude Code via `claude -p` on
subscription auth — see [cc-llm-capture.md](cc-llm-capture.md).)

Kiro CLI does **not** set `ANTHROPIC_API_KEY`. So under Kiro the classifier fell
back to a conservative regex that only fires on explicit phrasings
("remember …", "always …", "I prefer …"). A natural statement like
"my favourite color is green" was examined and rejected
(`no rule detected in prompt` in `correction-detector.log`), and nothing was
stored. Worse, under enterprise MCP governance the `store_memory` tool is
dropped from the agent's toolset, so the agent itself can't store on demand
either — leaving regex as the *only* capture path.

Two non-answers:

- **"Just export `ANTHROPIC_API_KEY`."** Works, but forces the user to bring
  their own Claude subscription/credits when Kiro already includes an LLM.
- **"Broaden the regex."** Trades one brittle heuristic for a slightly larger
  brittle heuristic; still misses anything not phrased as a known trigger.

## The finding

**`kiro-cli chat --no-interactive "<prompt>"` is a headless one-shot completion
that runs on Kiro's own model and Kiro's own authentication.** It is exactly the
subprocess-callable LLM I had wrongly assumed didn't exist. A background hook can
shell out to it to classify text, with no API key and no personal subscription.

Verified on Kiro CLI 2.7.0 (Kiro PRO):

| Property | Result |
| --- | --- |
| Auth | Uses the Kiro login. No `ANTHROPIC_API_KEY`. Consumes Kiro credits (~0.06 per call on Haiku). |
| Model | `--list-models` exposes `claude-haiku-4.5` (rate 0.4 — cheapest Claude), plus Sonnet/Opus tiers. |
| Classify **and** extract in one call | `{"store": true, "type": "preference", "value": "favourite color is green"}` |
| Latency (bare agent, warm) | ~2.9–3.4 s |
| Latency (default agent, cold) | ~16 s — dominated by loading the session's MCP servers and firing that agent's own hooks |
| Reachable from a minimal `PATH` | Yes — `~/.local/bin/kiro-cli` resolves |

### Why a dedicated "bare" agent matters

Running the classify call through the *default* agent is slow and unsafe:

- It loads all of the session's MCP servers (the enterprise setup loads five),
  adding ~5 s.
- It fires that agent's own `agentSpawn`/hook chain — including Claude Recall's
  own hooks if they're wired — which risks **recursion** (a capture call that
  triggers another capture call).

So `kiro setup` writes a minimal `claude-recall-classifier` agent to
`~/.kiro/agents/` with **no MCP servers, no hooks, and no tools**. The classify
call runs `--agent claude-recall-classifier`, which cold-boots in ~3 s and
cannot recurse.

### Why capture must run asynchronously

Kiro enforces a per-hook timeout (we wire `userPromptSubmit` at 8 s). A cold
classify call can exceed that, which would kill the hook on the first — and most
important — prompt of a session. Even when it fits, blocking every turn on a
~3 s LLM call is a poor experience for an interactive session.

So the `userPromptSubmit` hook does **not** classify inline. It spawns a
**detached worker** (the same pattern as `session-end-checkpoint`), pipes the
prompt to it over stdin, and returns in milliseconds. The worker performs the
~3 s Kiro classify call and stores the memory in the background. The trade-off:
no synchronous "captured" echo, and a brief window where a memory stated in one
turn isn't queryable until the worker finishes (~3 s later) — acceptable for
capture.

## The design

```
Kiro userPromptSubmit
        │
        ▼
  hook run kiro-capture          (returns in <100 ms)
        │  spawn detached, pipe payload via stdin
        ▼
  hook run kiro-capture-worker   (background, survives parent exit)
        │  sets CLAUDE_RECALL_KIRO_CLASSIFIER=1
        ▼
  handleCorrectionDetector → classifyContent()
        │
        ├─ classifyWithLLM()   → ANTHROPIC_API_KEY (unset under Kiro) → null
        ├─ classifyWithKiro()  → kiro-cli chat --no-interactive --agent
        │                         claude-recall-classifier --model claude-haiku-4.5
        │                         → {"type","confidence","extract"}
        └─ regex fallback       (only if both above yield nothing)
```

Capture precedence under Kiro: **Kiro's included LLM → `ANTHROPIC_API_KEY` if
present → regex as a last resort.** The Kiro LLM comes first *even when a key is
set*, so a key exported for other tools never silently spends the user's
Anthropic credits — Kiro already ships an LLM. `CLAUDE_RECALL_PREFER_API_KEY=1`
flips the order back to key-first for anyone who deliberately wants to pay for a
stronger model. (Under Claude Code the same pattern applies with `claude -p` on
the user's subscription as the included LLM — see
[cc-llm-capture.md](cc-llm-capture.md).)

### Output parsing

`kiro-cli` decorates stdout with a `> ` prompt marker, occasional ```` ```json ````
fences, and ANSI control sequences (the spinner and credits footer go to
stderr). `classifyWithKiro` strips ANSI, removes the marker and fences, extracts
the first balanced `{ … }` block, and `JSON.parse`s it. Any failure at any step
returns `null`, degrading to regex — a hook must never throw.

### Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `CLAUDE_RECALL_KIRO_CLASSIFIER` | *(set by the worker)* | Enables the Kiro-LLM path in `classifyContent`. Set automatically by `kiro-capture-worker`; never needed by hand. |
| `CLAUDE_RECALL_KIRO_MODEL` | `claude-haiku-4.5` | Model for the classify call, passed explicitly as `--model`. This is a **dedicated classifier model, independent of the user's interactive Kiro chat model** (e.g. `auto`) — the headless call always uses this value. Raise to `claude-sonnet-4.6` for steadier judgement at ~3× the credits. |
| `CLAUDE_RECALL_KIRO_LLM_TIMEOUT_MS` | `30000` | Hard cap on the headless call before the worker gives up and falls back to regex. |
| `CLAUDE_RECALL_PREFER_API_KEY` | *(unset)* | Force `ANTHROPIC_API_KEY`-based classification ahead of Kiro's included LLM (opt-in; uses your Anthropic credits). |

## Caveats

- **Consistency.** Haiku returned YES then NO on near-identical prompt wording
  during testing. The classify prompt is written to be explicit, and
  `CLAUDE_RECALL_KIRO_MODEL` lets you trade credits for a steadier model.
- **Cost.** Each classified prompt spends ~0.06 Kiro credits on Haiku. That is
  the deliberate trade for using Kiro's LLM instead of a personal subscription.
- **Concurrency.** The worker opens a second, throwaway headless conversation
  while the interactive session runs. They use different agents and no
  `--resume`, so they're independent; SQLite WAL handles concurrent writes.
- **Requires `kiro-cli` on `PATH`.** If it's absent the classify call errors and
  the worker falls back to regex — no crash.
```

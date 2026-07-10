# Using your Claude subscription for memory capture (no API key)

The Claude Code counterpart to [kiro-llm-capture.md](kiro-llm-capture.md): how
claude-recall's LLM features run on the user's **Claude subscription** — the
same login that powers their interactive session — instead of a personal
`ANTHROPIC_API_KEY`.

## The problem

Claude Recall's LLM classifier originally called Claude Haiku through the
Anthropic SDK, which needs `ANTHROPIC_API_KEY` — a **personal pay-as-you-go
key**. For a long time the docs claimed Claude Code "provides the key to its
hooks." That was false: Claude Code does not mint a key from the user's
subscription; hooks merely inherit the user's environment. So the key path
only ever worked for users who had exported their own key, and it silently
spent **their API credits** — a separate wallet from the Claude subscription
they were already paying for.

The failure mode that exposed all of this: a user's exported key ran out of
credits. Every SDK call failed silently, capture degraded to the regex
fallback, and the regex promptly stored four junk memories in one session —
while the user reasonably believed "the LLM" was doing the classifying.

## The finding

**`claude -p "<prompt>"` is a headless one-shot completion that runs on the
user's Claude Code login** — the direct analogue of the earlier
`kiro-cli chat --no-interactive` discovery. A background worker can shell out
to it to classify text with no API key and no extra cost beyond the
subscription usage the user already has.

One gotcha made this non-trivial, and it's the most important line in the
implementation:

> **`claude -p` prefers `ANTHROPIC_API_KEY` over subscription auth when the
> key is present in the environment.**

So a stray exported key — possibly dead, possibly billing a wallet the user
forgot about — would silently hijack every headless call. The fix:
`completeWithClaudeCli()` **strips `ANTHROPIC_API_KEY` from the child env**,
forcing subscription auth unconditionally. (Verified live: with a
credits-exhausted key in the env, `claude -p` returned
`Credit balance is too low`; with the key stripped, the same call succeeded on
the login.)

## The design

```
Claude Code UserPromptSubmit
        │
        ▼
  hook run correction-detector      (name unchanged in settings.json;
        │                            returns in <100 ms)
        │  spawn detached, pipe payload via stdin
        ▼
  hook run cc-capture-worker        (background, survives parent exit)
        │  sets CLAUDE_RECALL_CC_CLASSIFIER=1
        ▼
  handleCorrectionDetector → classifyContent()
        │
        ├─ classifyWithClaudeCli()  → claude -p --model haiku "<prompt>"
        │                             (subscription auth, key stripped)
        └─ regex fallback

  (classifyWithLLM() / ANTHROPIC_API_KEY exists but is OPT-IN only —
   see below; it is never in the default chain)
```

Precedence mirrors Kiro: **the runtime's included LLM → regex.** An exported
`ANTHROPIC_API_KEY` is **never consulted by default — not even as a
fallback**; `CLAUDE_RECALL_PREFER_API_KEY=1` is the one switch that enables
(and prefers) it. The registered hook name (`hook run correction-detector`)
was deliberately kept, so existing `settings.json` files work with no
re-setup — only the dispatch behind it changed.

**Trade-off:** the synchronous `📌 Recall: auto-captured …` echo is gone.
A cold `claude -p` takes ~4 s, far too slow to block the user's prompt, so
capture is silent and lands a few seconds later — the same contract Kiro has
always had. Verify via `~/.claude-recall/hook-logs/cc-classifier.log`
(`classified via claude -p (model=…, Claude subscription, no API key)`) or
`claude-recall search`.

### Recursion guard

The nested headless session is itself a Claude Code session. If the user has
claude-recall hooks registered at **user scope** (`~/.claude/settings.json`),
the classify call would fire those hooks, which would spawn another worker,
which would run another `claude -p` — forever. Two layers prevent this:

1. `claude -p` children run with `cwd = os.tmpdir()`, so **project**
   settings/hooks never load.
2. Children are marked with `CLAUDE_RECALL_NESTED=1` (plus the legacy
   `CLAUDE_RECALL_CC_CLASSIFIER=1`). The capture hook refuses to spawn a
   worker, and the secondary-feature backend refuses to invoke the CLI, when
   either marker is present.

### Beyond capture: the secondary features (0.32.0)

`completeWithClaudeCli()` is a generic completion primitive, and the four
features that previously knew only the key path now route through it with the
same precedence:

| Feature | Runs in | Without any key, now |
| --- | --- | --- |
| Auto-checkpoint extraction | Session-exit worker (CC + **Pi** — Pi's only recovery path, it has no `--resume`) | Works via `claude -p` |
| Failure hindsight hints | Stop hook, inline | Works via `claude -p` |
| End-of-session lesson extraction | Stop hook, inline | Works via `claude -p` |
| Batch classification | Stop hook, inline | Works via `claude -p` |

Two budget rules keep the inline ones inside the Stop hook's ~40 s window
(capture doesn't need them — it runs in a detached worker):

- each secondary CLI call is capped at **10 s** (vs the worker's 30 s), and
- hindsight-hint generation is capped at **5 LLM calls per run** (the loop
  over detected failures is otherwise unbounded; failures past the cap keep
  the grounded generic lesson text).

Under **Pi** these functions run in-process, so Pi benefits automatically on
any machine with the `claude` binary installed alongside. Under **Kiro** the
Stop-hook features mostly don't run (no transcript in its hooks), and capture
uses the Kiro backend.

### Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `CLAUDE_RECALL_CC_MODEL` | `haiku` | Model passed to `claude -p --model` — a dedicated classifier model, independent of the user's interactive session model. |
| `CLAUDE_RECALL_CC_LLM_TIMEOUT_MS` | `30000` | Hard cap on the capture worker's `claude -p` call. (Secondary features use a fixed 10 s per call.) |
| `CLAUDE_RECALL_PREFER_API_KEY` | *(unset)* | **The only switch that enables the `ANTHROPIC_API_KEY` backend** (and prefers it first) — without it an exported key is never touched, not even as a fallback. For Pi-only machines without the `claude` binary, or a stronger model you deliberately pay for. Applies to capture and the secondary features, on every runtime. |
| `CLAUDE_RECALL_NESTED` | *(set on `claude -p` children)* | Recursion marker — never set it by hand. |

## Caveats

- **Requires the `claude` binary on `PATH`.** Absent (e.g. a bare CI box, or a
  Pi-only machine), the CLI backend errors out and the chain falls through to
  regex — or to an `ANTHROPIC_API_KEY` if you opted in with
  `CLAUDE_RECALL_PREFER_API_KEY=1`. No crash, no exception.
- **Subscription usage.** Each classified prompt is one small Haiku call
  against the user's Claude plan limits. That is the deliberate trade — the
  user's existing plan instead of a second wallet.
- **Latency.** ~4 s cold per call. Fine in a detached worker; the reason the
  inline features carry the 10 s cap and hint budget.
- **Consistency.** Same probabilistic caveat as the Kiro backend: the
  classifier is an LLM judgement call. The classify prompt carries a
  "standalone rule" test with negative examples precisely because early
  versions stored one-off task instructions ("first fix the sentence") as
  corrections.

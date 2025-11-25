# Troubleshooting

Common issues & solutions.

---

## Claude Code is not calling Claude Recall

Check installation:

```bash
npx claude-recall --version
```

Ensure Claude Code was restarted.

---

## Node version too low

You must use Node 20+:

```bash
nvm install 20
```

---

## PubNub connection errors

Symptoms:

* Agent not receiving events
* No memory suggestions
* watch mode shows nothing

Solution:

* restart clamps
* check network firewall
* ensure project-specific keys exist in `~/.claude-recall/keys.json`

PubNub uses outbound-only connections.

---

## Memory not updating

Ensure the Memory Agent is running:

```bash
npx claude-recall watch
```

Look for:

```
[agent] heartbeat ok
```

---

## Hooks not firing

Check `.claude/hooks/` directory exists.

---

## Reset everything

```bash
rm -rf ~/.claude-recall
```

Reinstall the package in your project.

---

For deeper issues, open a GitHub issue.

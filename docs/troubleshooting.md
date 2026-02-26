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

## Memory not updating

Check MCP server status:

```bash
npx claude-recall mcp status
```

---

## Hooks not firing

Check `.claude/hooks/` directory exists and `search_enforcer.py` is present:

```bash
npx claude-recall hooks check
```

---

## Reset everything

```bash
rm -rf ~/.claude-recall
```

Reinstall the package in your project.

---

For deeper issues, open a GitHub issue.

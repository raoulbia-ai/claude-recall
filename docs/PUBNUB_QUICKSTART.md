# PubNub Integration - Quick Start Guide

Get autonomous memory working in 5 minutes! ⚡

## Prerequisites

- Node.js 18+ (check: `node --version`)
- Claude Recall installed (`npm install claude-recall`)
- Python 3 (for hooks, usually pre-installed)

## Step 1: Build the PubNub Integration

```bash
cd /path/to/claude-recall
npm run build
```

This compiles TypeScript and creates the PubNub publisher/agent.

## Step 2: Enable PubNub Hooks

**Update `.claude/settings.json`:**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "python3 .claude/hooks/pubnub_pre_tool_hook.py"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 .claude/hooks/pubnub_prompt_hook.py"
          }
        ]
      }
    ]
  }
}
```

**Make hooks executable:**

```bash
chmod +x .claude/hooks/pubnub_pre_tool_hook.py
chmod +x .claude/hooks/pubnub_prompt_hook.py
```

## Step 3: Start the Memory Agent

```bash
claude-recall agent start
```

**Verify it's running:**

```bash
claude-recall agent status
```

Expected output:
```
[Agent CLI] Status: Running
[Agent CLI] PID: 12345
[Agent CLI] Logs: /home/user/.claude-recall/agent/memory-agent.log
```

## Step 4: Test It!

**Run the integration test:**

```bash
node dist/pubnub/test-integration.js
```

Expected output:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧪 PubNub Integration Test
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Test 1: Publisher Connectivity
  ✅ Publisher working

Test 2: Memory Agent Startup
  ✅ Memory agent started

Test 3: Tool Event Flow
  ✅ Tool event published
  ✅ Tool event processed

Test 4: Prompt Event Flow
  ✅ Prompt event published
  ✅ Prompt analyzed

Test 5: Memory Context Flow
  ✅ Full memory cycle completed

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ All tests passed!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Step 5: Watch It Work

**Terminal 1 - Agent Logs:**
```bash
tail -f ~/.claude-recall/agent/memory-agent.log
```

**Terminal 2 - Start Claude Code:**
```bash
# Start your Claude Code session
# Try saying: "I prefer TypeScript with strict mode"
# Then try: "Create a new file for authentication"
```

**What you'll see in logs:**
```
[Memory Agent] Prompt event: "I prefer TypeScript with strict mode"
[Memory Agent] Detected: preference
[Memory Agent] Stored preference: I prefer TypeScript with strict mode
[Memory Agent] Tool event: Write
[Memory Agent] Searching: "auth ts create preferences success failure correction"
[Memory Agent] Found 1 relevant memories
[Memory Agent] Published 1 suggestions
```

## Troubleshooting

### "Agent failed to start"

**Check Node version:**
```bash
node --version  # Must be 18+
```

**Check for port conflicts:**
```bash
claude-recall agent stop
claude-recall agent start
```

### "No logs appearing"

**Manually test publisher:**
```bash
node dist/pubnub/publisher-cli.js prompt '{"sessionId":"test","content":"hello"}'
```

**Check agent logs:**
```bash
ls -lh ~/.claude-recall/agent/memory-agent.log
cat ~/.claude-recall/agent/memory-agent.log
```

### "Hooks not triggering"

**Verify hooks exist and are executable:**
```bash
ls -la .claude/hooks/pubnub_*.py
```

**Test hook manually:**
```bash
echo '{"tool_name":"Write","tool_input":{"file_path":"/test.ts"},"session_id":"test"}' | \
  python3 .claude/hooks/pubnub_pre_tool_hook.py
```

## What's Next?

🎉 **Congratulations!** You now have autonomous memory working.

**Try these scenarios:**

1. **Preference Learning**
   - Say: "I prefer Jest for testing"
   - Later: "Create a test file"
   - Agent will remember Jest preference!

2. **Correction Learning**
   - Say: "No, put tests in __tests__/ directory"
   - Agent stores correction with high priority
   - Next time: Automatically uses __tests__/

3. **Tool Context**
   - Create files and edit them
   - Watch agent logs suggest relevant memories
   - Memory context arrives DURING tool execution

**Read more:**
- [Full Documentation](./PUBNUB_INTEGRATION.md)
- [Architecture Details](./PUBNUB_INTEGRATION.md#architecture)
- [Advanced Configuration](./PUBNUB_INTEGRATION.md#setup--configuration)

## Using Production PubNub Keys

**Demo keys have limits.** For production use:

1. **Sign up:** https://www.pubnub.com/signup/
2. **Get keys:** Dashboard → Your App → Keys
3. **Set environment:**

```bash
export PUBNUB_PUBLISH_KEY="pub-c-xxxxxxxx"
export PUBNUB_SUBSCRIBE_KEY="sub-c-yyyyyyyy"
```

4. **Restart agent:**
```bash
claude-recall agent restart
```

## Disabling PubNub (Revert to Old Hooks)

**Edit `.claude/settings.json`:**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "python3 .claude/hooks/pre_tool_search_enforcer.py"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 .claude/hooks/user_prompt_capture.py"
          }
        ]
      }
    ]
  }
}
```

**Stop agent:**
```bash
claude-recall agent stop
```

---

**Questions?** Open an issue: https://github.com/raoulbia-ai/claude-recall/issues

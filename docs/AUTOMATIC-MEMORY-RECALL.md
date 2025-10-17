# Automatic Memory Recall Setup

This document explains how to enable automatic memory recall in your conversations. Once configured, relevant memories will be automatically injected into your messages **before** they reach the LLM, ensuring the LLM always has access to your stored preferences and context.

## The Problem This Solves

By default, memories are only retrieved when you explicitly search for them or when tools are called. This means:

❌ You say: "never mention claude in commit messages"
❌ System stores this as a memory
❌ Next time you ask for a commit message, the memory is NOT automatically recalled
❌ You have to remind the system again

With automatic recall:

✅ You say: "never mention claude in commit messages"
✅ System stores this as a memory
✅ Next time you ask for a commit message → memory is AUTOMATICALLY injected
✅ LLM sees: "🧠 **Relevant Memories**: User preference: Do not mention 'Claude' in git commit messages..."
✅ LLM respects your preference without being told again

## How It Works

The `auto-memory-recall.js` hook:
1. Receives your message before it reaches the LLM
2. Extracts keywords from your message
3. Searches claude-recall memories for relevant context
4. Injects top 3 most relevant memories (with 70%+ relevance score)
5. Passes the enhanced message to the LLM

## Installation

### Step 1: Copy the Hook

The hook is located at:
```
src/hooks/auto-memory-recall.js
```

If you installed claude-recall globally, copy it to a permanent location:

```bash
# Create hooks directory
mkdir -p ~/.claude-recall/hooks

# Copy the hook
cp ./src/hooks/auto-memory-recall.js ~/.claude-recall/hooks/

# Make it executable
chmod +x ~/.claude-recall/hooks/auto-memory-recall.js
```

If you installed claude-recall locally in your project:

```bash
# The hook is already in node_modules/claude-recall/src/hooks/
# You can reference it directly from there
```

### Step 2: Configure the Hook

Add the hook to your `~/.claude/config.yaml`:

```yaml
hooks:
  user-prompt-submit: ~/.claude-recall/hooks/auto-memory-recall.js
```

Or if using a local installation:

```yaml
hooks:
  user-prompt-submit: ./node_modules/claude-recall/src/hooks/auto-memory-recall.js
```

### Step 3: Restart

Restart your terminal or reload your shell configuration for changes to take effect.

## Configuration

The hook supports several environment variables for customization:

### Basic Configuration

```bash
# Enable/disable automatic injection (default: true)
export CLAUDE_RECALL_AUTO_INJECT=true

# Maximum number of memories to inject (default: 3)
export CLAUDE_RECALL_INJECT_LIMIT=3

# Minimum relevance score (0.0-1.0, default: 0.7)
export CLAUDE_RECALL_MIN_RELEVANCE=0.7

# Maximum length per memory (default: 200 characters)
export CLAUDE_RECALL_MAX_CONTENT_LENGTH=200
```

### Debug Configuration

```bash
# Enable debug logging
export CLAUDE_RECALL_DEBUG=1

# Check debug logs
tail -f ~/.claude-recall/auto-recall.log
```

## Testing

Test the hook manually:

```bash
# Test with a commit-related message
echo "write a git commit message" | node ~/.claude-recall/hooks/auto-memory-recall.js

# Expected output:
# 🧠 **Relevant Memories**:
# - User preference: Do not mention "Claude" in git commit messages...
#
# write a git commit message
```

## Verifying It's Working

1. **Store a preference:**
   ```
   You: "I prefer TypeScript with strict mode"
   ```

2. **Ask related question (in NEW conversation):**
   ```
   You: "Create a new module"
   ```

3. **Check the message you sent** - you should see:
   ```
   🧠 **Relevant Memories**:
   - I prefer TypeScript with strict mode (85% relevant)

   Create a new module
   ```

4. **LLM should respond** using TypeScript without being told again

## Troubleshooting

### Hook Not Running

Check your config.yaml:
```bash
cat ~/.claude/config.yaml
```

Should show:
```yaml
hooks:
  user-prompt-submit: ~/.claude-recall/hooks/auto-memory-recall.js
```

### No Memories Being Injected

Enable debug mode:
```bash
export CLAUDE_RECALL_DEBUG=1
```

Check the log:
```bash
tail -20 ~/.claude-recall/auto-recall.log
```

Common issues:
- No memories match the query (check with `npx claude-recall search "your query"`)
- Relevance scores too low (try lowering `CLAUDE_RECALL_MIN_RELEVANCE`)
- Hook can't find claude-recall CLI (ensure it's in PATH)

### Too Many/Too Few Memories

Adjust the limits:
```bash
# Show only 1 memory
export CLAUDE_RECALL_INJECT_LIMIT=1

# Lower relevance threshold
export CLAUDE_RECALL_MIN_RELEVANCE=0.5

# Increase memory length
export CLAUDE_RECALL_MAX_CONTENT_LENGTH=300
```

## Performance

The hook adds minimal latency:
- Keyword extraction: ~1ms
- Memory search: ~50-200ms (depending on database size)
- Total overhead: ~100-300ms per message

This is a small price for always-on memory recall.

## Advanced: Selective Hook Activation

If you want the hook only for specific projects, use project-specific config:

```bash
# In your project directory
mkdir -p .claude
cat > .claude/config.yaml <<EOF
hooks:
  user-prompt-submit: ~/.claude-recall/hooks/auto-memory-recall.js
EOF
```

Or disable globally and enable per-project:

```bash
# Globally disable
export CLAUDE_RECALL_AUTO_INJECT=false

# Enable for specific project
cd my-project
export CLAUDE_RECALL_AUTO_INJECT=true
```

## How This Relates to Phase 3

This hook implements **Phase 3B: Pre-Prompt Memory Injection** from the Real-Time Intelligence roadmap.

Original plan:
- Intercept tool calls and inject memories into `_memoryContext`

Actual implementation:
- Intercept user messages and inject memories **before** the LLM sees them
- More effective because memories are in the prompt, not hidden in tool metadata
- Works for ALL messages, not just tool calls

## Next Steps

- Automatic memory recall is now working! ✅
- Consider enhancing the claude-recall://context/active resource for passive memory subscription
- Explore Phase 4: Real-time learning and adaptive retrieval

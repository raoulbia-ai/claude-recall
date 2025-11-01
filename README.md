# Claude Recall

An MCP server that gives Claude persistent memory across conversations.

Every time you start a new conversation with Claude, you're starting from scratch. Claude doesn't remember your preferences, your project context, or the decisions you've made together. Until now.

**Claude Recall** is an MCP (Model Context Protocol) server that gives Claude persistent memory across conversations. It learns from your interactions and provides relevant context in future conversations, making Claude feel like a true collaborator who remembers your journey together.

## Key Features

### 🧠 Intelligent Learning Loop
- **Never repeat yourself** - State preferences once, Claude remembers forever
- **Learn from outcomes** - Automatically captures what worked and what didn't
- **Direct MCP search** - Fast, simple memory lookup (milliseconds, no agent overhead)
- **Automatic application** - Preferences and successful patterns applied without asking
- **Persistent across restarts** - Your learnings survive Claude Code restarts

### 📝 Intelligent Capture
- **Automatic extraction** - Captures preferences, patterns, and important information from conversations
- **Categorized storage** - Organizes memories by type (preferences, project knowledge, corrections)
- **Priority-based** - More important or frequently used memories are prioritized

### ⚡ Advanced Features (v0.3.2+)
- **Direct MCP calls** - Fast memory search without agent overhead (milliseconds)
- **Comprehensive search** - Single search finds preferences, successes, failures, and corrections
- **Outcome capture** - Stores what worked and what didn't for future learning
- **Learning loop** - Pre-action search → Execute → Post-action outcome → Future tasks apply learnings
- **Optional agent** - Advanced context-manager agent available for complex workflows
- **Correction priority** - User corrections given highest priority (never repeat mistakes)

### 🔒 Privacy & Security First
- **100% Local** - All memories stored locally in SQLite (~/.claude-recall/)
- **No cloud sync** - Your data never leaves your machine
- **You own your data** - Export, view, or delete memories at any time
- **Zero telemetry** - No data collection or phone-home behavior
- **Security audited** - Reviewed using `/security-review` command: No exposed secrets, SQL injection protection, 0 npm vulnerabilities

## Quick Start

### Recommended: Local Project Installation

**Install in each project where you want Claude Recall:**

```bash
cd your-project
npm install claude-recall
```

**What this does:**
- ✅ Creates `.claude/` directory with memory-first workflow instructions
- ✅ Configures MCP server in `~/.claude.json` (global, works everywhere)
- ✅ Adds to `package.json` (team members get it automatically)
- ✅ CLI available via `npx claude-recall stats`

**After installation, verify:**
```bash
npx claude-recall --version   # Should show 0.3.3 or later
```

### Why Local Over Global?

**Local installation (`npm install claude-recall`):**
- ✅ `.claude/CLAUDE.md` auto-created in your project
- ✅ `.claude/agents/` available for Claude Code
- ✅ Team members get it via `package.json`
- ✅ Use `npx claude-recall` for CLI
- ✅ MCP server still works globally

**Global installation (`npm install -g`):**
- ❌ `.claude/` directory NOT auto-created
- ❌ Must manually copy integration files to each project
- ❌ Harder to share with team
- ✅ CLI available without `npx`

**Bottom line:** Install locally in each project. The MCP server (`~/.claude.json`) and database (`~/.claude-recall/`) are shared globally anyway, so you get the best of both worlds.

### If You Have Global Installation

**Remove it:**
```bash
npm uninstall -g claude-recall
```

**Then install locally in each project** as shown above. Your memories in `~/.claude-recall/claude-recall.db` are preserved!

### Cross-Platform Compatibility

Claude Recall works on **Windows, Linux, and macOS**. Native binaries (SQLite) compile automatically for your platform during `npm install`.

**WSL Users:** Use local installation only. Global installation on Windows + WSL usage causes binary conflicts ("invalid ELF header" errors).

**Everyone else:** Both local and global work, but local is still recommended for the benefits above.

## Updating Claude Recall

**For local installations (recommended):**

```bash
# 1. Update in your project
cd your-project
npm install claude-recall@latest

# 2. Restart Claude Code
```

**For global installations (not recommended):**

```bash
# 1. Update globally
npm install -g claude-recall@latest

# 2. Restart Claude Code
```

**Note:** MCP server configuration in `~/.claude.json` persists across updates. You only need to update the package.

## Verifying Claude Recall is Working

To confirm claude-recall is active in your Claude Code session:

**1. Check MCP Server Status**
```bash
claude mcp list
```
Should show `claude-recall` in the list of active servers.

**2. Ask Claude to Search Memories**
Simply ask: "Search my memories for [anything]" - Claude should be able to call the search tool.

**3. Check Available MCP Tools**
Ask Claude: "What MCP tools do you have access to?" - Claude should list tools starting with `mcp__claude-recall__` including:
- `mcp__claude-recall__store_memory`
- `mcp__claude-recall__retrieve_memory`
- `mcp__claude-recall__search`

**4. Store and Retrieve a Test Memory**
```
You: "Remember that I prefer testing with Jest"
Claude: [Should call store_memory tool]

You: "What testing framework do I prefer?"
Claude: [Should search memories and find Jest]
```

**5. Check Stats via CLI**
```bash
claude-recall stats
```
This shows if memories are being stored.

**6. Check Running Process**
```bash
ps aux | grep claude-recall
```
Should show the MCP server process running.

## How It Works

Claude Recall implements an **intelligent learning loop** that ensures you never repeat yourself:

### The Learning Loop

1. **Store Preferences**: When you express preferences, they're stored in SQLite
2. **Pre-Action Search**: Before tasks, Claude searches memories directly (fast MCP call)
3. **Find Context**: Search finds preferences + successes + failures + corrections automatically
4. **Execute with Context**: Claude applies what was learned
5. **Capture Outcome**: After task, Claude stores success/failure/correction
6. **Future Application**: Next similar task automatically applies learnings

### Complete Example: Never Repeat Yourself

```
=== First Time: State Preference ===
You: "I prefer Python for scripts"
[Claude stores preference via MCP]

=== Second Time: First Use ===
You: "Create a test script"
[Claude searches: mcp__claude-recall__search("scripts python test")]
[Search finds: "I prefer Python for scripts"]
[Claude creates test.py using Python]
You: "Perfect!"
[Claude stores: "Created test script with Python - SUCCESS"]

=== Third Time: Automatic Application ===
You: "Create a build script"
[Claude searches: mcp__claude-recall__search("scripts build python")]
[Search finds: "I prefer Python" + "test.py SUCCESS"]
[Claude creates build.py automatically - learned pattern!]
You: *Don't have to repeat preference - it was learned!*

=== Correction Loop ===
You: "No, put scripts in scripts/ directory not root"
[Claude stores: "CORRECTION: Scripts in scripts/ directory" (highest priority)]
[Claude moves file immediately]
Next time: Search finds correction and applies automatically
```

## How Memory Capture Works

**You don't need to say "remember"** - Claude Recall automatically captures preferences when you speak naturally.

### Automatic Trigger Words

Claude Recall uses a **three-tier priority system** to capture memories:

#### Priority 1: Explicit "Remember" Commands (100% Confidence)
```
"Remember that I prefer TypeScript with strict mode"
```

#### Priority 2 & 3: Automatic Pattern Detection (60%+ Confidence)

**Strong indicators** (boost confidence):
- `prefer`, `always`, `never`
- `from now on`, `moving forward`, `going forward`

**General indicators**:
- `use`, `should`, `want`, `like`, `love`
- `save`, `store`, `put`, `place`, `create`, `make`

### Examples That Work WITHOUT "Remember"

| What You Say | Automatically Captured? | Confidence |
|--------------|------------------------|------------|
| "I prefer TypeScript with strict mode" | ✅ YES | High (80%+) |
| "Always use Jest for testing" | ✅ YES | High (80%+) |
| "Never put tests in the root directory" | ✅ YES | High (80%+) |
| "From now on, use 4 spaces for indentation" | ✅ YES | High (85%+) |
| "I want scripts in the scripts/ folder" | ✅ YES | Medium (70%+) |
| "Use Axios for HTTP requests" | ✅ YES | Medium (70%+) |
| "Tests should go in __tests__/" | ✅ YES | Medium (70%+) |
| "Create files with .ts extension" | ✅ YES | Medium (65%+) |
| "Maybe use React" | ❌ NO | Low (< 60%) |

### Confidence Threshold

- **Minimum confidence**: 60% required for automatic capture
- **"Remember" keyword**: Ensures 100% confidence capture (but not required)
- **Stronger language**: "prefer", "always", "never" boost confidence
- **Override signals**: "from now on", "actually", "instead" boost confidence

**Bottom line**: Speak naturally about your preferences - Claude Recall captures them automatically. Use "remember" only when you want to ensure something is captured with absolute certainty.

## Memory Types

Claude Recall stores different types of memories (sorted by priority):

### 1. Corrections (Highest Priority)
- User explicitly said "No, do this instead"
- Fixes to mistakes Claude made
- Override previous approaches
- **Example**: "CORRECTION: Tests in __tests__/ not tests/"

### 2. Preferences
- Coding style preferences (languages, frameworks, patterns)
- Tool preferences (testing frameworks, build tools)
- Workflow preferences (git conventions, file structures)
- **Example**: "I prefer TypeScript with strict mode"

### 3. Successes
- What worked in past tasks
- Approaches that user approved
- Validated patterns
- **Example**: "Created auth module with JWT tokens - SUCCESS"

### 4. Failures
- What didn't work and should be avoided
- Approaches that failed or were rejected
- Deprecated approaches
- **Example**: "Session-based auth failed, use JWT instead"

### 5. Project Knowledge
- Database configurations
- API patterns and endpoints
- Architecture decisions
- Dependencies and versions

### 6. Tool Use
- Historical tool execution
- Command patterns
- Workflow steps

## CLI Commands

### Essential Commands
```bash
# View statistics
claude-recall stats

# Search memories
claude-recall search "database configuration"

# Export memories
claude-recall export memories.json

# Import memories
claude-recall import memories.json

# Clear memories (use with caution)
claude-recall clear --type preferences  # Clear only preferences
claude-recall clear --force               # Clear everything

# Test memory capture (for debugging)
claude-recall capture user-prompt '{"content":"your message here"}'
```

## Memory Management

Claude Recall automatically manages memory to prevent unlimited database growth, with user notifications:

### Current Limits
- **Maximum memories**: 10,000 total (configurable)
- **Database size threshold**: 10MB for automatic compaction
- **Queue message retention**: 7 days for completed messages

### User Notifications
- **Stats command** shows current usage: `8,234/10,000 (82.3%)`
- **Warning at 80%**: "⚠️ Note: Memory usage is high"
- **Critical at 90%**: "⚠️ WARNING: Approaching memory limit - pruning will occur soon"
- **During pruning**: "🔄 Pruned 500 old tool-use memories"
- **During compaction**: "🗜️ Compacting database... ✅ saved 2.3MB"

### Memory Retention by Type
- **Preferences**: Kept indefinitely (your coding style, tool choices)
- **Project Knowledge**: Kept indefinitely (database configs, API patterns)
- **Tool Usage**: Last 1,000 entries
- **Corrections**: Last 100 entries
- **Session memories**: Maximum 50 per session

### Manual Management
```bash
# Check database size and memory count (with usage percentage)
claude-recall stats

# Clear old memories
claude-recall clear --days 30        # Clear memories older than 30 days
claude-recall clear --type tool_use  # Clear specific type
claude-recall clear --all            # Clear everything (requires confirmation)

# Export before clearing
claude-recall export backup.json
```

### Environment Variables
```bash
# Customize limits
export CLAUDE_RECALL_MAX_MEMORIES=20000        # Increase memory limit
export CLAUDE_RECALL_COMPACT_THRESHOLD=20971520 # 20MB compaction threshold
export CLAUDE_RECALL_RETAIN_TOOL_USE=2000      # Keep more tool usage history
```

## Troubleshooting

### Memories not being retrieved?
1. Verify memories exist: `claude-recall stats`
2. Search manually to test: `claude-recall search "your topic"`

### Installation shows old version?

#### For global installation (CLI usage):
```bash
npm cache clean --force
npm uninstall -g claude-recall
npm install -g claude-recall@latest
claude-recall --version
```

#### For local installation (CLAUDE.md integration):
```bash
npm cache clean --force
npm uninstall claude-recall
npm install claude-recall@latest
npx claude-recall --version
```

### Performance issues?
- Check database size: `ls -lh ~/.claude-recall/claude-recall.db`
- Clear old memories: `claude-recall clear --days 30`
- The system uses SQLite with optimized indexes for fast retrieval

### Need Help?
Run this diagnostic script and share the output:
```bash
claude-recall --version
claude-recall stats
ls -lh ~/.claude-recall/claude-recall.db
node --version
npm --version
```

## Best Practices

1. **Be explicit about preferences** - Clear statements like "Always use..." or "Never..." are captured better
2. **Approve or correct** - Say "Good!" or "No, do this" after tasks to build the learning loop
3. **Trust the learning loop** - Direct MCP search finds preferences, successes, and failures instantly
4. **Correct mistakes immediately** - Corrections get highest priority and won't be repeated
5. **Review periodically** - Use `claude-recall stats` to see what's being remembered
6. **Export important memories** - Backup critical preferences with `claude-recall export`
7. **Fast and simple** - Direct MCP calls work great for most tasks (agent is optional)

## Acknowledgements

This project makes extensive use of the excellent work from:
- [claude-flow](https://github.com/ruvnet/claude-flow) - by Ruvnet

## License

MIT - Use it, modify it, make it yours.

## Disclaimer

This software is provided "as-is", without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, and noninfringement. In no event shall the authors or copyright holders be liable for any claim, damages or other liability, whether in an action of contract, tort or otherwise, arising from, out of or in connection with the software or the use or other dealings in the software.

This project is provided for free to the community. While every effort has been made to ensure quality and security (including automated security reviews), users should review and test the code according to their own requirements before use in production environments.

---

Built with ❤️ by a developer who was tired of repeating himself to Claude.

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

### 🧠 Intelligence & Evolution (v0.7.0+)
- **Sophistication tracking** - Measures agent progression from basic tool use to compositional reasoning
- **Failure learning** - Captures what failed, why it failed, and what should be done instead (counterfactual reasoning)
- **Evolution metrics** - View progression score, confidence trends, and failure rates over time
- **Structured memories** - Rich Title/Description/Content format for better human readability
- **Automatic classification** - Memories auto-classified by sophistication level (L1-L4)

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

**WSL Users - Special Case:**

If you use **both Windows and WSL** for the same project (e.g., Electron app runs on Windows, but Claude Code runs in WSL):

**Problem**: Installing locally creates Windows binaries, but WSL needs Linux binaries → "invalid ELF header" errors.

**Solution**: Install globally in WSL only:
```bash
# From WSL:
npm install -g claude-recall

# Verify:
claude-recall --version
```

**Important**: Global installation does NOT affect project-specific memory scoping! See [How Project Scoping Works](#how-project-scoping-works-installation-location) below.

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

### Schema Migration (v0.7.6+)

**Automatic Migration:**

Starting with v0.7.6, Claude Recall automatically migrates your database schema when needed. The first time you run any command after upgrading, missing columns will be added automatically.

**What Gets Migrated:**
- `sophistication_level` column (added in v0.7.0)
- `scope` column (added in v0.7.2)

You'll see console messages like:
```
📋 Migrating database schema: Adding scope column...
✅ Added scope column
```

**Manual Migration (Optional):**

If you prefer to run the migration explicitly:

```bash
# Check current schema and migrate if needed
npx claude-recall migrate schema

# Create backup before migration
npx claude-recall migrate schema --backup
```

**Troubleshooting Schema Errors:**

If you see errors like:
- `"no such column: scope"`
- `"no such column: sophistication_level"`

Run the manual migration:
```bash
npx claude-recall migrate schema --backup
```

This will:
1. Create a backup of your database (if `--backup` flag used)
2. Add any missing columns
3. Create necessary indexes
4. Verify the migration succeeded

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

## Claude Code Skills Integration (v0.5.0+)

Claude Recall now integrates with **Claude Code Skills** for better LLM compliance and automatic memory management.

### What Are Skills?

Skills are structured task modules that teach Claude how to perform specific workflows. Unlike `.claude/CLAUDE.md` (which are passive instructions), Skills are recognized by Claude Code's runtime and loaded intelligently.

**Benefits:**
- ✅ **Better compliance**: Skills are runtime-integrated, not just text instructions
- ✅ **Progressive disclosure**: Only load detailed instructions when needed
- ✅ **Structured format**: YAML frontmatter makes parsing more reliable
- ✅ **Tool teaching**: Explicitly teaches WHEN and HOW to use MCP tools

### Memory Management Skill

**Location:** `.claude/skills/memory-management/SKILL.md`

This Skill teaches Claude to:
1. **Search memories before tasks** - Automatic search before file operations
2. **Store memories after outcomes** - Success/failure/correction capture
3. **Apply learned patterns** - Use devops workflows, preferences automatically
4. **Check what's captured** - Verify automatic capture worked

**Created automatically** when you install Claude Recall in a project.

### Skill Structure

```
.claude/
├── CLAUDE.md                     # Backward compatibility
├── agents/                       # Optional context-manager agent
└── skills/
    └── memory-management/
        ├── SKILL.md              # Main skill definition
        └── references/
            ├── devops-patterns.md      # DevOps capture examples
            ├── capture-examples.md     # Manual storage templates
            └── troubleshooting.md      # Common issues & fixes
```

### How Skills Work

1. **Metadata loaded first** - Claude reads skill name/description (fast)
2. **Full instructions when needed** - Detailed workflow loaded on-demand
3. **References as needed** - Examples and patterns loaded if required

**Example:**
```
User: "Create authentication module"

Claude:
1. Loads memory-management Skill metadata
2. Reads SKILL.md instructions → "Search before tasks"
3. Searches: mcp__claude-recall__search("authentication devops testing")
4. Finds: "Always use JWT" + "Tests in __tests__/" + "TDD approach"
5. Creates auth module following learned patterns
6. Loads references/capture-examples.md for success storage template
7. Stores: "Created auth with JWT - SUCCESS"
```

### Backward Compatibility

**Both work together:**
- **CLAUDE.md** - General instructions for Claude Code
- **SKILL.md** - Specific memory management workflow

Skills take precedence when both exist, but CLAUDE.md provides fallback for users without Skills support.

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

### 1. DevOps (Highest Priority - v0.5.0+)
- **Project-specific workflows** that are critical to how you work
- Git conventions, testing approaches, build processes
- Development environment setup (WSL, Docker, etc.)
- Architecture decisions, tech stack choices
- **Automatically captured** when you describe your workflow
- **Example**: "We use TDD for all new features"
- **Example**: "Always create feature branches from main"
- **Example**: "This is a teleprompter tool for interviews"

### 2. Corrections
- User explicitly said "No, do this instead"
- Fixes to mistakes Claude made
- Override previous approaches
- **Example**: "CORRECTION: Tests in __tests__/ not tests/"

### 3. Preferences
- Coding style preferences (languages, frameworks, patterns)
- Tool preferences (testing frameworks, build tools)
- File organization, naming conventions
- **Example**: "I prefer TypeScript with strict mode"

### 4. Successes
- What worked in past tasks
- Approaches that user approved
- Validated patterns
- **Example**: "Created auth module with JWT tokens - SUCCESS"

### 5. Failures
- What didn't work and should be avoided
- Approaches that failed or were rejected
- Deprecated approaches
- **Example**: "Session-based auth failed, use JWT instead"

### 6. Project Knowledge
- Database configurations
- API patterns and endpoints
- Infrastructure details (tenant IDs, endpoints)
- Dependencies and versions
- **Example**: "Tenant ID is abc-123"
- **Example**: "API endpoint: https://api.example.com"

### 7. Tool Use
- Historical tool execution
- Command patterns
- Workflow steps

## CLI Commands

All commands can be run from your terminal or **within Claude Code sessions** (Claude can execute them using the Bash tool).

### Memory Operations

**Search memories:**
```bash
npx claude-recall search "database"
npx claude-recall search "auth" --limit 20           # Show up to 20 results
npx claude-recall search "config" --project my-app   # Filter by project + universal
npx claude-recall search "testing" --global          # Search all projects
npx claude-recall search "api" --json                # Output as JSON
```

**View statistics:**
```bash
npx claude-recall stats                    # Current project + universal + unscoped
npx claude-recall stats --project my-app   # Specific project + universal
npx claude-recall stats --global           # All projects
```

**Store memory directly:**
```bash
npx claude-recall store "I prefer TypeScript with strict mode"
npx claude-recall store "Use PostgreSQL" --type project-knowledge
```

### Intelligence & Evolution (v0.7.0+)

**View memory evolution and sophistication metrics:**
```bash
npx claude-recall evolution                    # Last 30 days
npx claude-recall evolution --days 60          # Last 60 days
npx claude-recall evolution --project my-app   # Filter by project
```

**Example `evolution` output:**
```
📈 Memory Evolution

Analysis Period: Last 30 days
Total Memories: 145
Progression Score: 67/100

Sophistication Breakdown:
  Procedural (L1):      45 ( 31.0%)
  Self-Reflection (L2): 38 ( 26.2%)
  Adaptive (L3):        52 ( 35.9%)
  Compositional (L4):   10 (  6.9%)

Average Confidence: 0.78 ↗
Failure Rate: 12.4% ↘

○ Agent developing adaptive patterns
```

**Sophistication Levels:**
- **L1 Procedural**: Basic tool use, simple actions
- **L2 Self-Reflection**: Error checking, corrections, learning from failures
- **L3 Adaptive**: Systematic workflows, devops patterns
- **L4 Compositional**: Multi-constraint reasoning, complex decision-making

**View failure memories with counterfactual learning:**
```bash
npx claude-recall failures                    # Last 10 failures
npx claude-recall failures --limit 20         # Show 20 most recent
npx claude-recall failures --project my-app   # Filter by project
```

**Example `failures` output:**
```
❌ Failure Memories (Counterfactual Learning)

1. Avoid: Reading file without existence check
   What Failed: Attempted to read config.json directly
   Why Failed: File does not exist at expected location
   Should Do: Verify file path exists before reading. Use fs.existsSync()
   Preventative Checks:
     - Verify file exists before reading (fs.existsSync)
     - Handle ENOENT errors gracefully

2. Avoid: Session-based authentication
   What Failed: Session-based auth implementation
   Why Failed: User reported: Doesn't scale across multiple servers
   Should Do: Use JWT tokens instead
```

### Data Management

**Export/import memories:**
```bash
npx claude-recall export memories.json          # Export all memories
npx claude-recall export backup.json --json     # Export as JSON
npx claude-recall import memories.json          # Import memories
```

**Clear memories (use with caution):**
```bash
npx claude-recall clear --force                 # Clear everything (requires --force)
```

### MCP Server Commands

**What are MCP commands?**
The MCP (Model Context Protocol) server is how Claude Code communicates with Claude Recall. When you install claude-recall, it automatically configures `~/.claude.json` to start the MCP server.

**Process Management (v0.7.4+):**
```bash
# Start/stop
npx claude-recall mcp start              # Start MCP server (auto-started by Claude Code)
npx claude-recall mcp stop               # Stop running server gracefully
npx claude-recall mcp restart            # Restart server
npx claude-recall mcp test               # Test MCP server functionality

# Monitoring
npx claude-recall mcp status             # Show server status for current project
npx claude-recall mcp ps                 # List all running MCP servers (all projects)

# Cleanup
npx claude-recall mcp cleanup            # Remove stale PID files and processes
npx claude-recall mcp cleanup --dry-run  # Preview cleanup actions
npx claude-recall mcp cleanup --all      # Stop all MCP servers (all projects)
```

**When to use:**
- **Auto-started**: Claude Code automatically starts the MCP server on launch
- **Manual management**: Stop, restart, or cleanup stale servers as needed
- **Troubleshooting**: Use `mcp ps` to see running servers, `mcp cleanup` to remove zombies
- **Testing**: Use `mcp test` to verify the server responds correctly

### Utilities

**Check installation status:**
```bash
npx claude-recall status        # Show installation and system status
npx claude-recall --version     # Show version
```

**Monitoring (advanced):**
```bash
npx claude-recall monitor                      # View search monitoring stats
npx claude-recall test-memory-search           # Test if Claude searches before file creation
```

**Migration:**
```bash
# Database schema migration (v0.7.6+)
npx claude-recall migrate schema                # Migrate database schema (automatic)
npx claude-recall migrate schema --backup       # Create backup before migration

# Architecture migration (file-watcher → MCP)
npx claude-recall migrate                       # Migrate from file-watcher to MCP architecture
```

### Global Options

All commands support:
- `--verbose` - Enable verbose logging
- `--config <path>` - Use custom config file
- `-h, --help` - Show help for any command

## Project Management (v0.7.5+)

Claude Recall maintains a **project registry** to track all projects using it, enabling better organization and visibility across multiple projects.

### Auto-Registration

Projects are automatically registered when:
- The MCP server starts (every time Claude Code connects)
- You run `npm install claude-recall` locally
- You manually run `npx claude-recall project register`

The registry stores:
- Project path
- Claude Recall version
- Registration date
- Last activity timestamp

### Project Commands

**List all registered projects:**
```bash
npx claude-recall project list              # Human-friendly output
npx claude-recall project list --json       # JSON format
```

Shows:
- Project name and path
- Claude Recall version
- Last activity
- MCP server status (active/inactive)

**Show project details:**
```bash
npx claude-recall project show              # Current project
npx claude-recall project show my-project   # Specific project
```

Displays:
- Registry information (path, version, timestamps)
- MCP server status (running/stopped, PID)

**Register a project:**
```bash
npx claude-recall project register          # Current directory
npx claude-recall project register --path /path/to/project
```

**Unregister a project:**
```bash
npx claude-recall project unregister        # Current project
npx claude-recall project unregister my-project
```

**Note**: Unregistering does NOT remove memories or MCP configuration - only the registry entry.

**Clean up stale entries:**
```bash
npx claude-recall project clean             # Remove projects not seen in 30 days
npx claude-recall project clean --days 60   # Custom threshold
npx claude-recall project clean --dry-run   # Preview without changes
```

### Enhanced MCP Commands

MCP commands now show registry information:

```bash
npx claude-recall mcp status    # Shows registry info + MCP status
npx claude-recall mcp ps        # Lists all servers with version info
```

### Registry Storage

Registry stored at: `~/.claude-recall/projects.json`

Format:
```json
{
  "version": 1,
  "projects": {
    "my-project": {
      "path": "/full/path/to/my-project",
      "registeredAt": "2025-11-09T...",
      "version": "0.7.5",
      "lastSeen": "2025-11-09T..."
    }
  }
}
```

**Note**: The registry is separate from your memory database. Cleaning the registry does NOT affect your stored memories.

## Project Scoping (v0.7.2+)

Claude Recall now supports **project-specific memory isolation** while keeping universal preferences available everywhere.

### How It Works

- **Single global database**: `~/.claude-recall/claude-recall.db`
- **Three memory scopes**:
  - **Universal**: Available in all projects (coding preferences, tools)
  - **Project**: Only available in the specific project
  - **Unscoped** (default): Available everywhere (backward compatible)
- **Project ID**: Automatically detected from directory name

### Storing Memories

**Universal memories** (available everywhere):
```
User: "Remember everywhere: I prefer TypeScript with strict mode"
Claude: [Stores with scope='universal']
```

**Project-specific memories**:
```
User: "For this project, we use SQLite for the database"
Claude: [Stores with scope='project', project_id='my-app']
```

**Default** (unscoped, works like before):
```
User: "I prefer Jest for testing"
Claude: [Stores with scope=null, available everywhere]
```

### Searching with Scopes

**Default** (current project + universal):
```bash
npx claude-recall search "database"
# Returns: Current project memories + universal memories + unscoped
```

**Specific project**:
```bash
npx claude-recall search "database" --project my-app
# Returns: my-app memories + universal memories + unscoped
```

**All projects**:
```bash
npx claude-recall search "database" --global
# Returns: All memories from all projects
```

### Stats with Scopes

**Current project**:
```bash
npx claude-recall stats
# Shows: Memories for current project (claude-recall) + universal + unscoped
```

**All projects**:
```bash
npx claude-recall stats --global
# Shows: All memories across all projects
```

### Use Cases

**Universal memories** (scope='universal'):
- Coding style preferences: "Always use TypeScript with strict mode"
- Tool preferences: "Prefer Jest for testing"
- File naming conventions: "Name markdown files with lowercase-dash-case"

**Project-specific memories** (scope='project'):
- Database choice: "This project uses PostgreSQL"
- API endpoints: "API base URL is https://api.example.com"
- Build commands: "Run npm run build:prod for production"

**Unscoped memories** (scope=null, default):
- Backward compatible
- Works like v0.7.1 and earlier
- Available everywhere unless you explicitly scope them

### How Project Scoping Works (Installation Location)

**Important**: Where you install claude-recall (global vs local) does NOT affect project-specific memory scoping!

**What Determines Project Scope:**

1. ✅ **Claude Code's working directory** - Where you run Claude Code
2. ✅ **Database scoping logic** - Filters memories by project_id
3. ❌ **Installation location** - Doesn't matter for scoping

**How It Works:**

```
# Claude Code runs in this directory:
/home/user/projects/my-app

# Project ID detected from directory name:
project_id = "my-app"

# Memories stored/searched with that project_id:
- "For this project, use PostgreSQL" → stored with project_id="my-app"
- "Remember everywhere: I prefer TypeScript" → stored with scope="universal"

# Same behavior whether claude-recall is:
# - Installed globally: /usr/local/lib/node_modules/claude-recall
# - Installed locally: ./node_modules/claude-recall
```

**Database Location (Always Global):**

Whether you install globally or locally, the database is **always** at:
```
~/.claude-recall/claude-recall.db
```

This single database contains:
- Project-specific memories for each project (isolated by project_id)
- Universal memories (available in all projects)
- Unscoped memories (backward compatible)

**Example: Two Projects, One Installation**

```bash
# Project A:
cd ~/projects/project-a
# Claude Code detects: project_id = "project-a"
# Memories: isolated to project-a + universal + unscoped

# Project B:
cd ~/projects/project-b
# Claude Code detects: project_id = "project-b"
# Memories: isolated to project-b + universal + unscoped

# Same global installation, proper isolation!
```

**WSL Users:**

This is why **global installation in WSL** works perfectly for project scoping:
- Code location: `/home/user/.nvm/.../bin/claude-recall` (global)
- Project detection: Based on Claude Code's `cwd`, NOT installation path
- Memory isolation: Each project gets its own memories + universal preferences

Global installation actually **helps** WSL users by avoiding binary conflicts while maintaining perfect project isolation!

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

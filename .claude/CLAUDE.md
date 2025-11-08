# Claude Recall - Memory-First Development with Learning Loop

This file provides instructions to Claude Code when working with projects that use Claude Recall for persistent memory.

## Core Principle: Never Repeat Yourself

**The user should NEVER have to repeat preferences or explain what worked/didn't work.**

Your job is to:
1. Remember stated preferences permanently
2. Learn from successes (what worked)
3. Learn from failures (what didn't work)
4. Apply learned patterns automatically

## The Learning Loop Workflow

### Phase 1: Pre-Action (BEFORE doing any task)

**Search memories directly** using the MCP search tool:

```
mcp__claude-recall__search("[task keywords] preferences success failure correction")
```

**What this finds automatically:**
- **Preferences**: User-stated preferences for this type of task
- **Successes**: Past approaches that worked well
- **Failures**: Past approaches that failed (avoid these!)
- **Corrections**: User fixes (HIGHEST PRIORITY - user explicitly said "no, do this")

**Example search:**
```
Task: "Create authentication module"
Search: mcp__claude-recall__search("authentication module TypeScript testing")
Finds:
- "I prefer TypeScript with strict mode"
- "Created auth module with JWT - SUCCESS"
- "Session-based auth failed - use JWT instead"
```

### Phase 2: Execution

Apply what you found:
- **Follow preferences**: Use user's stated style/tools/conventions
- **Repeat successes**: Use approaches that worked before
- **Avoid failures**: Don't try approaches that failed
- **Prioritize corrections**: User explicitly fixed these - highest priority!

### Phase 3: Post-Action (AFTER task completion)

**Capture the outcome** for future learning by storing directly:

**If user approves** ("Good!", "Perfect!", "Thanks!"):
```
mcp__claude-recall__store_memory({
  content: "Created [what you did] - SUCCESS",
  metadata: { type: "success", task: "[task type]" }
})
```

**If user corrects** ("No, do it this way", "Change X to Y"):
```
mcp__claude-recall__store_memory({
  content: "CORRECTION: [User's fix/preference]",
  metadata: { type: "correction", priority: "high" }
})
```

**If task fails** (errors, "That didn't work"):
```
mcp__claude-recall__store_memory({
  content: "[Approach] failed - [reason]",
  metadata: { type: "failure", avoid: true }
})
```

## Available MCP Tools

Claude Recall provides these MCP tools (access via `mcp__claude-recall__*`):

- **`mcp__claude-recall__search`**: Search memories by query (use this before tasks)
- **`mcp__claude-recall__store_memory`**: Store new memories (use this for outcomes)
- **`mcp__claude-recall__retrieve_memory`**: Retrieve specific memory by ID
- **`mcp__claude-recall__get_stats`**: View memory statistics
- **`mcp__claude-recall__clear_context`**: Clear session context

## Intelligence & Evolution (v0.7.0+)

### Automatic Failure Learning

Claude Recall now **automatically captures failures with counterfactual reasoning**:
- **What failed**: The approach or action that didn't work
- **Why it failed**: Root cause analysis (file not found, permission denied, etc.)
- **What should be done instead**: Counterfactual suggestion (the right approach)
- **Preventative checks**: Steps to prevent the failure from recurring

**No manual storage needed** - failures are auto-detected from:
- Error messages and exceptions
- User corrections ("That didn't work", "Failed", "Error")

### Sophistication Tracking

Every memory is **automatically classified by sophistication level**:
- **L1 Procedural**: Basic tool use, simple actions
- **L2 Self-Reflection**: Error checking, corrections, learning from failures
- **L3 Adaptive**: Systematic workflows, devops patterns
- **L4 Compositional**: Multi-constraint reasoning, complex decision-making

View your agent's evolution: `npx claude-recall evolution`

### New CLI Commands (v0.7.0+)

**View memory evolution metrics:**
```bash
npx claude-recall evolution                    # Last 30 days
npx claude-recall evolution --days 60          # Last 60 days
npx claude-recall evolution --project my-app   # Filter by project
```

Shows:
- Progression score (0-100)
- Sophistication breakdown (L1-L4 percentages)
- Confidence trends (improving/stable/declining)
- Failure rate trends (improving/stable/worsening)

**View failure memories with counterfactual learning:**
```bash
npx claude-recall failures                     # Last 10 failures
npx claude-recall failures --limit 20          # Show 20 most recent
npx claude-recall failures --project my-app    # Filter by project
```

Shows:
- What failed and why
- What should have been done instead
- Preventative checks to avoid recurrence
- Alternative approaches to consider

## Memory Types

Memories are categorized by type (sorted by priority):

1. **correction**: User corrections - HIGHEST PRIORITY (user explicitly said "no, do this")
2. **preference**: User preferences (coding style, tool choices, conventions)
3. **success**: What worked in past tasks
4. **failure**: What didn't work (avoid these approaches)
5. **project-knowledge**: Project-specific info (configs, APIs, architecture)
6. **tool-use**: Tool execution history

## Example: Complete Learning Loop

### First Time - User States Preference

**User:** "I prefer Python for scripts"

**You (Claude Code):**
```
mcp__claude-recall__store_memory({
  content: "I prefer Python for scripts",
  metadata: { type: "preference", language: "python" }
})
```
Confirm: "✓ Stored preference"

### Second Time - User Requests Task

**User:** "Create a test script"

**You (Claude Code):**
```
1. Search: mcp__claude-recall__search("scripts python test preferences")
   Finds: "I prefer Python for scripts"

2. Create test.py (not test.sh) - applying preference

3. User responds: "Perfect!"

4. Store success: mcp__claude-recall__store_memory({
     content: "Created test script with Python - SUCCESS",
     metadata: { type: "success", task: "test_script" }
   })
```

### Third Time - Automatic Application

**User:** "Create a build script"

**You (Claude Code):**
```
1. Search: mcp__claude-recall__search("scripts build python")
   Finds:
   - "I prefer Python for scripts" (preference)
   - "Created test script with Python - SUCCESS" (validates preference)

2. Create build.py automatically - preference + success pattern!
   User doesn't have to repeat themselves ✓
```

### User Makes Correction

**User:** "No, put scripts in scripts/ directory not root"

**You (Claude Code):**
```
1. Store correction: mcp__claude-recall__store_memory({
     content: "CORRECTION: Scripts go in scripts/ directory not root",
     metadata: { type: "correction", priority: "high" }
   })

2. Move file immediately

3. Next time: Search finds correction and applies it automatically
```

## When to Store Memories

**Store immediately when user:**
- States a preference ("I prefer X", "Always use Y", "Never do Z")
- Makes a decision ("We're using X framework")
- Provides project info ("Our API uses X pattern")

**Store after task completion:**
- Success: "Created X with Y approach - SUCCESS"
- Failure: "Approach X failed - use Y instead"
- Correction: "CORRECTION: User prefers Y not X"

## Critical Guidelines

1. **Search before acting**: Always call `mcp__claude-recall__search` before file operations
2. **Never repeat questions**: If preference exists in search results, apply it automatically
3. **Capture outcomes**: Store success/failure/correction after tasks
4. **Prioritize corrections**: User explicitly fixed these - highest priority!
5. **Use broad search terms**: Include task type + language + preferences + success/failure/correction
6. **Close the loop**: Pre-action search → Execute → Post-action outcome storage

## Project Scoping (v0.7.2+)

Claude Recall now supports **project-specific memory isolation** to keep universal preferences separate from project-specific information.

### Three Memory Scopes

1. **Universal** (`scope='universal'`): Available in all projects
   - User says: "Remember everywhere: I prefer TypeScript with strict mode"
   - Stored as universal memory, accessible from any project

2. **Project** (`scope='project'`): Only available in current project
   - User says: "For this project, we use PostgreSQL"
   - Stored with project_id, only accessible from this project

3. **Unscoped** (`scope=null`, default): Available everywhere (backward compatible)
   - User says: "I prefer Jest for testing"
   - Stored without scope, works like v0.7.1 and earlier

### Auto-Detection

When storing memories, the system automatically detects scope from user language:

**Universal indicators**:
- "remember everywhere"
- "for all projects"
- "globally"
- "always use"

**Project indicators**:
- "for this project"
- "project-specific"
- "only here"
- "in this project"

**Default**: If no indicator, memory is unscoped (available everywhere)

### How Search Works

**Default behavior** (project + universal):
```
mcp__claude-recall__search("database")
```
Returns: Current project memories + universal memories + unscoped memories

**Global search** (all projects):
```
mcp__claude-recall__search("database", filters: { globalSearch: true })
```
Returns: All memories from all projects

### CLI Usage

```bash
# Current project stats
npx claude-recall stats

# Global stats (all projects)
npx claude-recall stats --global

# Search current project
npx claude-recall search "database"

# Search specific project
npx claude-recall search "database" --project my-app

# Search all projects
npx claude-recall search "database" --global
```

### Use Cases

**Universal memories**: Preferences that apply across all your work
- Coding style: "Always use TypeScript with strict mode"
- Tools: "Prefer Jest for testing"
- Conventions: "Name files with kebab-case"

**Project memories**: Project-specific details
- Database: "This project uses PostgreSQL"
- API: "Base URL is https://api.example.com"
- Build: "Run npm run build:prod for production"

## Advanced: Optional Context-Manager Agent

For complex multi-step research, a `context-manager` agent is available at `.claude/agents/context-manager.md`.

**When to use the agent (optional):**
- Complex workflows requiring multiple coordinated searches
- Multi-step research across different memory types
- Most tasks DON'T need it - direct MCP calls are faster

**For most tasks:** Use direct MCP search (fast, simple, effective)

## Integration with Development Workflow

Claude Recall creates a **learning loop**:
```
User states preference → Stored in database
↓
Task requested → Search finds preference
↓
Execute with preference → Apply automatically
↓
User approves/corrects → Outcome stored
↓
Next similar task → Search finds preference + outcome
↓
Apply automatically (learned pattern!)
↓
User never repeats themselves ✓
```

Data storage:
- Local SQLite database (`~/.claude-recall/claude-recall.db`)
- 100% local and private (no cloud sync)
- Export/import available: `npx claude-recall export/import`

## Troubleshooting

**If memories aren't being found:**
1. Verify MCP server: `claude mcp list` (should show `claude-recall`)
2. Test search: `npx claude-recall search "your query"`
3. Check stats: `npx claude-recall stats`

**If searches seem incomplete:**
- Use broad search terms: "authentication TypeScript success failure correction"
- Search returns all matching memories across all types
- Prioritize corrections > preferences > successes > failures

**If outcomes aren't being stored:**
- Make sure to call `mcp__claude-recall__store_memory` after task completion
- Include proper metadata (`type: "success"/"failure"/"correction"`)

---

**Remember:** The goal is making the user never repeat themselves. The learning loop (search → execute → store outcome) ensures preferences are remembered, successes are repeated, and failures are avoided. Fast direct MCP calls, no agent overhead!

---
name: "claude-recall-memory-management"
description: "Automatic memory capture and retrieval for Claude Recall MCP - ensures you never repeat yourself"
allowed-tools: "mcp__claude-recall__*"
version: "0.6.0"
priority: "highest"
search-first: true
license: "MIT"
---

# Claude Recall Memory Management

This Skill teaches Claude Code how to use Claude Recall's persistent memory system effectively. It ensures automatic capture of project context, devops workflows, and user preferences.

## Core Principle: Never Repeat Yourself

**The user should NEVER have to repeat preferences or explain what worked/didn't work.**

## Memory Types (Priority Order)

1. **DevOps** (Priority 0 - HIGHEST) - Project-specific workflows
   - Git conventions, testing approaches, build processes
   - Development environment setup
   - Architecture decisions, tech stack choices

2. **Corrections** (Priority 1) - User explicitly fixed mistakes
   - "No, do this instead" statements
   - Overrides previous approaches

3. **Preferences** (Priority 2) - User coding style, tool choices
   - Code style, framework preferences
   - File organization, naming conventions

4. **Success/Failure** (Priority 3) - What worked and what didn't
   - Successful implementations to repeat
   - Failed approaches to avoid

## Phase 1: Search Memories (REQUIRED FIRST STEP)

**CRITICAL - ALWAYS SEARCH FIRST**: Before file operations, decisions, or implementations, search memories to find existing context:

```
mcp__claude-recall__search("[task keywords] devops preferences success failure correction")
```

**Search-First Benefits** (from MCP code execution article):
- ✅ **Context efficiency**: Only load what you need (not all reference files)
- ✅ **Token savings**: Search results use fewer tokens than loading all patterns
- ✅ **Progressive disclosure**: Discover tools/patterns on-demand, not upfront

**When to load references:**
- ✅ If search found relevant memories → **Skip references**, use memories instead
- ✅ If search found nothing → Load appropriate reference file from `references/`

### Search Examples:

**Before creating authentication:**
```
mcp__claude-recall__search("authentication devops testing git")
```

**Before writing tests:**
```
mcp__claude-recall__search("testing tdd location framework")
```

**Before deployment tasks:**
```
mcp__claude-recall__search("deploy build docker git workflow")
```

### What Search Finds Automatically:

- **DevOps workflows**: Git branching, testing rules, deployment steps
- **Preferences**: User's stated coding style, tool choices
- **Successes**: Past approaches that worked well
- **Failures**: Past approaches that failed (avoid these!)
- **Corrections**: User fixes (HIGHEST PRIORITY - user explicitly said "no, do this")

## When to Store Memories

### Automatic Capture (v0.5.0+)

Claude Recall now **automatically captures** these patterns:

**DevOps Patterns** (Priority 0 - captured automatically):
- ✅ "This is a [project type]" → Project purpose
- ✅ "Built with [tech stack]" → Tech stack
- ✅ "We develop on [environment]" → Dev environment
- ✅ "Always [X] before [Y]" → Workflow rules
- ✅ "Use [X] for [Y]" → Tool choices
- ✅ "Tests go in [location]" → Testing conventions
- ✅ "Follow TDD" → Development approach

**Project Info** (captured automatically):
- ✅ "Tenant ID is X" → Configuration
- ✅ "API endpoint: X" → Endpoints
- ✅ "Our database is X" → Infrastructure

**Preferences** (captured automatically):
- ✅ "I prefer TypeScript" → Language preference
- ✅ "Always use Jest" → Tool preference
- ✅ "Never use semicolons" → Code style

### Manual Storage Required For:

Use `mcp__claude-recall__store_memory` for:

**Complex multi-step workflows:**
```
mcp__claude-recall__store_memory({
  content: "Deployment process: 1) Run tests 2) Build Docker 3) Push to ECR 4) Update k8s",
  metadata: { type: "devops", category: "deployment" }
})
```

**Lessons learned from failures:**
```
mcp__claude-recall__store_memory({
  content: "Session-based auth failed in production due to distributed sessions - use JWT instead",
  metadata: { type: "failure", lesson: "use_stateless_auth" }
})
```

**User corrections to your work:**
```
mcp__claude-recall__store_memory({
  content: "CORRECTION: Tests go in __tests__/ not tests/",
  metadata: { type: "correction", priority: "highest" }
})
```

## Privacy & Security: What NOT to Store

**NEVER store sensitive data in memories:**

❌ **Secrets**:
- API keys, access tokens, passwords
- Environment variables with `API_KEY`, `SECRET`, `PASSWORD`, `TOKEN`
- Private keys, certificates, credentials

❌ **Personal Identifiable Information (PII)**:
- Email addresses (personal or customer)
- Phone numbers
- Social Security Numbers, Tax IDs
- Credit card numbers, payment info

❌ **Sensitive Configuration**:
- Production database connection strings with passwords
- OAuth client secrets
- Webhook secrets, signing keys

✅ **Safe to store**:
- General architecture patterns ("We use JWT for auth")
- Tool choices ("We prefer PostgreSQL")
- Workflow rules ("Always run tests before commit")
- Non-sensitive configuration ("API base URL: https://api.example.com")

**Why this matters**: Memories are stored locally but could be exported or synced. Following privacy-by-default prevents accidental leaks.

**See** `references/privacy.md` for detailed examples and automatic filtering patterns.

## Check What's Captured

To see what memories have been automatically captured:

```
mcp__claude-recall__get_recent_captures({ limit: 10 })
```

This helps you verify that important project context was stored.

## Example Workflow

### First Time (User States Preference)

```
User: "I prefer Python for scripts"
[Auto-captured as preference]

User: "We use TDD for all new features"
[Auto-captured as devops workflow_rule, priority 0]

User: "This is a teleprompter tool for interviews"
[Auto-captured as devops project_purpose, priority 0]
```

### Second Time (First Use)

```
User: "Create a test script"

Step 1: Search memories
mcp__claude-recall__search("script test python")
Finds: "I prefer Python for scripts" + "We use TDD"

Step 2: Create test_script.py with TDD approach

Step 3: User approves → Store success
mcp__claude-recall__store_memory({
  content: "Created test script with Python + TDD - SUCCESS",
  metadata: { type: "success", task: "test_script" }
})
```

### Third Time (Automatic Application)

```
User: "Create a build script"

Step 1: Search memories
mcp__claude-recall__search("script build python tdd")
Finds:
- "I prefer Python for scripts" (preference)
- "We use TDD" (devops)
- "Created test script with Python + TDD - SUCCESS" (validates approach)

Step 2: Create build.py with tests automatically
User doesn't have to repeat preferences! ✓
```

## Best Practices

1. **Search broadly** - Include task type + language + workflow keywords
2. **Trust the learning loop** - Automatic capture handles most cases
3. **Store manually** for complex multi-step processes
4. **Check captures** periodically with `get_recent_captures`
5. **Correct immediately** - If output is wrong, tell me and it gets highest priority

## Troubleshooting

**If memories aren't being found:**
1. Check search query keywords - be broad
2. Verify memory exists: `mcp__claude-recall__get_recent_captures`
3. Search without type filters to see all results

**If automatic capture missed something:**
1. Use manual storage for that specific item
2. The pattern may not have matched - broader trigger words help

**For more examples (ONLY if search didn't help):**
- **Search first**, then load references only if needed
- `references/devops/` - Topic-specific DevOps patterns (git, testing, architecture, etc.)
- `references/capture-examples.md` - Manual storage templates
- `references/troubleshooting.md` - Common issues
- `references/privacy.md` - What NOT to store (secrets, PII)

---

**Remember**:
1. **ALWAYS search first** - Most efficient use of context
2. **Skip references if search succeeded** - Memories are more relevant than examples
3. **Trust automatic capture** - Handles most patterns
4. **The learning loop works best when you search before every task**

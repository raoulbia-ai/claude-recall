---
name: memory-management
description: Persistent memory for Claude across conversations. Use when starting any task, before writing or editing code, before making decisions, when user mentions preferences or conventions, when user corrects your work, or when completing a task that overcame challenges. Ensures Claude never repeats mistakes and always applies learned patterns.
version: "2.0.0"
license: "MIT"
---

# Memory Management

Persistent memory system that ensures Claude never repeats mistakes and always applies learned patterns across conversations.

## 2 Tools Only

- `mcp__claude-recall__load_rules` - Load all active rules before starting work. No query needed.
- `mcp__claude-recall__store_memory` - Store a rule or learning. Immediately active in this conversation.

## When to Use

- **Starting any task** - Call `load_rules` before Write, Edit, or significant Bash operations
- **When user corrects your work** - Call `store_memory` with `metadata.type: "correction"`
- **When user mentions preferences** - Call `store_memory` with `metadata.type: "preference"`
- **After overcoming a challenge** - Call `store_memory` with `metadata.type: "failure"`
- **DevOps/workflow rules** - Call `store_memory` with `metadata.type: "devops"`

## Key Directives

1. **ALWAYS load rules before acting** - Call `load_rules` before Write, Edit, or significant Bash operations
2. **Apply what you find** - Use retrieved preferences, patterns, and corrections
3. **Capture corrections immediately** - User fixes are highest priority
4. **Store learning cycles** - When you fail then succeed, that's valuable knowledge
5. **Never store secrets** - No API keys, passwords, tokens, or PII

## Quick Reference

### Load Rules (Before Every Task)

```
mcp__claude-recall__load_rules({})
```

Returns all active preferences, corrections, failures, and devops rules in one call. Deterministic and complete.

### Store Memory (When Something Important Happens)

```
mcp__claude-recall__store_memory({
  "content": "Description of what to remember",
  "metadata": { "type": "preference|correction|devops|failure" }
})
```

Returns the stored rule with an `activeRule` field and `_directive` to apply it immediately. No need to call `load_rules` again.

## Same-Session Rules

When you call `store_memory`, the response includes:
- `activeRule`: The stored content formatted as a rule
- `_directive`: Instructions to apply the rule immediately

This means rules stored mid-conversation are active right away without reloading.

## What Gets Stored

### Automatic Capture (You Don't Need to Store)

The system auto-captures when users say:
- "I prefer X" / "Always use X" / "Never do X" -> Preferences
- "We use X for Y" / "Tests go in X" -> Project conventions
- "This is a [type] project" -> Project context

### Manual Storage Required

Store these explicitly:

**Corrections** (highest priority):
```
User: "No, put tests in __tests__/ not tests/"
-> Store: "CORRECTION: Test files go in __tests__/ directory, not tests/"
   metadata: { "type": "correction" }
```

**Complex workflows**:
```
-> Store: "Deploy process: 1) npm test 2) docker build 3) push to ECR 4) kubectl apply"
   metadata: { "type": "devops" }
```

**Learning cycles** (fail -> fix -> success):
```
-> Store: "REST API failed due to CORS. Solution: Use GraphQL endpoint instead."
   metadata: { "type": "failure" }
```

## Memory Priority Order

1. **Corrections** - User explicitly fixed a mistake (HIGHEST)
2. **DevOps** - Git, testing, deploy, architecture patterns
3. **Preferences** - Code style, tool choices, conventions
4. **Failures** - Learning cycles and past mistakes

## What NOT to Store

Never store:
- API keys, tokens, passwords, secrets
- Personal emails, phone numbers, addresses
- Database connection strings with credentials
- Any sensitive configuration values

Safe to store:
- "We use JWT for auth" (pattern, not credentials)
- "API base URL is https://api.example.com" (non-sensitive)
- "PostgreSQL for production, SQLite for tests" (tool choice)

## Example Workflows

### Starting a New Task

```
1. User: "Add user authentication"

2. Load rules first:
   mcp__claude-recall__load_rules({})

3. Response includes:
   ## Preferences
   - auth_method: JWT with httpOnly cookies
   ## Corrections
   - Never use localStorage for auth tokens

4. Implement using JWT + httpOnly cookies (not sessions, not localStorage)

5. User approves -> Done (no need to store, just applied existing knowledge)
```

### User Corrects Your Work

```
1. You: Created auth with localStorage tokens

2. User: "No, we always use httpOnly cookies for security"

3. Fix the code

4. Store the correction:
   mcp__claude-recall__store_memory({
     "content": "CORRECTION: Always use httpOnly cookies for auth tokens, never localStorage",
     "metadata": { "type": "correction" }
   })

5. Response includes activeRule - apply it immediately
```

### Overcoming a Challenge

```
1. Tried: Redis sessions for auth
   Failed: "Session sync issues in k8s cluster"

2. User suggested: "Try stateless JWT"

3. Implemented JWT -> Works!

4. Store the learning:
   mcp__claude-recall__store_memory({
     "content": "Auth in k8s: Redis sessions failed (sync issues). JWT stateless tokens work correctly.",
     "metadata": { "type": "failure", "learning_cycle": true }
   })
```

## Inline Citations

When `load_rules` returns memories, the response includes a `_citationDirective` instructing you to cite any memory you actually apply. When you use a retrieved memory in your work, add a brief inline note:

> (applied from memory: always use httpOnly cookies for auth tokens)

This gives the user visibility into which stored knowledge is influencing your decisions. Only cite memories you actually use.

To disable citations, set the environment variable `CLAUDE_RECALL_CITE_MEMORIES=false`.

## Troubleshooting

**Load rules returns nothing:**
- This may be a new project with no history yet
- Store rules as you learn them with `store_memory`

**Automatic capture missed something:**
- Store it manually with appropriate type
- Future `load_rules` calls will find it

---

**The Learning Loop**: Load rules -> Apply -> Execute -> Capture outcomes -> Better next time

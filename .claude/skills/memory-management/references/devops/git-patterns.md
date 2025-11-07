# Git Workflow Patterns

Patterns for capturing git branching, commit conventions, and version control workflows.

## Git Workflow Examples

**Automatically Captured:**
- "Use feature branches from main"
- "Commit messages follow conventional commits format"
- "Squash before merging to main"
- "Create PR from feature branch for review"
- "Use GitFlow branching strategy"
- "Feature branches from develop, hotfixes from main"

**Stored As:**
```json
{
  "type": "devops",
  "category": "git_workflow",
  "value": "feature branches from main",
  "confidence": 0.9
}
```

## Commit Message Conventions

**Automatically Captured:**
- "Use conventional commits (feat:, fix:, docs:)"
- "Commit messages must be descriptive"
- "Add Jira ticket number to commits"
- "Sign all commits with GPG"

**Examples:**
```
✅ "Commits follow conventional commits format"
   → Stored as git_workflow pattern

✅ "Always include ticket number in commit message"
   → Stored as workflow_rule with high confidence

✅ "Use imperative mood in commit messages"
   → Stored as git_workflow pattern
```

## Branching Strategies

**Automatically Captured:**
- "Never commit to main directly"
- "Always create feature branches from develop"
- "Use release branches for production deploys"
- "Hotfix branches go directly to main"

**Examples:**
```
✅ "Feature branches from main"
✅ "Use develop as integration branch"
✅ "Release branches cut from develop"
✅ "Hotfixes branch from main, merge to main and develop"
```

## PR/Review Workflows

**Automatically Captured:**
- "Require 2 approvals before merge"
- "Must pass CI before merging"
- "Squash and merge to keep history clean"
- "Delete branch after merge"

**Examples:**
```
✅ "All PRs need code review"
✅ "Squash commits before merging"
✅ "Rebase feature branches before PR"
✅ "Linear history preferred"
```

## Complex Git Workflow Example

**User States:**
```
"Our git workflow:
1. Create feature branch from main (feature/JIRA-123)
2. Commit with conventional format: 'feat(api): add user endpoint'
3. Push and create PR
4. Wait for CI (tests + linting)
5. Get 2 approvals
6. Squash and merge to main
7. Delete feature branch"
```

**Store Manually for Multi-Step:**
```javascript
mcp__claude-recall__store_memory({
  content: `Git workflow:
1. Feature branch from main (feature/JIRA-XXX)
2. Conventional commits (feat/fix/docs)
3. Create PR
4. Wait for CI (tests + lint)
5. Get 2 approvals
6. Squash merge to main
7. Delete branch`,
  metadata: {
    type: "devops",
    category: "git_workflow",
    steps: 7
  }
})
```

## Confidence Boosters

These keywords increase confidence for git patterns:

- **Strong**: "always", "never", "must"
- **Explicit**: "main", "develop", "feature", "hotfix"
- **Tools**: "GitHub", "GitLab", "Bitbucket"
- **Actions**: "merge", "rebase", "squash", "branch"

**Example:**
- "use feature branches" → 70% confidence
- "always use feature branches" → 90% confidence
- "team always creates feature branches from main" → 95% confidence

## What Won't Be Captured

❌ "Maybe use git flow" (uncertain)
❌ "I think we should squash" (suggestion)
❌ "Could try rebasing" (possibility)
❌ "What about feature branches?" (question)

**Make it explicit:**
✅ "Use git flow"
✅ "Squash commits before merging"
✅ "Rebase feature branches"
✅ "Create feature branches from main"

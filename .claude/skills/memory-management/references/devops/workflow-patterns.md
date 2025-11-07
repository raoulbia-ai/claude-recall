# Workflow & Environment Patterns

Patterns for capturing development workflows, team rules, and environment setup.

## Workflow Rule Examples

**Automatically Captured:**
- "Always run tests before committing"
- "Must lint code before pushing"
- "Never commit to main directly"
- "Always create feature branches from develop"
- "Code review required for all changes"
- "Update documentation with code changes"

**Stored As:**
```json
{
  "type": "devops",
  "category": "workflow_rule",
  "value": "run tests before committing",
  "confidence": 0.95
}
```

## Dev Environment Examples

**Automatically Captured:**
- "We develop on WSL for backend, Windows for audio testing"
- "Use Docker for local development"
- "Code on macOS, deploy to Linux"
- "Development environment is Ubuntu 22.04"
- "Develop in VS Code with Remote Containers"

**Stored As:**
```json
{
  "type": "devops",
  "category": "dev_environment",
  "value": "WSL for backend, Windows for audio testing",
  "confidence": 0.9
}
```

## Code Quality Rules

**Automatically Captured:**
- "Always format code with Prettier"
- "Run ESLint before commit"
- "Use Black for Python formatting"
- "Must pass type checking"
- "No warnings allowed in production build"

**Examples:**
```
✅ "Format with Prettier on save"
✅ "ESLint must pass before push"
✅ "Type check with TypeScript strict mode"
✅ "Zero linter warnings policy"
```

## Pre-Commit Hooks

**Automatically Captured:**
- "Husky runs tests pre-commit"
- "Pre-commit hook for linting"
- "Run formatter before commit"
- "Validate commit message format"

**Examples:**
```
✅ "Pre-commit runs lint and test"
✅ "Husky enforces conventional commits"
✅ "Format code automatically on commit"
✅ "Pre-push runs full test suite"
```

## Development Tools

**Automatically Captured:**
- "Use VS Code for development"
- "Docker Compose for local services"
- "Postman for API testing"
- "pgAdmin for database management"
- "Redux DevTools for state debugging"

**Examples:**
```
✅ "VS Code with ESLint extension"
✅ "Docker Compose runs all dependencies"
✅ "Use Insomnia for API testing"
✅ "DBeaver for database access"
```

## Local Environment Setup

**Automatically Captured:**
- "Node.js 18+ required for development"
- "Install pnpm globally"
- "Docker Desktop must be running"
- "Environment variables in .env.local"

**Examples:**
```
✅ "Requires Node 18 and pnpm"
✅ "Use .env.local for local config"
✅ "Docker and docker-compose required"
✅ "Python 3.11+ with venv"
```

## Team Conventions

**Automatically Captured:**
- "Daily standups at 9 AM"
- "Sprint planning every 2 weeks"
- "Code freeze Friday afternoon"
- "Deploy to staging on Tuesday"
- "Production deploys require team lead approval"

**Examples:**
```
✅ "No deploys on Friday"
✅ "Code review within 24 hours"
✅ "Production changes need approval"
✅ "Pair programming for complex features"
```

## Documentation Rules

**Automatically Captured:**
- "Update README with new features"
- "JSDoc comments required for public APIs"
- "Keep CHANGELOG.md current"
- "Document breaking changes"

**Examples:**
```
✅ "JSDoc all exported functions"
✅ "Update docs with code changes"
✅ "CHANGELOG follows keep-a-changelog format"
✅ "ADRs for architecture decisions"
```

## Environment-Specific Rules

**Automatically Captured:**
- "Development uses mock data"
- "Staging mirrors production config"
- "Local DB runs in Docker"
- "Production uses managed services"

**Examples:**
```
✅ "Dev environment has seeded data"
✅ "Staging uses production-like setup"
✅ "Local uses Docker PostgreSQL"
✅ "Production on AWS RDS"
```

## Complex Workflow Example

**User States:**
```
"Our daily workflow:
1. Pull latest from main
2. Create feature branch (feature/TASK-123)
3. Make changes, commit frequently
4. Run tests locally before pushing
5. Push and create PR
6. Wait for CI (lint + test + build)
7. Request code review from 2 teammates
8. Address review comments
9. Squash and merge after approval
10. Delete feature branch"
```

**Store Manually for Multi-Step:**
```javascript
mcp__claude-recall__store_memory({
  content: `Daily workflow:
1. Pull main
2. Feature branch (feature/TASK-XXX)
3. Commit frequently
4. Test locally before push
5. Create PR
6. Wait for CI
7. Get 2 code reviews
8. Address feedback
9. Squash merge
10. Delete branch`,
  metadata: {
    type: "devops",
    category: "workflow_rule",
    steps: 10,
    reviews_required: 2
  }
})
```

## Onboarding Workflows

**Automatically Captured:**
- "New devs pair with senior for first week"
- "Complete onboarding checklist"
- "Read architecture docs first"
- "Set up dev environment from README"

**Examples:**
```
✅ "New team members shadow for 1 week"
✅ "Onboarding includes codebase tour"
✅ "First PR is documentation improvement"
✅ "Dev setup automated with script"
```

## Confidence Boosters

These keywords increase confidence for workflow patterns:

- **Strong**: "always", "never", "must", "required"
- **Team context**: "our", "we", "team"
- **Explicit tools**: "Docker", "VS Code", "ESLint"
- **Actions**: "run", "check", "validate", "deploy"

**Example:**
- "use Docker" → 65% confidence
- "always use Docker" → 85% confidence
- "our team always uses Docker for local development" → 95% confidence
- "development environment requires Docker and Docker Compose" → 97% confidence

## What Won't Be Captured

❌ "Maybe run tests" (uncertain)
❌ "Should we use Docker?" (question)
❌ "Consider linting" (vague)
❌ "Tests might help" (uncertain)

**Make it explicit:**
✅ "Run tests before commit"
✅ "Use Docker for local development"
✅ "Lint all code before push"
✅ "Format with Prettier"

## Workflow Anti-Patterns to Store

**Automatically Captured:**
- "Never push directly to main"
- "Don't skip code review"
- "Avoid committing commented-out code"
- "No console.log in production"

**Examples:**
```
✅ "Never bypass CI checks"
✅ "Don't commit secrets"
✅ "No force push to shared branches"
✅ "Avoid long-lived feature branches"
```

## Cross-Platform Development

**Automatically Captured:**
- "Develop on Mac, deploy to Linux"
- "Windows developers use WSL2"
- "Cross-platform compatibility required"
- "Test on all target platforms"

**Examples:**
```
✅ "Devs use Mac/Windows, production is Linux"
✅ "WSL2 for Windows development"
✅ "CI tests on Linux, Mac, Windows"
✅ "Use cross-platform tools only"
```

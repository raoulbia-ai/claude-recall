# DevOps Memory Patterns

This document provides examples of DevOps-related memories that Claude Recall automatically captures.

## Project Purpose Examples

**Automatically Captured:**
- "This is a teleprompter tool for interviews"
- "This is a REST API for user management"
- "Building a chat application with real-time messaging"
- "Creating an e-commerce platform"

**Stored As:**
```json
{
  "type": "devops",
  "category": "project_purpose",
  "value": "teleprompter tool for interviews",
  "confidence": 0.85
}
```

## Tech Stack Examples

**Automatically Captured:**
- "Built with Python and Electron"
- "Uses React + TypeScript for frontend"
- "Backend is FastAPI with PostgreSQL"
- "Frontend framework is Vue.js"

**Stored As:**
```json
{
  "type": "devops",
  "category": "tech_stack",
  "value": "Python and Electron",
  "confidence": 0.85
}
```

## Dev Environment Examples

**Automatically Captured:**
- "We develop on WSL for backend, Windows for audio testing"
- "Use Docker for local development"
- "Code on macOS, deploy to Linux"
- "Development environment is Ubuntu 22.04"

**Stored As:**
```json
{
  "type": "devops",
  "category": "dev_environment",
  "value": "WSL for backend, Windows for audio testing",
  "confidence": 0.9
}
```

## Workflow Rule Examples

**Automatically Captured:**
- "Always run tests before committing"
- "Must lint code before pushing"
- "Never commit to main directly"
- "Always create feature branches from develop"

**Stored As:**
```json
{
  "type": "devops",
  "category": "workflow_rule",
  "value": "run tests before committing",
  "confidence": 0.95
}
```

## Git Workflow Examples

**Automatically Captured:**
- "Use feature branches from main"
- "Commit messages follow conventional commits format"
- "Squash before merging to main"
- "Create PR from feature branch for review"

**Stored As:**
```json
{
  "type": "devops",
  "category": "git_workflow",
  "value": "feature branches from main",
  "confidence": 0.9
}
```

## Testing Approach Examples

**Automatically Captured:**
- "We use TDD for all new features"
- "Tests go in __tests__/ directory"
- "Write tests first, then implementation"
- "Follow BDD with Cucumber"
- "Tests must achieve 80% coverage"

**Stored As:**
```json
{
  "type": "devops",
  "category": "testing_approach",
  "value": "TDD for all new features",
  "confidence": 0.95
}
```

## Architecture Examples

**Automatically Captured:**
- "Uses microservices architecture"
- "Follows event-driven pattern"
- "We use MVC design pattern"
- "Built with serverless architecture"

**Stored As:**
```json
{
  "type": "devops",
  "category": "architecture",
  "value": "microservices architecture",
  "confidence": 0.85
}
```

## Dependency Examples

**Automatically Captured:**
- "Requires Blue Yeti microphone"
- "Depends on Redis for caching"
- "Requires Python 3.11+"
- "Needs Docker and docker-compose"

**Stored As:**
```json
{
  "type": "devops",
  "category": "dependency",
  "value": "Blue Yeti microphone",
  "confidence": 0.8
}
```

## Build/Deploy Examples

**Automatically Captured:**
- "Build with npm run build"
- "Deploy using Docker"
- "Run with docker-compose up"
- "CI/CD pipeline uses GitHub Actions"

**Stored As:**
```json
{
  "type": "devops",
  "category": "build_deploy",
  "value": "npm run build",
  "confidence": 0.85
}
```

## Complex Multi-Step Example

**User States:**
```
"Our deployment process:
1. Run full test suite on feature branch
2. Create PR to main
3. Wait for CI to pass (linting + tests + build)
4. Get approval from 2 reviewers
5. Squash and merge to main
6. Automatic deploy to staging via GitHub Actions
7. Manual promotion to production after QA sign-off"
```

**This Complex Workflow Should Be Stored Manually:**
```javascript
mcp__claude-recall__store_memory({
  content: `Deployment process:
1. Run tests on feature branch
2. Create PR to main
3. Wait for CI (lint/test/build)
4. Get 2 approvals
5. Squash merge to main
6. Auto-deploy to staging
7. Manual production promotion after QA`,
  metadata: {
    type: "devops",
    category: "deployment",
    steps: 7
  }
})
```

## Negative Examples (Won't Be Captured)

These phrases are too vague and won't trigger automatic capture:

❌ "Maybe use React" (uncertain - no confidence)
❌ "I think we should..." (uncertain)
❌ "Could try Docker" (suggestion, not decision)
❌ "What about TypeScript?" (question, not statement)

**To capture these, be explicit:**
✅ "Use React for frontend"
✅ "We're using TypeScript"
✅ "Deploy with Docker"

## Confidence Boosters

These keywords increase confidence and ensure capture:

- **Strong**: "always", "never", "must"
- **Team context**: "our", "we", "team"
- **Explicit**: "TDD", "CI/CD", specific tool names
- **Decision**: "decided", "using", "follow"

**Example:**
- "use docker" → 70% confidence
- "always use docker" → 90% confidence
- "our team always uses docker for deployments" → 95% confidence

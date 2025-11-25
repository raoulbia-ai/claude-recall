# Manual Memory Capture Examples

This document provides templates for manually storing memories when automatic capture isn't sufficient.

## When to Use Manual Storage

Use `mcp__claude-recall__store_memory` when:
- **User corrects your work** (highest priority)
- **Learning cycles** - When you overcame a challenge (tried A, failed, then B worked)
- **Complex multi-step workflows** need to be documented
- **Nuanced context** that automatic capture might miss

**DO NOT** use for:
- Trivial successes (file creation, simple tool execution)
- First-try successes with no challenges
- Actions that just followed existing preferences

## Success Examples (Learning Cycles Only!)

**IMPORTANT**: Only store success memories when there was a **learning cycle** - you tried something, it failed, then another approach worked. This captures valuable insights, not trivial actions.

### Learning Cycle: Authentication Approach
```javascript
// ✓ Store this - overcame a challenge
mcp__claude-recall__store_memory({
  content: "Tried session-based auth with cookies (FAILED - CORS issues in distributed API). Switched to JWT tokens with Bearer auth - SUCCESS. JWT works better for stateless architecture.",
  metadata: {
    type: "success",
    task: "authentication",
    learning_cycle: true,
    failed_approach: "session_cookies",
    working_approach: "jwt_bearer"
  }
})
```

### Learning Cycle: Audio Capture Strategy
```javascript
// ✓ Store this - iterated to find the right solution
mcp__claude-recall__store_memory({
  content: "Continuous VAD approach failed (too CPU intensive). Tried buffering (FAILED - lag issues). Implemented push-to-talk with pyaudio - SUCCESS. Much better performance and UX control.",
  metadata: {
    type: "success",
    task: "audio_capture",
    learning_cycle: true,
    improvement: "performance + ux"
  }
})
```

### Learning Cycle: Performance Fix
```javascript
// ✓ Store this - debugging led to solution
mcp__claude-recall__store_memory({
  content: "Memory leak investigation: Tried garbage collection tuning (no effect). Checked event listeners (not the issue). Found PyAudio initialization inside loop - moved outside - SUCCESS. Memory dropped 500MB → 50MB.",
  metadata: {
    type: "success",
    task: "performance",
    learning_cycle: true,
    metric: "10x memory reduction"
  }
})
```

### ✗ DON'T Store Trivial Success
```javascript
// ✗ DON'T store this - no challenge, just basic tool execution
mcp__claude-recall__store_memory({
  content: "Created authentication module with JWT - SUCCESS",
  metadata: { type: "success", task: "authentication" }
})
// Why not? No failure, no iteration, no learning cycle.
```

## Failure Examples

### Basic Failure
```javascript
mcp__claude-recall__store_memory({
  content: "Session-based authentication failed in distributed environment - use stateless JWT instead",
  metadata: { type: "failure", avoid: "session_auth_distributed" }
})
```

### Failure with Root Cause
```javascript
mcp__claude-recall__store_memory({
  content: "Continuous VAD approach failed - too CPU intensive, poor UX. Root cause: processing audio every frame. Solution: Use push-to-talk instead.",
  metadata: {
    type: "failure",
    root_cause: "continuous_processing",
    solution: "push_to_talk"
  }
})
```

### Failure with Lesson Learned
```javascript
mcp__claude-recall__store_memory({
  content: "Tried mock audio files for testing but they don't match real mic behavior. Lesson: Need actual microphone for audio tests, can't fully mock.",
  metadata: {
    type: "failure",
    lesson: "use_real_hardware_for_audio_tests"
  }
})
```

## Correction Examples

### Basic Correction
```javascript
mcp__claude-recall__store_memory({
  content: "CORRECTION: Tests go in __tests__/ directory, not tests/",
  metadata: { type: "correction", priority: "highest" }
})
```

### Correction with Rationale
```javascript
mcp__claude-recall__store_memory({
  content: "CORRECTION: Use 4 spaces for indentation, not tabs. Reason: Project convention for Python files.",
  metadata: {
    type: "correction",
    priority: "highest",
    language: "python"
  }
})
```

### Correction Overriding Previous Approach
```javascript
mcp__claude-recall__store_memory({
  content: "CORRECTION: Don't use Docker for local development, use virtual environment instead. Docker adds unnecessary complexity for this project.",
  metadata: {
    type: "correction",
    priority: "highest",
    overrides: "docker_local_dev"
  }
})
```

## DevOps Workflow Examples

### Deployment Process
```javascript
mcp__claude-recall__store_memory({
  content: `Deployment workflow:
1. Create feature branch from main
2. Run tests locally: npm test
3. Create PR with conventional commit message
4. Wait for CI (lint + test + build)
5. Get 2 code review approvals
6. Squash merge to main
7. GitHub Actions auto-deploys to staging
8. QA approval required for production
9. Promote to prod: kubectl apply -f k8s/prod/`,
  metadata: {
    type: "devops",
    category: "deployment",
    steps: 9,
    tools: ["github-actions", "kubernetes"]
  }
})
```

### Testing Strategy
```javascript
mcp__claude-recall__store_memory({
  content: `Testing strategy:
- Unit tests: Jest, 80% coverage minimum
- Integration tests: Supertest for API
- E2E tests: Playwright for UI
- Run order: unit → integration → e2e
- CI runs all, but devs can run unit tests locally`,
  metadata: {
    type: "devops",
    category: "testing_strategy",
    tools: ["jest", "supertest", "playwright"]
  }
})
```

### Git Branching Strategy
```javascript
mcp__claude-recall__store_memory({
  content: `Git workflow (GitFlow variant):
- main: production-ready code
- develop: integration branch
- feature/*: new features (from develop)
- bugfix/*: bug fixes (from develop)
- hotfix/*: emergency production fixes (from main)
- Merge: feature → develop → main
- Release: tag main with semver`,
  metadata: {
    type: "devops",
    category: "git_workflow",
    strategy: "gitflow"
  }
})
```

## Project Knowledge Examples

### API Configuration
```javascript
mcp__claude-recall__store_memory({
  content: "API configuration: Base URL https://api.example.com/v1, Auth header: Bearer token, Rate limit: 100 req/min",
  metadata: {
    type: "project-knowledge",
    category: "api_config"
  }
})
```

### Database Setup
```javascript
mcp__claude-recall__store_memory({
  content: "Database: PostgreSQL 15 on RDS. Connection pooling: 20 connections. Migrations: Alembic. Backup: Daily at 2 AM UTC.",
  metadata: {
    type: "project-knowledge",
    category: "database"
  }
})
```

### Environment Variables
```javascript
mcp__claude-recall__store_memory({
  content: `Required environment variables:
- DATABASE_URL: postgres connection string
- REDIS_URL: redis://localhost:6379
- JWT_SECRET: from 1Password
- AWS_REGION: us-east-1
- LOG_LEVEL: info (prod) or debug (dev)`,
  metadata: {
    type: "project-knowledge",
    category: "env_vars"
  }
})
```

## Complex Decision Examples

### Architecture Decision
```javascript
mcp__claude-recall__store_memory({
  content: `Decided on microservices architecture:
- User Service: authentication, profiles
- Product Service: catalog, inventory
- Order Service: cart, checkout, payments
- Communication: Event bus (RabbitMQ)
- API Gateway: Kong
- Reason: Team scaling, independent deployment`,
  metadata: {
    type: "devops",
    category: "architecture",
    pattern: "microservices",
    decision_date: "2025-01-15"
  }
})
```

### Technology Choice
```javascript
mcp__claude-recall__store_memory({
  content: `Chose TypeScript over JavaScript:
- Type safety reduces runtime errors
- Better IDE support
- Easier refactoring
- Team already familiar
- Strict mode enabled for all files`,
  metadata: {
    type: "devops",
    category: "tech_choice",
    language: "typescript"
  }
})
```

## Preference Override Examples

### Updating Previous Preference
```javascript
mcp__claude-recall__store_memory({
  content: "FROM NOW ON: Use Vitest instead of Jest for new projects. Vitest is faster and has better ESM support.",
  metadata: {
    type: "preference",
    category: "testing_framework",
    overrides: "jest",
    reason: "performance"
  }
})
```

### Changing Workflow
```javascript
mcp__claude-recall__store_memory({
  content: "UPDATED WORKFLOW: Now we're using trunk-based development instead of GitFlow. Feature flags for incomplete features. Direct commits to main allowed with CI passing.",
  metadata: {
    type: "devops",
    category: "git_workflow",
    overrides: "gitflow",
    change_date: "2025-01-15"
  }
})
```

## Template for Any Memory

```javascript
mcp__claude-recall__store_memory({
  content: "[Clear, concise description of what you learned/decided]",
  metadata: {
    type: "[devops|preference|success|failure|correction|project-knowledge]",
    category: "[specific category]",
    // Optional fields:
    priority: "[highest|high|medium|low]",
    overrides: "[what this replaces]",
    tools: ["tool1", "tool2"],
    confidence: 0.85,
    // Any other relevant context
  }
})
```

## Best Practices

1. **Be specific** - "Created auth with JWT" is better than "Made login work"
2. **Include context** - Why did it work? What was the problem?
3. **Add metadata** - Helps future searches find relevant memories
4. **Use consistent types** - Stick to the standard types (devops, preference, etc.)
5. **Override explicitly** - If changing previous decision, note what it overrides
6. **Include tools/versions** - Helps when debugging version-specific issues

# DevOps Patterns - Topic Index

This directory contains **topic-specific** DevOps memory pattern examples. Load only the files you need for your current task.

## Progressive Disclosure: Load Only What You Need

**DON'T load all files** - This defeats the purpose of progressive disclosure!

**DO search memories first:**
```
mcp__claude-recall__search("git workflow testing deployment")
```

**ONLY load specific files if search didn't help:**

## Available Topics

### 1. Project Identity (`project-identity.md`)
Load when working on:
- Understanding what the project is
- Tech stack questions
- Dependency requirements

**Contains:**
- Project purpose patterns
- Tech stack examples
- Dependency declarations

### 2. Git Workflows (`git-patterns.md`)
Load when working on:
- Git branching strategies
- Commit message conventions
- PR/review workflows

**Contains:**
- Branching strategies (GitFlow, trunk-based, etc.)
- Commit conventions (conventional commits, etc.)
- PR and review processes

### 3. Testing Strategies (`testing-patterns.md`)
Load when working on:
- Test organization
- Testing frameworks
- Coverage requirements

**Contains:**
- TDD, BDD methodologies
- Test framework choices
- Coverage rules
- Test organization

### 4. Architecture (`architecture-patterns.md`)
Load when working on:
- System design decisions
- Design patterns
- Integration patterns

**Contains:**
- Architecture styles (microservices, monolith, etc.)
- Design patterns (repository, factory, etc.)
- Communication patterns (REST, GraphQL, events)
- Scalability and resilience patterns

### 5. Workflow & Environment (`workflow-patterns.md`)
Load when working on:
- Development environment setup
- Team workflow rules
- Code quality standards

**Contains:**
- Workflow rules (pre-commit hooks, etc.)
- Dev environment setup
- Code quality tools
- Team conventions

### 6. Build & Deploy (`build-deploy-patterns.md`)
Load when working on:
- Build processes
- CI/CD pipelines
- Deployment strategies

**Contains:**
- Build tools and processes
- CI/CD configurations
- Deployment strategies
- Infrastructure as code

## Usage Examples

### Example 1: Git Task
```
User: "Create a feature branch for the new API"

Step 1: Search memories
mcp__claude-recall__search("git branch workflow feature")

Step 2a: If search found results → Use memories (SKIP loading git-patterns.md)
Step 2b: If search found nothing → Load git-patterns.md for examples
```

### Example 2: Testing Task
```
User: "Add tests for the user service"

Step 1: Search memories
mcp__claude-recall__search("testing tdd location framework")

Step 2a: If search found results → Use memories (SKIP loading testing-patterns.md)
Step 2b: If search found nothing → Load testing-patterns.md for examples
```

### Example 3: Deployment Task
```
User: "Deploy to staging"

Step 1: Search memories
mcp__claude-recall__search("deploy staging ci cd workflow")

Step 2a: If search found results → Use memories (SKIP loading build-deploy-patterns.md)
Step 2b: If search found nothing → Load build-deploy-patterns.md for examples
```

## Token Efficiency

**Loading all files: ~8,000 tokens**
**Loading one file: ~1,500 tokens**
**Search results: ~500 tokens**

**Best practice: Search first, load only if needed!**

## When to Load Multiple Files

Only load multiple files when working on cross-cutting concerns:

```
Task: "Set up new project from scratch"
Relevant files:
- project-identity.md (tech stack)
- workflow-patterns.md (dev environment)
- git-patterns.md (git setup)
- testing-patterns.md (test framework)

BUT: Still search first! Existing memories might cover everything.
```

## File Selection Guide

| Your Task | Search Query | If No Results → Load |
|-----------|--------------|---------------------|
| Create feature branch | `git branch feature workflow` | `git-patterns.md` |
| Add tests | `testing tdd location framework` | `testing-patterns.md` |
| Deploy to production | `deploy production ci cd` | `build-deploy-patterns.md` |
| Design new service | `architecture microservices api` | `architecture-patterns.md` |
| Set up dev environment | `dev environment docker local` | `workflow-patterns.md` |
| Understand project | `project purpose tech stack` | `project-identity.md` |

## Remember

1. **Search memories FIRST** - Most efficient
2. **Load specific file if search failed** - Progressive disclosure
3. **Don't load all files** - Wastes tokens
4. **One file at a time** - Unless cross-cutting concern

---

**See parent `SKILL.md` for complete learning loop workflow.**

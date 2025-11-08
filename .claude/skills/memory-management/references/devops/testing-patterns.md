# Testing Approach Patterns

Patterns for capturing testing strategies, frameworks, and quality requirements.

## Testing Approach Examples

**Automatically Captured:**
- "We use TDD for all new features"
- "Tests go in __tests__/ directory"
- "Write tests first, then implementation"
- "Follow BDD with Cucumber"
- "Tests must achieve 80% coverage"
- "Integration tests run in CI only"
- "Unit tests for all business logic"

**Stored As:**
```json
{
  "type": "devops",
  "category": "testing_approach",
  "value": "TDD for all new features",
  "confidence": 0.95
}
```

## Testing Framework Patterns

**Automatically Captured:**
- "Use Jest for unit tests"
- "Playwright for E2E testing"
- "pytest for Python tests"
- "RSpec for Ruby testing"

**Examples:**
```
✅ "Jest for unit tests, Playwright for E2E"
✅ "pytest with coverage reporting"
✅ "Mocha + Chai for backend tests"
✅ "React Testing Library for components"
```

## Test Organization

**Automatically Captured:**
- "Tests go in __tests__/ directory"
- "Colocate tests with source files"
- "tests/ folder at project root"
- "Unit tests in test/unit/, integration in test/integration/"

**Examples:**
```
✅ "Tests in __tests__/ next to source files"
✅ "tests/ directory mirrors src/ structure"
✅ "Separate unit and integration test directories"
```

## Test Coverage Requirements

**Automatically Captured:**
- "Maintain 80% code coverage"
- "100% coverage for critical paths"
- "Coverage must not decrease"
- "All PRs require test coverage"

**Examples:**
```
✅ "80% coverage minimum"
✅ "Tests required for all new code"
✅ "Coverage gate in CI pipeline"
✅ "100% coverage for auth module"
```

## Testing Methodologies

**Automatically Captured:**
- "Follow TDD (test-driven development)"
- "Use BDD (behavior-driven development)"
- "Property-based testing for utils"
- "Snapshot testing for UI components"

**Examples:**
```
✅ "TDD for all features"
✅ "BDD scenarios in Cucumber"
✅ "Snapshot tests for React components"
✅ "Property tests for pure functions"
```

## Test Execution Rules

**Automatically Captured:**
- "Run tests before committing"
- "CI must pass before merge"
- "E2E tests run nightly"
- "Load tests before production deploy"

**Examples:**
```
✅ "Always run tests before commit"
✅ "Unit tests run on every push"
✅ "Integration tests in CI only"
✅ "E2E tests before production deploy"
```

## Complex Testing Workflow Example

**User States:**
```
"Our testing process:
1. Write failing test first (TDD)
2. Implement minimum code to pass
3. Refactor while keeping tests green
4. Run full test suite locally
5. Push and let CI run tests
6. Coverage must be >80%
7. E2E tests run in staging environment"
```

**Store Manually for Multi-Step:**
```javascript
mcp__claude-recall__store_memory({
  content: `Testing process:
1. Write failing test (TDD)
2. Implement to pass
3. Refactor
4. Run full suite locally
5. CI runs all tests
6. Coverage gate at 80%
7. E2E in staging`,
  metadata: {
    type: "devops",
    category: "testing_approach",
    methodology: "TDD",
    steps: 7
  }
})
```

## Test Types

**Automatically Captured:**
- "Unit tests for business logic"
- "Integration tests for API endpoints"
- "E2E tests for critical user flows"
- "Smoke tests after deployment"
- "Performance tests for high-traffic endpoints"

**Examples:**
```
✅ "Unit tests for all services"
✅ "Integration tests use test database"
✅ "E2E tests with Playwright"
✅ "Load tests with k6"
```

## Confidence Boosters

These keywords increase confidence for testing patterns:

- **Strong**: "always", "never", "must", "require"
- **Methodologies**: "TDD", "BDD", "unit", "integration", "E2E"
- **Tools**: "Jest", "pytest", "Playwright", "Cypress"
- **Metrics**: "coverage", "80%", "100%"

**Example:**
- "use tests" → 60% confidence
- "write tests first" → 80% confidence
- "always use TDD for new features" → 95% confidence
- "our team requires 80% test coverage" → 98% confidence

## What Won't Be Captured

❌ "Maybe write tests" (uncertain)
❌ "Should we use TDD?" (question)
❌ "Consider testing" (vague)
❌ "Tests might be useful" (uncertain)

**Make it explicit:**
✅ "Use TDD"
✅ "Write tests for all features"
✅ "80% coverage required"
✅ "Jest for unit testing"

## Testing Anti-Patterns to Store

**Automatically Captured:**
- "Never skip tests"
- "Don't test implementation details"
- "Avoid flaky tests"
- "No tests in production code"

**Examples:**
```
✅ "Never commit code without tests"
✅ "Don't mock what you don't own"
✅ "Avoid brittle snapshot tests"
✅ "No console.log in tests"
```

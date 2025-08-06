# AI-Driven Live Testing Architecture

## Overview

The AI-Driven Live Testing Architecture enables AI developers (like Claude) to execute real-time tests, observe behavior, and self-correct issues without human intervention. This solves the critical "blind development" problem where AI agents write code but cannot verify if it actually works.

## Architecture Components

### 1. Test Orchestrator (`src/testing/test-orchestrator.ts`)

The central component that coordinates all testing activities.

**Key Features:**
- Runs predefined test scenarios
- Observes system behavior in real-time
- Validates proposed fixes
- Maintains test history for learning

**Available Methods:**
```typescript
runScenario(scenario: TestScenario): Promise<TestResult>
observeBehavior(action: string, params: any): Promise<ObservationResult>
validateFix(params: ValidationParams): Promise<ValidationResult>
simulateClaudeInteraction(params: SimulationParams): Promise<SimulationResult>
getTestHistory(params: HistoryParams): Promise<TestHistory>
```

### 2. Observable Database (`src/testing/observable-database.ts`)

Tracks all database operations for analysis.

**Key Features:**
- Intercepts memory service operations
- Records all database changes
- Provides operation statistics
- Exports/imports change logs

**Usage:**
```typescript
const observer = new ObservableDatabase(memoryService);
observer.startTracking();
// ... perform operations ...
const changes = observer.getChanges();
const stats = observer.getStatistics();
observer.stopTracking();
```

### 3. Mock Claude Agent (`src/testing/mock-claude.ts`)

Simulates Claude's behavior with configurable compliance levels.

**Key Features:**
- Analyzes prompts to determine intent
- Selects appropriate tools based on compliance level
- Executes tools against real MCP server
- Tests compliance at different levels

**Compliance Levels:**
- `0.0`: Never searches before file operations (non-compliant)
- `0.5`: Sometimes searches (partially compliant)
- `1.0`: Always searches (fully compliant)

### 4. Scenario Runner (`src/testing/scenario-runner.ts`)

Executes predefined test scenarios step-by-step.

**Built-in Scenarios:**
- `memory_persistence`: Tests if memories are stored correctly
- `search_compliance`: Verifies search is called before file creation
- `rate_limiting`: Ensures rate limits are enforced
- `context_retrieval`: Tests relevant context retrieval
- `file_location_compliance`: Verifies files are created in correct locations

**Scenario Structure:**
```typescript
interface ScenarioDefinition {
  name: string;
  description: string;
  steps: ScenarioStep[];
  expectedOutcome: {
    searchCompliance?: boolean;
    memoryPersistence?: boolean;
    fileLocation?: string;
    customValidation?: (result: any) => boolean;
  };
}
```

### 5. Auto-Correction Engine (`src/testing/auto-correction-engine.ts`)

Analyzes failures and generates fixes automatically.

**Key Features:**
- Analyzes test failures to identify root causes
- Generates code fixes based on patterns
- Validates fixes before applying
- Learns from successful fixes

**Fix Generation Process:**
1. Analyze failure → Identify issue type
2. Generate fix → Based on patterns or custom logic
3. Validate fix → Run tests in sandbox
4. Apply fix → If confidence > threshold
5. Learn → Record successful fixes

## MCP Testing Tools

New MCP tools accessible to AI developers:

### `mcp__test__run_scenario`
Runs a predefined test scenario.
```json
{
  "scenario": "memory_persistence",
  "params": { "optional": "parameters" }
}
```

### `mcp__test__observe_behavior`
Observes system behavior for specific actions.
```json
{
  "action": "store_memory",
  "params": { "value": "test data" }
}
```

### `mcp__test__validate_fix`
Validates a proposed fix by running tests.
```json
{
  "issueId": "TEST-001",
  "fixDescription": "Added search enforcement",
  "testScenarios": ["memory_persistence", "search_compliance"]
}
```

### `mcp__test__simulate_claude`
Simulates Claude agent with configurable compliance.
```json
{
  "prompt": "Create a new test file",
  "complianceLevel": 0.8,
  "expectedBehavior": { "searchFirst": true }
}
```

### `mcp__test__memory_scenario`
Quick test for memory search compliance.
```json
{
  "storeContent": "Save tests in test-pasta/",
  "testAction": "create_file('test.js')"
}
```

### `mcp__test__get_results`
Retrieves test history and analytics.
```json
{
  "sessionId": "optional_session",
  "limit": 10
}
```

## Usage Examples

### Example 1: Testing Memory Search Compliance

```typescript
// AI can execute this through MCP
const result = await mcp__test__memory_scenario({
  storeContent: "All tests should be in test-pasta/ directory",
  testAction: "create_file('sample.test.js')"
});

if (!result.success) {
  console.log("Test failed:", result.issues);
  // AI can now attempt to fix the issue
}
```

### Example 2: Running Full Scenario

```typescript
const scenarioResult = await mcp__test__run_scenario({
  scenario: "search_compliance"
});

if (scenarioResult.status === 'failed') {
  // Analyze violations
  for (const violation of scenarioResult.observations.complianceViolations) {
    console.log(`Violation: ${violation.type} - ${violation.message}`);
  }
  
  // Get suggested fix
  console.log(`Suggested fix: ${scenarioResult.insights.suggestedFix}`);
}
```

### Example 3: Validating a Fix

```typescript
const validation = await mcp__test__validate_fix({
  issueId: "SEARCH-001",
  fixDescription: "Added pre-file-creation search hook",
  testScenarios: ["memory_persistence", "search_compliance", "file_location_compliance"]
});

if (validation.validationPassed) {
  console.log(`Fix validated with ${validation.confidence * 100}% confidence`);
  // Apply the fix
} else {
  console.log("Fix validation failed:", validation.recommendations);
}
```

### Example 4: Simulating Different Compliance Levels

```typescript
// Test with high compliance
const highCompliance = await mcp__test__simulate_claude({
  prompt: "Create a new React component",
  complianceLevel: 0.9
});

// Test with low compliance
const lowCompliance = await mcp__test__simulate_claude({
  prompt: "Create a new React component",
  complianceLevel: 0.1
});

// Compare behaviors
console.log(`High compliance searched: ${highCompliance.searchCallsMade > 0}`);
console.log(`Low compliance searched: ${lowCompliance.searchCallsMade > 0}`);
```

## Test Result Structure

### Observable Test Result
```typescript
interface ObservableTestResult {
  scenario: string;
  status: 'passed' | 'failed' | 'partial';
  
  observations: {
    memoriesStored: MemoryEntry[];
    searchesPerformed: SearchCall[];
    filesCreated: FileOperation[];
    complianceViolations: Violation[];
  };
  
  insights: {
    rootCause?: string;
    suggestedFix?: string;
    confidenceLevel: number;
  };
  
  reproduction: {
    steps: string[];
    environment: EnvironmentSnapshot;
  };
}
```

## Success Metrics

### Immediate (Now Available)
- ✅ AI can trigger test scenarios
- ✅ AI receives structured test results
- ✅ AI can observe database changes

### Achieved Capabilities
- ✅ AI identifies why memory search fails
- ✅ AI proposes and validates fixes
- ✅ Observable compliance tracking
- ✅ Automated fix generation
- ✅ Learning from successful fixes

### Benefits
1. **Immediate Feedback**: AI gets test results in milliseconds, not days
2. **Self-Correction**: AI can identify issues and validate fixes autonomously
3. **Compliance Testing**: Different compliance levels can be tested systematically
4. **Learning System**: Successful fixes are recorded and reused
5. **Observable Behavior**: All database operations are tracked and analyzable

## Running the Tests

### Start the MCP Server with Testing Tools
```bash
npm run build
npm run start:mcp
```

### Run Integration Tests
```bash
npm test -- tests/integration/ai-testing-system.test.ts
```

### Use from Claude
```javascript
// Claude can now test its own code
const testResult = await mcp__test__run_scenario({
  scenario: "memory_persistence"
});

// If test fails, Claude can analyze and fix
if (testResult.status === 'failed') {
  const fix = await mcp__test__validate_fix({
    issueId: "auto-generated",
    fixDescription: "My proposed fix",
    testScenarios: ["memory_persistence"]
  });
}
```

## Troubleshooting

### Common Issues

1. **Tests Not Available**: Ensure TestTools are registered in the MCP server
2. **Database Not Observable**: Check ObservableDatabase is properly intercepting methods
3. **Mock Claude Not Compliant**: Verify compliance level is set correctly
4. **Scenarios Not Found**: Check scenario name matches registered scenarios

### Debug Mode

Enable detailed logging:
```typescript
process.env.CLAUDE_RECALL_DEBUG = 'true';
```

## Future Enhancements

1. **Parallel Test Execution**: Run multiple scenarios simultaneously
2. **Visual Test Results**: Web UI for viewing test outcomes
3. **Advanced Learning**: ML-based fix generation
4. **Performance Benchmarks**: Track system performance over time
5. **Custom Scenario Builder**: UI for creating test scenarios

## Conclusion

The AI-Driven Live Testing Architecture transforms Claude Recall from a system with multi-day feedback loops to one with immediate, actionable testing capabilities. AI developers can now:

- Test their code in real-time
- Observe actual system behavior
- Validate fixes before applying them
- Learn from successful corrections
- Achieve reliable memory search compliance

This architecture moves AI development from **blind coding** to **informed development** with continuous validation and improvement.
# Hook System Analysis for Claude Recall

## Executive Summary

This document analyzes how hook systems from Claude Code and Claude Flow can be leveraged to build Claude Recall - a brain-inspired memory system for AI coding assistants. After examining both implementations, hooks emerge as the ideal architecture for transparently capturing AI-human interactions and building consistent, project-specific memory.

## Claude Recall's Core Objectives

Based on the project description, Claude Recall aims to:

1. **Automatic Memory Capture**: Transparently intercept all AI-assistant interactions without user intervention
2. **Consistency & Efficiency**: Maintain coding style, conventions, and decisions across sessions
3. **Smart Retention**: Remember instructions, preferences, corrections, and patterns
4. **Context-Aware Retrieval**: Surface relevant memories based on current context
5. **Brain-Inspired Architecture**: Implement psychological memory principles (forgetting curves, consolidation, associative networks)

## Hook Systems Overview

### Claude Code Hooks (Official)

Claude Code provides a simple yet powerful hook system:

- **Configuration**: JSON-based in `.claude/settings.json`
- **Hook Types**: PreToolUse, PostToolUse, UserPromptSubmit, SessionStart, Stop
- **Data Exchange**: JSON via stdin/stdout with tool parameters and context
- **Control Flow**: Exit codes determine continuation (0), user feedback (1), or blocking (2)
- **Tools Covered**: Bash, Edit, and all other Claude Code tools

### Claude Flow Hooks (Extended)

Claude Flow demonstrates a sophisticated hook ecosystem:

- **Comprehensive Coverage**: 40+ hook types covering every aspect of operation
- **Categories**: LLM, Memory, Neural, Performance, Workflow, Session hooks
- **Infrastructure**: Built-in SQLite storage, namespaced keys, background processing
- **Advanced Features**: Pipeline creation, context building, cross-provider synchronization
- **Integration**: MCP servers, Git, GitHub, neural networks

## How Hooks Enable Claude Recall

### 1. Transparent Capture Mechanism

Hooks provide the **"automatic capture without user intervention"** that Claude Recall requires:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "python3 /claude-recall/capture/pre-tool.py"
      }]
    }],
    "PostToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "python3 /claude-recall/capture/post-tool.py"
      }]
    }],
    "UserPromptSubmit": [{
      "hooks": [{
        "type": "command",
        "command": "python3 /claude-recall/capture/user-prompt.py"
      }]
    }]
  }
}
```

This configuration captures:
- Every user prompt via `UserPromptSubmit`
- All tool operations (before and after) via `PreToolUse`/`PostToolUse`
- Complete context including file paths, code changes, commands run

### 2. Pattern Recognition & Learning

Hooks enable intelligent pattern capture at key moments:

#### Correction Detection (Post-Edit Hook)
```python
# When user modifies AI-generated code
def post_edit_hook(data):
    if data['original'] != data['new']:
        pattern = analyze_correction(data['original'], data['new'])
        memory.store({
            'type': 'correction',
            'pattern': pattern,
            'context': data['file_path'],
            'language': detect_language(data['file_path'])
        })
```

#### Preference Capture (Pre-Task Hook)
```python
# When user gives instructions
def user_prompt_hook(data):
    instructions = extract_instructions(data['prompt'])
    if instructions:
        memory.store({
            'type': 'preference',
            'instructions': instructions,
            'project': os.environ['CLAUDE_PROJECT_DIR']
        })
```

### 3. Context-Aware Memory Retrieval

Hooks can enhance prompts with relevant memories:

```python
def pre_tool_hook(data):
    # Retrieve relevant memories based on current context
    context = {
        'tool': data['tool_name'],
        'file': data.get('file_path'),
        'project': os.environ['CLAUDE_PROJECT_DIR']
    }
    
    relevant_memories = memory.retrieve(context)
    
    # Exit code 0 with additional context
    return {
        'additionalContext': format_memories(relevant_memories)
    }
```

### 4. Memory Consolidation & Management

Session hooks enable brain-inspired memory processes:

```python
def session_end_hook(data):
    # Consolidate working memory to long-term storage
    working_memories = memory.get_session_memories()
    
    # Apply forgetting curve
    for mem in working_memories:
        mem['relevance'] = calculate_relevance(mem)
    
    # Merge similar patterns
    consolidated = consolidate_patterns(working_memories)
    
    # Store in long-term memory
    memory.persist(consolidated)
```

## Implementation Architecture

### Phase 1: Basic Capture Infrastructure

1. **Hook Configuration**
   - Create `.claude/settings.json` with all capture hooks
   - Target all tools with wildcard matchers

2. **Capture Scripts**
   - `pre-tool.py`: Capture tool intentions and context
   - `post-tool.py`: Capture results and corrections
   - `user-prompt.py`: Capture instructions and preferences

3. **Storage Layer**
   - SQLite database for immediate storage (inspired by Claude Flow)
   - Schema: interactions, patterns, preferences, associations

### Phase 2: Memory Engine

1. **Working Memory**
   - In-memory cache of recent interactions
   - LRU eviction with capacity limits
   - Fast retrieval for current session

2. **Long-Term Memory**
   - Persistent SQLite storage
   - Indexed by project, file, language, pattern type
   - Background consolidation process

3. **Memory Algorithms**
   - Forgetting curve implementation
   - Pattern similarity detection
   - Associative network building

### Phase 3: Intelligent Retrieval

1. **Context Building**
   - Extract current file, project, language
   - Identify related concepts and patterns
   - Calculate temporal relevance

2. **Memory Enhancement**
   - Pre-tool hooks inject relevant memories
   - Ranked by relevance score
   - Formatted as additional context

3. **Performance Optimization**
   - Memory caching with TTL
   - Async retrieval to avoid latency
   - Selective loading based on context

## Key Benefits of Hook-Based Approach

### 1. Non-Invasive Integration
- No modification to Claude Code core
- Works with existing Claude Code installations
- Easy to enable/disable

### 2. Complete Coverage
- Captures every interaction automatically
- No special commands or manual saves needed
- Transparent to user workflow

### 3. Rich Context Access
- Full tool parameters and results
- Project directory and file paths
- Session and timing information

### 4. Extensibility
- Easy to add new capture points
- Can integrate with other tools
- Adaptable to future Claude Code features

### 5. Performance Control
- Async execution possible
- Selective capture based on patterns
- Background processing for heavy operations

## Implementation Roadmap

### Week 1-2: Proof of Concept
- Basic hook configuration
- Simple capture scripts
- SQLite storage setup
- Manual testing with Claude Code

### Week 3-4: Memory Engine
- Working memory implementation
- Forgetting curve algorithm
- Pattern detection logic
- Consolidation process

### Week 5-6: Retrieval System
- Context extraction
- Relevance scoring
- Memory injection via hooks
- Performance optimization

### Week 7-8: Polish & Testing
- Edge case handling
- Performance tuning
- Documentation
- User testing

## Technical Considerations

### 1. Performance Impact
- Hooks must complete quickly (< 100ms)
- Use async processing for heavy operations
- Cache frequently accessed memories

### 2. Storage Scalability
- Implement automatic pruning
- Archive old memories
- Optimize indexes for common queries

### 3. Privacy & Security
- Encrypt sensitive data
- Provide memory management commands
- Allow selective memory deletion

### 4. Cross-Platform Support
- Test on Windows, Mac, Linux
- Handle path differences
- Ensure Python compatibility

## Known Issues with Claude Code Hooks (2025)

Based on current research, Claude Code hooks suffer from several critical implementation issues:

### 1. Template Variable Interpolation Failure
- Variables like `{{tool.name}}`, `{{timestamp}}`, and `{{tool.input.file_path}}` are not replaced with actual values
- They appear literally in executed commands instead of being interpolated

### 2. Configuration Persistence Problems
- Changes to `.claude/settings.local.json` are ignored even after restarting Claude Code
- Direct edits to hooks in settings files don't take effect immediately
- Security restrictions prevent immediate hook modifications from affecting current sessions

### 3. Exit Status Not Blocking Operations
- PreToolUse hooks with non-zero exit status should block operations but don't
- Tool operations proceed regardless of hook command exit status
- This undermines the control flow mechanism entirely

### 4. Performance and Reliability Issues
- Unexpectedly restrictive usage limits affecting heavy users
- Network overload errors and API issues
- Token burn problems when left unattended
- 60-second execution timeout limit

### 5. Parallel Execution Conflicts
- All matching hooks run in parallel
- Can lead to race conditions between hooks
- No sequential execution option available

## Why Claude Flow Hooks Avoid These Issues

Claude Flow's architecture fundamentally differs from Claude Code's hook implementation:

### 1. Architectural Separation
- **Claude Flow as Service**: Acts as a service layer for hooks rather than implementing the hook runner
- **CLI Target Design**: Claude Flow doesn't handle hook execution; it provides tools that hooks call
- This separation avoids the configuration and interpolation issues plaguing Claude Code

### 2. Granular Event System
- **Specific Commands**: Breaks general events into specific, actionable commands (pre-task, pre-edit, etc.)
- **Direct Execution**: Uses `npx claude-flow hooks [command]` pattern, avoiding variable interpolation
- **Explicit Parameters**: Pass parameters as command-line arguments, not template variables

### 3. Built-in Infrastructure
- **SQLite Storage**: Persistent `.swarm/memory.db` with 12 specialized tables
- **Background Processing**: Handles heavy operations without blocking
- **Enterprise Features**: Memory-sync and telemetry designed for large-scale deployments

### 4. Fire-and-Forget Design
- Claude Flow hooks are "fire-and-forget" - they don't attempt complex control flow
- This simpler design avoids the exit status blocking issues
- Focus on data capture and processing rather than operation control

### 5. Robust Error Handling
- WASM SIMD acceleration for performance
- Fault-tolerant dynamic agent architecture
- Self-organizing agents handle failures gracefully

## Implications for Claude Recall

### Recommended Approach

Given these findings, Claude Recall should:

1. **Adopt Claude Flow's Architecture**
   - Use hooks as simple data capture points
   - Implement control flow logic within the capture scripts
   - Avoid relying on template variable interpolation

2. **Work Around Known Issues**
   - Use explicit command-line arguments instead of template variables
   - Implement own blocking logic rather than relying on exit codes
   - Use `/hooks` command interface for configuration instead of direct JSON edits

3. **Design for Resilience**
   - Assume hooks may fail or not block as expected
   - Implement redundant capture mechanisms
   - Use fire-and-forget pattern with async processing

4. **Performance Considerations**
   - Keep hook execution under 100ms
   - Move heavy processing to background tasks
   - Implement progressive slowdown to manage token usage

## Conclusion

While Claude Code hooks have significant implementation issues, the concept remains sound for Claude Recall. By adopting Claude Flow's architectural patterns - treating hooks as simple event notifications rather than control flow mechanisms - we can build a robust memory system that works around current limitations.

The key insight is that Claude Flow succeeds by **not** relying on the problematic features of Claude Code hooks. Instead, it uses hooks merely as triggers for its own sophisticated processing pipeline. Claude Recall should follow this pattern: simple, reliable capture via hooks, with all intelligence implemented in the processing layer.

Next steps should focus on building a proof of concept that uses hooks conservatively - as simple event notifications - while implementing all memory logic in separate, robust Python scripts that can handle failures gracefully.
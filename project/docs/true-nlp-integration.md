# True NLP Integration for Claude Recall

## Overview

Claude Recall now features true Natural Language Processing (NLP) using Claude's language understanding capabilities, moving beyond simple pattern matching to genuine semantic comprehension.

## Key Differences: Pattern Matching vs True NLP

### Pattern-Based Approach (Old)
- Uses RegEx patterns to match specific phrases
- Limited to predefined patterns
- Cannot understand context or intent
- Misses subtle or conversational preferences
- Fast but inflexible

### NLP-Based Approach (New)
- Uses Claude's language model to understand meaning
- Handles any natural language expression
- Understands context, tone, and intent
- Can infer implicit preferences
- Detects override signals naturally
- Can suggest related preferences
- Slightly slower but highly accurate

## Architecture

### 1. ClaudeNLPAnalyzer
The core NLP engine that interfaces with Claude API to analyze text.

```typescript
interface NLPAnalysis {
  intent: {
    type: 'preference' | 'correction' | 'query' | 'instruction' | 'other';
    confidence: number;
    subtype?: string;
  };
  entities: {
    subject: string;
    action: string;
    target?: string;
    modifiers?: string[];
  };
  preference?: {
    key: string;
    value: any;
    isOverride: boolean;
    temporal: 'permanent' | 'temporary' | 'session';
    reasoning: string;
  };
  context: {
    emotional_tone: 'neutral' | 'emphatic' | 'uncertain' | 'frustrated';
    formality: 'casual' | 'formal' | 'technical';
    urgency: 'low' | 'medium' | 'high';
  };
  confidence: number;
  reasoning: string;
}
```

### 2. IntelligentPreferenceExtractor
Builds on NLP analysis to extract and validate preferences with context awareness.

Features:
- Context-aware preference extraction
- Inference of related preferences
- Conflict detection and resolution
- Confidence scoring based on context
- Caching for performance

### 3. Integration with HookService
The hook service now tries NLP extraction first, falling back to pattern matching if:
- ANTHROPIC_API_KEY is not set
- NLP extraction fails
- No preferences detected via NLP

## Examples

### Example 1: Contextual Understanding
```
Input: "I've been thinking about it, and you know what? Tests really belong in a tests-raoul directory."

Pattern-Based: ❌ No match (doesn't fit regex patterns)

NLP-Based: ✓ Extracts:
- Key: test_location
- Value: tests-raoul
- Confidence: 0.92
- Reasoning: "User expressing thoughtful preference for test location"
```

### Example 2: Natural Variations
```
Input: "Whenever you're writing tests, make sure they end up in the tests-raoul folder."

Pattern-Based: ❌ Partial match, low confidence

NLP-Based: ✓ Extracts:
- Key: test_location
- Value: tests-raoul
- Confidence: 0.88
- Override: true (temporal indicator "whenever")
```

### Example 3: Implicit Preferences
```
Input: "I noticed you used 2 spaces. I actually prefer tabs - they're more flexible."

Pattern-Based: ✓ Detects "prefer tabs" but misses the context

NLP-Based: ✓ Extracts:
- Key: indentation
- Value: tabs
- Confidence: 0.95
- Override: true (detected correction intent)
- Reasoning: "User correcting from 2 spaces to tabs with justification"
```

### Example 4: Complex Multi-Preference
```
Input: "Looking at the code, I think we should use Vitest for testing since it's faster, and all test files should go in src/__tests__."

Pattern-Based: ❌ Only catches partial preferences

NLP-Based: ✓ Extracts multiple:
1. Key: test_framework, Value: vitest (confidence: 0.87)
2. Key: test_location, Value: src/__tests__ (confidence: 0.91)
3. Key: test_runner, Value: vitest (inferred, confidence: 0.72)
```

## Configuration

### Enable NLP Integration
```bash
export ANTHROPIC_API_KEY=your-api-key-here
```

### Fallback Behavior
If NLP is not available, the system automatically falls back to:
1. Semantic pattern extraction (enhanced regex)
2. Basic pattern extraction (legacy regex)

### Performance Tuning
```typescript
// In intelligent-preference-extractor.ts
const nlpExtractor = new IntelligentPreferenceExtractor(apiKey);

// Cache preferences for session
nlpExtractor.getCached(text); // Returns cached result if available
nlpExtractor.clearCache(); // Clear cache when needed
```

## Benefits

1. **Natural Communication**: Users can express preferences naturally without memorizing specific patterns
2. **Context Awareness**: Understands the context and intent behind statements
3. **Intelligent Inference**: Can infer related preferences from a single statement
4. **Conflict Resolution**: Detects and handles conflicting preferences intelligently
5. **Confidence Scoring**: Provides confidence levels based on context and clarity
6. **Temporal Understanding**: Distinguishes between permanent, temporary, and session preferences

## Testing

Run the comparison demo:
```bash
npm install
export ANTHROPIC_API_KEY=your-key
npx tsx demo-nlp-vs-patterns.ts
```

Run unit tests:
```bash
npm test -- intelligent-preference-extractor.test.ts
```

## Future Enhancements

1. **Batch Processing**: Process multiple statements in a single API call
2. **Learning Mode**: Learn from user corrections to improve accuracy
3. **Multi-language Support**: Extend to support preferences in multiple languages
4. **Voice Integration**: Process voice-to-text preferences
5. **Contextual Memory**: Use long-term memory to improve understanding
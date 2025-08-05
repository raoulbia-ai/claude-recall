import { LoggingService } from './logging';

export interface SemanticIntent {
  category: 'location' | 'tool' | 'style' | 'process' | 'general';
  action: string;
  entities: string[];
  confidence: number;
}

export interface ExtractedSemanticPreference {
  key: string;
  value: any;
  confidence: number;
  rawText: string;
  intent: SemanticIntent;
  isOverride: boolean;
  overrideSignals: string[];
}

export interface IntentPattern {
  pattern: RegExp;
  category: SemanticIntent['category'];
  extractor: (match: RegExpMatchArray, text: string) => Partial<SemanticIntent>;
}

export class SemanticPreferenceExtractor {
  private logger = LoggingService.getInstance();

  // Semantic patterns for intent identification
  private readonly INTENT_PATTERNS: IntentPattern[] = [
    // Location preferences - very flexible patterns
    {
      pattern: /(?:let'?s?\s+)?(?:put|save|store|place|keep|create)\s+(.+?)\s+(?:in|into|at|under|within)\s+([^\s].+?)(?:\s+from\s+now\s+on|\s+going\s+forward|\s+moving\s+forward)?$/i,
      category: 'location',
      extractor: (match) => {
        let location = match[2].trim();
        // Remove trailing temporal phrases
        location = location.replace(/\s+(from\s+now\s+on|going\s+forward|moving\s+forward)$/i, '');
        return {
          action: 'save_location',
          entities: [match[1].trim(), location]
        };
      }
    },
    {
      pattern: /(.+?)\s+(?:should\s+)?(?:go|goes?|belong|live)(?:es)?\s+(?:in|into|at|under)\s+([^\s].+?)(?:\s+going\s+forward)?$/i,
      category: 'location',
      extractor: (match) => {
        let location = match[2].trim();
        // Remove trailing temporal phrases
        location = location.replace(/\s+(going\s+forward|from\s+now\s+on)$/i, '');
        return {
          action: 'location_preference',
          entities: [match[1].trim(), location]
        };
      }
    },
    {
      pattern: /(?:i\s+)?(?:think|believe|want)\s+(.+?)\s+(?:should\s+)?(?:be|go)\s+(?:in|at)\s+(.+)/i,
      category: 'location',
      extractor: (match) => ({
        action: 'location_opinion',
        entities: [match[1].trim(), match[2].trim()]
      })
    },
    {
      pattern: /(?:actually|you\s+know\s+what),?\s*(?:let'?s?\s+)?(?:use|put|save)\s+(.+?)\s+(?:in|for)\s+(.+)/i,
      category: 'location',
      extractor: (match) => ({
        action: 'location_change',
        entities: [match[1].trim(), match[2].trim()]
      })
    },
    // More flexible patterns for casual language
    {
      pattern: /(?:oh\s+)?(?:btw|by\s+the\s+way)?,?\s*(.+?)\s+should\s+(?:be|go)\s+in\s+([^\s].+?)(?:\s+moving\s+forward)?$/i,
      category: 'location',
      extractor: (match) => {
        let location = match[2].trim();
        location = location.replace(/\s+(moving\s+forward|from\s+now\s+on)$/i, '');
        return {
          action: 'location_preference',
          entities: [match[1].trim(), location]
        };
      }
    },
    {
      pattern: /(?:let'?s?\s+)?(?:start\s+)?(?:putting|placing)\s+(?:all\s+)?(.+?)\s+in\s+([^\s].+)/i,
      category: 'location',
      extractor: (match) => ({
        action: 'save_location',
        entities: [match[1].trim(), match[2].trim()]
      })
    },

    // Tool preferences
    {
      pattern: /(?:let'?s?\s+)?use\s+(.+?)\s+(?:for|to|when)\s+(.+)/i,
      category: 'tool',
      extractor: (match) => ({
        action: 'tool_preference',
        entities: [match[1].trim(), match[2].trim()]
      })
    },
    {
      pattern: /prefer\s+(.+?)\s+(?:over|instead\s+of|rather\s+than)\s+(.+)/i,
      category: 'tool',
      extractor: (match) => ({
        action: 'tool_comparison',
        entities: [match[1].trim(), match[2].trim()]
      })
    },

    // Style preferences
    {
      pattern: /(?:use\s+)?(\d+)\s*spaces?\s+(?:for\s+)?(?:indent|indentation)/i,
      category: 'style',
      extractor: (match) => ({
        action: 'indentation_style',
        entities: [`${match[1]}_spaces`]
      })
    },
    {
      pattern: /(?:use\s+)?tabs?\s+(?:for\s+)?(?:indent|indentation)/i,
      category: 'style',
      extractor: () => ({
        action: 'indentation_style',
        entities: ['tabs']
      })
    },
    {
      pattern: /(?:actually,?\s+)?(?:let'?s?\s+)?use\s+tabs\s+(?:instead|now)?/i,
      category: 'style',
      extractor: () => ({
        action: 'indentation_style',
        entities: ['tabs']
      })
    },

    // Process preferences
    {
      pattern: /(?:always|never)\s+(.+)/i,
      category: 'process',
      extractor: (match, text) => ({
        action: text.toLowerCase().includes('always') ? 'always_do' : 'never_do',
        entities: [match[1].trim()]
      })
    }
  ];

  // Context indicators that boost confidence
  private readonly CONTEXT_BOOSTERS = {
    temporal: ['from now on', 'going forward', 'moving forward', 'henceforth', 'starting now'],
    change: ['actually', 'instead', 'rather', 'changed my mind', 'on second thought'],
    emphasis: ['definitely', 'absolutely', 'really', 'certainly', 'please'],
    casual: ['hey', 'oh', 'btw', 'by the way', 'fyi']
  };

  // Word variations and synonyms for entity normalization
  private readonly ENTITY_SYNONYMS: Record<string, string[]> = {
    'tests': ['test', 'testing', 'specs', 'spec', 'test files', 'test file'],
    'config': ['configuration', 'configs', 'settings', 'conf'],
    'docs': ['documentation', 'documents', 'doc'],
    'src': ['source', 'sources', 'code'],
    'lib': ['library', 'libraries', 'libs'],
    'dist': ['distribution', 'build', 'output', 'out']
  };

  /**
   * Extract preferences using semantic understanding
   */
  extractPreference(prompt: string, context?: any): ExtractedSemanticPreference | null {
    try {
      // Step 1: Identify intent
      const intent = this.identifyIntent(prompt);
      if (!intent) return null;

      // Step 2: Extract components based on intent
      const components = this.extractComponents(prompt, intent);
      if (!components) return null;

      // Step 3: Build structured preference
      return this.buildPreference(intent, components, prompt);
    } catch (error) {
      this.logger.logServiceError('SemanticPreferenceExtractor', 'extractPreference', error as Error);
      return null;
    }
  }

  /**
   * Extract multiple preferences from text
   */
  extractAllPreferences(text: string): ExtractedSemanticPreference[] {
    const preferences: ExtractedSemanticPreference[] = [];
    const sentences = this.splitIntoMeaningfulChunks(text);

    for (const sentence of sentences) {
      const preference = this.extractPreference(sentence);
      if (preference && preference.confidence > 0.5) {
        preferences.push(preference);
      }
    }

    return preferences;
  }

  /**
   * Identify the intent category and extract basic information
   */
  private identifyIntent(prompt: string): SemanticIntent | null {
    let bestMatch: SemanticIntent | null = null;
    let highestConfidence = 0;

    for (const pattern of this.INTENT_PATTERNS) {
      const match = prompt.match(pattern.pattern);
      if (match) {
        const extracted = pattern.extractor(match, prompt);
        const baseConfidence = this.calculateBaseConfidence(prompt, match[0]);
        const contextBoost = this.calculateContextBoost(prompt);
        
        const intent: SemanticIntent = {
          category: pattern.category,
          action: extracted.action || 'unknown',
          entities: extracted.entities || [],
          confidence: Math.min(baseConfidence + contextBoost, 1.0)
        };

        if (intent.confidence > highestConfidence) {
          highestConfidence = intent.confidence;
          bestMatch = intent;
        }
      }
    }

    return bestMatch;
  }

  /**
   * Extract detailed components based on intent
   */
  private extractComponents(prompt: string, intent: SemanticIntent): any {
    switch (intent.category) {
      case 'location':
        return this.extractLocationComponents(prompt, intent);
      case 'tool':
        return this.extractToolComponents(prompt, intent);
      case 'style':
        return this.extractStyleComponents(prompt, intent);
      case 'process':
        return this.extractProcessComponents(prompt, intent);
      default:
        return { raw: intent };
    }
  }

  /**
   * Build the final preference object
   */
  private buildPreference(
    intent: SemanticIntent, 
    components: any, 
    rawText: string
  ): ExtractedSemanticPreference {
    const overrideSignals = this.detectOverrideSignals(rawText);
    
    return {
      key: components.key,
      value: components.value,
      confidence: intent.confidence,
      rawText: rawText.trim(),
      intent,
      isOverride: overrideSignals.length > 0,
      overrideSignals
    };
  }

  /**
   * Extract location-specific components
   */
  private extractLocationComponents(prompt: string, intent: SemanticIntent): any {
    if (intent.entities.length < 2) return null;

    const [subject, location] = intent.entities;
    const normalizedSubject = this.normalizeEntity(subject);
    const normalizedLocation = this.normalizeLocation(location);

    // Determine the preference key based on the subject
    let key = 'file_location'; // default
    if (normalizedSubject.match(/test|spec/i)) {
      key = 'test_location';
    } else if (normalizedSubject.match(/config|settings/i)) {
      key = 'config_location';
    } else if (normalizedSubject.match(/doc|documentation/i)) {
      key = 'docs_location';
    }

    return {
      key,
      value: normalizedLocation
    };
  }

  /**
   * Extract tool-specific components
   */
  private extractToolComponents(prompt: string, intent: SemanticIntent): any {
    if (intent.entities.length === 0) return null;

    const tool = intent.entities[0];
    const purpose = intent.entities[1] || 'general';

    // Map tools to preference keys
    const toolMappings: Record<string, string> = {
      'axios': 'http_client',
      'fetch': 'http_client',
      'jest': 'test_framework',
      'vitest': 'test_framework',
      'mocha': 'test_framework',
      'webpack': 'build_tool',
      'vite': 'build_tool',
      'typescript': 'language',
      'javascript': 'language',
      'tabs': 'indentation',
      '2 spaces': 'indentation',
      '4 spaces': 'indentation'
    };

    const key = toolMappings[tool.toLowerCase()] || 'tool_preference';

    return {
      key,
      value: tool.toLowerCase()
    };
  }

  /**
   * Extract style-specific components
   */
  private extractStyleComponents(prompt: string, intent: SemanticIntent): any {
    if (intent.entities.length === 0) return null;

    const style = intent.entities[0];
    
    // Handle different style preferences
    if (intent.action === 'style_preference' && intent.entities.length >= 2) {
      const [value, type] = intent.entities;
      if (type.includes('indent')) {
        return {
          key: 'indentation',
          value: value
        };
      }
    }
    
    return {
      key: 'indentation',
      value: style
    };
  }

  /**
   * Extract process-specific components
   */
  private extractProcessComponents(prompt: string, intent: SemanticIntent): any {
    if (intent.entities.length === 0) return null;

    const process = intent.entities[0];
    const action = intent.action;

    return {
      key: `${action}_rule`,
      value: process
    };
  }

  /**
   * Calculate base confidence based on match quality
   */
  private calculateBaseConfidence(fullText: string, matchedText: string): number {
    // Start with base confidence
    let confidence = 0.6;

    // Boost for match coverage
    const coverage = matchedText.length / fullText.length;
    confidence += coverage * 0.2;

    // Boost for sentence position (preferences often at start or end)
    const position = fullText.indexOf(matchedText) / fullText.length;
    if (position < 0.2 || position > 0.8) {
      confidence += 0.1;
    }

    return confidence;
  }

  /**
   * Calculate confidence boost from context
   */
  private calculateContextBoost(text: string): number {
    let boost = 0;
    const lowerText = text.toLowerCase();

    // Check for context boosters
    for (const [category, phrases] of Object.entries(this.CONTEXT_BOOSTERS)) {
      for (const phrase of phrases) {
        if (lowerText.includes(phrase)) {
          switch (category) {
            case 'temporal': boost += 0.15; break;
            case 'change': boost += 0.12; break;
            case 'emphasis': boost += 0.08; break;
            case 'casual': boost += 0.05; break;
          }
        }
      }
    }

    return Math.min(boost, 0.3); // Cap total boost
  }

  /**
   * Normalize entity names using synonyms
   */
  private normalizeEntity(entity: string): string {
    const lower = entity.toLowerCase().trim();
    
    // Check synonyms
    for (const [normalized, synonyms] of Object.entries(this.ENTITY_SYNONYMS)) {
      if (synonyms.some(syn => lower.includes(syn))) {
        return normalized;
      }
    }

    return entity.trim();
  }

  /**
   * Normalize location paths
   */
  private normalizeLocation(location: string): string {
    // Remove quotes and extra spaces
    let normalized = location.trim().replace(/["']/g, '');
    
    // Remove temporal phrases and punctuation that might have been captured
    normalized = normalized.replace(/\s+(from\s+now\s+on|going\s+forward|moving\s+forward)[\?\!]*$/i, '');
    normalized = normalized.replace(/[\?\!]+$/, ''); // Remove trailing punctuation
    
    // Don't add ./ prefix to already valid paths or simple directory names
    if (!normalized.startsWith('/') && 
        !normalized.startsWith('.') && 
        !normalized.match(/^[a-zA-Z0-9_-]+$/) &&
        !normalized.match(/^__[a-zA-Z0-9_-]+__$/)) { // Handle __dirname__ style
      // Only add ./ if it contains spaces or special chars
      normalized = `./${normalized}`;
    }

    // Normalize separators
    normalized = normalized.replace(/\\/g, '/');

    return normalized;
  }

  /**
   * Detect override signals in text
   */
  private detectOverrideSignals(text: string): string[] {
    const signals: string[] = [];
    const lowerText = text.toLowerCase();

    for (const [category, phrases] of Object.entries(this.CONTEXT_BOOSTERS)) {
      if (category === 'temporal' || category === 'change') {
        for (const phrase of phrases) {
          if (lowerText.includes(phrase)) {
            signals.push(phrase);
          }
        }
      }
    }

    return signals;
  }

  /**
   * Split text into meaningful chunks for analysis
   */
  private splitIntoMeaningfulChunks(text: string): string[] {
    // Split by punctuation and conjunctions
    const chunks = text.split(/[.!?;]|\s+(?:and|but|also|then)\s+/i);
    
    return chunks
      .map(chunk => chunk.trim())
      .filter(chunk => chunk.length > 10); // Filter short fragments
  }
}
import { LoggingService } from './logging';

export interface ExtractedPreference {
  key: string;           // e.g., "test_location", "code_style"
  value: string;         // e.g., "tests-arlo", "4_spaces"
  confidence: number;    // 0.0-1.0 confidence score
  raw: string;           // Original text
  isOverride: boolean;   // True if this updates existing preference
  overrideSignals: string[]; // e.g., ["moving forward", "actually"]
}

export class PreferenceExtractor {
  private logger = LoggingService.getInstance();
  
  private readonly OVERRIDE_SIGNALS = {
    temporal: ["moving forward", "from now on", "going forward", "henceforth"],
    change: ["actually", "instead", "rather than", "changed my mind"],
    update: ["update to", "replace with", "switch to", "migrate to"],
    revert: ["go back to", "return to", "revert to", "back to using"]
  };

  private readonly PREFERENCE_PATTERNS = {
    test_location: {
      triggers: ["test", "tests", "test files", "testing", "spec", "specs"],
      locationWords: ["in", "to", "at", "under", "within", "inside"],
      valuePattern: /(?:in|to|at|under|within|inside)\s+([\w\-\/\.]+)/i
    },
    code_style: {
      triggers: ["spaces", "tabs", "indentation", "indent", "formatting", "style"],
      patterns: [
        { pattern: /(\d+)\s*spaces?/i, extract: (m: RegExpMatchArray) => `${m[1]}_spaces` },
        { pattern: /tabs?/i, extract: () => "tabs" },
        { pattern: /semicolons?/i, extract: () => "semicolons" },
        { pattern: /no\s*semicolons?/i, extract: () => "no_semicolons" },
        { pattern: /single\s*quotes?/i, extract: () => "single_quotes" },
        { pattern: /double\s*quotes?/i, extract: () => "double_quotes" }
      ]
    },
    framework_choice: {
      triggers: ["use", "prefer", "framework", "library", "package"],
      frameworks: {
        http_client: ["axios", "fetch", "superagent", "got"],
        test_framework: ["jest", "vitest", "mocha", "jasmine", "cypress"],
        build_tool: ["webpack", "vite", "rollup", "parcel"],
        ui_framework: ["react", "vue", "angular", "svelte"]
      }
    },
    file_organization: {
      triggers: ["save", "store", "put", "place", "create", "organize"],
      types: ["config", "configs", "configuration", "assets", "images", "styles", "components"]
    }
  };

  /**
   * Extract preferences from natural language text
   */
  extractPreferences(prompt: string): ExtractedPreference[] {
    try {
      const sentences = this.splitIntoSentences(prompt);
      const preferences: ExtractedPreference[] = [];

      for (const sentence of sentences) {
        if (this.indicatesPreference(sentence)) {
          const preference = this.extractPreferenceFromSentence(sentence);
          if (preference && preference.confidence > 0.6) { // Only high-confidence extractions
            preferences.push(preference);
            
            this.logger.debug('PreferenceExtractor', `Extracted preference: ${preference.key} = ${preference.value}`, {
              confidence: preference.confidence,
              isOverride: preference.isOverride,
              raw: preference.raw
            });
          }
        }
      }

      return preferences;
    } catch (error) {
      this.logger.logServiceError('PreferenceExtractor', 'extractPreferences', error as Error);
      return [];
    }
  }

  /**
   * Check if sentence indicates a preference
   */
  private indicatesPreference(sentence: string): boolean {
    const lower = sentence.toLowerCase();
    
    // Check for preference indicators
    const preferenceIndicators = [
      "prefer", "use", "save", "store", "put", "place", "create", "make",
      "should", "want", "like", "love", "always", "never", "from now on",
      "moving forward", "going forward", "henceforth"
    ];
    
    return preferenceIndicators.some(indicator => lower.includes(indicator));
  }

  /**
   * Extract preference from a single sentence
   */
  private extractPreferenceFromSentence(sentence: string): ExtractedPreference | null {
    const lower = sentence.toLowerCase();
    
    // Try each preference pattern
    for (const [key, pattern] of Object.entries(this.PREFERENCE_PATTERNS)) {
      const preference = this.extractSpecificPreference(sentence, key, pattern);
      if (preference) {
        return preference;
      }
    }
    
    return null;
  }

  /**
   * Extract specific preference type from sentence
   */
  private extractSpecificPreference(sentence: string, key: string, pattern: any): ExtractedPreference | null {
    const lower = sentence.toLowerCase();
    
    // Check if sentence contains triggers for this preference type
    const hasTrigger = pattern.triggers.some((trigger: string) => lower.includes(trigger));
    if (!hasTrigger) return null;
    
    let value: string | null = null;
    let confidence = 0.7; // Base confidence
    
    switch (key) {
      case 'test_location':
        value = this.extractTestLocation(sentence, pattern);
        break;
      case 'code_style':
        value = this.extractCodeStyle(sentence, pattern);
        break;
      case 'framework_choice':
        value = this.extractFrameworkChoice(sentence, pattern);
        break;
      case 'file_organization':
        value = this.extractFileOrganization(sentence, pattern);
        break;
    }
    
    if (!value) return null;
    
    // Detect override intent
    const overrideSignals = this.detectOverrideSignals(sentence);
    const isOverride = overrideSignals.length > 0;
    
    // Boost confidence for explicit preferences
    if (lower.includes("prefer") || lower.includes("always") || lower.includes("never")) {
      confidence += 0.2;
    }
    
    // Boost confidence for override signals
    if (isOverride) {
      confidence += 0.1;
    }
    
    // Boost confidence for specific patterns
    if (lower.includes("from now on") || lower.includes("moving forward")) {
      confidence += 0.15;
    }
    
    return {
      key: this.getPreferenceKey(key, value, sentence),
      value,
      confidence: Math.min(confidence, 1.0),
      raw: sentence.trim(),
      isOverride,
      overrideSignals
    };
  }

  /**
   * Extract test location from sentence
   */
  private extractTestLocation(sentence: string, pattern: any): string | null {
    const match = sentence.match(pattern.valuePattern);
    if (match && match[1]) {
      return match[1].trim();
    }
    
    // Fallback: look for directory-like words after location words
    const words = sentence.split(/\s+/);
    for (let i = 0; i < words.length - 1; i++) {
      if (pattern.locationWords.some((locWord: string) => words[i].toLowerCase() === locWord)) {
        const nextWord = words[i + 1];
        if (nextWord && /^[\w\-\/\.]+$/.test(nextWord)) {
          return nextWord;
        }
      }
    }
    
    return null;
  }

  /**
   * Extract code style preferences
   */
  private extractCodeStyle(sentence: string, pattern: any): string | null {
    for (const stylePattern of pattern.patterns) {
      const match = sentence.match(stylePattern.pattern);
      if (match) {
        return stylePattern.extract(match);
      }
    }
    return null;
  }

  /**
   * Extract framework choice preferences
   */
  private extractFrameworkChoice(sentence: string, pattern: any): string | null {
    const lower = sentence.toLowerCase();
    
    for (const [category, frameworks] of Object.entries(pattern.frameworks)) {
      for (const framework of frameworks as string[]) {
        if (lower.includes(framework)) {
          return framework;
        }
      }
    }
    
    return null;
  }

  /**
   * Extract file organization preferences
   */
  private extractFileOrganization(sentence: string, pattern: any): string | null {
    const lower = sentence.toLowerCase();
    
    // Look for file type + location pattern
    for (const type of pattern.types) {
      if (lower.includes(type)) {
        const locationMatch = sentence.match(new RegExp(`${type}.*?(?:in|to|at|under)\\s+([\\w\\-\\/\\.]+)`, 'i'));
        if (locationMatch && locationMatch[1]) {
          return `${type}:${locationMatch[1]}`;
        }
      }
    }
    
    return null;
  }

  /**
   * Get the appropriate preference key based on the detected pattern
   */
  private getPreferenceKey(key: string, value: string, sentence: string): string {
    if (key === 'framework_choice') {
      return this.getFrameworkKey(value);
    } else if (key === 'code_style') {
      // Map code_style to more specific keys
      const lower = sentence.toLowerCase();
      if (lower.includes('indent') || lower.includes('spaces') || lower.includes('tabs')) {
        return 'indentation';
      } else if (lower.includes('quote')) {
        return 'quotes';
      } else if (lower.includes('semicolon')) {
        return 'semicolons';
      }
    }
    
    return key;
  }

  /**
   * Get the appropriate framework key based on detected framework
   */
  private getFrameworkKey(framework: string): string {
    const frameworkMappings: Record<string, string> = {
      'axios': 'http_client',
      'fetch': 'http_client',
      'superagent': 'http_client',
      'got': 'http_client',
      'jest': 'test_framework',
      'vitest': 'test_framework',
      'mocha': 'test_framework',
      'jasmine': 'test_framework',
      'cypress': 'test_framework',
      'webpack': 'build_tool',
      'vite': 'build_tool',
      'rollup': 'build_tool',
      'parcel': 'build_tool',
      'react': 'ui_framework',
      'vue': 'ui_framework',
      'angular': 'ui_framework',
      'svelte': 'ui_framework'
    };
    
    return frameworkMappings[framework] || 'framework_choice';
  }

  /**
   * Detect override signals in sentence
   */
  private detectOverrideSignals(sentence: string): string[] {
    const lower = sentence.toLowerCase();
    const signals: string[] = [];
    
    for (const [category, signalList] of Object.entries(this.OVERRIDE_SIGNALS)) {
      for (const signal of signalList) {
        if (lower.includes(signal.toLowerCase())) {
          signals.push(signal);
        }
      }
    }
    
    return signals;
  }

  /**
   * Split text into sentences for processing
   */
  private splitIntoSentences(text: string): string[] {
    // Enhanced sentence splitting that handles common patterns
    return text.split(/[.!?]+|(?:\n\s*\n)/)
               .map(s => s.trim())
               .filter(s => s.length > 10) // Filter out very short fragments
               .map(s => s.replace(/\s+/g, ' ')); // Normalize whitespace
  }
}
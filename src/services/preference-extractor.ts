import { LoggingService } from './logging';

export interface ExtractedPreference {
  key: string;           // e.g., "test_location", "code_style"
  value: string | { category: string; value: string; raw: string; };         // e.g., "tests-arlo", "4_spaces", or devops object
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
    },
    project_info: {
      // Generic key-value patterns for project information (IDs, endpoints, URLs, etc.)
      // Broad triggers - these are words commonly used when providing project details
      triggers: ["id", "endpoint", "api", "url", "configured", "our", "using", "is", ":", "have"],
      patterns: [
        // Pattern: "X ID is Y" or "X ID: Y"
        { pattern: /([\w\s]+)\s*(?:ID|id)\s*(?:is|:)\s*([^\s,;]+)/i, keyIndex: 1, valueIndex: 2 },
        // Pattern: "X endpoint is Y" or "X endpoint: Y"
        { pattern: /([\w\s]+)\s*(?:endpoint|api)\s*(?:is|:)\s*([^\s,;]+)/i, keyIndex: 1, valueIndex: 2 },
        // Pattern: "X URL is Y" or "X URL: Y"
        { pattern: /([\w\s]+)\s*(?:URL|url)\s*(?:is|:)\s*([^\s,;]+)/i, keyIndex: 1, valueIndex: 2 },
        // Pattern: "configured to X" or "configured as X"
        { pattern: /configured\s+(?:to|as)\s+([^\s,;.]+)/i, keyIndex: 0, valueIndex: 1, keyDefault: "configuration" },
        // Pattern: "our X is Y"
        { pattern: /our\s+([\w\s]+)\s+(?:is|:)\s+([^\s,;]+)/i, keyIndex: 1, valueIndex: 2 },
        // Pattern: "we're using X for Y" or "we use X"
        { pattern: /we(?:'re| are)?\s+using\s+([^\s,;.]+)/i, keyIndex: 0, valueIndex: 1, keyDefault: "tool" }
      ]
    },
    devops: {
      // DevOps workflows, development practices, git conventions, testing approaches
      // All patterns are generic and work across any project domain
      triggers: [
        "built with", "develop on", "test on", "deploy", "workflow",
        "always", "must", "never", "architecture", "strategy",
        "git", "commit", "branch", "tdd", "testing"
      ],
      patterns: [
        // Project identity patterns
        { pattern: /this\s+(?:is|will be)\s+(?:a|an)\s+(.+?)(?:\.|$)/i, category: "project_purpose" },
        { pattern: /(?:building|creating)\s+(?:a|an)\s+(.+?)(?:\.|$)/i, category: "project_purpose" },

        // Tech stack patterns
        { pattern: /built\s+with\s+(.+?)(?:\.|,|and|$)/i, category: "tech_stack" },
        { pattern: /(?:frontend|backend|database|framework).*?(?:is|uses?)\s+(.+?)(?:\.|,|$)/i, category: "tech_stack" },

        // Dev environment patterns
        { pattern: /(?:develop|code|work)\s+(?:on|in|with)\s+(.+?)(?:\.|,|for|$)/i, category: "dev_environment" },
        { pattern: /use\s+(WSL|Windows|Linux|Mac|macOS|Docker).*?for\s+(.+?)(?:\.|,|$)/i, category: "dev_environment" },

        // Workflow rule patterns
        { pattern: /always\s+(.+?)\s+before\s+(.+?)(?:\.|$)/i, category: "workflow_rule" },
        { pattern: /must\s+(.+?)(?:\.|,|before|after)/i, category: "workflow_rule" },
        { pattern: /never\s+(.+?)(?:\.|,|$)/i, category: "workflow_rule" },

        // Git workflow patterns
        { pattern: /(?:create|use|make)\s+.*?branch.*?(?:from|for)\s+(.+?)(?:\.|$)/i, category: "git_workflow" },
        { pattern: /commit.*?(?:format|style|convention).*?(?:is|uses?)\s+(.+?)(?:\.|$)/i, category: "git_workflow" },
        { pattern: /(?:merge|squash|rebase).*?(?:before|after|into)\s+(.+?)(?:\.|$)/i, category: "git_workflow" },

        // Testing approach patterns
        { pattern: /(?:use|follow|practice)\s+(TDD|test[- ]driven|BDD|behavior[- ]driven)/i, category: "testing_approach" },
        { pattern: /tests?\s+(?:go|belong|are|live)\s+in\s+(.+?)(?:\.|$)/i, category: "testing_approach" },
        { pattern: /(?:write|run)\s+tests?\s+(?:before|after|for)\s+(.+?)(?:\.|$)/i, category: "testing_approach" },

        // Architecture patterns
        { pattern: /(?:uses?|follows?)\s+(.+?)\s+(?:architecture|pattern|design)(?:\.|$)/i, category: "architecture" },
        { pattern: /(?:microservices?|monolith|serverless|event[- ]driven)/i, category: "architecture" },

        // Dependency patterns
        { pattern: /requires?\s+(.+?)(?:\.|,|for)/i, category: "dependency" },
        { pattern: /depends?\s+on\s+(.+?)(?:\.|$)/i, category: "dependency" },

        // Build/deploy patterns
        { pattern: /(?:build|deploy|run)\s+(?:with|using)\s+(.+?)(?:\.|$)/i, category: "build_deploy" },
        { pattern: /(?:docker|container|kubernetes|k8s)/i, category: "build_deploy" }
      ]
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
          if (preference && preference.confidence >= 0.5) { // Lowered threshold for broader capture
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
      "prefer", "always", "never", "from now on",
      "moving forward", "going forward", "henceforth",
      // Team/project context
      "our", "we're using", "we have", "we use"
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
      case 'project_info':
        return this.extractProjectInfo(sentence, pattern);
      case 'devops':
        return this.extractDevOps(sentence, pattern);
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
   * Extract generic project information (IDs, endpoints, URLs, configurations)
   */
  private extractProjectInfo(sentence: string, pattern: any): ExtractedPreference | null {
    // Try each pattern
    for (const infoPattern of pattern.patterns) {
      const match = sentence.match(infoPattern.pattern);
      if (match) {
        let key: string;
        let value: string;

        // Extract key based on pattern configuration
        if (infoPattern.keyIndex > 0 && match[infoPattern.keyIndex]) {
          key = match[infoPattern.keyIndex].trim().toLowerCase().replace(/\s+/g, '_');
        } else if (infoPattern.keyDefault) {
          key = infoPattern.keyDefault;
        } else {
          continue; // Skip if no key found
        }

        // Extract value
        if (match[infoPattern.valueIndex]) {
          value = match[infoPattern.valueIndex].trim();
        } else {
          continue; // Skip if no value found
        }

        // Detect override intent
        const overrideSignals = this.detectOverrideSignals(sentence);
        const isOverride = overrideSignals.length > 0;

        // Set confidence based on pattern specificity
        let confidence = 0.6; // Base confidence for project info

        // Boost confidence for explicit patterns (ID, endpoint, URL)
        const lower = sentence.toLowerCase();
        if (lower.includes(' id') || lower.includes('endpoint') || lower.includes('url')) {
          confidence += 0.15;
        }

        // Boost confidence for team context ("our", "we")
        if (lower.includes('our ') || lower.includes('we')) {
          confidence += 0.1;
        }

        // Boost confidence for override signals
        if (isOverride) {
          confidence += 0.1;
        }

        return {
          key,
          value,
          confidence: Math.min(confidence, 1.0),
          raw: sentence.trim(),
          isOverride,
          overrideSignals
        };
      }
    }

    return null;
  }

  /**
   * Extract DevOps workflow patterns (git, testing, build, environment)
   */
  private extractDevOps(sentence: string, pattern: any): ExtractedPreference | null {
    const lower = sentence.toLowerCase();

    // Try each devops pattern
    for (const devopsPattern of pattern.patterns) {
      const match = sentence.match(devopsPattern.pattern);
      if (match) {
        // Extract matched content
        const matchedText = match[0];
        const category = devopsPattern.category;

        // Determine key based on category
        let key = category;
        let value = matchedText.trim();

        // Extract more specific value if captured group exists
        if (match[1]) {
          value = match[1].trim();
        }

        // Detect override intent
        const overrideSignals = this.detectOverrideSignals(sentence);
        const isOverride = overrideSignals.length > 0;

        // Set confidence based on pattern type and keywords
        let confidence = 0.7; // Base confidence for devops

        // Boost confidence for strong keywords
        if (lower.includes('always') || lower.includes('never') || lower.includes('must')) {
          confidence += 0.2;
        }

        // Boost confidence for specific categories
        if (category === 'workflow_rule' || category === 'git_workflow') {
          confidence += 0.1;
        }

        // Boost confidence for explicit practices
        if (lower.includes('tdd') || lower.includes('test-driven') || lower.includes('ci/cd')) {
          confidence += 0.15;
        }

        // Boost confidence for team context
        if (lower.includes('our ') || lower.includes('we ') || lower.includes('team')) {
          confidence += 0.1;
        }

        // Boost confidence for override signals
        if (isOverride) {
          confidence += 0.1;
        }

        return {
          key: `devops_${category}`,
          value: {
            category,
            value,
            raw: matchedText
          },
          confidence: Math.min(confidence, 1.0),
          raw: sentence.trim(),
          isOverride,
          overrideSignals
        };
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
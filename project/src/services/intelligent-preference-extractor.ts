import { LoggingService } from './logging';
import { ClaudeNLPAnalyzer, NLPAnalysis } from './claude-nlp-analyzer';

export interface IntelligentPreference {
  key: string;
  value: any;
  confidence: number;
  rawText: string;
  analysis: NLPAnalysis;
  metadata: {
    timestamp: number;
    sessionId?: string;
    projectId?: string;
    source: 'direct' | 'inferred' | 'corrected';
    reasoning: string;
  };
}

export interface PreferenceContext {
  recentMemories?: any[];
  projectContext?: any;
  sessionHistory?: string[];
}

export class IntelligentPreferenceExtractor {
  private logger = LoggingService.getInstance();
  private nlpAnalyzer: ClaudeNLPAnalyzer;
  private preferenceCache: Map<string, IntelligentPreference[]> = new Map();

  constructor(apiKey?: string) {
    this.nlpAnalyzer = new ClaudeNLPAnalyzer(apiKey);
  }

  /**
   * Extract preferences using true NLP understanding
   */
  async extractPreferences(
    text: string, 
    context?: PreferenceContext
  ): Promise<IntelligentPreference[]> {
    try {
      // Step 1: Analyze the text with NLP
      const analysis = await this.nlpAnalyzer.analyzeText(text, {
        recentMemories: context?.recentMemories?.slice(0, 5),
        hasSessionHistory: !!context?.sessionHistory?.length
      });

      // Step 2: If no preference detected, return empty
      if (analysis.intent.type !== 'preference' || analysis.confidence < 0.5) {
        this.logger.debug('IntelligentPreferenceExtractor', 'No preference detected', {
          text: text.substring(0, 50) + '...',
          intentType: analysis.intent.type,
          confidence: analysis.confidence
        });
        return [];
      }

      // Step 3: Build intelligent preference from analysis
      const preferences: IntelligentPreference[] = [];

      if (analysis.preference) {
        const preference = await this.buildIntelligentPreference(
          text,
          analysis,
          context
        );
        
        if (preference) {
          preferences.push(preference);
          
          // Check for related preferences
          const related = await this.inferRelatedPreferences(preference, context);
          preferences.push(...related);
        }
      }

      // Step 4: Validate against existing preferences
      if (context?.recentMemories) {
        await this.validateAgainstExisting(preferences, context.recentMemories);
      }

      // Cache the results
      this.cachePreferences(text, preferences);

      return preferences;
    } catch (error) {
      this.logger.logServiceError('IntelligentPreferenceExtractor', 'extractPreferences', error as Error);
      return [];
    }
  }

  /**
   * Extract preferences from code corrections
   */
  async extractFromCorrection(
    original: string,
    corrected: string,
    context?: PreferenceContext
  ): Promise<IntelligentPreference[]> {
    try {
      const analysis = await this.nlpAnalyzer.analyzeCodeCorrection(original, corrected);
      
      if (!analysis.preference) {
        return [];
      }

      const preference: IntelligentPreference = {
        key: analysis.preference.key,
        value: analysis.preference.value,
        confidence: analysis.confidence,
        rawText: `Correction: ${original} → ${corrected}`,
        analysis,
        metadata: {
          timestamp: Date.now(),
          source: 'corrected',
          reasoning: analysis.reasoning,
          sessionId: context?.sessionHistory?.[0],
          projectId: context?.projectContext?.projectId
        }
      };

      return [preference];
    } catch (error) {
      this.logger.logServiceError('IntelligentPreferenceExtractor', 'extractFromCorrection', error as Error);
      return [];
    }
  }

  /**
   * Build an intelligent preference from NLP analysis
   */
  private async buildIntelligentPreference(
    text: string,
    analysis: NLPAnalysis,
    context?: PreferenceContext
  ): Promise<IntelligentPreference | null> {
    if (!analysis.preference) return null;

    const preference: IntelligentPreference = {
      key: analysis.preference.key,
      value: analysis.preference.value,
      confidence: analysis.confidence,
      rawText: text,
      analysis,
      metadata: {
        timestamp: Date.now(),
        source: 'direct',
        reasoning: analysis.preference.reasoning,
        sessionId: context?.sessionHistory?.[0],
        projectId: context?.projectContext?.projectId
      }
    };

    // Enhance with contextual understanding
    if (context?.recentMemories) {
      const enhancement = await this.enhanceWithContext(preference, context.recentMemories);
      if (enhancement) {
        preference.confidence = enhancement.confidence;
        preference.metadata.reasoning += `. ${enhancement.reasoning}`;
      }
    }

    return preference;
  }

  /**
   * Infer related preferences based on the primary preference
   */
  private async inferRelatedPreferences(
    primary: IntelligentPreference,
    context?: PreferenceContext
  ): Promise<IntelligentPreference[]> {
    const related: IntelligentPreference[] = [];

    // Example: If user sets test location, infer test framework preference
    if (primary.key === 'test_location' && primary.value.includes('vitest')) {
      const inferred: IntelligentPreference = {
        key: 'test_framework',
        value: 'vitest',
        confidence: primary.confidence * 0.7,
        rawText: primary.rawText,
        analysis: primary.analysis,
        metadata: {
          ...primary.metadata,
          source: 'inferred',
          reasoning: `Inferred from test location containing 'vitest'`
        }
      };
      related.push(inferred);
    }

    // Example: If user prefers tabs, infer they might want tab-based formatting
    if (primary.key === 'indentation' && primary.value === 'tabs') {
      const formattingPref: IntelligentPreference = {
        key: 'formatting_style',
        value: 'tab-based',
        confidence: primary.confidence * 0.6,
        rawText: primary.rawText,
        analysis: primary.analysis,
        metadata: {
          ...primary.metadata,
          source: 'inferred',
          reasoning: `Inferred from tab preference`
        }
      };
      related.push(formattingPref);
    }

    return related;
  }

  /**
   * Enhance preference with contextual information
   */
  private async enhanceWithContext(
    preference: IntelligentPreference,
    recentMemories: any[]
  ): Promise<{ confidence: number; reasoning: string } | null> {
    // Check if this preference aligns with recent behavior
    const relatedMemories = recentMemories.filter(m => 
      m.type === 'preference' && 
      m.value?.preference_key === preference.key
    );

    if (relatedMemories.length > 0) {
      // This is likely an override
      return {
        confidence: Math.min(preference.confidence * 1.2, 1.0),
        reasoning: 'Confidence boosted due to existing preference history'
      };
    }

    // Check for conflicting preferences
    const conflicts = recentMemories.filter(m =>
      m.type === 'preference' &&
      this.isConflicting(m.value, preference)
    );

    if (conflicts.length > 0) {
      return {
        confidence: preference.confidence * 0.8,
        reasoning: 'Confidence reduced due to potential conflicts'
      };
    }

    return null;
  }

  /**
   * Validate preferences against existing ones
   */
  private async validateAgainstExisting(
    preferences: IntelligentPreference[],
    existingMemories: any[]
  ): Promise<void> {
    const existingPrefs = existingMemories
      .filter(m => m.type === 'preference' && m.is_active)
      .map(m => m.value);

    if (existingPrefs.length === 0) return;

    for (const pref of preferences) {
      const validation = await this.nlpAnalyzer.analyzePreferenceContext(
        existingPrefs,
        pref.rawText
      );

      if (validation.conflicts.length > 0) {
        this.logger.warn('IntelligentPreferenceExtractor', 'Preference conflict detected', {
          preference: pref.key,
          conflicts: validation.conflicts
        });
        pref.confidence *= 0.9;
      }

      if (validation.reinforcements.length > 0) {
        this.logger.debug('IntelligentPreferenceExtractor', 'Preference reinforcement detected', {
          preference: pref.key,
          reinforcements: validation.reinforcements
        });
        pref.confidence = Math.min(pref.confidence * 1.1, 1.0);
      }
    }
  }

  /**
   * Check if two preferences conflict
   */
  private isConflicting(existing: any, newPref: IntelligentPreference): boolean {
    if (!existing.preference_key) return false;
    
    // Same key with different value
    if (existing.preference_key === newPref.key && existing.value !== newPref.value) {
      return true;
    }

    // Known conflicts
    const conflictMap: Record<string, string[]> = {
      'indentation': ['formatting_style'],
      'test_framework': ['test_runner'],
      'build_tool': ['bundler']
    };

    const conflicts = conflictMap[newPref.key] || [];
    return conflicts.includes(existing.preference_key);
  }

  /**
   * Cache preferences for session
   */
  private cachePreferences(text: string, preferences: IntelligentPreference[]): void {
    const cacheKey = text.substring(0, 50);
    this.preferenceCache.set(cacheKey, preferences);

    // Limit cache size
    if (this.preferenceCache.size > 100) {
      const firstKey = this.preferenceCache.keys().next().value;
      if (firstKey) this.preferenceCache.delete(firstKey);
    }
  }

  /**
   * Get cached preferences if available
   */
  getCached(text: string): IntelligentPreference[] | null {
    const cacheKey = text.substring(0, 50);
    return this.preferenceCache.get(cacheKey) || null;
  }

  /**
   * Clear the preference cache
   */
  clearCache(): void {
    this.preferenceCache.clear();
  }
}
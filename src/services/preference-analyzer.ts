/**
 * Preference Analyzer Service
 * Phase 2: Automatic preference detection and analysis triggers
 *
 * This service:
 * 1. Detects preference signals in tool calls (keywords, patterns)
 * 2. Suggests when Claude Code should analyze conversations
 * 3. Stores a "pending-analysis" memory that appears in active context
 * 4. Claude Code sees the suggestion and can analyze using the prompt template
 */

import { LoggingService } from './logging';
import { MemoryService } from './memory';
import { SessionManager, ConversationTurn } from '../mcp/session-manager';

export interface PreferenceSignal {
  keyword: string;
  confidence: number;
  context: string;
}

export interface AnalysisSuggestion {
  sessionId: string;
  reason: string;
  conversationTurns: number;
  preferenceSignals: number;
  suggestedAt: number;
}

export class PreferenceAnalyzer {
  private logger: LoggingService;
  private memoryService: MemoryService;
  private sessionManager: SessionManager;

  // Keywords that indicate preference statements
  private readonly PREFERENCE_KEYWORDS = [
    'prefer', 'always', 'never', 'use', 'avoid',
    'like', 'dislike', 'should', 'shouldn\'t',
    'better', 'worse', 'instead', 'rather',
    'convention', 'standard', 'practice', 'pattern',
    'remember', 'save', 'keep', 'store'
  ];

  // Keywords that indicate corrections (learning opportunities)
  private readonly CORRECTION_KEYWORDS = [
    'no', 'wrong', 'incorrect', 'actually', 'meant',
    'fix', 'change', 'correct', 'should be',
    'not like that', 'different', 'instead'
  ];

  constructor(
    logger: LoggingService,
    memoryService: MemoryService,
    sessionManager: SessionManager
  ) {
    this.logger = logger;
    this.memoryService = memoryService;
    this.sessionManager = sessionManager;
  }

  /**
   * Detect if a tool input/output contains preference signals
   * Returns true if preference keywords are found
   */
  detectPreferenceSignals(input: any, output: any): PreferenceSignal[] {
    const signals: PreferenceSignal[] = [];

    // Check input text for preference keywords
    const inputText = this.extractText(input);
    signals.push(...this.findKeywords(inputText, this.PREFERENCE_KEYWORDS, 'input'));

    // Check output text for correction keywords
    const outputText = this.extractText(output);
    signals.push(...this.findKeywords(outputText, this.CORRECTION_KEYWORDS, 'output'));

    return signals;
  }

  /**
   * Extract text from various input/output formats
   */
  private extractText(data: any): string {
    if (typeof data === 'string') {
      return data.toLowerCase();
    }

    if (typeof data === 'object' && data !== null) {
      // Handle common structures
      if (data.content) return this.extractText(data.content);
      if (data.text) return this.extractText(data.text);
      if (data.message) return this.extractText(data.message);

      // Flatten all string values
      return Object.values(data)
        .filter(v => typeof v === 'string')
        .join(' ')
        .toLowerCase();
    }

    return '';
  }

  /**
   * Find preference keywords in text
   */
  private findKeywords(
    text: string,
    keywords: string[],
    context: string
  ): PreferenceSignal[] {
    const signals: PreferenceSignal[] = [];

    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        signals.push({
          keyword,
          confidence: this.calculateKeywordConfidence(keyword, text),
          context
        });
      }
    }

    return signals;
  }

  /**
   * Calculate confidence based on keyword strength and context
   */
  private calculateKeywordConfidence(keyword: string, text: string): number {
    // Base confidence
    let confidence = 0.5;

    // Strong keywords
    const strongKeywords = ['always', 'never', 'prefer', 'convention', 'standard'];
    if (strongKeywords.includes(keyword)) {
      confidence = 0.8;
    }

    // Boost if appears multiple times
    const occurrences = (text.match(new RegExp(keyword, 'g')) || []).length;
    if (occurrences > 1) {
      confidence = Math.min(1.0, confidence + 0.1 * (occurrences - 1));
    }

    return confidence;
  }

  /**
   * Check if session should be analyzed and create suggestion
   * This is called after each tool call
   */
  async checkAndSuggestAnalysis(sessionId: string): Promise<void> {
    // Check if session meets analysis criteria
    if (!this.sessionManager.shouldAnalyzeSession(sessionId)) {
      return;
    }

    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      return;
    }

    // Create analysis suggestion
    const suggestion: AnalysisSuggestion = {
      sessionId,
      reason: this.generateReason(session),
      conversationTurns: session.conversationHistory?.length || 0,
      preferenceSignals: session.preferenceSignalCount || 0,
      suggestedAt: Date.now()
    };

    // Store as a special memory type that appears in active context
    await this.createAnalysisSuggestionMemory(suggestion);

    this.logger.info('PreferenceAnalyzer', 'Analysis suggested', {
      sessionId,
      reason: suggestion.reason
    });
  }

  /**
   * Generate reason text for why analysis is suggested
   */
  private generateReason(session: any): string {
    const turns = session.conversationHistory?.length || 0;
    const signals = session.preferenceSignalCount || 0;
    const lastAnalyzed = session.lastAnalyzedTurn || 0;
    const unanalyzed = turns - lastAnalyzed;

    if (signals >= 3) {
      return `Detected ${signals} preference signals in recent conversation`;
    }

    if (unanalyzed >= 5) {
      return `${unanalyzed} conversation turns since last analysis`;
    }

    return 'Time for preference analysis';
  }

  /**
   * Create a special "analysis-suggestion" memory
   * This will appear in the active context resource, making it visible to Claude Code
   */
  private async createAnalysisSuggestionMemory(suggestion: AnalysisSuggestion): Promise<void> {
    const key = `analysis-suggestion-${suggestion.sessionId}`;

    const value = {
      type: 'analysis-suggestion',
      message: `💡 **Preference Analysis Suggested**\n\nI've noticed patterns in our conversation that might contain preferences worth remembering.\n\n**Details:**\n- Reason: ${suggestion.reason}\n- Conversation turns: ${suggestion.conversationTurns}\n- Preference signals detected: ${suggestion.preferenceSignals}\n\n**What to do:**\nYou can ask me to analyze our conversation by saying:\n"Can you analyze our conversation for preferences?"\n\nI'll use the \`analyze-for-preferences\` prompt to extract any coding preferences, conventions, or patterns from our discussion.`,
      ...suggestion
    };

    await this.memoryService.store({
      key,
      value,
      type: 'analysis-suggestion',
      context: {
        sessionId: suggestion.sessionId,
        timestamp: Date.now()
      }
    });

    this.logger.debug('PreferenceAnalyzer', 'Created analysis suggestion memory', {
      key,
      sessionId: suggestion.sessionId
    });
  }

  /**
   * Get conversation text for analysis
   */
  getConversationForAnalysis(sessionId: string): string {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      return '';
    }

    const lastAnalyzed = session.lastAnalyzedTurn || 0;
    return this.sessionManager.getConversationText(sessionId, lastAnalyzed);
  }

  /**
   * Mark session as analyzed
   */
  markSessionAnalyzed(sessionId: string): void {
    const session = this.sessionManager.getSession(sessionId);
    if (session?.conversationHistory) {
      const turnNumber = session.conversationHistory.length;
      this.sessionManager.markAnalyzed(sessionId, turnNumber);

      // Note: Analysis suggestion will auto-expire after 1 hour
      // We could add a delete method to MemoryService in the future
      // For now, the suggestion will naturally expire

      this.logger.info('PreferenceAnalyzer', 'Session marked as analyzed', {
        sessionId,
        turnNumber
      });
    }
  }

  /**
   * Store extracted preferences from Claude Code's analysis
   * This is called after Claude analyzes the conversation
   */
  async storeExtractedPreferences(
    preferences: Array<{
      key: string;
      value: any;
      confidence: number;
      reasoning?: string;
    }>,
    sessionId: string
  ): Promise<void> {
    this.logger.info('PreferenceAnalyzer', 'Storing extracted preferences', {
      count: preferences.length,
      sessionId
    });

    for (const pref of preferences) {
      try {
        await this.memoryService.store({
          key: pref.key,
          value: {
            value: pref.value,
            confidence: pref.confidence,
            reasoning: pref.reasoning,
            source: 'claude-analysis',
            analyzedAt: Date.now(),
            sessionId
          },
          type: 'preference',
          context: {
            sessionId,
            timestamp: Date.now()
          }
        });

        this.logger.debug('PreferenceAnalyzer', 'Stored preference', {
          key: pref.key,
          confidence: pref.confidence
        });
      } catch (error) {
        this.logger.error('PreferenceAnalyzer', 'Failed to store preference', error);
      }
    }

    // Mark session as analyzed
    this.markSessionAnalyzed(sessionId);
  }
}

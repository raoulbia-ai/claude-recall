/**
 * Conversation Context Manager
 * Phase 4 Extension: Track recent actions within conversation to detect duplicates
 *
 * This service:
 * 1. Records recent actions performed (tool calls, analyses, searches)
 * 2. Detects duplicate requests within the same conversation
 * 3. Provides context-aware responses instead of repetition
 * 4. Maintains short-term memory of current conversation flow
 */

import { LoggingService } from './logging';

export interface ActionRecord {
  action: string;           // Type of action (e.g., "analyze_preferences", "search_memories")
  actionKey: string;        // Normalized key for duplicate detection
  timestamp: number;        // When action was performed
  turnNumber: number;       // Which turn in the conversation
  input: any;               // Input that triggered the action
  result: any;              // Result of the action
  sessionId: string;        // Session this action belongs to
}

export interface DuplicateDetectionResult {
  isDuplicate: boolean;
  previousAction?: ActionRecord;
  turnsSince?: number;
  suggestion?: string;
}

export class ConversationContextManager {
  private static instance: ConversationContextManager;
  private logger: LoggingService;

  // Track actions per session: sessionId -> array of action records
  private sessionActions: Map<string, ActionRecord[]> = new Map();

  // Track current turn number per session
  private sessionTurns: Map<string, number> = new Map();

  // Configuration
  private readonly MAX_ACTIONS_PER_SESSION = 50;
  private readonly DUPLICATE_DETECTION_WINDOW = 3; // Check last 3 turns
  private readonly SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

  private constructor() {
    this.logger = LoggingService.getInstance();
  }

  static getInstance(): ConversationContextManager {
    if (!ConversationContextManager.instance) {
      ConversationContextManager.instance = new ConversationContextManager();
    }
    return ConversationContextManager.instance;
  }

  /**
   * Record an action that was performed
   */
  recordAction(
    sessionId: string,
    action: string,
    input: any,
    result: any
  ): void {
    try {
      // Increment turn counter
      const currentTurn = (this.sessionTurns.get(sessionId) || 0) + 1;
      this.sessionTurns.set(sessionId, currentTurn);

      // Create normalized action key for duplicate detection
      const actionKey = this.normalizeActionKey(action, input);

      const record: ActionRecord = {
        action,
        actionKey,
        timestamp: Date.now(),
        turnNumber: currentTurn,
        input,
        result,
        sessionId
      };

      // Get or create action history for session
      const actions = this.sessionActions.get(sessionId) || [];
      actions.push(record);

      // Keep only recent actions (prevent memory bloat)
      if (actions.length > this.MAX_ACTIONS_PER_SESSION) {
        actions.shift(); // Remove oldest
      }

      this.sessionActions.set(sessionId, actions);

      this.logger.debug('ConversationContextManager', 'Recorded action', {
        sessionId,
        action,
        actionKey,
        turn: currentTurn,
        totalActions: actions.length
      });

    } catch (error) {
      this.logger.error('ConversationContextManager', 'Failed to record action', error);
    }
  }

  /**
   * Check if an action was recently performed (duplicate detection)
   */
  checkForDuplicate(
    sessionId: string,
    action: string,
    input: any
  ): DuplicateDetectionResult {
    try {
      const actions = this.sessionActions.get(sessionId);
      if (!actions || actions.length === 0) {
        return { isDuplicate: false };
      }

      const actionKey = this.normalizeActionKey(action, input);
      const currentTurn = this.sessionTurns.get(sessionId) || 0;

      // Search recent actions (within detection window)
      const recentActions = actions
        .filter(a => (currentTurn - a.turnNumber) <= this.DUPLICATE_DETECTION_WINDOW)
        .reverse(); // Most recent first

      for (const previousAction of recentActions) {
        // Check if same action with similar input
        if (previousAction.actionKey === actionKey) {
          const turnsSince = currentTurn - previousAction.turnNumber;

          return {
            isDuplicate: true,
            previousAction,
            turnsSince,
            suggestion: this.generateDuplicateSuggestion(previousAction, turnsSince)
          };
        }
      }

      return { isDuplicate: false };

    } catch (error) {
      this.logger.error('ConversationContextManager', 'Failed to check for duplicate', error);
      return { isDuplicate: false };
    }
  }

  /**
   * Get recent actions for a session
   */
  getRecentActions(sessionId: string, limit: number = 10): ActionRecord[] {
    const actions = this.sessionActions.get(sessionId) || [];
    return actions.slice(-limit).reverse(); // Most recent first
  }

  /**
   * Get the result of a recent action
   */
  getRecentResult(sessionId: string, action: string): any | null {
    const actions = this.sessionActions.get(sessionId);
    if (!actions || actions.length === 0) {
      return null;
    }

    // Find most recent matching action
    for (let i = actions.length - 1; i >= 0; i--) {
      if (actions[i].action === action) {
        return actions[i].result;
      }
    }

    return null;
  }

  /**
   * Clear session context (when session ends or times out)
   */
  clearSession(sessionId: string): void {
    this.sessionActions.delete(sessionId);
    this.sessionTurns.delete(sessionId);

    this.logger.debug('ConversationContextManager', 'Cleared session context', {
      sessionId
    });
  }

  /**
   * Clear all sessions (useful for testing)
   */
  clearAllSessions(): void {
    this.sessionActions.clear();
    this.sessionTurns.clear();

    this.logger.debug('ConversationContextManager', 'Cleared all sessions');
  }

  /**
   * Clean up old sessions
   */
  cleanup(): void {
    const now = Date.now();
    let removedCount = 0;

    for (const [sessionId, actions] of this.sessionActions.entries()) {
      if (actions.length === 0) {
        this.clearSession(sessionId);
        removedCount++;
        continue;
      }

      // Check if session has timed out
      const lastAction = actions[actions.length - 1];
      if ((now - lastAction.timestamp) > this.SESSION_TIMEOUT) {
        this.clearSession(sessionId);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      this.logger.info('ConversationContextManager', 'Cleaned up old sessions', {
        removedSessions: removedCount
      });
    }
  }

  /**
   * Get statistics about tracked sessions
   */
  getStats(): {
    activeSessions: number;
    totalActions: number;
    averageActionsPerSession: number;
  } {
    const activeSessions = this.sessionActions.size;
    const totalActions = Array.from(this.sessionActions.values())
      .reduce((sum, actions) => sum + actions.length, 0);
    const averageActionsPerSession = activeSessions > 0
      ? totalActions / activeSessions
      : 0;

    return {
      activeSessions,
      totalActions,
      averageActionsPerSession: Math.round(averageActionsPerSession * 10) / 10
    };
  }

  // ========== PRIVATE HELPER METHODS ==========

  /**
   * Normalize action key for duplicate detection
   * This creates a consistent identifier for similar actions
   */
  private normalizeActionKey(action: string, input: any): string {
    // Start with action type
    let key = action.toLowerCase();

    // Add relevant input parameters (normalized)
    if (input) {
      if (typeof input === 'string') {
        // Normalize string input (lowercase, trim, remove extra spaces)
        key += ':' + input.toLowerCase().trim().replace(/\s+/g, ' ');
      } else if (typeof input === 'object') {
        // Extract key fields from object
        const relevantFields = ['query', 'content', 'type', 'name'];
        const keyParts: string[] = [];

        for (const field of relevantFields) {
          if (input[field]) {
            const value = String(input[field]).toLowerCase().trim();
            keyParts.push(`${field}:${value}`);
          }
        }

        if (keyParts.length > 0) {
          key += ':' + keyParts.join('|');
        }
      }
    }

    // Truncate to prevent extremely long keys
    if (key.length > 200) {
      key = key.substring(0, 200);
    }

    return key;
  }

  /**
   * Generate helpful suggestion when duplicate is detected
   */
  private generateDuplicateSuggestion(
    previousAction: ActionRecord,
    turnsSince: number
  ): string {
    const suggestions: string[] = [];

    if (turnsSince === 0) {
      suggestions.push('I just performed this exact action in my previous response.');
    } else if (turnsSince === 1) {
      suggestions.push('I performed this action in my last response.');
    } else {
      suggestions.push(`I performed this action ${turnsSince} turns ago.`);
    }

    // Add action-specific suggestions
    switch (previousAction.action) {
      case 'analyze_preferences':
        suggestions.push('Did you want me to re-analyze with different criteria, or were you looking for the previous results?');
        break;

      case 'search_memories':
        suggestions.push('Did you want to search with different keywords, or see the previous search results again?');
        break;

      case 'store_memory':
        suggestions.push('The memory has already been stored. Did you want to update it or store a different memory?');
        break;

      default:
        suggestions.push('Did you mean something different, or would you like me to repeat the previous result?');
    }

    return suggestions.join(' ');
  }
}

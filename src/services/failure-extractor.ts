import { Memory, StructuredMemoryValue } from '../memory/storage';
import { LoggingService } from './logging';

/**
 * Structured failure memory value (v0.7.0+)
 * Based on ReasoningBank's counterfactual reasoning approach
 */
export interface FailureMemoryContent {
  what_failed: string;  // What action/approach failed
  why_failed: string;   // Root cause analysis
  what_should_do: string;  // Counterfactual - what should have been done instead
  context: string;  // Situation where failure occurred
  preventative_checks: string[];  // Checks to prevent recurrence
  alternative_approaches?: string[];  // Other potential solutions
}

export interface TaskContext {
  query?: string;
  project_id?: string;
  file_path?: string;
  timestamp?: number;
}

/**
 * FailureExtractor Service (v0.7.0)
 *
 * Extracts failure memories with counterfactual reasoning from:
 * 1. Error objects + context
 * 2. User corrections ("That didn't work", "Failed")
 *
 * Inspired by ReasoningBank's approach to learning from failures
 */
export class FailureExtractor {
  private static instance: FailureExtractor;
  private logger: LoggingService;

  private constructor() {
    this.logger = LoggingService.getInstance();
  }

  static getInstance(): FailureExtractor {
    if (!FailureExtractor.instance) {
      FailureExtractor.instance = new FailureExtractor();
    }
    return FailureExtractor.instance;
  }

  /**
   * Extract failure memory from error + context
   */
  extractFromError(
    error: Error,
    context: TaskContext,
    attemptedAction: string
  ): Memory | null {
    try {
      const whatFailed = this.extractWhatFailed(error, attemptedAction);
      const whyFailed = this.inferWhyFailed(error, context);
      const whatShouldDo = this.suggestAlternative(error, context);

      if (!whatFailed || !whyFailed) {
        this.logger.debug('FailureExtractor', 'Insufficient data to extract failure', {
          error: error.message,
          action: attemptedAction
        });
        return null;
      }

      const content: FailureMemoryContent = {
        what_failed: whatFailed,
        why_failed: whyFailed,
        what_should_do: whatShouldDo || 'Review error details and adjust approach',
        context: context.query || attemptedAction || 'Unknown context',
        preventative_checks: this.generateChecks(whatFailed, whyFailed),
        alternative_approaches: this.suggestAlternatives(error, context)
      };

      const value: StructuredMemoryValue = {
        title: `Avoid: ${this.truncate(whatFailed, 50)}`,
        description: this.truncate(whyFailed, 100),
        content
      };

      return {
        key: this.generateFailureKey(whatFailed, context),
        value,
        type: 'failure',
        project_id: context.project_id,
        file_path: context.file_path,
        confidence_score: 0.75,
        timestamp: context.timestamp || Date.now(),
        sophistication_level: 2  // Self-reflection level
      };
    } catch (err) {
      this.logger.error('FailureExtractor', 'Failed to extract failure memory', err);
      return null;
    }
  }

  /**
   * Extract failure memory from user correction
   */
  extractFromUserCorrection(
    userMessage: string,
    priorAction: string,
    context: TaskContext
  ): Memory | null {
    try {
      // Check if message indicates failure
      if (!this.isFailureIndicator(userMessage)) {
        return null;
      }

      const whatFailed = priorAction || 'Previous approach';
      const whyFailed = this.parseUserReason(userMessage) || 'User reported failure';
      const whatShouldDo = this.parseUserSolution(userMessage) || 'See user correction';

      const content: FailureMemoryContent = {
        what_failed: whatFailed,
        why_failed: whyFailed,
        what_should_do: whatShouldDo,
        context: context.query || userMessage,
        preventative_checks: []
      };

      const value: StructuredMemoryValue = {
        title: `User Correction: ${this.truncate(whatFailed, 50)}`,
        description: `User reported: ${this.truncate(whyFailed, 80)}`,
        content
      };

      return {
        key: this.generateFailureKey(whatFailed, context),
        value,
        type: 'failure',
        project_id: context.project_id,
        confidence_score: 0.9,  // High confidence from user feedback
        timestamp: context.timestamp || Date.now(),
        sophistication_level: 2
      };
    } catch (err) {
      this.logger.error('FailureExtractor', 'Failed to extract user correction', err);
      return null;
    }
  }

  /**
   * Extract what failed from error and action
   */
  private extractWhatFailed(error: Error, action: string): string {
    // Try to parse action for specific operation
    if (action) {
      // Clean up action description
      const cleanAction = action.replace(/^(tried to|attempting to|failed to)\s+/i, '');
      return cleanAction;
    }

    // Fall back to error message
    return error.message || 'Unknown operation';
  }

  /**
   * Infer why failure occurred based on error type
   */
  private inferWhyFailed(error: Error, context: TaskContext): string {
    const message = error.message.toLowerCase();

    // File system errors
    if (message.includes('enoent') || message.includes('no such file')) {
      return 'File does not exist at expected location';
    }
    if (message.includes('eacces') || message.includes('permission denied')) {
      return 'Permission denied - insufficient file access rights';
    }
    if (message.includes('eexist') || message.includes('already exists')) {
      return 'File or directory already exists at target location';
    }

    // Network/API errors
    if (message.includes('econnrefused') || message.includes('connection refused')) {
      return 'Connection refused - service may not be running';
    }
    if (message.includes('timeout') || message.includes('etimedout')) {
      return 'Operation timed out - service may be slow or unresponsive';
    }
    if (message.includes('404') || message.includes('not found')) {
      return 'Resource not found at specified endpoint';
    }

    // Code execution errors
    if (message.includes('syntaxerror')) {
      return 'Syntax error in code - invalid JavaScript/TypeScript syntax';
    }
    if (message.includes('referenceerror')) {
      return 'Reference error - variable or function not defined';
    }
    if (message.includes('typeerror')) {
      return 'Type error - unexpected type or undefined value';
    }

    // Generic fallback
    if (error.stack) {
      // Try to extract meaningful info from stack trace
      const firstLine = error.stack.split('\n')[0];
      return firstLine || error.message;
    }

    return error.message;
  }

  /**
   * Suggest counterfactual - what should have been done
   */
  private suggestAlternative(error: Error, context: TaskContext): string {
    const message = error.message.toLowerCase();

    // File system alternatives
    if (message.includes('enoent')) {
      return 'Verify file path exists before reading. Use fs.existsSync() or similar check.';
    }
    if (message.includes('eacces')) {
      return 'Check file permissions or run with appropriate user privileges.';
    }
    if (message.includes('eexist')) {
      return 'Check if file exists before creating, or use overwrite mode if intentional.';
    }

    // Network alternatives
    if (message.includes('econnrefused')) {
      return 'Verify service is running and accessible. Check host/port configuration.';
    }
    if (message.includes('timeout')) {
      return 'Increase timeout value or optimize service performance. Add retry logic.';
    }

    // Code alternatives
    if (message.includes('syntaxerror')) {
      return 'Review code syntax carefully. Run linter to identify issues.';
    }
    if (message.includes('referenceerror')) {
      return 'Ensure variable/function is defined before use. Check imports and scope.';
    }
    if (message.includes('typeerror')) {
      return 'Add null/undefined checks before accessing properties. Use optional chaining.';
    }

    return 'Review error message and documentation for correct usage.';
  }

  /**
   * Suggest multiple alternative approaches
   */
  private suggestAlternatives(error: Error, context: TaskContext): string[] {
    const message = error.message.toLowerCase();
    const alternatives: string[] = [];

    if (message.includes('enoent')) {
      alternatives.push('Use try-catch with fs.existsSync() before file operations');
      alternatives.push('Provide default file path or create file if missing');
      alternatives.push('Use absolute paths instead of relative paths');
    }

    if (message.includes('timeout')) {
      alternatives.push('Implement exponential backoff retry strategy');
      alternatives.push('Increase timeout threshold');
      alternatives.push('Add circuit breaker pattern for failing services');
    }

    return alternatives;
  }

  /**
   * Generate preventative checks
   */
  private generateChecks(whatFailed: string, whyFailed: string): string[] {
    const checks: string[] = [];
    const combined = `${whatFailed} ${whyFailed}`.toLowerCase();

    if (combined.includes('file') && combined.includes('not exist')) {
      checks.push('Verify file exists before reading (fs.existsSync)');
      checks.push('Handle ENOENT errors gracefully');
    }

    if (combined.includes('permission')) {
      checks.push('Check file/directory permissions before access');
      checks.push('Verify user has necessary access rights');
    }

    if (combined.includes('timeout') || combined.includes('connection')) {
      checks.push('Add timeout handling to network requests');
      checks.push('Implement retry logic for transient failures');
    }

    if (combined.includes('syntax') || combined.includes('type')) {
      checks.push('Run linter/type checker before execution');
      checks.push('Add unit tests to catch errors early');
    }

    if (combined.includes('null') || combined.includes('undefined')) {
      checks.push('Add null/undefined checks before property access');
      checks.push('Use optional chaining (?.) operator');
    }

    return checks;
  }

  /**
   * Generate unique failure key
   */
  private generateFailureKey(whatFailed: string, context: TaskContext): string {
    // Sanitize and truncate
    const sanitized = whatFailed
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 50);

    const projectSuffix = context.project_id ? `_${context.project_id}` : '_global';
    const timestamp = Date.now();

    return `failure_${sanitized}_${timestamp}${projectSuffix}`;
  }

  /**
   * Check if user message indicates failure
   */
  private isFailureIndicator(message: string): boolean {
    const lower = message.toLowerCase();
    const indicators = [
      "didn't work",
      "did not work",
      'failed',
      'error',
      'wrong',
      'incorrect',
      'broken',
      'not working',
      "doesn't work",
      'problem with',
      'issue with'
    ];

    return indicators.some(ind => lower.includes(ind));
  }

  /**
   * Parse user's reason for failure from message
   */
  private parseUserReason(message: string): string | null {
    // Look for "because X" pattern
    let match = message.match(/because\s+(.+?)(\.|$)/i);
    if (match) return match[1].trim();

    // Look for "due to X" pattern
    match = message.match(/due to\s+(.+?)(\.|$)/i);
    if (match) return match[1].trim();

    // Look for explanation after failure indicator
    match = message.match(/(?:failed|error|wrong|broken)\s*[:-]\s*(.+?)(\.|$)/i);
    if (match) return match[1].trim();

    return null;
  }

  /**
   * Parse user's solution from correction message
   */
  private parseUserSolution(message: string): string | null {
    // Look for "use X instead" pattern
    let match = message.match(/use\s+(.+?)\s+instead/i);
    if (match) return match[1].trim();

    // Look for "should X" pattern
    match = message.match(/should\s+(.+?)(\.|$)/i);
    if (match) return match[1].trim();

    // Look for "try X" pattern
    match = message.match(/try\s+(.+?)(\.|$)/i);
    if (match) return match[1].trim();

    // Look for imperative instructions
    match = message.match(/^([A-Z][^.!?]+)/);
    if (match && !match[1].toLowerCase().startsWith('that')) {
      return match[1].trim();
    }

    return null;
  }

  /**
   * Truncate string to max length
   */
  private truncate(str: string, maxLength: number): string {
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength - 3) + '...';
  }
}

import { LoggingService } from './logging';
import { ExtractedPreference } from './preference-extractor';

export interface DetectedAction {
  type: 'file_creation' | 'preference_mention' | 'pattern_usage' | 'tool_preference';
  pattern: string;
  context: {
    tool?: string;
    filePath?: string;
    directory?: string;
    content?: string;
    timestamp: number;
  };
  preference?: ExtractedPreference;
}

/**
 * ActionPatternDetector - Detects patterns in Claude Code's behavior
 * 
 * Instead of analyzing user input with API calls, this service detects
 * patterns in how Claude Code acts, allowing us to learn preferences
 * from behavior rather than redundant text analysis.
 */
export class ActionPatternDetector {
  private logger = LoggingService.getInstance();
  private actionHistory: DetectedAction[] = [];
  
  // Pattern detection thresholds
  private readonly PATTERN_THRESHOLD = 2; // How many times before we consider it a pattern
  private readonly RECENT_WINDOW = 10; // Number of recent actions to consider
  
  constructor() {
    this.logger.info('ActionPatternDetector', 'Initialized behavioral pattern detector');
  }
  
  /**
   * Detect patterns from tool usage
   */
  detectToolAction(toolName: string, toolInput: any): DetectedAction | null {
    const timestamp = Date.now();
    
    // Detect file creation patterns
    if (toolName === 'Write' || toolName === 'MultiEdit') {
      const filePath = toolInput.file_path || toolInput.filePath;
      if (filePath) {
        const action = this.detectFileCreationPattern(filePath, timestamp);
        if (action) {
          this.recordAction(action);
          return action;
        }
      }
    }
    
    // Detect specific tool preferences (e.g., always using axios for HTTP)
    if (toolName === 'Write' && toolInput.content) {
      const toolPreference = this.detectToolPreference(toolInput.content, timestamp);
      if (toolPreference) {
        this.recordAction(toolPreference);
        return toolPreference;
      }
    }
    
    return null;
  }
  
  /**
   * Detect patterns from Claude's response content
   */
  detectResponsePattern(responseContent: string): DetectedAction | null {
    const timestamp = Date.now();
    
    // Detect when Claude mentions preferences
    const preferenceMentions = [
      /I'll use (\w+) for (\w+)/gi,
      /I'm using (\w+) instead of (\w+)/gi,
      /I'll save (?:the )?(\w+) in ([\w\-\/]+)/gi,
      /I'll create (?:the )?(\w+) in ([\w\-\/]+)/gi,
      /Using (\w+) as (?:the )?(\w+)/gi
    ];
    
    for (const pattern of preferenceMentions) {
      const match = pattern.exec(responseContent);
      if (match) {
        const action: DetectedAction = {
          type: 'preference_mention',
          pattern: match[0],
          context: {
            content: responseContent.substring(Math.max(0, match.index - 50), match.index + match[0].length + 50),
            timestamp
          },
          preference: {
            key: this.inferPreferenceKey(match[2] || 'tool'),
            value: match[1],
            confidence: 0.8,
            raw: match[0],
            isOverride: false,
            overrideSignals: []
          }
        };
        
        this.recordAction(action);
        return action;
      }
    }
    
    return null;
  }
  
  /**
   * Get learned patterns based on repeated behavior
   */
  getLearnedPatterns(): ExtractedPreference[] {
    const preferences: ExtractedPreference[] = [];
    const recentActions = this.actionHistory.slice(-this.RECENT_WINDOW);
    
    // Group actions by type and pattern
    const patternGroups = new Map<string, DetectedAction[]>();
    
    for (const action of recentActions) {
      if (action.preference) {
        const key = `${action.preference.key}:${action.preference.value}`;
        if (!patternGroups.has(key)) {
          patternGroups.set(key, []);
        }
        patternGroups.get(key)!.push(action);
      }
    }
    
    // Convert repeated patterns to preferences
    for (const [key, actions] of patternGroups) {
      if (actions.length >= this.PATTERN_THRESHOLD) {
        const latestAction = actions[actions.length - 1];
        if (latestAction.preference) {
          preferences.push({
            ...latestAction.preference,
            confidence: Math.min(0.9, 0.5 + (actions.length * 0.1)), // Increase confidence with repetition
            raw: `Behavioral pattern: ${latestAction.preference.raw} (observed ${actions.length} times)`
          });
        }
      }
    }
    
    return preferences;
  }
  
  private detectFileCreationPattern(filePath: string, timestamp: number): DetectedAction | null {
    const pathParts = filePath.split('/');
    
    // Detect test file patterns
    if (filePath.includes('test') || filePath.includes('spec')) {
      const testDir = this.findTestDirectory(pathParts);
      if (testDir) {
        return {
          type: 'file_creation',
          pattern: `test_files_in_${testDir}`,
          context: { filePath, directory: testDir, timestamp },
          preference: {
            key: 'test_location',
            value: testDir,
            confidence: 0.85,
            raw: `Tests created in ${testDir}`,
            isOverride: false,
            overrideSignals: []
          }
        };
      }
    }
    
    // Detect config file patterns
    if (pathParts.includes('configs') || pathParts.includes('config')) {
      const configDir = pathParts.includes('configs') ? 'configs' : 'config';
      return {
        type: 'file_creation',
        pattern: `config_files_in_${configDir}`,
        context: { filePath, directory: configDir, timestamp },
        preference: {
          key: 'config_location',
          value: configDir,
          confidence: 0.8,
          raw: `Config files saved in ${configDir}`,
          isOverride: false,
          overrideSignals: []
        }
      };
    }
    
    return null;
  }
  
  private detectToolPreference(content: string, timestamp: number): DetectedAction | null {
    // Detect HTTP client preferences
    if (content.includes('axios') && (content.includes('http') || content.includes('request'))) {
      return {
        type: 'tool_preference',
        pattern: 'axios_for_http',
        context: { content: content.substring(0, 200), timestamp },
        preference: {
          key: 'http_client',
          value: 'axios',
          confidence: 0.75,
          raw: 'Using axios for HTTP requests',
          isOverride: false,
          overrideSignals: []
        }
      };
    }
    
    // Detect indentation preferences
    if (content.includes('\t')) {
      return {
        type: 'pattern_usage',
        pattern: 'tabs_indentation',
        context: { content: 'File uses tab indentation', timestamp },
        preference: {
          key: 'indentation',
          value: 'tabs',
          confidence: 0.7,
          raw: 'Using tabs for indentation',
          isOverride: false,
          overrideSignals: []
        }
      };
    } else if (content.match(/^  /m)) {
      return {
        type: 'pattern_usage',
        pattern: '2_space_indentation',
        context: { content: 'File uses 2-space indentation', timestamp },
        preference: {
          key: 'indentation',
          value: '2_spaces',
          confidence: 0.7,
          raw: 'Using 2 spaces for indentation',
          isOverride: false,
          overrideSignals: []
        }
      };
    }
    
    return null;
  }
  
  private findTestDirectory(pathParts: string[]): string | null {
    // Look for test-related directories
    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i];
      if (part.includes('test') || part.includes('spec')) {
        // Check if it's a custom test directory
        if (part.startsWith('tests-') || part.startsWith('test-')) {
          return part;
        }
        // Otherwise return the standard test directory
        return part;
      }
    }
    return null;
  }
  
  private inferPreferenceKey(context: string): string {
    const normalized = context.toLowerCase();
    
    if (normalized.includes('indent')) return 'indentation';
    if (normalized.includes('http') || normalized.includes('request')) return 'http_client';
    if (normalized.includes('test')) return 'test_framework';
    if (normalized.includes('build')) return 'build_tool';
    if (normalized.includes('ui') || normalized.includes('frontend')) return 'ui_framework';
    if (normalized.includes('database') || normalized.includes('db')) return 'database';
    
    return context.toLowerCase().replace(/\s+/g, '_');
  }
  
  private recordAction(action: DetectedAction): void {
    this.actionHistory.push(action);
    
    // Keep history size manageable
    if (this.actionHistory.length > 100) {
      this.actionHistory = this.actionHistory.slice(-50);
    }
    
    this.logger.debug('ActionPatternDetector', 'Recorded action', {
      type: action.type,
      pattern: action.pattern,
      preference: action.preference
    });
  }
}
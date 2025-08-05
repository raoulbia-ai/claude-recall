import { MCPRequest, MCPResponse } from './server';
import { PreferenceExtractor } from '../services/preference-extractor';
import { ActionPatternDetector } from '../services/action-pattern-detector';
import { MemoryService } from '../services/memory';
import { LoggingService } from '../services/logging';
import * as fs from 'fs';
import * as path from 'path';

interface MemoryPattern {
  pattern: string;
  type: string;
  confidence: number;
  extractionMode: string;
}

interface MemoryPatternConfig {
  preferencePatterns: MemoryPattern[];
  actionPatterns: MemoryPattern[];
  contextTriggers: {
    highConfidenceWords: string[];
    decisionIndicators: string[];
    futureTense: string[];
  };
  captureSettings: {
    minConfidence: number;
    requireExplicitConfirmation: boolean;
    batchProcessingDelay: number;
    maxMemoriesPerSession: number;
    deduplicationWindow: number;
  };
}

export class MemoryCaptureMiddleware {
  private preferenceExtractor: PreferenceExtractor;
  private actionDetector: ActionPatternDetector;
  private memoryService: MemoryService;
  private logger: LoggingService;
  private config!: MemoryPatternConfig;
  private recentCaptures: Map<string, number> = new Map();
  private sessionMemoryCount: Map<string, number> = new Map();

  constructor() {
    this.preferenceExtractor = new PreferenceExtractor();
    this.actionDetector = new ActionPatternDetector();
    this.memoryService = MemoryService.getInstance();
    this.logger = LoggingService.getInstance();
    this.loadConfig();
  }

  private loadConfig(): void {
    try {
      // First try custom config location
      const customConfigPath = process.env.CLAUDE_RECALL_PATTERNS_CONFIG;
      const defaultConfigPath = path.join(__dirname, '../../config/memory-patterns.json');
      
      const configPath = customConfigPath && fs.existsSync(customConfigPath) 
        ? customConfigPath 
        : defaultConfigPath;

      if (fs.existsSync(configPath)) {
        const configContent = fs.readFileSync(configPath, 'utf-8');
        this.config = JSON.parse(configContent);
        this.logger.info('MemoryCaptureMiddleware', 'Loaded memory patterns config', { configPath });
      } else {
        // Use default config if file doesn't exist
        this.config = this.getDefaultConfig();
        this.logger.warn('MemoryCaptureMiddleware', 'Using default config, no config file found');
      }
    } catch (error) {
      this.logger.error('MemoryCaptureMiddleware', 'Failed to load config, using defaults', error as Error);
      this.config = this.getDefaultConfig();
    }
  }

  private getDefaultConfig(): MemoryPatternConfig {
    return {
      preferencePatterns: [
        {
          pattern: "(?:I prefer|prefer)\\s+([\\w\\s]+)\\s+(?:over|instead of)\\s+([\\w\\s]+)",
          type: "preference",
          confidence: 0.9,
          extractionMode: "comparison"
        }
      ],
      actionPatterns: [],
      contextTriggers: {
        highConfidenceWords: ["always", "never", "must", "prefer"],
        decisionIndicators: ["decided", "choosing", "selected"],
        futureTense: ["will", "going to", "from now on"]
      },
      captureSettings: {
        minConfidence: 0.7,
        requireExplicitConfirmation: false,
        batchProcessingDelay: 1000,
        maxMemoriesPerSession: 50,
        deduplicationWindow: 3600000
      }
    };
  }

  /**
   * Process a request/response pair for automatic memory capture
   */
  async processForMemoryCapture(
    request: MCPRequest,
    response: MCPResponse,
    sessionId: string
  ): Promise<void> {
    try {
      // Don't capture from memory-related tools to avoid loops
      if (request.method === 'tools/call' && 
          request.params?.name?.includes('memory')) {
        return;
      }

      // Extract content to analyze
      const contentToAnalyze = this.extractContent(request, response);
      if (!contentToAnalyze) return;

      // Check session memory limit
      const sessionCount = this.sessionMemoryCount.get(sessionId) || 0;
      if (sessionCount >= this.config.captureSettings.maxMemoriesPerSession) {
        this.logger.debug('MemoryCaptureMiddleware', 'Session memory limit reached', { sessionId, count: sessionCount });
        return;
      }

      // Analyze for patterns
      const detectedMemories = await this.analyzeContent(contentToAnalyze, sessionId);

      // Store unique memories
      for (const memory of detectedMemories) {
        if (this.shouldCapture(memory, sessionId)) {
          await this.captureMemory(memory, sessionId);
        }
      }
    } catch (error) {
      this.logger.error('MemoryCaptureMiddleware', 'Error in memory capture', error as Error);
    }
  }

  private extractContent(request: MCPRequest, response: MCPResponse): string | null {
    let content = '';

    // Extract from request
    if (request.params?.arguments?.content) {
      content += request.params.arguments.content + '\n';
    }

    // Extract from response
    if (response.result?.content) {
      if (Array.isArray(response.result.content)) {
        response.result.content.forEach((item: any) => {
          if (item.text) content += item.text + '\n';
        });
      } else if (typeof response.result.content === 'string') {
        content += response.result.content + '\n';
      }
    }

    return content.trim() || null;
  }

  private async analyzeContent(content: string, sessionId: string): Promise<any[]> {
    const memories: any[] = [];

    // PRIORITY 1: Check for explicit "remember" commands
    const rememberRegex = /(?:remember|Remember)\s+(?:that\s+)?(.+?)(?:[.!?]|$)/gi;
    const rememberMatches = content.matchAll(rememberRegex);
    
    for (const match of rememberMatches) {
      const memoryContent = match[1].trim();
      if (memoryContent) {
        memories.push({
          type: 'explicit_memory',
          content: memoryContent,
          data: {
            raw: memoryContent,
            source: 'explicit_remember_command',
            confidence: 1.0
          },
          confidence: 1.0,  // Always highest confidence
          priority: 1  // Highest priority
        });
      }
    }

    // PRIORITY 2: Use configured preference patterns
    for (const pattern of this.config.preferencePatterns) {
      const regex = new RegExp(pattern.pattern, 'gi');
      const matches = content.matchAll(regex);
      
      for (const match of matches) {
        // Skip if this was already captured as explicit memory
        if (match[0].toLowerCase().includes('remember')) continue;
        
        memories.push({
          type: pattern.type,
          content: match[0],
          data: {
            pattern: pattern.type,
            captured: match.slice(1),
            confidence: pattern.confidence,
            extractionMode: pattern.extractionMode
          },
          confidence: pattern.confidence,
          priority: 2
        });
      }
    }

    // PRIORITY 3: Use existing PreferenceExtractor
    const preferences = this.preferenceExtractor.extractPreferences(content);
    for (const pref of preferences) {
      if (pref.confidence >= this.config.captureSettings.minConfidence) {
        // Skip if already captured as explicit memory
        if (pref.raw.toLowerCase().includes('remember')) continue;
        
        memories.push({
          type: 'preference',
          content: pref.raw,
          data: {
            key: pref.key,
            value: pref.value,
            confidence: pref.confidence
          },
          confidence: pref.confidence,
          priority: 3
        });
      }
    }

    // Check for action patterns using configured patterns
    for (const pattern of this.config.actionPatterns) {
      const regex = new RegExp(pattern.pattern, 'gi');
      const matches = content.matchAll(regex);
      
      for (const match of matches) {
        memories.push({
          type: pattern.type,
          content: match[0],
          data: {
            pattern: pattern.type,
            captured: match.slice(1),
            confidence: pattern.confidence
          },
          confidence: pattern.confidence
        });
      }
    }

    // Check for high-confidence context triggers
    const hasHighConfidenceContext = this.config.contextTriggers.highConfidenceWords.some(
      word => content.toLowerCase().includes(word.toLowerCase())
    );

    if (hasHighConfidenceContext) {
      // Boost confidence for all found patterns
      memories.forEach(m => m.confidence = Math.min(1.0, m.confidence * 1.1));
    }

    return memories;
  }

  private shouldCapture(memory: any, sessionId: string): boolean {
    // ALWAYS capture explicit "remember" commands
    if (memory.type === 'explicit_memory' || memory.priority === 1) {
      return true;
    }

    // Check confidence threshold for other types
    if (memory.confidence < this.config.captureSettings.minConfidence) {
      return false;
    }

    // Check for duplicates within deduplication window
    const memoryKey = `${memory.type}:${memory.content}`;
    const lastCapture = this.recentCaptures.get(memoryKey);
    const now = Date.now();

    if (lastCapture && (now - lastCapture) < this.config.captureSettings.deduplicationWindow) {
      return false;
    }

    return true;
  }

  private async captureMemory(memory: any, sessionId: string): Promise<void> {
    try {
      // Store using MemoryService
      const stored = this.memoryService.store({
        key: `auto_${memory.type}_${Date.now()}`,
        value: memory.data,
        type: memory.type,
        context: {
          projectId: sessionId,
          type: 'auto_capture',
          timestamp: Date.now()
        }
      });

      // Update tracking
      const memoryKey = `${memory.type}:${memory.content}`;
      this.recentCaptures.set(memoryKey, Date.now());
      
      const currentCount = this.sessionMemoryCount.get(sessionId) || 0;
      this.sessionMemoryCount.set(sessionId, currentCount + 1);

      this.logger.info('MemoryCaptureMiddleware', 'Auto-captured memory', {
        type: memory.type,
        confidence: memory.confidence,
        sessionId
      });
    } catch (error) {
      this.logger.error('MemoryCaptureMiddleware', 'Failed to capture memory', error as Error);
    }
  }

  /**
   * Clean up old session data
   */
  cleanupSessions(): void {
    // Clean up old captures
    const now = Date.now();
    const cutoff = now - this.config.captureSettings.deduplicationWindow;
    
    for (const [key, timestamp] of this.recentCaptures) {
      if (timestamp < cutoff) {
        this.recentCaptures.delete(key);
      }
    }

    // Reset session counts periodically
    if (this.sessionMemoryCount.size > 100) {
      this.sessionMemoryCount.clear();
    }
  }

  /**
   * Reload configuration (useful for hot-reloading)
   */
  reloadConfig(): void {
    this.loadConfig();
    this.logger.info('MemoryCaptureMiddleware', 'Configuration reloaded');
  }
}
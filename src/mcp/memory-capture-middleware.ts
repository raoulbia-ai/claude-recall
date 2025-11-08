import { MCPRequest, MCPResponse } from './server';
import { PreferenceExtractor } from '../services/preference-extractor';
import { ActionPatternDetector } from '../services/action-pattern-detector';
import { MemoryService } from '../services/memory';
import { LoggingService } from '../services/logging';
import { KeywordExtractor } from '../services/keyword-extractor';
import { MemoryUsageTracker } from '../services/memory-usage-tracker';
import { FailureExtractor } from '../services/failure-extractor';
import { MemoryEvolution } from '../services/memory-evolution';
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
  private keywordExtractor: KeywordExtractor;
  private usageTracker: MemoryUsageTracker;
  private failureExtractor: FailureExtractor;
  private memoryEvolution: MemoryEvolution;
  private config!: MemoryPatternConfig;
  private recentCaptures: Map<string, number> = new Map();
  private sessionMemoryCount: Map<string, number> = new Map();

  constructor() {
    this.preferenceExtractor = new PreferenceExtractor();
    this.actionDetector = new ActionPatternDetector();
    this.memoryService = MemoryService.getInstance();
    this.logger = LoggingService.getInstance();
    this.keywordExtractor = KeywordExtractor.getInstance();
    this.usageTracker = MemoryUsageTracker.getInstance();
    this.failureExtractor = FailureExtractor.getInstance();
    this.memoryEvolution = MemoryEvolution.getInstance();
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
        minConfidence: 0.5,
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

    // PRIORITY 0: Extract DevOps patterns (HIGHEST - project-specific workflows)
    const devopsPreferences = this.preferenceExtractor.extractPreferences(content)
      .filter(pref => pref.key.startsWith('devops_'));

    for (const devops of devopsPreferences) {
      if (devops.confidence >= this.config.captureSettings.minConfidence) {
        // Handle both string and object value types
        const data = typeof devops.value === 'object'
          ? {
              ...devops.value,
              key: devops.key,
              confidence: devops.confidence,
              isOverride: devops.isOverride
            }
          : {
              value: devops.value,
              key: devops.key,
              confidence: devops.confidence,
              isOverride: devops.isOverride
            };

        memories.push({
          type: 'devops',
          content: devops.raw,
          data,
          confidence: devops.confidence,
          priority: 0  // HIGHEST priority
        });
      }
    }

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
          priority: 1  // Second highest priority
        });
      }
    }

    // PRIORITY 1.5: Check for user corrections and failures (counterfactual learning)
    const failureMemory = this.failureExtractor.extractFromUserCorrection(
      content,
      'previous_action',  // TODO: Track actual previous action in session
      {
        query: content,
        timestamp: Date.now()
      }
    );

    if (failureMemory) {
      memories.push({
        type: 'failure',
        content: JSON.stringify(failureMemory.value),
        data: failureMemory.value,
        confidence: failureMemory.confidence_score || 0.9,
        priority: 1.5  // High priority - learn from failures
      });
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

    // PRIORITY 3: Use existing PreferenceExtractor (non-devops preferences)
    const preferences = this.preferenceExtractor.extractPreferences(content)
      .filter(pref => !pref.key.startsWith('devops_')); // Skip devops, already handled

    for (const pref of preferences) {
      if (pref.confidence >= this.config.captureSettings.minConfidence) {
        // Skip if already captured as explicit memory or devops
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
   * Get hints about recently captured memories (for LLM context injection)
   * This helps the LLM be aware of what has been automatically stored
   */
  getCaptureHints(sessionId: string, maxCount: number = 5): string | null {
    try {
      // Get recent captures for this session
      const sessionCount = this.sessionMemoryCount.get(sessionId) || 0;

      if (sessionCount === 0) {
        return null; // No captures yet
      }

      // Search for recent memories from this session
      // Use timestamp sorting to get most recent
      const recentMemories = this.memoryService.search('', 'timestamp').slice(0, maxCount);

      if (recentMemories.length === 0) {
        return null;
      }

      // Format as system hint
      const lines: string[] = [
        `[System: ${recentMemories.length} memories automatically captured in this session:]`
      ];

      for (const memory of recentMemories) {
        const formatted = this.formatMemoryForHint(memory);
        if (formatted) {
          lines.push(`  - ${formatted}`);
        }
      }

      lines.push('[Tip: Consider storing additional project details mentioned by the user]');

      return lines.join('\n');
    } catch (error) {
      this.logger.error('MemoryCaptureMiddleware', 'Failed to generate capture hints', error as Error);
      return null;
    }
  }

  /**
   * Format a memory for hint display
   */
  private formatMemoryForHint(memory: any): string | null {
    try {
      const value = memory.value;

      // Handle different value formats
      if (typeof value === 'string') {
        return `${memory.type}: ${value}`;
      }

      if (typeof value === 'object' && value !== null) {
        // Extract meaningful information
        if (value.raw) return `${memory.type}: ${value.raw}`;
        if (value.content) return `${memory.type}: ${value.content}`;
        if (value.message) return `${memory.type}: ${value.message}`;
        if (value.key && value.value) {
          return `${memory.type}: ${value.key} = ${typeof value.value === 'object' ? JSON.stringify(value.value) : value.value}`;
        }

        // Fallback: show memory key
        return `${memory.type}: ${memory.key}`;
      }

      return null;
    } catch (error) {
      return null;
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

  /**
   * Phase 3B: Proactively retrieve and inject relevant memories
   * Call this BEFORE executing tool to inject memory context
   */
  async enhanceRequestWithMemories(request: MCPRequest): Promise<MCPRequest> {
    try {
      // Only enhance tool calls
      if (request.method !== 'tools/call') {
        return request;
      }

      // Don't enhance memory-related tools to avoid loops
      if (request.params?.name?.includes('memory')) {
        return request;
      }

      // Extract keywords from tool arguments
      const toolArgs = request.params?.arguments || {};
      const searchQuery = this.keywordExtractor.extractAsQuery(toolArgs);

      if (!searchQuery) {
        return request; // No keywords found
      }

      // Search for relevant memories
      const memories = this.memoryService.search(searchQuery);

      // Filter to top 3 most relevant
      const topMemories = memories.slice(0, 3);

      if (topMemories.length === 0) {
        return request; // No relevant memories
      }

      // Format memories as context
      const memoryContext = this.formatMemoriesForContext(topMemories);

      // Add capture hints to help LLM be aware of what was stored
      const sessionId = request.params?.sessionId || 'unknown';
      const captureHints = this.getCaptureHints(sessionId, 3);

      // Combine memory context and capture hints
      let fullContext = memoryContext;
      if (captureHints) {
        fullContext += '\n\n' + captureHints;
      }

      // Inject into request
      // Store in a special field that tools can access
      if (!request.params) {
        request.params = {};
      }

      request.params._memoryContext = fullContext;
      request.params._injectedMemories = topMemories.map(m => ({
        key: m.key,
        type: m.type,
        confidence: this.extractConfidence(m)
      }));

      // Phase 3C: Track memory injections
      for (const memory of topMemories) {
        this.usageTracker.recordInjection(memory.key, request.params.name, sessionId);
      }

      this.logger.info('MemoryCaptureMiddleware', 'Injected memories into request', {
        toolName: request.params.name,
        memoryCount: topMemories.length,
        keywords: searchQuery
      });

      return request;

    } catch (error) {
      this.logger.error('MemoryCaptureMiddleware', 'Failed to enhance request', error);
      return request; // Return original on error
    }
  }

  /**
   * Format memories as readable context string
   */
  private formatMemoriesForContext(memories: any[]): string {
    const lines: string[] = ['📝 Relevant Memories:'];

    for (const memory of memories) {
      const formatted = this.formatSingleMemoryForContext(memory);
      if (formatted) {
        lines.push(`- ${formatted}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Format a single memory for context injection
   */
  private formatSingleMemoryForContext(memory: any): string | null {
    try {
      const value = memory.value;

      // Handle different value formats
      if (typeof value === 'string') {
        return value;
      }

      if (typeof value === 'object' && value !== null) {
        // Extract meaningful information
        if (value.preference) return value.preference;
        if (value.value) {
          const val = value.value;
          if (typeof val === 'string') return val;
          if (typeof val === 'object' && val.framework) {
            return `Use ${val.framework}`;
          }
        }
        if (value.content) return value.content;
        if (value.message) return value.message;
        if (value.raw) return value.raw;

        // Fallback: extract key info from memory key
        return this.extractKeyInfo(memory.key, value);
      }

      return null;

    } catch (error) {
      return null;
    }
  }

  /**
   * Extract key information from memory
   */
  private extractKeyInfo(key: string, value: any): string {
    const cleanKey = key
      .replace(/auto_|pref_/g, '')
      .replace(/_\d+$/g, '')
      .replace(/_/g, ' ');

    if (value.framework) return `${cleanKey}: ${value.framework}`;
    if (value.location) return `${cleanKey}: ${value.location}`;
    if (value.style) return `${cleanKey}: ${value.style}`;

    return cleanKey;
  }

  /**
   * Extract confidence from memory value
   */
  private extractConfidence(memory: any): number {
    if (typeof memory.value === 'object' && memory.value !== null) {
      return (memory.value as any).confidence || 0.5;
    }
    return 0.5;
  }
}
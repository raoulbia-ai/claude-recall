import * as path from 'path';
import * as fs from 'fs';

export interface ClaudeRecallConfig {
  // Database configuration
  database: {
    path: string;
    name: string;
    // Compaction settings
    compaction?: {
      autoCompact: boolean;
      compactThreshold: number;
      maxMemories: number;
      retention: {
        toolUse: number;
        corrections: number;
        preferences: number;
        projectKnowledge: number;
      };
    };
  };
  
  // Logging configuration
  logging: {
    directory: string;
    level: 'debug' | 'info' | 'warn' | 'error';
    maxFiles: number;
    maxSize: string;
  };
  
  // Memory configuration
  memory: {
    maxRetrieval: number;
    relevanceThreshold: number;
    decayFactor: number;
    halfLife: number;
  };
  
  // Project configuration
  project: {
    rootDir: string;
    name?: string;
    id?: string;
  };
  
  // Hook configuration
  hooks: {
    timeout: number;
    enabled: boolean;
  };
}

export class ConfigService {
  private static instance: ConfigService;
  private config: ClaudeRecallConfig;
  
  private constructor() {
    this.config = this.loadConfig();
  }
  
  static getInstance(): ConfigService {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService();
    }
    return ConfigService.instance;
  }
  
  private loadConfig(): ClaudeRecallConfig {
    // Default configuration
    const defaultConfig: ClaudeRecallConfig = {
      database: {
        path: process.env.CLAUDE_RECALL_DB_PATH || process.cwd(),
        name: process.env.CLAUDE_RECALL_DB_NAME || 'claude-recall.db',
        compaction: {
          autoCompact: process.env.CLAUDE_RECALL_AUTO_COMPACT !== 'false',
          compactThreshold: parseInt(process.env.CLAUDE_RECALL_COMPACT_THRESHOLD || '10485760'), // 10MB
          maxMemories: parseInt(process.env.CLAUDE_RECALL_MAX_MEMORIES || '10000'),
          retention: {
            toolUse: parseInt(process.env.CLAUDE_RECALL_RETAIN_TOOL_USE || '1000'),
            corrections: parseInt(process.env.CLAUDE_RECALL_RETAIN_CORRECTIONS || '100'),
            preferences: parseInt(process.env.CLAUDE_RECALL_RETAIN_PREFERENCES || '-1'), // Keep forever
            projectKnowledge: parseInt(process.env.CLAUDE_RECALL_RETAIN_PROJECT_KNOWLEDGE || '-1') // Keep forever
          }
        }
      },
      logging: {
        directory: process.env.CLAUDE_RECALL_LOG_DIR || process.cwd(),
        level: (process.env.CLAUDE_RECALL_LOG_LEVEL as any) || 'info',
        maxFiles: parseInt(process.env.CLAUDE_RECALL_LOG_MAX_FILES || '5'),
        maxSize: process.env.CLAUDE_RECALL_LOG_MAX_SIZE || '10MB'
      },
      memory: {
        maxRetrieval: parseInt(process.env.CLAUDE_RECALL_MAX_RETRIEVAL || '5'),
        relevanceThreshold: parseFloat(process.env.CLAUDE_RECALL_RELEVANCE_THRESHOLD || '0.1'),
        decayFactor: parseFloat(process.env.CLAUDE_RECALL_DECAY_FACTOR || '0.5'),
        halfLife: parseInt(process.env.CLAUDE_RECALL_HALF_LIFE || '7')
      },
      project: {
        rootDir: process.env.CLAUDE_PROJECT_DIR || process.cwd(),
        name: process.env.CLAUDE_PROJECT_NAME,
        id: process.env.CLAUDE_PROJECT_ID
      },
      hooks: {
        timeout: parseInt(process.env.CLAUDE_RECALL_HOOK_TIMEOUT || '5000'),
        enabled: process.env.CLAUDE_RECALL_HOOKS_ENABLED !== 'false'
      }
    };
    
    // Try to load custom config file
    const configPaths = [
      path.join(process.cwd(), '.claude-recall.json'),
      path.join(process.cwd(), 'claude-recall.config.json'),
      process.env.CLAUDE_RECALL_CONFIG_PATH
    ].filter(Boolean);
    
    for (const configPath of configPaths) {
      try {
        if (fs.existsSync(configPath!)) {
          const customConfig = JSON.parse(fs.readFileSync(configPath!, 'utf-8'));
          return this.mergeConfig(defaultConfig, customConfig);
        }
      } catch (error) {
        console.warn(`Failed to load config from ${configPath}: ${error}`);
      }
    }
    
    return defaultConfig;
  }
  
  private mergeConfig(defaultConfig: ClaudeRecallConfig, customConfig: any): ClaudeRecallConfig {
    return {
      database: {
        ...defaultConfig.database,
        ...customConfig.database,
        compaction: customConfig.database?.compaction ? {
          ...defaultConfig.database.compaction,
          ...customConfig.database.compaction,
          retention: {
            ...defaultConfig.database.compaction?.retention,
            ...customConfig.database.compaction?.retention
          }
        } : defaultConfig.database.compaction
      },
      logging: { ...defaultConfig.logging, ...customConfig.logging },
      memory: { ...defaultConfig.memory, ...customConfig.memory },
      project: { ...defaultConfig.project, ...customConfig.project },
      hooks: { ...defaultConfig.hooks, ...customConfig.hooks }
    };
  }
  
  getConfig(): ClaudeRecallConfig {
    return { ...this.config };
  }
  
  getDatabasePath(): string {
    return path.join(this.config.database.path, this.config.database.name);
  }
  
  getLogPath(logName: string): string {
    return path.join(this.config.logging.directory, logName);
  }
  
  getProjectId(): string {
    return this.config.project.id || this.config.project.rootDir;
  }
  
  updateConfig(updates: Partial<ClaudeRecallConfig>): void {
    this.config = this.mergeConfig(this.config, updates);
  }
}
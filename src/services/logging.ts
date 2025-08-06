import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from './config';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

export interface LogEntry {
  timestamp: string;
  level: string;
  service: string;
  message: string;
  metadata?: any;
}

export class LoggingService {
  private static instance: LoggingService;
  private config = ConfigService.getInstance();
  private logLevel: LogLevel;
  
  private constructor() {
    const configLevel = this.config.getConfig().logging.level;
    this.logLevel = LogLevel[configLevel.toUpperCase() as keyof typeof LogLevel] || LogLevel.INFO;
  }
  
  static getInstance(): LoggingService {
    if (!LoggingService.instance) {
      LoggingService.instance = new LoggingService();
    }
    return LoggingService.instance;
  }
  
  private formatLogEntry(level: LogLevel, service: string, message: string, metadata?: any): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level: LogLevel[level],
      service,
      message,
      metadata
    };
  }
  
  private writeLog(logName: string, entry: LogEntry): void {
    const logPath = this.config.getLogPath(logName);
    const logDir = path.dirname(logPath);
    
    // Ensure log directory exists
    if (!fs.existsSync(logDir)) {
      try {
        fs.mkdirSync(logDir, { recursive: true });
      } catch (error) {
        // If we can't create the log directory, skip logging to file
        return;
      }
    }
    
    const logMessage = `[${entry.timestamp}] ${entry.level} [${entry.service}] ${entry.message}`;
    const fullMessage = entry.metadata 
      ? `${logMessage}\n  Metadata: ${JSON.stringify(entry.metadata)}\n`
      : `${logMessage}\n`;
    
    try {
      fs.appendFileSync(logPath, fullMessage);
    } catch (error) {
      // Silently fail - we don't want logging errors to break the application
    }
  }
  
  debug(service: string, message: string, metadata?: any): void {
    if (this.logLevel <= LogLevel.DEBUG) {
      const entry = this.formatLogEntry(LogLevel.DEBUG, service, message, metadata);
      this.writeLog('debug.log', entry);
    }
  }
  
  info(service: string, message: string, metadata?: any): void {
    if (this.logLevel <= LogLevel.INFO) {
      const entry = this.formatLogEntry(LogLevel.INFO, service, message, metadata);
      this.writeLog('info.log', entry);
    }
  }
  
  warn(service: string, message: string, metadata?: any): void {
    if (this.logLevel <= LogLevel.WARN) {
      const entry = this.formatLogEntry(LogLevel.WARN, service, message, metadata);
      this.writeLog('warnings.log', entry);
    }
  }
  
  error(service: string, message: string, error?: Error | any, metadata?: any): void {
    if (this.logLevel <= LogLevel.ERROR) {
      const errorData = error instanceof Error 
        ? { message: error.message, stack: error.stack }
        : error;
      
      const entry = this.formatLogEntry(LogLevel.ERROR, service, message, {
        error: errorData,
        ...metadata
      });
      this.writeLog('errors.log', entry);
    }
  }
  
  // Specialized logging methods for different services
  logHookEvent(hookType: string, toolName: string, details?: any): void {
    this.info('Hook', `${hookType} - ${toolName}`, details);
  }
  
  logMemoryOperation(operation: string, details: any): void {
    this.debug('Memory', `${operation}`, details);
  }
  
  logRetrieval(query: string, resultsCount: number, details?: any): void {
    this.info('Retrieval', `Query: "${query}" -> ${resultsCount} results`, details);
  }
  
  logServiceError(service: string, operation: string, error: Error, context?: any): void {
    this.error(service, `Error in ${operation}`, error, context);
  }
}
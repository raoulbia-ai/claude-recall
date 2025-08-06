import { LoggingService } from './logging';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface SearchCall {
  timestamp: number;
  query: string;
  resultCount: number;
  sessionId: string;
  source: 'mcp' | 'cli' | 'direct';
  context?: any;
}

export class SearchMonitor {
  private static instance: SearchMonitor;
  private logger: LoggingService;
  private searchCalls: SearchCall[] = [];
  private monitoringEnabled: boolean = true;
  private logPath: string;

  private constructor() {
    this.logger = LoggingService.getInstance();
    this.logPath = path.join(os.homedir(), '.claude-recall', 'search-monitor.log');
    this.ensureLogDirectory();
  }

  static getInstance(): SearchMonitor {
    if (!SearchMonitor.instance) {
      SearchMonitor.instance = new SearchMonitor();
    }
    return SearchMonitor.instance;
  }

  private ensureLogDirectory(): void {
    const dir = path.dirname(this.logPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  recordSearch(query: string, resultCount: number, sessionId: string, source: 'mcp' | 'cli' | 'direct', context?: any): void {
    if (!this.monitoringEnabled) return;

    const searchCall: SearchCall = {
      timestamp: Date.now(),
      query,
      resultCount,
      sessionId,
      source,
      context
    };

    this.searchCalls.push(searchCall);

    // Log to file for persistence
    this.logToFile(searchCall);

    // Log to console in development
    this.logger.info('SearchMonitor', 'Memory search performed', {
      query: query.substring(0, 50) + (query.length > 50 ? '...' : ''),
      results: resultCount,
      source,
      sessionId
    });
  }

  private logToFile(searchCall: SearchCall): void {
    try {
      const logEntry = JSON.stringify({
        ...searchCall,
        datetime: new Date(searchCall.timestamp).toISOString()
      }) + '\n';

      fs.appendFileSync(this.logPath, logEntry, 'utf8');
    } catch (error) {
      this.logger.error('SearchMonitor', 'Failed to write to log file', error);
    }
  }

  getRecentSearches(limit: number = 100): SearchCall[] {
    return this.searchCalls.slice(-limit);
  }

  getSearchStats(): {
    totalSearches: number;
    searchesBySource: Record<string, number>;
    averageResultCount: number;
    lastSearchTime?: Date;
  } {
    const stats = {
      totalSearches: this.searchCalls.length,
      searchesBySource: {} as Record<string, number>,
      averageResultCount: 0,
      lastSearchTime: undefined as Date | undefined
    };

    if (this.searchCalls.length > 0) {
      let totalResults = 0;
      
      for (const call of this.searchCalls) {
        stats.searchesBySource[call.source] = (stats.searchesBySource[call.source] || 0) + 1;
        totalResults += call.resultCount;
      }

      stats.averageResultCount = totalResults / this.searchCalls.length;
      stats.lastSearchTime = new Date(this.searchCalls[this.searchCalls.length - 1].timestamp);
    }

    return stats;
  }

  checkCompliance(timeWindowMs: number = 300000): { // 5 minutes
    compliant: boolean;
    details: {
      totalActions: number;
      searchesPerformed: number;
      complianceRate: number;
      issues: string[];
    };
  } {
    const now = Date.now();
    const recentSearches = this.searchCalls.filter(s => s.timestamp > now - timeWindowMs);

    // This is a simplified check - in reality, we'd need to correlate with actual file operations
    const expectedSearchRate = 0.8; // Expect 80% of actions to have a search
    const actualRate = recentSearches.length > 0 ? 1.0 : 0.0;

    const issues: string[] = [];
    if (actualRate < expectedSearchRate) {
      issues.push(`Search rate (${(actualRate * 100).toFixed(0)}%) below expected ${(expectedSearchRate * 100).toFixed(0)}%`);
    }

    return {
      compliant: actualRate >= expectedSearchRate,
      details: {
        totalActions: recentSearches.length,
        searchesPerformed: recentSearches.length,
        complianceRate: actualRate,
        issues
      }
    };
  }

  clearLogs(): void {
    this.searchCalls = [];
    try {
      if (fs.existsSync(this.logPath)) {
        fs.unlinkSync(this.logPath);
      }
    } catch (error) {
      this.logger.error('SearchMonitor', 'Failed to clear log file', error);
    }
  }

  setMonitoringEnabled(enabled: boolean): void {
    this.monitoringEnabled = enabled;
    this.logger.info('SearchMonitor', `Monitoring ${enabled ? 'enabled' : 'disabled'}`);
  }
}
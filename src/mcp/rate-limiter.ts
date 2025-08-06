import { LoggingService } from '../services/logging';

export interface RateLimitConfig {
  windowMs?: number;       // Time window in milliseconds
  maxRequests?: number;    // Max requests per window
  skipSuccessfulRequests?: boolean; // Only count failed requests
}

export class RateLimiter {
  private requests: Map<string, number[]> = new Map();
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly skipSuccessfulRequests: boolean;
  private cleanupInterval: NodeJS.Timeout | null = null;
  
  constructor(
    private logger: LoggingService,
    config: RateLimitConfig = {}
  ) {
    this.windowMs = config.windowMs || 60000; // 1 minute default
    this.maxRequests = config.maxRequests || 100; // 100 requests default
    this.skipSuccessfulRequests = config.skipSuccessfulRequests || false;
    
    // Clean up old entries periodically
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.windowMs);
    
    this.logger.info('RateLimiter', 'Rate limiter initialized', {
      windowMs: this.windowMs,
      maxRequests: this.maxRequests,
      skipSuccessfulRequests: this.skipSuccessfulRequests
    });
  }
  
  async checkLimit(sessionId: string): Promise<boolean> {
    const now = Date.now();
    const requests = this.requests.get(sessionId) || [];
    
    // Remove old requests outside window
    const validRequests = requests.filter(time => now - time < this.windowMs);
    
    if (validRequests.length >= this.maxRequests) {
      this.logger.warn('RateLimiter', 'Rate limit exceeded', {
        sessionId,
        requests: validRequests.length,
        window: this.windowMs,
        maxRequests: this.maxRequests
      });
      return false;
    }
    
    // Don't add to count yet - wait for recordRequest
    this.requests.set(sessionId, validRequests);
    return true;
  }
  
  recordRequest(sessionId: string, successful: boolean = true): void {
    if (this.skipSuccessfulRequests && successful) {
      return; // Don't count successful requests if configured
    }
    
    const now = Date.now();
    const requests = this.requests.get(sessionId) || [];
    
    // Add new request
    requests.push(now);
    
    // Keep only requests within window
    const validRequests = requests.filter(time => now - time < this.windowMs);
    this.requests.set(sessionId, validRequests);
    
    this.logger.debug('RateLimiter', 'Request recorded', {
      sessionId,
      requestCount: validRequests.length,
      successful
    });
  }
  
  getRemainingRequests(sessionId: string): number {
    const now = Date.now();
    const requests = this.requests.get(sessionId) || [];
    const validRequests = requests.filter(time => now - time < this.windowMs);
    
    return Math.max(0, this.maxRequests - validRequests.length);
  }
  
  resetLimit(sessionId: string): void {
    this.requests.delete(sessionId);
    this.logger.info('RateLimiter', 'Rate limit reset', { sessionId });
  }
  
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [sessionId, requests] of this.requests) {
      const validRequests = requests.filter(time => now - time < this.windowMs);
      
      if (validRequests.length === 0) {
        this.requests.delete(sessionId);
        cleaned++;
      } else if (validRequests.length < requests.length) {
        this.requests.set(sessionId, validRequests);
      }
    }
    
    if (cleaned > 0) {
      this.logger.debug('RateLimiter', `Cleaned up ${cleaned} expired session limits`);
    }
  }
  
  getStats(): {
    activeSessions: number;
    totalRequests: number;
    topSessions: Array<{ sessionId: string; requests: number }>;
  } {
    const now = Date.now();
    const stats = {
      activeSessions: this.requests.size,
      totalRequests: 0,
      topSessions: [] as Array<{ sessionId: string; requests: number }>
    };
    
    const sessionRequests: Array<{ sessionId: string; requests: number }> = [];
    
    for (const [sessionId, requests] of this.requests) {
      const validRequests = requests.filter(time => now - time < this.windowMs);
      const count = validRequests.length;
      
      stats.totalRequests += count;
      sessionRequests.push({ sessionId, requests: count });
    }
    
    // Get top 5 sessions by request count
    stats.topSessions = sessionRequests
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 5);
    
    return stats;
  }
  
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    this.logger.info('RateLimiter', 'Rate limiter shut down', {
      activeSessions: this.requests.size
    });
  }
}
import { RateLimiter } from '../../src/mcp/rate-limiter';
import { LoggingService } from '../../src/services/logging';

// Mock LoggingService
jest.mock('../../src/services/logging');

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;
  let mockLogger: jest.Mocked<LoggingService>;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      logServiceError: jest.fn()
    } as any;
  });

  afterEach(() => {
    if (rateLimiter) {
      rateLimiter.shutdown();
    }
  });

  describe('checkLimit', () => {
    it('should allow requests within limit', async () => {
      rateLimiter = new RateLimiter(mockLogger, {
        windowMs: 60000,
        maxRequests: 5
      });

      const sessionId = 'test-session';
      
      // Should allow first 5 requests
      for (let i = 0; i < 5; i++) {
        const allowed = await rateLimiter.checkLimit(sessionId);
        expect(allowed).toBe(true);
        rateLimiter.recordRequest(sessionId);
      }

      // 6th request should be denied
      const allowed = await rateLimiter.checkLimit(sessionId);
      expect(allowed).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'RateLimiter',
        'Rate limit exceeded',
        expect.objectContaining({
          sessionId,
          requests: 5,
          maxRequests: 5
        })
      );
    });

    it('should reset limit after time window', async () => {
      jest.useFakeTimers();
      
      rateLimiter = new RateLimiter(mockLogger, {
        windowMs: 1000, // 1 second window
        maxRequests: 2
      });

      const sessionId = 'test-session';
      
      // Use up the limit
      await rateLimiter.checkLimit(sessionId);
      rateLimiter.recordRequest(sessionId);
      await rateLimiter.checkLimit(sessionId);
      rateLimiter.recordRequest(sessionId);

      // Should be blocked
      let allowed = await rateLimiter.checkLimit(sessionId);
      expect(allowed).toBe(false);

      // Advance time past window
      jest.advanceTimersByTime(1100);

      // Should be allowed again
      allowed = await rateLimiter.checkLimit(sessionId);
      expect(allowed).toBe(true);

      jest.useRealTimers();
    });
  });

  describe('recordRequest', () => {
    it('should track successful and failed requests', () => {
      rateLimiter = new RateLimiter(mockLogger, {
        windowMs: 60000,
        maxRequests: 10
      });

      const sessionId = 'test-session';

      rateLimiter.recordRequest(sessionId, true);
      rateLimiter.recordRequest(sessionId, false);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'RateLimiter',
        'Request recorded',
        expect.objectContaining({
          sessionId,
          successful: true
        })
      );
    });

    it('should skip successful requests when configured', async () => {
      rateLimiter = new RateLimiter(mockLogger, {
        windowMs: 60000,
        maxRequests: 2,
        skipSuccessfulRequests: true
      });

      const sessionId = 'test-session';

      // Record successful requests (should not count)
      rateLimiter.recordRequest(sessionId, true);
      rateLimiter.recordRequest(sessionId, true);
      rateLimiter.recordRequest(sessionId, true);

      // Should still allow requests
      const allowed = await rateLimiter.checkLimit(sessionId);
      expect(allowed).toBe(true);

      // Record failed requests (should count)
      rateLimiter.recordRequest(sessionId, false);
      rateLimiter.recordRequest(sessionId, false);

      // Now should be blocked
      const blocked = await rateLimiter.checkLimit(sessionId);
      expect(blocked).toBe(false);
    });
  });

  describe('getRemainingRequests', () => {
    it('should return correct remaining request count', () => {
      rateLimiter = new RateLimiter(mockLogger, {
        windowMs: 60000,
        maxRequests: 5
      });

      const sessionId = 'test-session';

      expect(rateLimiter.getRemainingRequests(sessionId)).toBe(5);

      rateLimiter.recordRequest(sessionId);
      expect(rateLimiter.getRemainingRequests(sessionId)).toBe(4);

      rateLimiter.recordRequest(sessionId);
      rateLimiter.recordRequest(sessionId);
      expect(rateLimiter.getRemainingRequests(sessionId)).toBe(2);
    });
  });

  describe('resetLimit', () => {
    it('should clear rate limit for session', () => {
      rateLimiter = new RateLimiter(mockLogger, {
        windowMs: 60000,
        maxRequests: 2
      });

      const sessionId = 'test-session';

      // Use up limit
      rateLimiter.recordRequest(sessionId);
      rateLimiter.recordRequest(sessionId);

      expect(rateLimiter.getRemainingRequests(sessionId)).toBe(0);

      // Reset limit
      rateLimiter.resetLimit(sessionId);

      expect(rateLimiter.getRemainingRequests(sessionId)).toBe(2);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'RateLimiter',
        'Rate limit reset',
        { sessionId }
      );
    });
  });

  describe('getStats', () => {
    it('should return rate limiter statistics', () => {
      rateLimiter = new RateLimiter(mockLogger, {
        windowMs: 60000,
        maxRequests: 10
      });

      // Create some activity
      rateLimiter.recordRequest('session1');
      rateLimiter.recordRequest('session1');
      rateLimiter.recordRequest('session1');
      
      rateLimiter.recordRequest('session2');
      rateLimiter.recordRequest('session2');
      
      rateLimiter.recordRequest('session3');

      const stats = rateLimiter.getStats();

      expect(stats.activeSessions).toBe(3);
      expect(stats.totalRequests).toBe(6);
      expect(stats.topSessions).toHaveLength(3);
      expect(stats.topSessions[0]).toEqual({ sessionId: 'session1', requests: 3 });
      expect(stats.topSessions[1]).toEqual({ sessionId: 'session2', requests: 2 });
      expect(stats.topSessions[2]).toEqual({ sessionId: 'session3', requests: 1 });
    });
  });

  describe('cleanup', () => {
    it('should automatically clean up expired entries', () => {
      jest.useFakeTimers();
      
      rateLimiter = new RateLimiter(mockLogger, {
        windowMs: 1000, // 1 second
        maxRequests: 10
      });

      // Create some requests
      rateLimiter.recordRequest('session1');
      rateLimiter.recordRequest('session2');

      expect(rateLimiter.getStats().activeSessions).toBe(2);

      // Advance time past window
      jest.advanceTimersByTime(2000);

      // Trigger cleanup
      jest.runOnlyPendingTimers();

      // Old entries should be cleaned up
      expect(rateLimiter.getStats().activeSessions).toBe(0);

      jest.useRealTimers();
    });
  });
});
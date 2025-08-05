import { SessionManager } from '../../src/mcp/session-manager';
import { LoggingService } from '../../src/services/logging';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock LoggingService
jest.mock('../../src/services/logging');

describe('SessionManager', () => {
  let sessionManager: SessionManager;
  let mockLogger: jest.Mocked<LoggingService>;
  const testSessionFile = path.join(os.homedir(), '.claude-recall', 'sessions.json');

  beforeEach(() => {
    // Clear any existing session file
    if (fs.existsSync(testSessionFile)) {
      fs.unlinkSync(testSessionFile);
    }

    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      logServiceError: jest.fn()
    } as any;

    sessionManager = new SessionManager(mockLogger);
  });

  afterEach(() => {
    sessionManager.shutdown();
    // Clean up session file
    if (fs.existsSync(testSessionFile)) {
      fs.unlinkSync(testSessionFile);
    }
  });

  describe('createSession', () => {
    it('should create a new session with correct properties', () => {
      const sessionId = 'test-session-123';
      const session = sessionManager.createSession(sessionId);

      expect(session).toMatchObject({
        id: sessionId,
        toolCalls: 0,
        memories: []
      });
      expect(session.startTime).toBeDefined();
      expect(session.lastActivity).toBeDefined();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'SessionManager',
        'Session created',
        { sessionId }
      );
    });

    it('should persist session to disk', () => {
      const sessionId = 'test-session-123';
      sessionManager.createSession(sessionId);

      // Check file exists
      expect(fs.existsSync(testSessionFile)).toBe(true);
      
      // Verify content
      const data = JSON.parse(fs.readFileSync(testSessionFile, 'utf-8'));
      expect(data).toHaveLength(1);
      expect(data[0][0]).toBe(sessionId);
    });
  });

  describe('getSession', () => {
    it('should return existing session', () => {
      const sessionId = 'test-session-123';
      const createdSession = sessionManager.createSession(sessionId);
      const retrievedSession = sessionManager.getSession(sessionId);

      expect(retrievedSession).toEqual(createdSession);
    });

    it('should return undefined for non-existent session', () => {
      const session = sessionManager.getSession('non-existent');
      expect(session).toBeUndefined();
    });
  });

  describe('updateSession', () => {
    it('should update session properties', () => {
      const sessionId = 'test-session-123';
      sessionManager.createSession(sessionId);

      sessionManager.updateSession(sessionId, {
        metadata: { key: 'value' }
      });

      const session = sessionManager.getSession(sessionId);
      expect(session?.metadata).toEqual({ key: 'value' });
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'SessionManager',
        'Session updated',
        expect.objectContaining({ sessionId })
      );
    });

    it('should update lastActivity timestamp', async () => {
      const sessionId = 'test-session-123';
      const session = sessionManager.createSession(sessionId);
      const originalActivity = session.lastActivity;

      // Wait a bit to ensure timestamp changes
      // Note: Using real timeout instead of fake timers since we're not using jest.useFakeTimers()
      await new Promise(resolve => setTimeout(resolve, 10));

      sessionManager.updateSession(sessionId, {});
      const updatedSession = sessionManager.getSession(sessionId);
      
      expect(updatedSession?.lastActivity).toBeGreaterThan(originalActivity);
    });
  });

  describe('incrementToolCalls', () => {
    it('should increment tool call count', () => {
      const sessionId = 'test-session-123';
      sessionManager.createSession(sessionId);

      sessionManager.incrementToolCalls(sessionId);
      sessionManager.incrementToolCalls(sessionId);

      const session = sessionManager.getSession(sessionId);
      expect(session?.toolCalls).toBe(2);
    });
  });

  describe('addMemory', () => {
    it('should add memory ID to session', () => {
      const sessionId = 'test-session-123';
      sessionManager.createSession(sessionId);

      sessionManager.addMemory(sessionId, 'memory-1');
      sessionManager.addMemory(sessionId, 'memory-2');

      const session = sessionManager.getSession(sessionId);
      expect(session?.memories).toEqual(['memory-1', 'memory-2']);
    });
  });

  describe('cleanupOldSessions', () => {
    it('should remove sessions older than 24 hours', () => {
      const oldSessionId = 'old-session';
      const newSessionId = 'new-session';

      // Create old session
      sessionManager.createSession(oldSessionId);
      const oldSession = sessionManager.getSession(oldSessionId)!;
      // Manually set lastActivity to 25 hours ago
      oldSession.lastActivity = Date.now() - (25 * 60 * 60 * 1000);

      // Create new session
      sessionManager.createSession(newSessionId);

      expect(sessionManager.getAllSessions()).toHaveLength(2);

      sessionManager.cleanupOldSessions();

      expect(sessionManager.getAllSessions()).toHaveLength(1);
      expect(sessionManager.getSession(oldSessionId)).toBeUndefined();
      expect(sessionManager.getSession(newSessionId)).toBeDefined();
    });
  });

  describe('getActiveSessionCount', () => {
    it('should count only recently active sessions', () => {
      const activeId = 'active-session';
      const inactiveId = 'inactive-session';

      sessionManager.createSession(activeId);
      sessionManager.createSession(inactiveId);

      // Make one session inactive (6 minutes old)
      const inactiveSession = sessionManager.getSession(inactiveId)!;
      inactiveSession.lastActivity = Date.now() - (6 * 60 * 1000);

      expect(sessionManager.getActiveSessionCount()).toBe(1);
    });
  });

  describe('persistence', () => {
    it('should load sessions from disk on startup', () => {
      // Create and save sessions
      const sessionId = 'persisted-session';
      sessionManager.createSession(sessionId);
      sessionManager.shutdown();

      // Create new instance
      const newManager = new SessionManager(mockLogger);
      const loadedSession = newManager.getSession(sessionId);

      expect(loadedSession).toBeDefined();
      expect(loadedSession?.id).toBe(sessionId);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'SessionManager',
        expect.stringContaining('Loaded 1 sessions from disk')
      );

      newManager.shutdown();
    });
  });
});
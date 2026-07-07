import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LoggingService } from '../services/logging';

export interface SessionData {
  id: string;
  startTime: number;
  lastActivity: number;
  toolCalls: number;
  memories: string[];
  metadata?: Record<string, any>;
}

export class SessionManager {
  private sessions: Map<string, SessionData> = new Map();
  private sessionFile: string;
  private logger: LoggingService;
  private persistInterval: NodeJS.Timeout | null = null;
  private dirty = false;

  /**
   * @param scope Optional suffix for the session file (typically the project
   *              id). Without it, concurrently running servers from different
   *              projects share one sessions.json and clobber each other
   *              last-writer-wins.
   */
  constructor(logger: LoggingService, scope?: string) {
    this.logger = logger;
    const fileName = scope
      ? `sessions-${scope.replace(/[^a-zA-Z0-9-]/g, '_')}.json`
      : 'sessions.json';
    // Same data directory as the database; the env override keeps tests and
    // custom setups away from the real ~/.claude-recall.
    const baseDir = process.env.CLAUDE_RECALL_DB_PATH || path.join(os.homedir(), '.claude-recall');
    this.sessionFile = path.join(baseDir, fileName);
    this.ensureDirectoryExists();
    this.loadSessions();

    // Persist (only when dirty) and evict stale sessions periodically.
    // Mutations mark dirty instead of writing synchronously — the previous
    // write-on-every-mutation did a full pretty-printed file write per tool
    // call. unref() so this timer never keeps a disconnected server alive.
    this.persistInterval = setInterval(() => {
      this.cleanupOldSessions();
      if (this.dirty) {
        this.persistSessions();
      }
    }, 30000); // Every 30 seconds
    this.persistInterval.unref();
  }

  private schedulePersist(): void {
    this.dirty = true;
  }
  
  private ensureDirectoryExists(): void {
    const dir = path.dirname(this.sessionFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  
  createSession(id: string): SessionData {
    const session: SessionData = {
      id,
      startTime: Date.now(),
      lastActivity: Date.now(),
      toolCalls: 0,
      memories: []
    };

    this.sessions.set(id, session);
    this.schedulePersist();

    this.logger.info('SessionManager', 'Session created', { sessionId: id });

    return session;
  }

  getSession(id: string): SessionData | undefined {
    return this.sessions.get(id);
  }

  updateSession(id: string, update: Partial<SessionData>): void {
    const session = this.sessions.get(id);
    if (session) {
      Object.assign(session, update, { lastActivity: Date.now() });
      this.schedulePersist();

      this.logger.debug('SessionManager', 'Session updated', { sessionId: id, update });
    }
  }

  incrementToolCalls(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.toolCalls++;
      session.lastActivity = Date.now();
      this.schedulePersist();
    }
  }

  addMemory(id: string, memoryId: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.memories.push(memoryId);
      session.lastActivity = Date.now();
      this.schedulePersist();
    }
  }


  private loadSessions(): void {
    try {
      if (fs.existsSync(this.sessionFile)) {
        const data = fs.readFileSync(this.sessionFile, 'utf-8');
        const sessions = JSON.parse(data);
        
        // Convert array back to Map
        if (Array.isArray(sessions)) {
          sessions.forEach(([id, session]) => {
            this.sessions.set(id, session);
          });
        }
        
        this.logger.info('SessionManager', `Loaded ${this.sessions.size} sessions from disk`);
      }
    } catch (error) {
      this.logger.error('SessionManager', 'Failed to load sessions', error);
    }
  }
  
  private persistSessions(): void {
    try {
      // Save to disk like claude-flow does
      const data = JSON.stringify(
        Array.from(this.sessions.entries()),
        null,
        2
      );
      
      fs.writeFileSync(this.sessionFile, data);
      this.dirty = false;
      this.logger.debug('SessionManager', `Persisted ${this.sessions.size} sessions to disk`);
    } catch (error) {
      this.logger.error('SessionManager', 'Failed to persist sessions', error);
    }
  }
  
  // Clean up old sessions (sessions older than 24 hours with no activity)
  cleanupOldSessions(): void {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    
    let removed = 0;
    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity > maxAge) {
        this.sessions.delete(id);
        removed++;
      }
    }
    
    if (removed > 0) {
      this.logger.info('SessionManager', `Cleaned up ${removed} old sessions`);
      this.schedulePersist();
    }
  }
  
  getAllSessions(): SessionData[] {
    return Array.from(this.sessions.values());
  }
  
  getActiveSessionCount(): number {
    const now = Date.now();
    const activeThreshold = 5 * 60 * 1000; // 5 minutes
    
    return Array.from(this.sessions.values()).filter(
      session => now - session.lastActivity < activeThreshold
    ).length;
  }
  
  shutdown(): void {
    if (this.persistInterval) {
      clearInterval(this.persistInterval);
      this.persistInterval = null;
    }
    this.persistSessions();
    this.logger.info('SessionManager', 'Session manager shut down');
  }
}
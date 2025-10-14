import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LoggingService } from '../services/logging';

export interface ConversationTurn {
  timestamp: number;
  tool: string;
  input: any;
  output: any;
  hasPreferenceSignals?: boolean;
}

export interface SessionData {
  id: string;
  startTime: number;
  lastActivity: number;
  toolCalls: number;
  memories: string[];
  conversationHistory?: ConversationTurn[];
  lastAnalyzedTurn?: number;
  preferenceSignalCount?: number;
  metadata?: Record<string, any>;
}

export class SessionManager {
  private sessions: Map<string, SessionData> = new Map();
  private sessionFile: string;
  private logger: LoggingService;
  private persistInterval: NodeJS.Timeout | null = null;
  
  constructor(logger: LoggingService) {
    this.logger = logger;
    this.sessionFile = path.join(os.homedir(), '.claude-recall', 'sessions.json');
    this.ensureDirectoryExists();
    this.loadSessions();
    
    // Persist sessions periodically
    this.persistInterval = setInterval(() => {
      this.persistSessions();
    }, 30000); // Every 30 seconds
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
      memories: [],
      conversationHistory: [],
      lastAnalyzedTurn: 0,
      preferenceSignalCount: 0
    };

    this.sessions.set(id, session);
    this.persistSessions();

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
      this.persistSessions();
      
      this.logger.debug('SessionManager', 'Session updated', { sessionId: id, update });
    }
  }
  
  incrementToolCalls(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.toolCalls++;
      session.lastActivity = Date.now();
      this.persistSessions();
    }
  }
  
  addMemory(id: string, memoryId: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.memories.push(memoryId);
      session.lastActivity = Date.now();
      this.persistSessions();
    }
  }

  /**
   * Add a conversation turn to session history
   * Phase 2: Track conversations for automatic preference analysis
   */
  addConversationTurn(
    id: string,
    tool: string,
    input: any,
    output: any,
    hasPreferenceSignals?: boolean
  ): void {
    const session = this.sessions.get(id);
    if (session) {
      if (!session.conversationHistory) {
        session.conversationHistory = [];
      }

      session.conversationHistory.push({
        timestamp: Date.now(),
        tool,
        input,
        output,
        hasPreferenceSignals
      });

      if (hasPreferenceSignals) {
        session.preferenceSignalCount = (session.preferenceSignalCount || 0) + 1;
      }

      session.lastActivity = Date.now();

      // Keep only last 50 turns to avoid memory bloat
      if (session.conversationHistory.length > 50) {
        session.conversationHistory = session.conversationHistory.slice(-50);
      }

      this.persistSessions();

      this.logger.debug('SessionManager', 'Conversation turn added', {
        sessionId: id,
        tool,
        hasPreferenceSignals,
        totalTurns: session.conversationHistory.length
      });
    }
  }

  /**
   * Get conversation history for a session
   */
  getConversationHistory(id: string): ConversationTurn[] {
    const session = this.sessions.get(id);
    return session?.conversationHistory || [];
  }

  /**
   * Get conversation history as formatted text for analysis
   */
  getConversationText(id: string, sinceTurn?: number): string {
    const session = this.sessions.get(id);
    if (!session?.conversationHistory) {
      return '';
    }

    const startIndex = sinceTurn || 0;
    const turns = session.conversationHistory.slice(startIndex);

    return turns.map((turn, index) => {
      const turnNumber = startIndex + index + 1;
      return `Turn ${turnNumber}:\nTool: ${turn.tool}\nInput: ${JSON.stringify(turn.input, null, 2)}\nOutput: ${JSON.stringify(turn.output, null, 2)}`;
    }).join('\n\n---\n\n');
  }

  /**
   * Mark that analysis has been performed up to a certain turn
   */
  markAnalyzed(id: string, turnNumber: number): void {
    const session = this.sessions.get(id);
    if (session) {
      session.lastAnalyzedTurn = turnNumber;
      this.persistSessions();
    }
  }

  /**
   * Check if session should be analyzed for preferences
   * Criteria:
   * - At least 5 unanalyzed turns
   * - OR at least 3 turns with preference signals
   */
  shouldAnalyzeSession(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session?.conversationHistory) {
      return false;
    }

    const lastAnalyzed = session.lastAnalyzedTurn || 0;
    const currentTurn = session.conversationHistory.length;
    const unanalyzedTurns = currentTurn - lastAnalyzed;

    // Check unanalyzed turns threshold
    if (unanalyzedTurns >= 5) {
      return true;
    }

    // Check preference signal count in unanalyzed turns
    const unanalyzedTurnsWithSignals = session.conversationHistory
      .slice(lastAnalyzed)
      .filter(turn => turn.hasPreferenceSignals)
      .length;

    if (unanalyzedTurnsWithSignals >= 3) {
      return true;
    }

    return false;
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
      this.persistSessions();
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
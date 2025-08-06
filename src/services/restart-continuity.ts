import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LoggingService } from './logging';
import { MemoryService } from './memory';
import { TestOrchestrator } from '../testing/test-orchestrator';

export interface ContinuityState {
  sessionId: string;
  testInProgress: boolean;
  currentTest?: {
    name: string;
    startTime: number;
    scenario: any;
    checkpoints: string[];
  };
  pendingActions: Array<{
    type: string;
    params: any;
    timestamp: number;
  }>;
  lastActivity: number;
  restartCount: number;
}

export interface RestartEvent {
  timestamp: number;
  previousSessionId: string;
  newSessionId: string;
  stateRecovered: boolean;
  testResumed: boolean;
}

export class RestartContinuityManager {
  private static instance: RestartContinuityManager;
  private logger: LoggingService;
  private memoryService: MemoryService;
  private stateFile: string;
  private lockFile: string;
  private currentState: ContinuityState | null = null;
  private checkInterval: NodeJS.Timeout | null = null;
  private testOrchestrator: TestOrchestrator | null = null;
  
  private constructor() {
    this.logger = LoggingService.getInstance();
    this.memoryService = MemoryService.getInstance();
    const baseDir = path.join(os.homedir(), '.claude-recall', 'continuity');
    this.stateFile = path.join(baseDir, 'state.json');
    this.lockFile = path.join(baseDir, 'lock.pid');
    this.ensureDirectory(baseDir);
    this.initialize();
  }
  
  static getInstance(): RestartContinuityManager {
    if (!RestartContinuityManager.instance) {
      RestartContinuityManager.instance = new RestartContinuityManager();
    }
    return RestartContinuityManager.instance;
  }
  
  private ensureDirectory(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  
  private initialize(): void {
    // Check for existing lock file (indicates a restart)
    const wasRestarted = this.detectRestart();
    
    if (wasRestarted) {
      this.handleRestart();
    } else {
      this.createNewSession();
    }
    
    // Create new lock file with current PID
    this.createLockFile();
    
    // Start monitoring for changes
    this.startMonitoring();
  }
  
  private detectRestart(): boolean {
    try {
      if (!fs.existsSync(this.lockFile)) {
        return false;
      }
      
      const lockData = fs.readFileSync(this.lockFile, 'utf-8');
      const previousPid = parseInt(lockData.trim());
      
      // Check if previous process is still running
      try {
        process.kill(previousPid, 0);
        // Process is still running, not a restart
        return false;
      } catch {
        // Process is not running, this is a restart
        this.logger.info('RestartContinuity', 'Restart detected', { 
          previousPid,
          currentPid: process.pid 
        });
        return true;
      }
    } catch (error) {
      this.logger.error('RestartContinuity', 'Error detecting restart', error as Error);
      return false;
    }
  }
  
  private createLockFile(): void {
    fs.writeFileSync(this.lockFile, process.pid.toString());
  }
  
  private handleRestart(): void {
    try {
      // Load previous state
      if (fs.existsSync(this.stateFile)) {
        const stateData = fs.readFileSync(this.stateFile, 'utf-8');
        const previousState = JSON.parse(stateData) as ContinuityState;
        
        // Create restart event
        const restartEvent: RestartEvent = {
          timestamp: Date.now(),
          previousSessionId: previousState.sessionId,
          newSessionId: this.generateSessionId(),
          stateRecovered: true,
          testResumed: false
        };
        
        // Store restart event in memory
        this.memoryService.store({
          key: `restart/event/${restartEvent.newSessionId}`,
          value: restartEvent,
          type: 'restart_event'
        });
        
        // Update state with new session
        previousState.sessionId = restartEvent.newSessionId;
        previousState.restartCount++;
        
        // Check if test was in progress
        if (previousState.testInProgress && previousState.currentTest) {
          this.logger.info('RestartContinuity', 'Resuming test after restart', {
            test: previousState.currentTest.name,
            checkpoints: previousState.currentTest.checkpoints.length
          });
          
          // Resume test
          this.resumeTest(previousState.currentTest);
          restartEvent.testResumed = true;
        }
        
        // Process pending actions
        if (previousState.pendingActions.length > 0) {
          this.processPendingActions(previousState.pendingActions);
        }
        
        this.currentState = previousState;
        this.saveState();
        
        // Inject continuity information as memory
        this.injectContinuityMemory(restartEvent);
      }
    } catch (error) {
      this.logger.error('RestartContinuity', 'Error handling restart', error as Error);
      this.createNewSession();
    }
  }
  
  private createNewSession(): void {
    this.currentState = {
      sessionId: this.generateSessionId(),
      testInProgress: false,
      pendingActions: [],
      lastActivity: Date.now(),
      restartCount: 0
    };
    this.saveState();
  }
  
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  private saveState(): void {
    if (this.currentState) {
      fs.writeFileSync(this.stateFile, JSON.stringify(this.currentState, null, 2));
    }
  }
  
  private startMonitoring(): void {
    // Monitor state changes every 5 seconds
    this.checkInterval = setInterval(() => {
      if (this.currentState) {
        this.currentState.lastActivity = Date.now();
        this.saveState();
      }
    }, 5000);
    
    // Handle process exit
    process.on('exit', () => this.cleanup());
    process.on('SIGINT', () => this.cleanup());
    process.on('SIGTERM', () => this.cleanup());
  }
  
  private cleanup(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
    
    // Mark session as ended
    if (this.currentState) {
      this.currentState.testInProgress = false;
      this.saveState();
    }
    
    // Remove lock file
    if (fs.existsSync(this.lockFile)) {
      fs.unlinkSync(this.lockFile);
    }
  }
  
  // Public methods for test management
  
  markTestStart(testName: string, scenario: any): void {
    if (!this.currentState) return;
    
    this.currentState.testInProgress = true;
    this.currentState.currentTest = {
      name: testName,
      startTime: Date.now(),
      scenario,
      checkpoints: []
    };
    this.saveState();
    
    this.logger.info('RestartContinuity', 'Test started', { 
      test: testName,
      sessionId: this.currentState.sessionId 
    });
  }
  
  addCheckpoint(checkpoint: string): void {
    if (!this.currentState?.currentTest) return;
    
    this.currentState.currentTest.checkpoints.push(checkpoint);
    this.saveState();
    
    this.logger.debug('RestartContinuity', 'Checkpoint added', { 
      checkpoint,
      total: this.currentState.currentTest.checkpoints.length 
    });
  }
  
  markTestComplete(result: any): void {
    if (!this.currentState) return;
    
    // Store test result in memory
    this.memoryService.store({
      key: `test/result/${this.currentState.sessionId}/${Date.now()}`,
      value: {
        test: this.currentState.currentTest,
        result,
        sessionId: this.currentState.sessionId,
        completedAt: Date.now()
      },
      type: 'test_result'
    });
    
    this.currentState.testInProgress = false;
    this.currentState.currentTest = undefined;
    this.saveState();
    
    this.logger.info('RestartContinuity', 'Test completed', { 
      sessionId: this.currentState.sessionId 
    });
  }
  
  addPendingAction(type: string, params: any): void {
    if (!this.currentState) return;
    
    this.currentState.pendingActions.push({
      type,
      params,
      timestamp: Date.now()
    });
    this.saveState();
  }
  
  private async resumeTest(test: any): Promise<void> {
    try {
      // Inject memory about resumed test
      this.memoryService.store({
        key: `test/resumed/${this.currentState?.sessionId}`,
        value: {
          test: test.name,
          checkpoints: test.checkpoints,
          resumedAt: Date.now(),
          originalStart: test.startTime
        },
        type: 'test_resumed'
      });
      
      // If test orchestrator is available, resume the test
      if (this.testOrchestrator) {
        // Resume from last checkpoint
        const lastCheckpoint = test.checkpoints[test.checkpoints.length - 1];
        this.logger.info('RestartContinuity', 'Resuming from checkpoint', { 
          checkpoint: lastCheckpoint 
        });
        
        // Re-run the test scenario with checkpoint data
        await this.testOrchestrator.runScenario({
          name: test.name,
          params: {
            ...test.scenario.params,
            resumeFrom: lastCheckpoint
          },
          sessionId: this.currentState?.sessionId
        });
      }
    } catch (error) {
      this.logger.error('RestartContinuity', 'Error resuming test', error as Error);
    }
  }
  
  private processPendingActions(actions: Array<any>): void {
    this.logger.info('RestartContinuity', 'Processing pending actions', { 
      count: actions.length 
    });
    
    // Store pending actions as memories for visibility
    actions.forEach(action => {
      this.memoryService.store({
        key: `pending/action/${this.currentState?.sessionId}/${action.timestamp}`,
        value: action,
        type: 'pending_action'
      });
    });
    
    // Clear processed actions
    if (this.currentState) {
      this.currentState.pendingActions = [];
      this.saveState();
    }
  }
  
  private injectContinuityMemory(event: RestartEvent): void {
    // Inject detailed continuity information
    this.memoryService.store({
      key: 'continuity/current_state',
      value: {
        event,
        state: this.currentState,
        message: 'Claude Code was restarted. Previous state has been recovered.',
        recommendations: [
          'Check test results from previous session',
          'Review any pending actions',
          'Continue with interrupted workflow'
        ]
      },
      type: 'continuity_state'
    });
  }
  
  setTestOrchestrator(orchestrator: TestOrchestrator): void {
    this.testOrchestrator = orchestrator;
  }
  
  getCurrentState(): ContinuityState | null {
    return this.currentState;
  }
  
  getRestartCount(): number {
    return this.currentState?.restartCount || 0;
  }
  
  isTestInProgress(): boolean {
    return this.currentState?.testInProgress || false;
  }
  
  stopMonitoring(): void {
    // Stop the monitoring interval to allow process to exit
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }
}
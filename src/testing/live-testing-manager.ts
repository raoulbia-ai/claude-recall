import { TestOrchestrator, TestScenario, TestResult } from './test-orchestrator';
import { RestartContinuityManager } from '../services/restart-continuity';
import { MemoryService } from '../services/memory';
import { LoggingService } from '../services/logging';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface LiveTestConfig {
  autoRestart: boolean;
  restartOnFailure: boolean;
  maxRestartAttempts: number;
  restartDelay: number; // milliseconds
  watchFiles: string[];
  injectResults: boolean;
}

export interface LiveTestSession {
  id: string;
  startTime: number;
  tests: TestScenario[];
  results: Map<string, TestResult>;
  restartAttempts: number;
  status: 'running' | 'completed' | 'failed' | 'restarting';
}

export class LiveTestingManager {
  private static instance: LiveTestingManager;
  private testOrchestrator: TestOrchestrator;
  private continuityManager: RestartContinuityManager;
  private memoryService: MemoryService;
  private logger: LoggingService;
  private currentSession: LiveTestSession | null = null;
  private fileWatchers: Map<string, fs.FSWatcher> = new Map();
  private config: LiveTestConfig;
  
  private constructor() {
    this.memoryService = MemoryService.getInstance();
    this.logger = LoggingService.getInstance();
    this.continuityManager = RestartContinuityManager.getInstance();
    this.testOrchestrator = new TestOrchestrator(this.memoryService, this.logger);
    
    // Link test orchestrator with continuity manager
    this.continuityManager.setTestOrchestrator(this.testOrchestrator);
    
    // Default configuration
    this.config = {
      autoRestart: true,
      restartOnFailure: true,
      maxRestartAttempts: 3,
      restartDelay: 2000,
      watchFiles: [
        'src/hooks/**/*.sh',
        'src/cli/claude-recall-cli.ts',
        'src/services/**/*.ts'
      ],
      injectResults: true
    };
    
    this.initialize();
  }
  
  static getInstance(): LiveTestingManager {
    if (!LiveTestingManager.instance) {
      LiveTestingManager.instance = new LiveTestingManager();
    }
    return LiveTestingManager.instance;
  }
  
  private initialize(): void {
    // Check if we're resuming from a restart
    const continuityState = this.continuityManager.getCurrentState();
    if (continuityState?.testInProgress) {
      this.logger.info('LiveTesting', 'Resuming tests after restart', {
        sessionId: continuityState.sessionId,
        test: continuityState.currentTest?.name
      });
    }
  }
  
  async startLiveTestSession(tests: TestScenario[]): Promise<string> {
    const sessionId = `live_test_${Date.now()}`;
    
    this.currentSession = {
      id: sessionId,
      startTime: Date.now(),
      tests,
      results: new Map(),
      restartAttempts: 0,
      status: 'running'
    };
    
    // Store session start in memory
    this.memoryService.store({
      key: `live_test/session/${sessionId}`,
      value: {
        id: sessionId,
        tests: tests.map(t => t.name),
        startTime: this.currentSession.startTime
      },
      type: 'live_test_session'
    });
    
    // Start file watchers if auto-restart is enabled
    if (this.config.autoRestart) {
      this.startFileWatchers();
    }
    
    // Run tests
    await this.runTests();
    
    return sessionId;
  }
  
  private async runTests(): Promise<void> {
    if (!this.currentSession) return;
    
    for (const test of this.currentSession.tests) {
      try {
        // Mark test start in continuity manager
        this.continuityManager.markTestStart(test.name, test);
        
        // Add checkpoint before running
        this.continuityManager.addCheckpoint(`pre_run_${test.name}`);
        
        // Run the test
        this.logger.info('LiveTesting', 'Running test', { name: test.name });
        const result = await this.testOrchestrator.runScenario(test);
        
        // Store result
        this.currentSession.results.set(test.name, result);
        
        // Add checkpoint after completion
        this.continuityManager.addCheckpoint(`post_run_${test.name}`);
        
        // Mark test complete
        this.continuityManager.markTestComplete(result);
        
        // Inject result as memory if configured
        if (this.config.injectResults) {
          this.injectTestResult(test.name, result);
        }
        
        // Check if restart is needed based on result
        if (result.status === 'failed' && this.config.restartOnFailure) {
          await this.handleTestFailure(test, result);
        }
        
      } catch (error) {
        this.logger.error('LiveTesting', 'Test execution error', error as Error, {
          test: test.name
        });
        
        // Add error to continuity for recovery
        this.continuityManager.addPendingAction('retry_test', {
          test: test.name,
          error: (error as Error).message
        });
        
        if (this.config.restartOnFailure) {
          await this.triggerRestart('test_error');
        }
      }
    }
    
    // Mark session complete
    if (this.currentSession) {
      this.currentSession.status = 'completed';
      this.completeLiveTestSession();
    }
  }
  
  private async handleTestFailure(test: TestScenario, result: TestResult): Promise<void> {
    this.logger.warn('LiveTesting', 'Test failed, evaluating restart', {
      test: test.name,
      violations: result.observations.complianceViolations
    });
    
    // Check if the failure requires a restart
    const requiresRestart = this.evaluateRestartNeed(result);
    
    if (requiresRestart) {
      // Store failure information
      this.memoryService.store({
        key: `test/failure/${this.currentSession?.id}/${test.name}`,
        value: {
          test: test.name,
          result,
          timestamp: Date.now(),
          restartTriggered: true
        },
        type: 'test_failure'
      });
      
      await this.triggerRestart('test_failure');
    }
  }
  
  private evaluateRestartNeed(result: TestResult): boolean {
    // Restart if there are compliance violations related to hooks or CLI
    if (result.observations.complianceViolations.length > 0) {
      const criticalViolations = result.observations.complianceViolations.filter(v => {
        const message = (v.message || v.type || '').toLowerCase();
        return message.includes('hook') || message.includes('cli') || message.includes('restart');
      });
      return criticalViolations.length > 0;
    }
    
    // Restart if suggested fix mentions restart
    if (result.insights.suggestedFix?.includes('restart')) {
      return true;
    }
    
    return false;
  }
  
  private async triggerRestart(reason: string): Promise<void> {
    if (!this.currentSession) return;
    
    // Check restart attempts
    if (this.currentSession.restartAttempts >= this.config.maxRestartAttempts) {
      this.logger.error('LiveTesting', 'Max restart attempts reached', {
        attempts: this.currentSession.restartAttempts
      });
      this.currentSession.status = 'failed';
      return;
    }
    
    this.currentSession.status = 'restarting';
    this.currentSession.restartAttempts++;
    
    this.logger.info('LiveTesting', 'Triggering restart', {
      reason,
      attempt: this.currentSession.restartAttempts
    });
    
    // Store restart event
    this.memoryService.store({
      key: `restart/trigger/${Date.now()}`,
      value: {
        reason,
        sessionId: this.currentSession.id,
        attempt: this.currentSession.restartAttempts,
        timestamp: Date.now()
      },
      type: 'restart_trigger'
    });
    
    // Wait before restart
    await new Promise(resolve => setTimeout(resolve, this.config.restartDelay));
    
    // Execute restart command
    await this.executeRestart();
  }
  
  private async executeRestart(): Promise<void> {
    try {
      // First, rebuild the project
      this.logger.info('LiveTesting', 'Rebuilding project before restart');
      await execAsync('npm run build');
      
      // Note: In a real implementation, Claude Code would need to be restarted
      // This is a placeholder for the actual restart mechanism
      // The restart would be detected by the RestartContinuityManager
      
      this.logger.info('LiveTesting', 'Restart command executed');
      
      // The actual restart would terminate this process
      // For testing purposes, we simulate the restart effect
      this.simulateRestartEffect();
      
    } catch (error) {
      this.logger.error('LiveTesting', 'Restart execution failed', error as Error);
    }
  }
  
  private simulateRestartEffect(): void {
    // This simulates what would happen after a restart
    // In reality, the process would restart and the RestartContinuityManager
    // would detect it and resume operations
    
    this.logger.info('LiveTesting', 'Simulating restart effect');
    
    // Clear current session (would be restored by continuity manager)
    const sessionBackup = { ...this.currentSession };
    this.currentSession = null;
    
    // Simulate restart detection and recovery
    setTimeout(() => {
      this.logger.info('LiveTesting', 'Simulating restart recovery');
      
      // Restore session (normally done by continuity manager)
      this.currentSession = sessionBackup as LiveTestSession;
      if (this.currentSession) {
        this.currentSession.status = 'running';
      }
      
      // Continue tests
      this.runTests();
    }, 1000);
  }
  
  private startFileWatchers(): void {
    // Watch configured files for changes
    this.config.watchFiles.forEach(pattern => {
      const basePath = path.resolve(process.cwd());
      
      // Simple file watching (in production, use chokidar for glob patterns)
      if (pattern.includes('**')) {
        // For now, watch directories
        const dir = pattern.split('**')[0];
        const fullPath = path.join(basePath, dir);
        
        if (fs.existsSync(fullPath)) {
          const watcher = fs.watch(fullPath, { recursive: true }, (eventType, filename) => {
            this.handleFileChange(eventType, path.join(fullPath, filename || ''));
          });
          this.fileWatchers.set(pattern, watcher);
        }
      }
    });
    
    this.logger.info('LiveTesting', 'File watchers started', {
      patterns: this.config.watchFiles
    });
  }
  
  private handleFileChange(eventType: string, filepath: string): void {
    this.logger.info('LiveTesting', 'File change detected', {
      eventType,
      filepath
    });
    
    // Check if change requires restart
    if (this.requiresRestartForFile(filepath)) {
      this.continuityManager.addPendingAction('file_change_restart', {
        file: filepath,
        eventType,
        timestamp: Date.now()
      });
      
      // Trigger restart after a short delay to batch changes
      setTimeout(() => {
        this.triggerRestart('file_change');
      }, 500);
    }
  }
  
  private requiresRestartForFile(filepath: string): boolean {
    // Hooks and CLI changes always require restart
    if (filepath.includes('/hooks/') || filepath.includes('claude-recall-cli')) {
      return true;
    }
    
    // Service changes might require restart
    if (filepath.includes('/services/')) {
      return true;
    }
    
    return false;
  }
  
  private injectTestResult(testName: string, result: TestResult): void {
    // Inject test result as searchable memory
    this.memoryService.store({
      key: `test/result/injected/${testName}`,
      value: {
        test: testName,
        status: result.status,
        observations: result.observations,
        insights: result.insights,
        timestamp: Date.now(),
        sessionId: this.currentSession?.id
      },
      type: 'test_result_injected'
    });
    
    // Also inject specific insights for quick access
    if (result.insights.suggestedFix) {
      this.memoryService.store({
        key: `test/insight/fix/${testName}`,
        value: {
          test: testName,
          fix: result.insights.suggestedFix,
          confidence: result.insights.confidenceLevel
        },
        type: 'test_fix_suggestion'
      });
    }
  }
  
  private completeLiveTestSession(): void {
    if (!this.currentSession) return;
    
    // Stop file watchers
    this.fileWatchers.forEach(watcher => watcher.close());
    this.fileWatchers.clear();
    
    // Generate session summary
    const summary = {
      sessionId: this.currentSession.id,
      duration: Date.now() - this.currentSession.startTime,
      totalTests: this.currentSession.tests.length,
      passed: Array.from(this.currentSession.results.values()).filter(r => r.status === 'passed').length,
      failed: Array.from(this.currentSession.results.values()).filter(r => r.status === 'failed').length,
      restartAttempts: this.currentSession.restartAttempts,
      results: Array.from(this.currentSession.results.entries()).map(([name, result]) => ({
        test: name,
        status: result.status,
        violations: result.observations.complianceViolations.length
      }))
    };
    
    // Store summary
    this.memoryService.store({
      key: `live_test/summary/${this.currentSession.id}`,
      value: summary,
      type: 'live_test_summary'
    });
    
    this.logger.info('LiveTesting', 'Session completed', summary);
  }
  
  async stopLiveTestSession(): Promise<void> {
    if (!this.currentSession) return;
    
    this.currentSession.status = 'completed';
    this.completeLiveTestSession();
    this.currentSession = null;
  }
  
  getSessionStatus(): any {
    if (!this.currentSession) {
      return { status: 'no_active_session' };
    }
    
    return {
      sessionId: this.currentSession.id,
      status: this.currentSession.status,
      testsRun: this.currentSession.results.size,
      totalTests: this.currentSession.tests.length,
      restartAttempts: this.currentSession.restartAttempts,
      results: Array.from(this.currentSession.results.entries()).map(([name, result]) => ({
        test: name,
        status: result.status
      }))
    };
  }
  
  updateConfig(config: Partial<LiveTestConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.info('LiveTesting', 'Configuration updated', this.config);
  }
}
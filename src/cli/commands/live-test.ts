import { Command } from 'commander';
import { LiveTestingManager } from '../../testing/live-testing-manager';
import { RestartContinuityManager } from '../../services/restart-continuity';
import { LoggingService } from '../../services/logging';
import { TestScenario } from '../../testing/test-orchestrator';

export class LiveTestCommand {
  private liveTestManager: LiveTestingManager;
  private continuityManager: RestartContinuityManager;
  private logger: LoggingService;
  
  constructor() {
    this.liveTestManager = LiveTestingManager.getInstance();
    this.continuityManager = RestartContinuityManager.getInstance();
    this.logger = LoggingService.getInstance();
  }
  
  register(program: Command): void {
    const liveTestCmd = program
      .command('live-test')
      .description('Manage live testing with automatic restart capability');
    
    // Start live testing
    liveTestCmd
      .command('start')
      .description('Start a live testing session')
      .option('-s, --scenario <scenarios...>', 'Test scenarios to run', ['memory_persistence', 'search_compliance'])
      .option('-a, --auto-restart', 'Enable automatic restart on changes', true)
      .option('-r, --restart-on-failure', 'Restart on test failures', true)
      .option('-m, --max-restarts <number>', 'Maximum restart attempts', '3')
      .option('-i, --inject-results', 'Inject test results as memories', true)
      .action(async (options) => {
        await this.startLiveTest(options);
      });
    
    // Check status
    liveTestCmd
      .command('status')
      .description('Check live testing and continuity status')
      .action(() => {
        this.showStatus();
      });
    
    // Stop testing
    liveTestCmd
      .command('stop')
      .description('Stop the current live testing session')
      .action(async () => {
        await this.stopLiveTest();
      });
    
    // Check continuity
    liveTestCmd
      .command('continuity')
      .description('Show continuity state and restart information')
      .action(() => {
        this.showContinuity();
      });
    
    // Add checkpoint
    liveTestCmd
      .command('checkpoint <name>')
      .description('Add a checkpoint for restart recovery')
      .action((name) => {
        this.addCheckpoint(name);
      });
    
    // Simulate restart
    liveTestCmd
      .command('restart')
      .description('Simulate a restart for testing')
      .option('-r, --reason <reason>', 'Reason for restart', 'manual_test')
      .action((options) => {
        this.simulateRestart(options.reason);
      });
  }
  
  private async startLiveTest(options: any): Promise<void> {
    console.log('🚀 Starting Live Testing Session');
    console.log('━'.repeat(50));
    
    try {
      // Parse scenarios
      const scenarios: TestScenario[] = options.scenario.map((name: string) => ({
        name,
        params: {},
        sessionId: `cli_${Date.now()}`
      }));
      
      // Configure live testing
      this.liveTestManager.updateConfig({
        autoRestart: options.autoRestart,
        restartOnFailure: options.restartOnFailure,
        maxRestartAttempts: parseInt(options.maxRestarts),
        restartDelay: 2000,
        watchFiles: [
          'src/hooks/**/*.sh',
          'src/cli/claude-recall-cli.ts',
          'src/services/**/*.ts'
        ],
        injectResults: options.injectResults
      });
      
      // Start session
      const sessionId = await this.liveTestManager.startLiveTestSession(scenarios);
      
      console.log('✅ Live testing session started');
      console.log(`Session ID: ${sessionId}`);
      console.log(`Scenarios: ${scenarios.map(s => s.name).join(', ')}`);
      console.log();
      console.log('Configuration:');
      console.log(`  • Auto-restart: ${options.autoRestart ? 'enabled' : 'disabled'}`);
      console.log(`  • Restart on failure: ${options.restartOnFailure ? 'enabled' : 'disabled'}`);
      console.log(`  • Max restarts: ${options.maxRestarts}`);
      console.log(`  • Inject results: ${options.injectResults ? 'enabled' : 'disabled'}`);
      console.log();
      console.log('Watching for file changes...');
      console.log('Use "claude-recall live-test status" to check progress');
      
    } catch (error) {
      console.error('❌ Failed to start live testing:', (error as Error).message);
      process.exit(1);
    }
  }
  
  private showStatus(): void {
    console.log('📊 Live Testing Status');
    console.log('━'.repeat(50));
    
    // Get live test status
    const liveStatus = this.liveTestManager.getSessionStatus();
    
    if (liveStatus.status === 'no_active_session') {
      console.log('No active live testing session');
    } else {
      console.log(`Session ID: ${liveStatus.sessionId}`);
      console.log(`Status: ${this.getStatusEmoji(liveStatus.status)} ${liveStatus.status}`);
      console.log(`Progress: ${liveStatus.testsRun}/${liveStatus.totalTests} tests`);
      console.log(`Restart attempts: ${liveStatus.restartAttempts}`);
      
      if (liveStatus.results && liveStatus.results.length > 0) {
        console.log();
        console.log('Test Results:');
        liveStatus.results.forEach((result: any) => {
          const emoji = result.status === 'passed' ? '✅' : result.status === 'failed' ? '❌' : '⚠️';
          console.log(`  ${emoji} ${result.test}: ${result.status}`);
        });
      }
    }
    
    // Get continuity status
    const continuityState = this.continuityManager.getCurrentState();
    if (continuityState) {
      console.log();
      console.log('🔄 Continuity State');
      console.log('━'.repeat(50));
      console.log(`Session: ${continuityState.sessionId}`);
      console.log(`Restarts: ${continuityState.restartCount}`);
      console.log(`Test in progress: ${continuityState.testInProgress ? 'yes' : 'no'}`);
      
      if (continuityState.currentTest) {
        console.log(`Current test: ${continuityState.currentTest.name}`);
        console.log(`Checkpoints: ${continuityState.currentTest.checkpoints.length}`);
      }
      
      if (continuityState.pendingActions.length > 0) {
        console.log();
        console.log(`Pending actions: ${continuityState.pendingActions.length}`);
      }
    }
    
    // Stop monitoring to allow process to exit
    this.continuityManager.stopMonitoring();
  }
  
  private async stopLiveTest(): Promise<void> {
    console.log('🛑 Stopping Live Testing');
    
    try {
      await this.liveTestManager.stopLiveTestSession();
      console.log('✅ Live testing session stopped');
    } catch (error) {
      console.error('❌ Failed to stop live testing:', (error as Error).message);
    }
  }
  
  private showContinuity(): void {
    console.log('🔄 Continuity Information');
    console.log('━'.repeat(50));
    
    const state = this.continuityManager.getCurrentState();
    
    if (!state) {
      console.log('No continuity state available');
      return;
    }
    
    console.log('Session Information:');
    console.log(`  • ID: ${state.sessionId}`);
    console.log(`  • Restart count: ${state.restartCount}`);
    console.log(`  • Last activity: ${new Date(state.lastActivity).toLocaleString()}`);
    console.log();
    
    if (state.testInProgress && state.currentTest) {
      console.log('Current Test:');
      console.log(`  • Name: ${state.currentTest.name}`);
      console.log(`  • Started: ${new Date(state.currentTest.startTime).toLocaleString()}`);
      console.log(`  • Checkpoints: ${state.currentTest.checkpoints.length}`);
      
      if (state.currentTest.checkpoints.length > 0) {
        console.log('  • Recent checkpoints:');
        state.currentTest.checkpoints.slice(-3).forEach(cp => {
          console.log(`    - ${cp}`);
        });
      }
    } else {
      console.log('No test currently in progress');
    }
    
    if (state.pendingActions.length > 0) {
      console.log();
      console.log(`Pending Actions (${state.pendingActions.length}):`);
      state.pendingActions.forEach(action => {
        console.log(`  • ${action.type} - ${new Date(action.timestamp).toLocaleString()}`);
      });
    }
    
    // Stop monitoring to allow process to exit
    this.continuityManager.stopMonitoring();
  }
  
  private addCheckpoint(name: string): void {
    console.log('➕ Adding Checkpoint');
    
    try {
      this.continuityManager.addCheckpoint(name);
      console.log(`✅ Checkpoint added: ${name}`);
      
      const state = this.continuityManager.getCurrentState();
      if (state?.currentTest) {
        console.log(`Total checkpoints: ${state.currentTest.checkpoints.length}`);
      }
    } catch (error) {
      console.error('❌ Failed to add checkpoint:', (error as Error).message);
    } finally {
      // Stop monitoring to allow process to exit
      this.continuityManager.stopMonitoring();
    }
  }
  
  private simulateRestart(reason: string): void {
    console.log('🔄 Simulating Restart');
    console.log('━'.repeat(50));
    
    console.log(`Reason: ${reason}`);
    console.log('Note: This simulates a restart for testing purposes');
    console.log('In production, Claude Code would actually restart');
    
    // Add restart action to continuity
    this.continuityManager.addPendingAction('simulated_restart', {
      reason,
      timestamp: Date.now()
    });
    
    console.log();
    console.log('✅ Restart simulation recorded');
    console.log('The restart will be detected on next actual restart');
    
    // Stop monitoring to allow process to exit
    this.continuityManager.stopMonitoring();
  }
  
  private getStatusEmoji(status: string): string {
    switch (status) {
      case 'running': return '🏃';
      case 'completed': return '✅';
      case 'failed': return '❌';
      case 'restarting': return '🔄';
      default: return '❓';
    }
  }
}
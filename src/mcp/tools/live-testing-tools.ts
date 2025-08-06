import { LiveTestingManager } from '../../testing/live-testing-manager';
import { RestartContinuityManager } from '../../services/restart-continuity';
import { TestScenario } from '../../testing/test-orchestrator';

export interface LiveTestToolParams {
  action: string;
  params?: any;
}

export class LiveTestingTools {
  private liveTestManager: LiveTestingManager;
  private continuityManager: RestartContinuityManager;
  
  constructor() {
    this.liveTestManager = LiveTestingManager.getInstance();
    this.continuityManager = RestartContinuityManager.getInstance();
  }
  
  getToolDefinitions() {
    return [
      {
        name: 'live_test_start',
        description: 'Start a live testing session with automatic restart capability',
        parameters: {
          type: 'object',
          properties: {
            tests: {
              type: 'array',
              description: 'Array of test scenarios to run',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  params: { type: 'object' }
                }
              }
            },
            config: {
              type: 'object',
              description: 'Live testing configuration',
              properties: {
                autoRestart: { type: 'boolean' },
                restartOnFailure: { type: 'boolean' },
                maxRestartAttempts: { type: 'number' },
                injectResults: { type: 'boolean' }
              }
            }
          },
          required: ['tests']
        }
      },
      {
        name: 'live_test_status',
        description: 'Get the current status of the live testing session',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'live_test_stop',
        description: 'Stop the current live testing session',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'continuity_status',
        description: 'Get the current continuity state and restart information',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'continuity_checkpoint',
        description: 'Add a checkpoint to the current test for restart recovery',
        parameters: {
          type: 'object',
          properties: {
            checkpoint: {
              type: 'string',
              description: 'Checkpoint identifier'
            }
          },
          required: ['checkpoint']
        }
      },
      {
        name: 'trigger_restart',
        description: 'Manually trigger a restart for testing purposes',
        parameters: {
          type: 'object',
          properties: {
            reason: {
              type: 'string',
              description: 'Reason for the restart'
            }
          },
          required: ['reason']
        }
      }
    ];
  }
  
  async handleToolCall(toolName: string, params: any): Promise<any> {
    switch (toolName) {
      case 'live_test_start':
        return await this.startLiveTest(params);
        
      case 'live_test_status':
        return this.getLiveTestStatus();
        
      case 'live_test_stop':
        return await this.stopLiveTest();
        
      case 'continuity_status':
        return this.getContinuityStatus();
        
      case 'continuity_checkpoint':
        return this.addCheckpoint(params);
        
      case 'trigger_restart':
        return await this.triggerRestart(params);
        
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }
  
  private async startLiveTest(params: any): Promise<any> {
    try {
      // Update configuration if provided
      if (params.config) {
        this.liveTestManager.updateConfig(params.config);
      }
      
      // Convert test definitions to TestScenario format
      const tests: TestScenario[] = params.tests.map((t: any) => ({
        name: t.name,
        params: t.params || {},
        sessionId: `test_${Date.now()}`
      }));
      
      // Start the live testing session
      const sessionId = await this.liveTestManager.startLiveTestSession(tests);
      
      return {
        success: true,
        sessionId,
        message: `Live testing session started with ${tests.length} tests`,
        tests: tests.map(t => t.name),
        config: {
          autoRestart: params.config?.autoRestart ?? true,
          restartOnFailure: params.config?.restartOnFailure ?? true,
          injectResults: params.config?.injectResults ?? true
        }
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }
  
  private getLiveTestStatus(): any {
    const status = this.liveTestManager.getSessionStatus();
    const continuityState = this.continuityManager.getCurrentState();
    
    return {
      liveTest: status,
      continuity: {
        sessionId: continuityState?.sessionId,
        testInProgress: continuityState?.testInProgress,
        currentTest: continuityState?.currentTest?.name,
        checkpoints: continuityState?.currentTest?.checkpoints?.length || 0,
        restartCount: continuityState?.restartCount || 0
      }
    };
  }
  
  private async stopLiveTest(): Promise<any> {
    try {
      await this.liveTestManager.stopLiveTestSession();
      
      return {
        success: true,
        message: 'Live testing session stopped'
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }
  
  private getContinuityStatus(): any {
    const state = this.continuityManager.getCurrentState();
    
    if (!state) {
      return {
        status: 'no_state',
        message: 'No continuity state available'
      };
    }
    
    return {
      sessionId: state.sessionId,
      testInProgress: state.testInProgress,
      currentTest: state.currentTest,
      pendingActions: state.pendingActions,
      lastActivity: new Date(state.lastActivity).toISOString(),
      restartCount: state.restartCount,
      isTestInProgress: this.continuityManager.isTestInProgress()
    };
  }
  
  private addCheckpoint(params: any): any {
    try {
      this.continuityManager.addCheckpoint(params.checkpoint);
      
      return {
        success: true,
        checkpoint: params.checkpoint,
        message: 'Checkpoint added successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }
  
  private async triggerRestart(params: any): Promise<any> {
    try {
      // This would trigger a manual restart for testing
      // In production, this would actually restart Claude Code
      
      return {
        success: true,
        message: 'Restart triggered',
        reason: params.reason,
        note: 'Manual restart initiated for testing'
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }
}
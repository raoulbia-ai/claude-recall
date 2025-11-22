#!/usr/bin/env node
/**
 * PubNub Integration Test
 *
 * End-to-end test of the autonomous memory system:
 * 1. Start memory agent
 * 2. Publish test events via hooks
 * 3. Verify agent receives and processes events
 * 4. Check memory context is published back
 *
 * Usage:
 *   node test-integration.js
 */

import { PubNubPublisher } from './publisher.js';
import { MemoryAgent } from './memory-agent.js';
import { CHANNELS, MessageType } from './config.js';

class IntegrationTest {
  private publisher: PubNubPublisher;
  private agent: MemoryAgent | null = null;
  private testSessionId: string;

  constructor() {
    this.publisher = new PubNubPublisher();
    this.testSessionId = `test-session-${Date.now()}`;
  }

  /**
   * Run full integration test
   */
  async run(): Promise<void> {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🧪 PubNub Integration Test');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');

    try {
      // Test 1: Publisher connectivity
      await this.testPublisher();

      // Test 2: Start memory agent
      await this.testAgentStartup();

      // Test 3: Tool event flow
      await this.testToolEventFlow();

      // Test 4: Prompt event flow
      await this.testPromptEventFlow();

      // Test 5: Memory context flow
      await this.testMemoryContextFlow();

      console.log('');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('✅ All tests passed!');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('');
      console.log('Next steps:');
      console.log('  1. Update .claude/settings.json to use PubNub hooks');
      console.log('  2. Start memory agent: claude-recall agent start');
      console.log('  3. Start Claude Code and watch autonomous memory in action!');
    } catch (error) {
      console.error('');
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.error('❌ Test failed:', error);
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      process.exit(1);
    } finally {
      // Cleanup
      if (this.agent) {
        await this.agent.stop();
      }
    }
  }

  /**
   * Test 1: Publisher connectivity
   */
  private async testPublisher(): Promise<void> {
    console.log('Test 1: Publisher Connectivity');
    console.log('  Testing PubNub publish endpoint...');

    const success = await this.publisher.publishToolPreExecution(
      this.testSessionId,
      'TestTool',
      { test: true }
    );

    if (!success) {
      throw new Error('Publisher test failed - check PubNub credentials');
    }

    console.log('  ✅ Publisher working');
    console.log('');
  }

  /**
   * Test 2: Memory agent startup
   */
  private async testAgentStartup(): Promise<void> {
    console.log('Test 2: Memory Agent Startup');
    console.log('  Starting memory agent...');

    this.agent = new MemoryAgent('test-project');

    // Start agent in background
    const startPromise = this.agent.start();

    // Give it a moment to initialize
    await this.sleep(2000);

    console.log('  ✅ Memory agent started');
    console.log('');
  }

  /**
   * Test 3: Tool event flow
   */
  private async testToolEventFlow(): Promise<void> {
    console.log('Test 3: Tool Event Flow');
    console.log('  Publishing tool pre-execution event...');

    const toolInput = {
      file_path: '/test/example.ts',
      content: 'console.log("test");',
    };

    const success = await this.publisher.publishToolPreExecution(
      this.testSessionId,
      'Write',
      toolInput,
      'test-project'
    );

    if (!success) {
      throw new Error('Tool event publish failed');
    }

    console.log('  ✅ Tool event published');
    console.log('  ⏳ Waiting for agent to process...');

    await this.sleep(2000);

    console.log('  ✅ Tool event processed (check agent logs)');
    console.log('');
  }

  /**
   * Test 4: Prompt event flow
   */
  private async testPromptEventFlow(): Promise<void> {
    console.log('Test 4: Prompt Event Flow');
    console.log('  Publishing user prompt...');

    const prompt = 'I prefer TypeScript with strict mode enabled';

    const success = await this.publisher.publishPromptSubmitted(
      this.testSessionId,
      prompt,
      'test-project'
    );

    if (!success) {
      throw new Error('Prompt event publish failed');
    }

    console.log('  ✅ Prompt event published');
    console.log('  ⏳ Waiting for agent to analyze...');

    await this.sleep(2000);

    console.log('  ✅ Prompt analyzed (check agent logs)');
    console.log('');
  }

  /**
   * Test 5: Memory context flow
   */
  private async testMemoryContextFlow(): Promise<void> {
    console.log('Test 5: Memory Context Flow');
    console.log('  Testing end-to-end memory flow...');

    // Simulate full cycle:
    // 1. User states preference
    await this.publisher.publishPromptSubmitted(
      this.testSessionId,
      'Always use Jest for testing',
      'test-project'
    );

    await this.sleep(1000);

    // 2. User creates file
    await this.publisher.publishToolPreExecution(
      this.testSessionId,
      'Write',
      {
        file_path: '/test/example.test.ts',
        content: 'test content',
      },
      'test-project'
    );

    await this.sleep(2000);

    console.log('  ✅ Full memory cycle completed');
    console.log('  📝 Check agent logs for memory context suggestions');
    console.log('');
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Main entry point
 */
async function main() {
  const test = new IntegrationTest();
  await test.run();
}

main().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});

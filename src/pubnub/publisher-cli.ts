#!/usr/bin/env node
/**
 * PubNub Publisher CLI
 *
 * Lightweight CLI for publishing events from hooks to PubNub.
 * Used by Python hook scripts for fast, non-blocking event publishing.
 *
 * Usage:
 *   node publisher-cli.js tool-pre '{"sessionId":"...", "toolName":"Write", ...}'
 *   node publisher-cli.js prompt '{"sessionId":"...", "content":"..."}'
 */

import { PubNubPublisher } from './publisher.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: publisher-cli <event-type> <json-data>');
    console.error('');
    console.error('Event types:');
    console.error('  tool-pre   - Tool pre-execution event');
    console.error('  tool-post  - Tool post-execution event');
    console.error('  tool-error - Tool error event');
    console.error('  prompt     - User prompt event');
    process.exit(1);
  }

  const [eventType, jsonData] = args;
  const publisher = new PubNubPublisher();

  try {
    const data = JSON.parse(jsonData);

    switch (eventType) {
      case 'tool-pre':
        await publisher.publishToolPreExecution(
          data.sessionId,
          data.toolName,
          data.toolInput,
          data.projectId
        );
        break;

      case 'tool-post':
        await publisher.publishToolPostExecution(
          data.sessionId,
          data.toolName,
          data.toolInput,
          data.toolOutput,
          data.duration,
          data.projectId
        );
        break;

      case 'tool-error':
        await publisher.publishToolError(
          data.sessionId,
          data.toolName,
          data.toolInput,
          new Error(data.error?.message || 'Unknown error'),
          data.projectId
        );
        break;

      case 'prompt':
        await publisher.publishPromptSubmitted(
          data.sessionId,
          data.content,
          data.projectId
        );
        break;

      default:
        console.error(`Unknown event type: ${eventType}`);
        console.error('Valid types: tool-pre, tool-post, tool-error, prompt');
        process.exit(1);
    }

    // Exit silently on success (hooks don't need output)
    process.exit(0);
  } catch (error) {
    // Fail silently - hooks should never block
    console.error(`[PubNub] Error: ${error}`);
    process.exit(1);
  }
}

main();

/**
 * session-end-checkpoint-worker — detached background worker spawned by the
 * session-end-checkpoint hook handler.
 *
 * Runs OUTSIDE Claude Code's 1.5s SessionEnd hook timeout. Reads the transcript,
 * extracts a most-recent-task checkpoint via Haiku, and saves it via
 * MemoryService.saveCheckpoint(). The next CC session that calls load_rules
 * will see the checkpoint hint.
 *
 * This worker is the symmetric counterpart to Pi's in-process auto-checkpoint
 * (src/pi/extension.ts session_shutdown handler). Both call the same shared
 * extractCheckpoint() function from event-processors.
 */

import {
  hookLog,
  readTranscriptTail,
  extractTextFromEntry,
  extractToolInteractions,
  extractAssistantTexts,
} from './shared';
import { extractCheckpoint, ConversationEntry, setLogFunction } from '../shared/event-processors';
import { ConfigService } from '../services/config';

const TRANSCRIPT_TAIL_SIZE = 30;

export async function handleSessionEndCheckpointWorker(input: any): Promise<void> {
  // Wire event-processor logs through hookLog so extractCheckpoint diagnostics
  // (LLM null, quality gate filter, save failure) end up in
  // ~/.claude-recall/hook-logs/session-end-checkpoint-worker.log instead of
  // being silently dropped by the default no-op logFn.
  setLogFunction((source, msg) => hookLog('session-end-checkpoint-worker', `[${source}] ${msg}`));

  const transcriptPath: string = input?.transcript_path ?? '';
  if (!transcriptPath) {
    hookLog('session-end-checkpoint-worker', 'No transcript_path provided');
    return;
  }

  const cwd: string | undefined = input?.cwd;
  if (cwd) {
    try {
      ConfigService.getInstance().updateConfig({ project: { rootDir: cwd } } as any);
    } catch {
      // Non-critical — getProjectId will fall back to process.cwd() basename
    }
  }

  const projectId = ConfigService.getInstance().getProjectId();
  if (!projectId) {
    hookLog('session-end-checkpoint-worker', 'No project_id resolved — aborting');
    return;
  }

  const entries = readTranscriptTail(transcriptPath, TRANSCRIPT_TAIL_SIZE);
  if (entries.length === 0) {
    hookLog('session-end-checkpoint-worker', 'No transcript entries found');
    return;
  }

  // Convert raw transcript JSONL entries to the ConversationEntry shape that
  // extractCheckpoint expects. We include user prompts, assistant text blocks,
  // AND tool interactions — Haiku needs the assistant's reasoning (especially
  // completion signals like "Done.") to know whether the most recent task is
  // finished or still in flight. Without assistant text the model hallucinates
  // follow-up work from sparse tool-call context.
  const converted: { entry: ConversationEntry; index: number }[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] as any;
    const role = entry?.message?.role ?? entry?.role;
    if (role === 'user') {
      // Skip user entries that are pure tool_result wrappers — those will be
      // captured via extractToolInteractions below
      const content = entry?.message?.content ?? entry?.content;
      const isPureToolResult =
        Array.isArray(content) && content.every((b: any) => b?.type === 'tool_result');
      if (isPureToolResult) continue;

      const text = extractTextFromEntry(entry);
      if (text && text.trim().length > 0) {
        converted.push({
          entry: { role: 'user', text: text.trim() },
          index: i,
        });
      }
    }
  }

  // Add assistant text blocks with their original index — these include
  // completion signals ("Done.", "All set", etc.) that help Haiku judge
  // whether the most recent task is actually finished.
  const assistantTexts = extractAssistantTexts(entries);
  for (const at of assistantTexts) {
    if (!at.text || !at.text.trim()) continue;
    converted.push({
      entry: { role: 'assistant', text: at.text.trim().substring(0, 400) },
      index: at.entryIndex,
    });
  }

  // Add tool interactions as tool_result entries with their original index
  const interactions = extractToolInteractions(entries);
  for (const interaction of interactions) {
    if (!interaction.result) continue;
    const text = interaction.result.content.substring(0, 300);
    if (!text) continue;
    converted.push({
      entry: {
        role: 'tool_result',
        text,
        toolName: interaction.call.name,
        isError: interaction.result.isError,
      },
      index: interaction.result.entryIndex,
    });
  }

  // Sort by original transcript index to preserve chronological order
  converted.sort((a, b) => a.index - b.index);
  const conversationEntries: ConversationEntry[] = converted.map(c => c.entry);

  if (conversationEntries.length < 3) {
    hookLog('session-end-checkpoint-worker', `Too few entries (${conversationEntries.length}) — skipping`);
    return;
  }

  hookLog('session-end-checkpoint-worker', `Extracting checkpoint from ${conversationEntries.length} entries (project=${projectId})`);

  const saved = await extractCheckpoint(conversationEntries, projectId, 'cc');

  if (saved) {
    hookLog('session-end-checkpoint-worker', `Auto-checkpoint saved for ${projectId}`);
  } else {
    hookLog('session-end-checkpoint-worker', `No checkpoint saved (LLM null, quality gate, or save failure)`);
  }
}

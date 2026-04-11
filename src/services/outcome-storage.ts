/**
 * OutcomeStorage — data access for outcome-aware learning tables (v0.18.0)
 *
 * Singleton service using the same DB connection as MemoryService.
 * Manages episodes, outcome_events, candidate_lessons, and memory_stats.
 */

import * as crypto from 'crypto';
import Database from 'better-sqlite3';
import { MemoryService } from './memory';

export interface EpisodeData {
  project_id: string;
  session_id?: string;
  task_summary?: string;
  action_summary?: string;
  outcome_summary?: string;
  outcome_type?: 'success' | 'failure' | 'partial' | 'unclear';
  severity?: 'low' | 'medium' | 'high';
  confidence?: number;
  source?: string;
}

export interface OutcomeEventData {
  episode_id?: string;
  event_type: string;
  actor: string;
  action_summary?: string;
  next_state_summary: string;
  exit_code?: number;
  tags?: string[];
}

export interface CandidateLessonData {
  project_id: string;
  episode_id?: string;
  lesson_text: string;
  lesson_kind: string;
  applies_when?: string[];
  outcome_type: string;
  reward_band: number;
  confidence: number;
  durability: string;
}

export interface CandidateLesson {
  id: string;
  project_id: string;
  episode_id: string | null;
  lesson_text: string;
  lesson_kind: string;
  applies_when_json: string | null;
  outcome_type: string;
  reward_band: number;
  confidence: number;
  durability: string;
  evidence_count: number;
  status: string;
  promoted_memory_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryStats {
  memory_key: string;
  times_observed: number;
  times_retrieved: number;
  times_helpful: number;
  times_unhelpful: number;
  last_confirmed_at: string | null;
  last_retrieved_at: string | null;
}

export class OutcomeStorage {
  private static instance: OutcomeStorage;
  private db: Database.Database;

  private constructor() {
    this.db = MemoryService.getInstance().getDatabase();
  }

  static getInstance(): OutcomeStorage {
    if (!OutcomeStorage.instance) {
      OutcomeStorage.instance = new OutcomeStorage();
    }
    return OutcomeStorage.instance;
  }

  /** Reset singleton (for testing) */
  static resetInstance(): void {
    OutcomeStorage.instance = undefined as any;
  }

  private generateId(): string {
    return crypto.randomUUID();
  }

  private now(): string {
    return new Date().toISOString();
  }

  // --- Episodes ---

  createEpisode(data: EpisodeData): string {
    const id = this.generateId();
    const now = this.now();
    this.db.prepare(`
      INSERT INTO episodes (id, project_id, session_id, started_at, task_summary,
        action_summary, outcome_summary, outcome_type, severity, confidence, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, data.project_id, data.session_id || null, now,
      data.task_summary || null, data.action_summary || null,
      data.outcome_summary || null, data.outcome_type || null,
      data.severity || null, data.confidence ?? null,
      data.source || null, now
    );
    return id;
  }

  updateEpisode(id: string, updates: Partial<EpisodeData>): void {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.outcome_type !== undefined) { fields.push('outcome_type = ?'); values.push(updates.outcome_type); }
    if (updates.outcome_summary !== undefined) { fields.push('outcome_summary = ?'); values.push(updates.outcome_summary); }
    if (updates.severity !== undefined) { fields.push('severity = ?'); values.push(updates.severity); }
    if (updates.confidence !== undefined) { fields.push('confidence = ?'); values.push(updates.confidence); }
    if (updates.task_summary !== undefined) { fields.push('task_summary = ?'); values.push(updates.task_summary); }
    if (updates.action_summary !== undefined) { fields.push('action_summary = ?'); values.push(updates.action_summary); }

    fields.push('ended_at = ?');
    values.push(this.now());

    if (fields.length === 0) return;
    values.push(id);

    this.db.prepare(`UPDATE episodes SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  // --- Outcome Events ---

  createOutcomeEvent(data: OutcomeEventData): string {
    const id = this.generateId();
    this.db.prepare(`
      INSERT INTO outcome_events (id, episode_id, event_type, actor, action_summary,
        next_state_summary, exit_code, tags_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, data.episode_id || null, data.event_type, data.actor,
      data.action_summary || null, data.next_state_summary,
      data.exit_code ?? null,
      data.tags ? JSON.stringify(data.tags) : null,
      this.now()
    );
    return id;
  }

  // --- Candidate Lessons ---

  createCandidateLesson(data: CandidateLessonData): string {
    const id = this.generateId();
    const now = this.now();
    this.db.prepare(`
      INSERT INTO candidate_lessons (id, project_id, episode_id, lesson_text, lesson_kind,
        applies_when_json, outcome_type, reward_band, confidence, durability,
        evidence_count, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'candidate', ?, ?)
    `).run(
      id, data.project_id, data.episode_id || null,
      data.lesson_text, data.lesson_kind,
      data.applies_when ? JSON.stringify(data.applies_when) : null,
      data.outcome_type, data.reward_band, data.confidence, data.durability,
      now, now
    );
    return id;
  }

  updateLessonStatus(id: string, status: string, promotedKey?: string): void {
    this.db.prepare(`
      UPDATE candidate_lessons SET status = ?, promoted_memory_key = ?, updated_at = ?
      WHERE id = ?
    `).run(status, promotedKey || null, this.now(), id);
  }

  /**
   * Find candidate lessons with similar text using Jaccard similarity >= threshold.
   */
  findSimilarLessons(text: string, projectId: string, threshold: number = 0.6): CandidateLesson[] {
    const rows = this.db.prepare(
      `SELECT * FROM candidate_lessons WHERE project_id = ? AND status IN ('candidate', 'promoted')`
    ).all(projectId) as CandidateLesson[];

    const textTokens = tokenize(text);
    return rows.filter(row => {
      const rowTokens = tokenize(row.lesson_text);
      return jaccardSimilarity(textTokens, rowTokens) >= threshold;
    });
  }

  incrementEvidenceCount(id: string): void {
    this.db.prepare(
      `UPDATE candidate_lessons SET evidence_count = evidence_count + 1, updated_at = ? WHERE id = ?`
    ).run(this.now(), id);
  }

  getCandidateLessons(projectId: string, status?: string): CandidateLesson[] {
    let query = 'SELECT * FROM candidate_lessons WHERE project_id = ?';
    const params: any[] = [projectId];
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    return this.db.prepare(query).all(...params) as CandidateLesson[];
  }

  getCandidateLessonById(id: string): CandidateLesson | null {
    return (this.db.prepare('SELECT * FROM candidate_lessons WHERE id = ?').get(id) as CandidateLesson) || null;
  }

  /**
   * Get outcome events filtered by event_type, ordered by most recent.
   * Optionally filter by time window (defaults to last 24 hours).
   */
  getEventsByType(eventType: string, hoursBack: number = 24): Array<{
    id: string;
    episode_id: string | null;
    event_type: string;
    actor: string;
    action_summary: string | null;
    next_state_summary: string;
    exit_code: number | null;
    tags_json: string | null;
    created_at: string;
  }> {
    const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
    return this.db.prepare(
      'SELECT * FROM outcome_events WHERE event_type = ? AND created_at > ? ORDER BY created_at DESC'
    ).all(eventType, cutoff) as any[];
  }

  // --- Memory Stats ---

  getMemoryStats(key: string): MemoryStats | null {
    return (this.db.prepare('SELECT * FROM memory_stats WHERE memory_key = ?').get(key) as MemoryStats) || null;
  }

  recordRetrieval(key: string): void {
    const now = this.now();
    this.db.prepare(`
      INSERT INTO memory_stats (memory_key, times_observed, times_retrieved, times_helpful, times_unhelpful, last_retrieved_at)
      VALUES (?, 1, 1, 0, 0, ?)
      ON CONFLICT(memory_key) DO UPDATE SET
        times_retrieved = times_retrieved + 1,
        last_retrieved_at = ?
    `).run(key, now, now);
  }

  recordHelpful(key: string): void {
    const now = this.now();
    this.db.prepare(`
      INSERT INTO memory_stats (memory_key, times_observed, times_retrieved, times_helpful, times_unhelpful, last_confirmed_at)
      VALUES (?, 1, 0, 1, 0, ?)
      ON CONFLICT(memory_key) DO UPDATE SET
        times_helpful = times_helpful + 1,
        last_confirmed_at = ?
    `).run(key, now, now);
  }

  recordUnhelpful(key: string): void {
    this.db.prepare(`
      INSERT INTO memory_stats (memory_key, times_observed, times_retrieved, times_helpful, times_unhelpful)
      VALUES (?, 1, 0, 0, 1)
      ON CONFLICT(memory_key) DO UPDATE SET
        times_unhelpful = times_unhelpful + 1
    `).run(key);
  }

  // --- Rule injection events (just-in-time rule injection meter) ---
  //
  // Replaces the broken citation-detection regex. Every time the JITRI hook
  // injects a rule into a tool call's context, we record an event here.
  // PostToolUse later resolves the event with the tool outcome (success or
  // failure), giving us direct evidence of whether rules-at-the-moment-of-action
  // are correlated with successful tool calls — without depending on the model
  // remembering to write "(applied from memory: ...)" markers.

  recordRuleInjection(input: {
    rule_key: string;
    tool_name: string;
    tool_use_id?: string;
    project_id?: string;
    match_score: number;
    matched_tokens: string[];
  }): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO rule_injection_events
        (rule_key, tool_name, tool_use_id, project_id, match_score, matched_tokens, injected_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.rule_key,
      input.tool_name,
      input.tool_use_id ?? null,
      input.project_id ?? null,
      input.match_score,
      JSON.stringify(input.matched_tokens),
      now,
    );
  }

  /**
   * Resolve all unresolved injection events for a given tool_use_id with
   * the tool's outcome. Called from PostToolUse / PostToolUseFailure.
   */
  resolveRuleInjections(toolUseId: string, outcome: 'success' | 'failure'): number {
    const now = Date.now();
    const result = this.db.prepare(`
      UPDATE rule_injection_events
      SET tool_outcome = ?, resolved_at = ?
      WHERE tool_use_id = ? AND resolved_at IS NULL
    `).run(outcome, now, toolUseId);
    return result.changes;
  }

  /**
   * Per-rule injection summary for the outcomes CLI.
   * Returns: rule_key, total injections, success/failure counts, helpfulness rate.
   */
  getInjectionStats(opts?: { project_id?: string; limit?: number }): Array<{
    rule_key: string;
    total_injections: number;
    successes: number;
    failures: number;
    unresolved: number;
    success_rate: number;
  }> {
    const limit = opts?.limit ?? 50;
    const where = opts?.project_id ? 'WHERE project_id = ?' : '';
    const params = opts?.project_id ? [opts.project_id, limit] : [limit];

    const rows = this.db.prepare(`
      SELECT
        rule_key,
        COUNT(*) as total_injections,
        SUM(CASE WHEN tool_outcome = 'success' THEN 1 ELSE 0 END) as successes,
        SUM(CASE WHEN tool_outcome = 'failure' THEN 1 ELSE 0 END) as failures,
        SUM(CASE WHEN resolved_at IS NULL THEN 1 ELSE 0 END) as unresolved
      FROM rule_injection_events
      ${where}
      GROUP BY rule_key
      ORDER BY total_injections DESC
      LIMIT ?
    `).all(...params) as Array<{
      rule_key: string;
      total_injections: number;
      successes: number;
      failures: number;
      unresolved: number;
    }>;

    return rows.map(r => ({
      ...r,
      success_rate: (r.successes + r.failures) > 0
        ? r.successes / (r.successes + r.failures)
        : 0,
    }));
  }

  /**
   * Prune old data from outcome tables to prevent unbounded growth.
   * - Episodes older than 90 days
   * - Outcome events older than 90 days
   * - Rejected/archived candidate lessons older than 14 days
   * - Orphaned memory_stats entries (key no longer in memories table)
   * - Rule injection events older than 90 days
   */
  pruneOldData(): { episodes: number; events: number; lessons: number; stats: number; injections: number } {
    const cutoff90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const cutoff14 = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const cutoff90Ms = Date.now() - 90 * 24 * 60 * 60 * 1000;

    const episodes = this.db.prepare(
      'DELETE FROM episodes WHERE created_at < ?'
    ).run(cutoff90).changes;

    const events = this.db.prepare(
      'DELETE FROM outcome_events WHERE created_at < ?'
    ).run(cutoff90).changes;

    const lessons = this.db.prepare(
      "DELETE FROM candidate_lessons WHERE status IN ('rejected', 'archived') AND updated_at < ?"
    ).run(cutoff14).changes;

    const stats = this.db.prepare(
      'DELETE FROM memory_stats WHERE memory_key NOT IN (SELECT key FROM memories)'
    ).run().changes;

    const injections = this.db.prepare(
      'DELETE FROM rule_injection_events WHERE injected_at < ?'
    ).run(cutoff90Ms).changes;

    return { episodes, events, lessons, stats, injections };
  }
}

// --- Helpers ---

function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) {
    if (b.has(w)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

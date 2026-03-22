/**
 * PromotionEngine — promotes validated candidate lessons into active memories (v0.18.0)
 *
 * Promotion criteria:
 * - evidence_count >= 2 → promote (seen at least twice)
 * - confidence >= 0.9 && reward_band <= -2 → promote immediately (high-severity)
 *
 * Rejection criteria:
 * - status === 'candidate' && age > 7 days && evidence_count === 1 → reject
 *
 * Demotion criteria:
 * - times_retrieved > 10 && times_helpful === 0 → never useful
 * - Not retrieved in 90 days with low strength
 */

import { MemoryService } from './memory';
import { OutcomeStorage, CandidateLesson, MemoryStats } from './outcome-storage';
import { MemoryRetrieval } from '../core/retrieval';
import { Memory } from '../memory/storage';

export class PromotionEngine {
  private static instance: PromotionEngine;

  static getInstance(): PromotionEngine {
    if (!PromotionEngine.instance) {
      PromotionEngine.instance = new PromotionEngine();
    }
    return PromotionEngine.instance;
  }

  static resetInstance(): void {
    PromotionEngine.instance = undefined as any;
  }

  runCycle(projectId: string): { promoted: number; archived: number } {
    const outcomeStorage = OutcomeStorage.getInstance();
    const candidates = outcomeStorage.getCandidateLessons(projectId, 'candidate');
    let promoted = 0;
    let archived = 0;

    for (const candidate of candidates) {
      try {
        if (this.shouldPromote(candidate)) {
          this.promote(candidate.id);
          promoted++;
        } else if (this.shouldReject(candidate)) {
          outcomeStorage.updateLessonStatus(candidate.id, 'rejected');
          archived++;
        }
      } catch (err) {
        console.error(`PromotionEngine: failed to process candidate ${candidate.id}`);
      }
    }

    // Check for demotion of existing memories
    archived += this.demotionSweep(projectId);

    return { promoted, archived };
  }

  shouldPromote(candidate: CandidateLesson): boolean {
    // High-severity immediate promotion
    if (candidate.confidence >= 0.9 && candidate.reward_band <= -2) {
      return true;
    }
    // Evidence-based promotion
    if (candidate.evidence_count >= 2) {
      return true;
    }
    return false;
  }

  promote(candidateId: string): string {
    const outcomeStorage = OutcomeStorage.getInstance();
    const candidate = outcomeStorage.getCandidateLessonById(candidateId);
    if (!candidate) throw new Error(`Candidate ${candidateId} not found`);

    const memoryService = MemoryService.getInstance();
    const key = `promoted_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Determine memory type from lesson_kind
    const typeMap: Record<string, string> = {
      'failure_preventer': 'failure',
      'anti_pattern': 'correction',
      'rule': 'preference',
      'preference': 'preference',
      'workflow': 'devops',
      'debug_fix': 'failure',
    };
    const memType = typeMap[candidate.lesson_kind] || 'correction';

    memoryService.store({
      key,
      value: {
        title: `Learned: ${candidate.lesson_text.substring(0, 50)}`,
        description: `Promoted from ${candidate.evidence_count} observation(s)`,
        content: candidate.lesson_text,
        source: 'promotion-engine',
        lesson_kind: candidate.lesson_kind,
        evidence_count: candidate.evidence_count,
      },
      type: memType,
      context: {
        projectId: candidate.project_id,
        timestamp: Date.now(),
      },
      relevanceScore: Math.min(candidate.confidence * 1.2, 1.0),
    });

    outcomeStorage.updateLessonStatus(candidateId, 'promoted', key);
    return key;
  }

  shouldReject(candidate: CandidateLesson): boolean {
    const ageMs = Date.now() - new Date(candidate.created_at).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    return ageDays > 7 && candidate.evidence_count === 1;
  }

  shouldArchive(memory: Memory, stats: MemoryStats): boolean {
    // Never useful: retrieved many times but never helpful
    if (stats.times_retrieved > 10 && stats.times_helpful === 0) {
      return true;
    }

    // Not retrieved in 90 days with low strength
    if (stats.last_retrieved_at) {
      const daysSinceRetrieved = (Date.now() - new Date(stats.last_retrieved_at).getTime()) / (1000 * 60 * 60 * 24);
      let strength = 0;
      try { strength = MemoryRetrieval.computeStrength(memory); } catch { strength = 0; }
      if (daysSinceRetrieved > 90 && strength < 0.2) {
        return true;
      }
    }

    return false;
  }

  private demotionSweep(projectId: string): number {
    let archived = 0;
    try {
      const outcomeStorage = OutcomeStorage.getInstance();
      const db = MemoryService.getInstance().getDatabase();

      // Get memories with stats that might need demotion
      const rows = db.prepare(`
        SELECT m.key, m.type, m.timestamp, m.access_count, m.last_accessed,
               m.relevance_score, m.cite_count, m.load_count,
               ms.times_retrieved, ms.times_helpful, ms.times_unhelpful,
               ms.last_retrieved_at, ms.last_confirmed_at
        FROM memories m
        INNER JOIN memory_stats ms ON ms.memory_key = m.key
        WHERE (m.project_id = ? OR m.project_id IS NULL)
          AND m.is_active = 1
      `).all(projectId) as any[];

      for (const row of rows) {
        const memory: Memory = {
          key: row.key,
          value: '',
          type: row.type,
          timestamp: row.timestamp,
          access_count: row.access_count,
          last_accessed: row.last_accessed,
          relevance_score: row.relevance_score,
          cite_count: row.cite_count,
          load_count: row.load_count,
        };
        const stats: MemoryStats = {
          memory_key: row.key,
          times_observed: 1,
          times_retrieved: row.times_retrieved,
          times_helpful: row.times_helpful,
          times_unhelpful: row.times_unhelpful,
          last_confirmed_at: row.last_confirmed_at,
          last_retrieved_at: row.last_retrieved_at,
        };

        if (this.shouldArchive(memory, stats)) {
          // Mark as inactive rather than deleting
          db.prepare('UPDATE memories SET is_active = 0 WHERE key = ?').run(row.key);
          archived++;
        }
      }
    } catch (err) {
      console.error('PromotionEngine: demotion sweep failed');
    }
    return archived;
  }
}

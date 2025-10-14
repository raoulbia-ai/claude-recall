/**
 * Memory Usage Tracker Service
 * Phase 3C: Track which memories are actually used and adjust relevance scores
 *
 * This service:
 * 1. Records when memories are injected into tool calls
 * 2. Tracks if memories are actually useful (usage patterns)
 * 3. Boosts relevance scores for useful memories
 * 4. Reduces scores for ignored memories
 * 5. Provides statistics on memory effectiveness
 */

import { LoggingService } from './logging';
import { MemoryService } from './memory';

export interface MemoryInjectionRecord {
  memoryId: string;
  toolName: string;
  sessionId: string;
  timestamp: number;
  wasUseful?: boolean;
}

export interface MemoryEffectivenessStats {
  memoryId: string;
  injectionCount: number;
  useCount: number;
  effectiveness: number; // useCount / injectionCount
  lastInjected: number;
  lastUsed: number;
}

export class MemoryUsageTracker {
  private static instance: MemoryUsageTracker;
  private logger: LoggingService;
  private memoryService: MemoryService;

  // Track injections: memoryId -> injection records
  private injections: Map<string, MemoryInjectionRecord[]> = new Map();

  // Track usage: memoryId -> use count
  private usageCount: Map<string, number> = new Map();

  // Relevance adjustment thresholds
  private readonly BOOST_AMOUNT = 0.1;
  private readonly REDUCE_AMOUNT = 0.05;
  private readonly MIN_INJECTIONS_FOR_SCORING = 3; // Need at least 3 injections to judge effectiveness

  private constructor() {
    this.logger = LoggingService.getInstance();
    this.memoryService = MemoryService.getInstance();
  }

  static getInstance(): MemoryUsageTracker {
    if (!MemoryUsageTracker.instance) {
      MemoryUsageTracker.instance = new MemoryUsageTracker();
    }
    return MemoryUsageTracker.instance;
  }

  /**
   * Record that a memory was injected into a tool call
   */
  recordInjection(
    memoryId: string,
    toolName: string,
    sessionId: string
  ): void {
    try {
      const record: MemoryInjectionRecord = {
        memoryId,
        toolName,
        sessionId,
        timestamp: Date.now()
      };

      const records = this.injections.get(memoryId) || [];
      records.push(record);
      this.injections.set(memoryId, records);

      this.logger.debug('MemoryUsageTracker', 'Recorded memory injection', {
        memoryId,
        toolName,
        totalInjections: records.length
      });

    } catch (error) {
      this.logger.error('MemoryUsageTracker', 'Failed to record injection', error);
    }
  }

  /**
   * Record that an injected memory was actually used
   * Call this when you detect the memory was referenced in the response
   */
  recordUsage(memoryId: string, wasUseful: boolean = true): void {
    try {
      if (wasUseful) {
        const currentCount = this.usageCount.get(memoryId) || 0;
        this.usageCount.set(memoryId, currentCount + 1);

        // Update the last injection record
        const records = this.injections.get(memoryId);
        if (records && records.length > 0) {
          records[records.length - 1].wasUseful = true;
        }

        this.logger.debug('MemoryUsageTracker', 'Recorded memory usage', {
          memoryId,
          totalUses: currentCount + 1
        });

        // Check if we should boost relevance
        this.checkAndAdjustRelevance(memoryId);
      }

    } catch (error) {
      this.logger.error('MemoryUsageTracker', 'Failed to record usage', error);
    }
  }

  /**
   * Check effectiveness and adjust relevance score if needed
   */
  private async checkAndAdjustRelevance(memoryId: string): Promise<void> {
    const stats = this.getEffectivenessStats(memoryId);

    if (!stats || stats.injectionCount < this.MIN_INJECTIONS_FOR_SCORING) {
      return; // Need more data
    }

    // Highly effective memory (used >70% of the time)
    if (stats.effectiveness > 0.7) {
      await this.boostRelevance(memoryId);
    }
    // Rarely used memory (used <30% of the time)
    else if (stats.effectiveness < 0.3) {
      await this.reduceRelevance(memoryId);
    }
  }

  /**
   * Boost relevance score for a useful memory
   */
  private async boostRelevance(memoryId: string): Promise<void> {
    try {
      // Note: MemoryService doesn't currently have a boostRelevance method
      // This would need to be added to the MemoryService
      // For now, log the action

      this.logger.info('MemoryUsageTracker', 'Memory marked for relevance boost', {
        memoryId,
        boostAmount: this.BOOST_AMOUNT
      });

      // TODO: Implement when MemoryService.updateRelevanceScore() is available
      // await this.memoryService.updateRelevanceScore(memoryId, this.BOOST_AMOUNT);

    } catch (error) {
      this.logger.error('MemoryUsageTracker', 'Failed to boost relevance', error);
    }
  }

  /**
   * Reduce relevance score for an ignored memory
   */
  private async reduceRelevance(memoryId: string): Promise<void> {
    try {
      this.logger.info('MemoryUsageTracker', 'Memory marked for relevance reduction', {
        memoryId,
        reduceAmount: this.REDUCE_AMOUNT
      });

      // TODO: Implement when MemoryService.updateRelevanceScore() is available
      // await this.memoryService.updateRelevanceScore(memoryId, -this.REDUCE_AMOUNT);

    } catch (error) {
      this.logger.error('MemoryUsageTracker', 'Failed to reduce relevance', error);
    }
  }

  /**
   * Get effectiveness statistics for a memory
   */
  getEffectivenessStats(memoryId: string): MemoryEffectivenessStats | null {
    const records = this.injections.get(memoryId);
    if (!records || records.length === 0) {
      return null;
    }

    const injectionCount = records.length;
    const useCount = this.usageCount.get(memoryId) || 0;
    const effectiveness = useCount / injectionCount;

    const timestamps = records.map(r => r.timestamp);
    const lastInjected = Math.max(...timestamps);

    const usedRecords = records.filter(r => r.wasUseful);
    const lastUsed = usedRecords.length > 0
      ? Math.max(...usedRecords.map(r => r.timestamp))
      : 0;

    return {
      memoryId,
      injectionCount,
      useCount,
      effectiveness,
      lastInjected,
      lastUsed
    };
  }

  /**
   * Get all effectiveness statistics
   * Useful for debugging and monitoring
   */
  getAllStats(): MemoryEffectivenessStats[] {
    const stats: MemoryEffectivenessStats[] = [];

    for (const memoryId of this.injections.keys()) {
      const memoryStat = this.getEffectivenessStats(memoryId);
      if (memoryStat) {
        stats.push(memoryStat);
      }
    }

    // Sort by effectiveness (most effective first)
    return stats.sort((a, b) => b.effectiveness - a.effectiveness);
  }

  /**
   * Get statistics summary
   */
  getSummary(): {
    totalMemoriesTracked: number;
    totalInjections: number;
    totalUses: number;
    averageEffectiveness: number;
    highlyEffectiveMemories: number;
    ineffectiveMemories: number;
  } {
    const allStats = this.getAllStats();

    const totalInjections = Array.from(this.injections.values())
      .reduce((sum, records) => sum + records.length, 0);

    const totalUses = Array.from(this.usageCount.values())
      .reduce((sum, count) => sum + count, 0);

    const averageEffectiveness = allStats.length > 0
      ? allStats.reduce((sum, s) => sum + s.effectiveness, 0) / allStats.length
      : 0;

    const highlyEffective = allStats.filter(s => s.effectiveness > 0.7).length;
    const ineffective = allStats.filter(s => s.effectiveness < 0.3 && s.injectionCount >= this.MIN_INJECTIONS_FOR_SCORING).length;

    return {
      totalMemoriesTracked: this.injections.size,
      totalInjections,
      totalUses,
      averageEffectiveness,
      highlyEffectiveMemories: highlyEffective,
      ineffectiveMemories: ineffective
    };
  }

  /**
   * Clean up old tracking data
   * Remove records older than 7 days
   */
  cleanup(): void {
    const cutoffTime = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 days
    let removedCount = 0;

    for (const [memoryId, records] of this.injections.entries()) {
      const filteredRecords = records.filter(r => r.timestamp > cutoffTime);

      if (filteredRecords.length === 0) {
        this.injections.delete(memoryId);
        this.usageCount.delete(memoryId);
        removedCount++;
      } else {
        this.injections.set(memoryId, filteredRecords);
      }
    }

    if (removedCount > 0) {
      this.logger.info('MemoryUsageTracker', 'Cleaned up old tracking data', {
        removedMemories: removedCount
      });
    }
  }
}

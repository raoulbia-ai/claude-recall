import { Memory } from '../memory/storage';
import { MemoryService } from './memory';
import { LoggingService } from './logging';

/**
 * Sophistication Levels (v0.7.0)
 * Based on ReasoningBank's emergent behavior progression
 */
export enum SophisticationLevel {
  Procedural = 1,      // Basic execution (tool-use, simple actions)
  SelfReflection = 2,  // Error checking, corrections
  Adaptive = 3,        // Systematic patterns (devops single category)
  Compositional = 4    // Multi-constraint reasoning (devops complex)
}

export interface EvolutionMetrics {
  totalMemories: number;
  sophisticationBreakdown: Record<SophisticationLevel, number>;
  averageConfidence: number;
  confidenceTrend: 'improving' | 'stable' | 'declining';
  failureRate: number;
  failureTrend: 'improving' | 'stable' | 'worsening';
  progressionScore: number;  // 0-100 (higher = more evolved)
}

/**
 * MemoryEvolution Service (v0.7.0)
 *
 * Tracks agent evolution through sophistication levels:
 * - L1 Procedural: Basic tool use
 * - L2 Self-Reflection: Error checking, corrections
 * - L3 Adaptive: Systematic workflows
 * - L4 Compositional: Multi-constraint reasoning
 *
 * Provides metrics showing agent getting smarter over time
 */
export class MemoryEvolution {
  private static instance: MemoryEvolution;
  private logger: LoggingService;

  private constructor() {
    this.logger = LoggingService.getInstance();
  }

  static getInstance(): MemoryEvolution {
    if (!MemoryEvolution.instance) {
      MemoryEvolution.instance = new MemoryEvolution();
    }
    return MemoryEvolution.instance;
  }

  /**
   * Classify memory sophistication level
   * Called when storing new memory
   */
  classifySophistication(memory: Memory): SophisticationLevel {
    // Tool-use memories are procedural
    if (memory.type === 'tool-use') {
      return SophisticationLevel.Procedural;
    }

    // Corrections show self-reflection
    if (memory.type === 'corrections') {
      return SophisticationLevel.SelfReflection;
    }

    // Failures show self-reflection (learning from mistakes)
    if (memory.type === 'failure') {
      return SophisticationLevel.SelfReflection;
    }

    // DevOps memories vary by complexity
    if (memory.type === 'devops') {
      return this.classifyDevOpsSophistication(memory);
    }

    // Preferences can be adaptive if they show systematic thinking
    if (memory.type === 'preference') {
      return this.classifyPreferenceSophistication(memory);
    }

    // Success memories default to procedural
    if (memory.type === 'success') {
      return SophisticationLevel.Procedural;
    }

    // Default to procedural
    return SophisticationLevel.Procedural;
  }

  /**
   * Classify DevOps memory sophistication
   */
  private classifyDevOpsSophistication(memory: Memory): SophisticationLevel {
    try {
      const value = memory.value;
      const content = typeof value === 'object' && value.content
        ? JSON.stringify(value.content)
        : JSON.stringify(value);

      const lower = content.toLowerCase();

      // Check for compositional patterns (multi-constraint reasoning)
      const compositionalIndicators = [
        'and', 'before', 'after', 'then', 'must', 'always', 'never',
        'verify', 'check', 'ensure', 'validate', 'if', 'when'
      ];

      const matches = compositionalIndicators.filter(ind =>
        lower.includes(ind)
      ).length;

      // 3+ indicators = compositional reasoning
      if (matches >= 3) {
        return SophisticationLevel.Compositional;
      }

      // Otherwise adaptive (systematic pattern)
      return SophisticationLevel.Adaptive;
    } catch (err) {
      this.logger.debug('MemoryEvolution', 'Error classifying devops sophistication', err);
      return SophisticationLevel.Adaptive;
    }
  }

  /**
   * Classify preference sophistication
   */
  private classifyPreferenceSophistication(memory: Memory): SophisticationLevel {
    try {
      const value = typeof memory.value === 'string'
        ? memory.value
        : JSON.stringify(memory.value);

      const lower = value.toLowerCase();

      // Check for systematic thinking
      if (lower.includes('always') || lower.includes('never') ||
          lower.includes('must') || lower.includes('should')) {
        return SophisticationLevel.Adaptive;
      }

      return SophisticationLevel.Procedural;
    } catch (err) {
      return SophisticationLevel.Procedural;
    }
  }

  /**
   * Calculate evolution metrics for project or globally
   */
  getEvolutionMetrics(projectId?: string, days: number = 30): EvolutionMetrics {
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);

    // Search for recent memories (lazy-load MemoryService to avoid circular dependency)
    const memoryService = MemoryService.getInstance();
    const allMemories = memoryService.search('');
    const memories = allMemories.filter(m => {
      const timestamp = m.timestamp || 0;
      const matchesTime = timestamp > cutoff;
      const matchesProject = !projectId || m.project_id === projectId;
      return matchesTime && matchesProject;
    });

    if (memories.length === 0) {
      return this.getEmptyMetrics();
    }

    // Calculate sophistication breakdown
    const breakdown: Record<number, number> = {
      1: 0, 2: 0, 3: 0, 4: 0
    };

    let totalConfidence = 0;
    let confidenceCount = 0;
    let failureCount = 0;

    for (const mem of memories) {
      const level = mem.sophistication_level || 1;
      breakdown[level]++;

      if (mem.confidence_score) {
        totalConfidence += mem.confidence_score;
        confidenceCount++;
      }

      if (mem.type === 'failure') {
        failureCount++;
      }
    }

    // Calculate average confidence
    const avgConfidence = confidenceCount > 0
      ? totalConfidence / confidenceCount
      : 0;

    // Calculate failure rate
    const failureRate = memories.length > 0
      ? (failureCount / memories.length) * 100
      : 0;

    // Calculate trends (compare to previous period)
    const prevCutoff = cutoff - (days * 24 * 60 * 60 * 1000);
    const prevMemories = allMemories.filter(m => {
      const timestamp = m.timestamp || 0;
      const matchesTime = timestamp > prevCutoff && timestamp <= cutoff;
      const matchesProject = !projectId || m.project_id === projectId;
      return matchesTime && matchesProject;
    });

    const prevAvgConfidence = this.calculateAvgConfidence(prevMemories);
    const prevFailureRate = this.calculateFailureRate(prevMemories);

    const confidenceTrend = avgConfidence > prevAvgConfidence + 0.05 ? 'improving' :
                            avgConfidence < prevAvgConfidence - 0.05 ? 'declining' : 'stable';

    const failureTrend = failureRate < prevFailureRate - 2 ? 'improving' :
                         failureRate > prevFailureRate + 2 ? 'worsening' : 'stable';

    // Calculate progression score (0-100)
    const total = memories.length;
    const l1Pct = breakdown[1] / total;
    const l2Pct = breakdown[2] / total;
    const l3Pct = breakdown[3] / total;
    const l4Pct = breakdown[4] / total;

    const progressionScore = Math.round(
      (l1Pct * 25) + (l2Pct * 50) + (l3Pct * 75) + (l4Pct * 100)
    );

    return {
      totalMemories: memories.length,
      sophisticationBreakdown: breakdown as Record<SophisticationLevel, number>,
      averageConfidence: avgConfidence,
      confidenceTrend,
      failureRate,
      failureTrend,
      progressionScore
    };
  }

  /**
   * Calculate average confidence from memory list
   */
  private calculateAvgConfidence(memories: any[]): number {
    if (memories.length === 0) return 0;

    let total = 0;
    let count = 0;

    for (const mem of memories) {
      if (mem.confidence_score) {
        total += mem.confidence_score;
        count++;
      }
    }

    return count > 0 ? total / count : 0;
  }

  /**
   * Calculate failure rate from memory list
   */
  private calculateFailureRate(memories: any[]): number {
    if (memories.length === 0) return 0;

    const failures = memories.filter(m => m.type === 'failure').length;
    return (failures / memories.length) * 100;
  }

  /**
   * Return empty metrics when no memories exist
   */
  private getEmptyMetrics(): EvolutionMetrics {
    return {
      totalMemories: 0,
      sophisticationBreakdown: { 1: 0, 2: 0, 3: 0, 4: 0 },
      averageConfidence: 0,
      confidenceTrend: 'stable',
      failureRate: 0,
      failureTrend: 'stable',
      progressionScore: 0
    };
  }

  /**
   * Get sophistication level name
   */
  static getSophisticationName(level: SophisticationLevel): string {
    switch (level) {
      case SophisticationLevel.Procedural:
        return 'Procedural';
      case SophisticationLevel.SelfReflection:
        return 'Self-Reflection';
      case SophisticationLevel.Adaptive:
        return 'Adaptive';
      case SophisticationLevel.Compositional:
        return 'Compositional';
      default:
        return 'Unknown';
    }
  }
}

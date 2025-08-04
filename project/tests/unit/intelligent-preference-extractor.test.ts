import { IntelligentPreferenceExtractor } from '../../src/services/intelligent-preference-extractor';
import { ClaudeNLPAnalyzer } from '../../src/services/claude-nlp-analyzer';

// Mock the Claude NLP Analyzer
jest.mock('../../src/services/claude-nlp-analyzer');

describe('IntelligentPreferenceExtractor', () => {
  let extractor: IntelligentPreferenceExtractor;
  let mockAnalyzer: jest.Mocked<ClaudeNLPAnalyzer>;

  beforeEach(() => {
    jest.clearAllMocks();
    extractor = new IntelligentPreferenceExtractor();
    mockAnalyzer = (extractor as any).nlpAnalyzer;
  });

  describe('extractPreferences', () => {
    it('should extract preferences from NLP analysis', async () => {
      const mockAnalysis = {
        intent: { type: 'preference', confidence: 0.9, subtype: 'location' },
        entities: { subject: 'tests', action: 'put', target: 'tests-raoul' },
        preference: {
          key: 'test_location',
          value: 'tests-raoul',
          isOverride: true,
          temporal: 'permanent',
          reasoning: 'User wants tests in tests-raoul directory'
        },
        context: { emotional_tone: 'neutral', formality: 'casual', urgency: 'medium' },
        confidence: 0.9,
        reasoning: 'Clear preference statement'
      };

      mockAnalyzer.analyzeText.mockResolvedValue(mockAnalysis);

      const result = await extractor.extractPreferences('Put tests in tests-raoul');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        key: 'test_location',
        value: 'tests-raoul',
        confidence: 0.9,
        rawText: 'Put tests in tests-raoul'
      });
    });

    it('should return empty array for non-preference text', async () => {
      const mockAnalysis = {
        intent: { type: 'query', confidence: 0.8 },
        entities: { subject: 'weather', action: 'check' },
        context: { emotional_tone: 'neutral', formality: 'casual', urgency: 'low' },
        confidence: 0.8,
        reasoning: 'This is a question, not a preference'
      };

      mockAnalyzer.analyzeText.mockResolvedValue(mockAnalysis);

      const result = await extractor.extractPreferences('What is the weather today?');

      expect(result).toHaveLength(0);
    });

    it('should handle extraction errors gracefully', async () => {
      mockAnalyzer.analyzeText.mockRejectedValue(new Error('API error'));

      const result = await extractor.extractPreferences('Put tests in tests-raoul');

      expect(result).toHaveLength(0);
    });
  });

  describe('extractFromCorrection', () => {
    it('should extract preferences from code corrections', async () => {
      const mockAnalysis = {
        intent: { type: 'correction', confidence: 0.85, subtype: 'code_style' },
        entities: { subject: 'code', action: 'correct', target: '\ttabs' },
        preference: {
          key: 'indentation',
          value: 'tabs',
          isOverride: false,
          temporal: 'permanent',
          reasoning: 'User corrected spaces to tabs'
        },
        context: { emotional_tone: 'neutral', formality: 'technical', urgency: 'low' },
        confidence: 0.85,
        reasoning: 'Code correction shows indentation preference'
      };

      mockAnalyzer.analyzeCodeCorrection.mockResolvedValue(mockAnalysis);

      const result = await extractor.extractFromCorrection('  spaces', '\ttabs');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        key: 'indentation',
        value: 'tabs',
        confidence: 0.85
      });
    });
  });

  describe('caching', () => {
    it('should cache extracted preferences', async () => {
      const mockAnalysis = {
        intent: { type: 'preference', confidence: 0.9 },
        entities: { subject: 'tests', action: 'put', target: 'tests-raoul' },
        preference: {
          key: 'test_location',
          value: 'tests-raoul',
          isOverride: false,
          temporal: 'permanent',
          reasoning: 'Test location preference'
        },
        context: { emotional_tone: 'neutral', formality: 'casual', urgency: 'medium' },
        confidence: 0.9,
        reasoning: 'Clear preference'
      };

      mockAnalyzer.analyzeText.mockResolvedValue(mockAnalysis);

      const text = 'Put tests in tests-raoul';
      await extractor.extractPreferences(text);

      const cached = extractor.getCached(text);
      expect(cached).toBeTruthy();
      expect(cached).toHaveLength(1);
    });

    it('should clear cache', async () => {
      const mockAnalysis = {
        intent: { type: 'preference', confidence: 0.9 },
        entities: { subject: 'tests', action: 'put', target: 'tests-raoul' },
        preference: {
          key: 'test_location',
          value: 'tests-raoul',
          isOverride: false,
          temporal: 'permanent',
          reasoning: 'Test location preference'
        },
        context: { emotional_tone: 'neutral', formality: 'casual', urgency: 'medium' },
        confidence: 0.9,
        reasoning: 'Clear preference'
      };

      mockAnalyzer.analyzeText.mockResolvedValue(mockAnalysis);

      const text = 'Put tests in tests-raoul';
      await extractor.extractPreferences(text);

      extractor.clearCache();
      const cached = extractor.getCached(text);
      expect(cached).toBeNull();
    });
  });
});
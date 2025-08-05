import { PatternDetector, CorrectionPattern } from '../../src/core/patterns';
import { PatternStore } from '../../src/memory/pattern-store';
import { MemoryStorage } from '../../src/memory/storage';

describe('PatternDetector', () => {
  let detector: PatternDetector;
  
  beforeEach(() => {
    detector = new PatternDetector();
  });
  
  it('should detect corrections', () => {
    const pattern = detector.detectCorrection(
      'function getUserData() {}',
      'function fetchUserData() {}'
    );
    
    expect(pattern).toBeDefined();
    expect(pattern?.original).toContain('function IDENTIFIER');
    expect(pattern?.corrected).toContain('function IDENTIFIER');
    expect(pattern?.context).toBe('function-declaration');
    expect(pattern?.frequency).toBe(1);
  });
  
  it('should return null for identical strings', () => {
    const pattern = detector.detectCorrection(
      'const data = 5;',
      'const data = 5;'
    );
    
    expect(pattern).toBeNull();
  });
  
  it('should generalize patterns', () => {
    const pattern = detector.detectCorrection(
      'var userName = "John"',
      'const userName = "John"'
    );
    
    expect(pattern?.original).toBe('var IDENTIFIER = STRING');
    expect(pattern?.corrected).toBe('const IDENTIFIER = STRING');
    expect(pattern?.context).toBe('variable-declaration');
  });
  
  it('should detect function call patterns', () => {
    const pattern = detector.detectCorrection(
      'checkAuth(user)',
      'validateAuth(user)'
    );
    
    expect(pattern?.context).toBe('function-call');
  });
});

describe('PatternStore', () => {
  let storage: MemoryStorage;
  let patternStore: PatternStore;
  
  beforeEach(() => {
    storage = new MemoryStorage(':memory:');
    patternStore = new PatternStore(storage);
  });
  
  it('should save patterns', () => {
    const pattern: CorrectionPattern = {
      original: 'var IDENTIFIER',
      corrected: 'const IDENTIFIER',
      context: 'variable-declaration',
      frequency: 1
    };
    
    patternStore.savePattern(pattern);
    
    const stats = storage.getStats();
    expect(stats.total).toBe(1);
    expect(stats.byType['correction-pattern']).toBe(1);
  });
  
  it('should increment frequency for similar patterns', () => {
    const pattern: CorrectionPattern = {
      original: 'var IDENTIFIER',
      corrected: 'const IDENTIFIER',
      context: 'variable-declaration',
      frequency: 1
    };
    
    // Save same pattern twice
    patternStore.savePattern(pattern);
    patternStore.savePattern(pattern);
    
    const frequent = patternStore.getFrequentPatterns(2);
    expect(frequent).toHaveLength(1);
    expect(frequent[0].frequency).toBe(2);
  });
  
  it('should retrieve frequent patterns', () => {
    // Add various patterns
    patternStore.savePattern({
      original: 'var X',
      corrected: 'const X',
      context: 'variable',
      frequency: 1
    });
    
    // Make this one frequent
    for (let i = 0; i < 3; i++) {
      patternStore.savePattern({
        original: 'getUserData',
        corrected: 'fetchUserData',
        context: 'function-call',
        frequency: 1
      });
    }
    
    const frequent = patternStore.getFrequentPatterns(2);
    expect(frequent).toHaveLength(1);
    expect(frequent[0].original).toBe('getUserData');
    expect(frequent[0].frequency).toBeGreaterThanOrEqual(3);
  });
});
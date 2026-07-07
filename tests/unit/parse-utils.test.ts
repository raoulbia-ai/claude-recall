import { parsePositiveInt, parseUnitFloat } from '../../src/cli/parse-utils';

describe('parse-utils', () => {
  let exitSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as any);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  describe('parsePositiveInt', () => {
    it('parses valid values and falls back when absent', () => {
      expect(parsePositiveInt('20', 'limit', 10)).toBe(20);
      expect(parsePositiveInt(undefined, 'limit', 10)).toBe(10);
      expect(parsePositiveInt('', 'limit', 10)).toBe(10);
    });

    it('exits loudly on garbage instead of silently producing NaN', () => {
      // Previously: --limit abc → parseInt NaN → slice(0, NaN) → zero results
      expect(() => parsePositiveInt('abc', 'limit', 10)).toThrow('exit');
      expect(exitSpy).toHaveBeenCalledWith(2);
      expect(errorSpy.mock.calls[0][0]).toContain('--limit');
    });

    it('rejects zero, negatives and floats', () => {
      expect(() => parsePositiveInt('0', 'days', 30)).toThrow('exit');
      expect(() => parsePositiveInt('-5', 'days', 30)).toThrow('exit');
      expect(() => parsePositiveInt('2.5', 'days', 30)).toThrow('exit');
    });
  });

  describe('parseUnitFloat', () => {
    it('parses valid values and falls back when absent', () => {
      expect(parseUnitFloat('0.65', 'threshold', 0.5)).toBe(0.65);
      expect(parseUnitFloat('1', 'threshold', 0.5)).toBe(1);
      expect(parseUnitFloat('0', 'threshold', 0.5)).toBe(0);
      expect(parseUnitFloat(undefined, 'threshold', 0.5)).toBe(0.5);
    });

    it('exits loudly on garbage or out-of-range values', () => {
      expect(() => parseUnitFloat('abc', 'confidence', 0.8)).toThrow('exit');
      expect(() => parseUnitFloat('1.5', 'confidence', 0.8)).toThrow('exit');
      expect(() => parseUnitFloat('-0.1', 'confidence', 0.8)).toThrow('exit');
      expect(exitSpy).toHaveBeenCalledWith(2);
    });
  });
});

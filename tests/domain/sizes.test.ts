import { describe, expect, it } from 'vitest';
import { describeSizes, parseSizeSpec, usSizesToEs, usToEsSize } from '../../src/domain/sizes.js';

describe('ring sizes', () => {
  it('converts US sizes to Spanish sizes (inner circumference in mm)', () => {
    expect(usToEsSize(4)).toBe(47);
    expect(usToEsSize(5)).toBe(49);
    expect(usToEsSize(6)).toBe(52);
    expect(usToEsSize(7)).toBe(54);
    expect(usToEsSize(8)).toBe(57);
    expect(usToEsSize(10)).toBe(62);
    expect(usSizesToEs([6, 5, 5.5, 5])).toEqual([49, 51, 52]);
  });

  it('parses Spanish size specs', () => {
    expect(parseSizeSpec('48-52')).toEqual([48, 49, 50, 51, 52]);
    expect(parseSizeSpec('48 – 50')).toEqual([48, 49, 50]);
    expect(parseSizeSpec('52,48;50 50')).toEqual([48, 50, 52]);
  });

  it('rejects invalid specs', () => {
    expect(() => parseSizeSpec('62-48')).toThrow(/invertido/);
    expect(() => parseSizeSpec('M-L')).toThrow(/no válidas/);
    expect(() => parseSizeSpec('')).toThrow();
  });

  it('describes sizes for product copy', () => {
    expect(describeSizes([50, 48, 49])).toBe('48 a 50');
    expect(describeSizes([48, 50, 52])).toBe('48, 50 y 52');
    expect(describeSizes([52])).toBe('52');
  });
});

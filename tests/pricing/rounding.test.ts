import { describe, expect, it } from 'vitest';
import { roundCommercial } from '../../src/pricing/rounding.js';

describe('roundCommercial', () => {
  it('none: rounds up to the cent', () => {
    expect(roundCommercial(123456, 'none')).toBe(123456);
    expect(roundCommercial(123456.2, 'none')).toBe(123457);
  });

  it('integer: rounds up to whole euros (…,00)', () => {
    expect(roundCommercial(44900, 'integer')).toBe(44900);
    expect(roundCommercial(44901, 'integer')).toBe(45000);
    expect(roundCommercial(44999, 'integer')).toBe(45000);
  });

  it('ends-in-9: rounds up to the next euro amount ending in 9', () => {
    expect(roundCommercial(44900, 'ends-in-9')).toBe(44900);
    expect(roundCommercial(44901, 'ends-in-9')).toBe(45900);
    expect(roundCommercial(44100, 'ends-in-9')).toBe(44900);
    expect(roundCommercial(123456, 'ends-in-9')).toBe(123900);
    expect(roundCommercial(500, 'ends-in-9')).toBe(900);
  });

  it('ignores floating point noise', () => {
    expect(roundCommercial(44900.0000001, 'integer')).toBe(44900);
    expect(roundCommercial(0.1 * 3 * 100000, 'none')).toBe(30000);
  });
});

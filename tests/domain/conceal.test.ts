import { describe, expect, it } from 'vitest';
import { findSupplierTraces, stripSupplierMarks } from '../../src/domain/conceal.js';

const marks = {
  brands: ['Halden & Rowe', 'Talleres Orvia', 'Orvia'],
  refs: ['ORV-1002', 'HR-CD4-14Y'],
};

describe('stripSupplierMarks', () => {
  it.each([
    ['Comfort Fit Flat Band 5mm by Halden & Rowe', 'Comfort Fit Flat Band 5mm'],
    ['Halden & Rowe Classic Dome Wedding Band 4mm', 'Classic Dome Wedding Band 4mm'],
    ['Alianza plana confort 4 mm - Talleres Orvia', 'Alianza plana confort 4 mm'],
    ['Alianza plana satinada Orvia®', 'Alianza plana satinada'],
    ['Alianza media caña Orvia (ref. ORV-1002)', 'Alianza media caña'],
    ['Alianza clásica, SKU: HR-CD4-14Y', 'Alianza clásica,'],
    ['Alianza ÓRVIA clásica', 'Alianza clásica'],
  ])('%s', (input, expected) => {
    expect(stripSupplierMarks(input, marks)).toBe(expected);
  });

  it('does not touch words that only contain the brand', () => {
    expect(stripSupplierMarks('Orvianas y morvias', marks)).toBe('Orvianas y morvias');
  });
});

describe('findSupplierTraces', () => {
  it('finds brands and references regardless of case and accents', () => {
    expect(findSupplierTraces('alianza-orvia-str-al-000001-1.jpg', marks)).toEqual(['Orvia']);
    expect(findSupplierTraces('Ref hr-cd4-14y', marks)).toEqual(['HR-CD4-14Y']);
    expect(findSupplierTraces('Alianza Alba media caña 4 mm', marks)).toEqual([]);
  });
});

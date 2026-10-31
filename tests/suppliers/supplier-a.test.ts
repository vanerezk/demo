import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileSource } from '../../src/suppliers/sources.js';
import {
  finishFromTitle,
  parseMetalA,
  styleFromTitle,
  SupplierAAdapter,
} from '../../src/suppliers/supplier-a.js';

const adapter = new SupplierAAdapter(new FileSource(resolve('fixtures/supplier-a/catalog.json')), [
  'Halden & Rowe',
]);

describe('SupplierAAdapter', () => {
  it('groups SKUs by parent into one product per model and rejects invalid records', async () => {
    const { items, rejected } = adapter.normalize(await adapter.fetch());
    expect(items).toHaveLength(9);
    expect(rejected).toEqual([
      expect.objectContaining({
        supplierRef: 'HR-TT6-SS',
        reason: expect.stringContaining('price_usd') as string,
      }),
    ]);

    const dome = items.find((i) => i.supplierRef === 'HR-CD4')!;
    expect(dome.style).toBe('media-cana');
    expect(dome.currency).toBe('USD');
    expect(new Set(dome.variants.map((v) => v.metal))).toEqual(
      new Set(['ORO_14K', 'ORO_18K', 'PLATINO_950']),
    );
    // Tallas US 4–10 -> tallas españolas
    expect(Math.min(...dome.variants.map((v) => v.size))).toBe(47);
    expect(Math.max(...dome.variants.map((v) => v.size))).toBe(62);
    expect(dome.images[0]).toBe(resolve('fixtures/supplier-a/images/HR-CD4-14Y_main.jpg'));
  });

  it('maps diamonds and puts diamond rings in their own category', async () => {
    const { items } = adapter.normalize(await adapter.fetch());
    const eternity = items.find((i) => i.supplierRef === 'HR-ET25')!;
    expect(eternity.category).toBe('alianzas-diamantes');
    expect(new Set(eternity.variants.map((v) => v.diamond?.caratTotal))).toEqual(new Set([0.5, 1]));
    expect(eternity.variants[0]?.diamond?.quality).toBe('G/VS1');
  });

  it('rejects a model whose SKUs disagree on width', () => {
    const base = {
      title: 'Flat Band',
      metal: 'yellow gold',
      karat: 14,
      sizes: [6],
      price_usd: 100,
      stock: 1,
    };
    const { items, rejected } = adapter.normalize([
      { ...base, sku: 'X-1', parent_sku: 'X', width_mm: 4 },
      { ...base, sku: 'X-2', parent_sku: 'X', width_mm: 5, karat: 18 },
    ]);
    expect(items).toHaveLength(0);
    expect(rejected[0]?.reason).toMatch(/Anchos distintos/);
  });

  it('translates titles into shop styles and finishes', () => {
    expect(styleFromTitle('Half Eternity Diamond Band')).toBe('media-eternity');
    expect(styleFromTitle('Diamond Eternity Band')).toBe('eternity');
    expect(styleFromTitle('Comfort Fit Flat Band')).toBe('plana-confort');
    expect(styleFromTitle('Something new')).toBe('clasica');
    expect(finishFromTitle('Brushed Satin Flat')).toBe('satinado');
  });

  it('maps metals', () => {
    expect(parseMetalA('platinum', null)).toEqual({ metal: 'PLATINO_950' });
    expect(parseMetalA('White Gold', 18)).toEqual({ metal: 'ORO_18K', goldColor: 'blanco' });
    expect(() => parseMetalA('yellow gold', 10)).toThrow(/Quilataje/);
    expect(() => parseMetalA('sterling silver', null)).toThrow(/Metal no soportado/);
  });
});

import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileSource } from '../../src/suppliers/sources.js';
import {
  parseAvailability,
  parseMetalB,
  parseSpanishNumber,
  SupplierBAdapter,
} from '../../src/suppliers/supplier-b.js';

const adapter = new SupplierBAdapter(new FileSource(resolve('fixtures/supplier-b/tarifa.csv')), [
  'Talleres Orvia',
  'Orvia',
]);

describe('SupplierBAdapter', () => {
  it('parses the semicolon CSV and rejects invalid rows without stopping', async () => {
    const { items, rejected } = adapter.normalize(await adapter.fetch());
    expect(items).toHaveLength(9);
    expect(rejected).toEqual([
      expect.objectContaining({
        supplierRef: 'ORV-1070',
        reason: expect.stringMatching(/invertido/) as string,
      }),
    ]);
  });

  it('maps every column to the common model', async () => {
    const { items } = adapter.normalize(await adapter.fetch());
    const platinum = items.find((i) => i.supplierRef === 'ORV-1011')!;
    expect(platinum.currency).toBe('EUR');
    expect(platinum.style).toBe('plana-confort');
    expect(platinum.widthMm).toBe(5);
    expect(platinum.variants).toHaveLength(17); // 50-66
    expect(platinum.variants[0]).toMatchObject({ metal: 'PLATINO_950', cost: 1185, stock: 3 }); // "sí" -> 3
    expect(platinum.images).toEqual([
      resolve('fixtures/supplier-b/fotos/ORV-1011_a.jpg'),
      resolve('fixtures/supplier-b/fotos/ORV-1011_b.jpg'),
    ]);

    const soldOut = items.find((i) => i.supplierRef === 'ORV-1060')!;
    expect(soldOut.variants.every((v) => v.stock === 0)).toBe(true);
  });

  it('fails clearly when columns are missing', async () => {
    const broken = new SupplierBAdapter({
      location: 'x',
      read: () => Promise.resolve('ref;nombre\nA;B'),
      resolve: (r) => r,
    });
    await expect(broken.fetch()).rejects.toThrow(
      /Faltan columnas en el CSV del proveedor B: material/,
    );
  });
});

describe('supplier B parsing helpers', () => {
  it('parses Spanish numbers', () => {
    expect(parseSpanishNumber('1.185,00')).toBe(1185);
    expect(parseSpanishNumber('342,50')).toBe(342.5);
    expect(parseSpanishNumber('5,0 mm')).toBe(5);
    expect(parseSpanishNumber('612,00 €')).toBe(612);
    expect(() => parseSpanishNumber('12.5.3')).toThrow();
  });

  it('parses availability', () => {
    expect(parseAvailability('12', 3)).toBe(12);
    expect(parseAvailability('Sí', 3)).toBe(3);
    expect(parseAvailability('agotado', 3)).toBe(0);
    expect(() => parseAvailability('pronto', 3)).toThrow();
  });

  it('maps materials', () => {
    expect(parseMetalB('Oro rosa 14 kt')).toEqual({ metal: 'ORO_14K', goldColor: 'rosa' });
    expect(parseMetalB('Oro blanco 18K')).toEqual({ metal: 'ORO_18K', goldColor: 'blanco' });
    expect(parseMetalB('Platino 950')).toEqual({ metal: 'PLATINO_950' });
    expect(() => parseMetalB('Plata 925')).toThrow();
  });
});

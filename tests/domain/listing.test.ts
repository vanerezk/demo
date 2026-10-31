import { describe, expect, it } from 'vitest';
import {
  commercialName,
  modelName,
  SupplierTraceError,
  toListing,
} from '../../src/domain/listing.js';
import {
  CatalogItemSchema,
  type CatalogItem,
  type CatalogItemInput,
} from '../../src/domain/model.js';
import { InMemoryReferenceAllocator } from '../../src/domain/reference.js';
import { FixedRateProvider, PriceCalculator } from '../../src/pricing/index.js';

const pricing = new PriceCalculator(new FixedRateProvider({ USD: 0.92 }), {
  vatPct: 21,
  rounding: 'ends-in-9',
  defaultMarginPct: 100,
  marginPctBySupplier: { a: 90 },
});

function item(overrides: Partial<CatalogItemInput> = {}): CatalogItem {
  const variants = (['ORO_14K', 'ORO_18K'] as const).flatMap((metal, i) =>
    [50, 52, 54].map((size) => ({
      supplierSku: `HR-CD4-${metal === 'ORO_14K' ? '14Y' : '18Y'}`,
      metal,
      size,
      cost: i === 0 ? 389 : 574,
      stock: 3,
    })),
  );
  return CatalogItemSchema.parse({
    supplier: 'a',
    supplierRef: 'HR-CD4',
    sourceTitle: 'Halden & Rowe Classic Dome Wedding Band 4mm',
    brand: 'Halden & Rowe',
    style: 'media-cana',
    widthMm: 4,
    category: 'alianzas',
    currency: 'USD',
    images: [
      '/feeds/images/HR-CD4-14Y_main.jpg',
      'https://cdn.halden-rowe.example/HR-CD4-18Y_side.png?v=2',
    ],
    variants,
    ...overrides,
  });
}

const ctx = () => ({
  pricing,
  references: new InMemoryReferenceAllocator(),
  referencePrefix: 'STR-AL',
});

describe('toListing', () => {
  it('builds a native-looking product with our own reference and name', async () => {
    const listing = await toListing(item(), ctx());
    expect(listing.reference).toBe('STR-AL-000001');
    expect(listing.name).toBe('Alianza Alba media caña 4 mm');
    expect(listing.description).toContain('<strong>Metal:</strong> Oro 14K o Oro 18K');
    expect(listing.description).toContain('<strong>Tallas:</strong> 50, 52 y 54');
    expect(listing.category).toEqual({ key: 'alianzas', name: 'Alianzas de boda' });
  });

  it('prices combinations as impacts over the cheapest one', async () => {
    const listing = await toListing(item(), ctx());
    expect(listing.gross).toBe(829);
    const gold14 = listing.combinations.filter((c) => c.attributes.Metal === 'Oro 14K');
    const gold18 = listing.combinations.filter((c) => c.attributes.Metal === 'Oro 18K');
    expect(gold14.every((c) => c.impactTaxExcl === 0)).toBe(true);
    expect(gold18.every((c) => c.gross === 1219)).toBe(true);
    for (const c of gold18) {
      // Lo que mostrará PrestaShop: (base + impacto) × 1,21, redondeado al céntimo.
      expect(Math.round((listing.taxExcl + c.impactTaxExcl) * 1.21 * 100) / 100).toBe(1219);
    }
  });

  it('picks the cheapest combination closest to the median size as default', async () => {
    const listing = await toListing(item(), ctx());
    const defaults = listing.combinations.filter((c) => c.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.attributes).toEqual({ Metal: 'Oro 14K', Talla: '52' });
    expect(defaults[0]?.reference).toBe('STR-AL-000001-14K-52');
  });

  it('renames images and drops every supplier trace from public fields', async () => {
    const listing = await toListing(item(), ctx());
    expect(listing.images.map((i) => i.fileName)).toEqual([
      'alianza-alba-media-cana-4-mm-str-al-000001-1.jpg',
      'alianza-alba-media-cana-4-mm-str-al-000001-2.png',
    ]);
    const publicText = JSON.stringify([
      listing.name,
      listing.description,
      listing.descriptionShort,
      listing.reference,
      listing.images.map((i) => i.fileName),
      listing.combinations.map((c) => c.reference),
    ]);
    expect(publicText).not.toMatch(/halden|rowe|HR-CD4/i);
  });

  it('keeps references stable for the same supplier product', async () => {
    const c = ctx();
    const first = await toListing(item(), c);
    const again = await toListing(item(), c);
    const other = await toListing(item({ supplierRef: 'HR-CF5' }), c);
    expect(again.reference).toBe(first.reference);
    expect(other.reference).toBe('STR-AL-000002');
  });

  it('changes only the price hash when a cost changes', async () => {
    const before = await toListing(item(), ctx());
    const cheaper = item();
    cheaper.variants = cheaper.variants.map((v) => ({ ...v, cost: v.cost - 50 }));
    const after = await toListing(cheaper, ctx());
    expect(after.contentHash).toBe(before.contentHash);
    expect(after.priceHash).not.toBe(before.priceHash);
  });

  it('refuses to publish if a supplier mark leaks into a public field', async () => {
    // Una marca que coincide con el nombre de modelo "Alba" acabaría en el nombre del producto.
    await expect(toListing(item({ brand: 'Alba' }), ctx())).rejects.toBeInstanceOf(
      SupplierTraceError,
    );
  });
});

describe('commercialName', () => {
  it('names diamonds, finishes and non-yellow gold', () => {
    const eternity = item({
      style: 'eternity',
      widthMm: 2.5,
      category: 'alianzas-diamantes',
      variants: [
        {
          supplierSku: 'x',
          metal: 'ORO_18K',
          goldColor: 'blanco',
          size: 52,
          cost: 1,
          stock: 1,
          diamond: { caratTotal: 0.5 },
        },
      ],
    });
    expect(commercialName(eternity, 3)).toBe(
      'Alianza Brisa eternity de diamantes en oro blanco 2,5 mm',
    );
    expect(commercialName(item({ style: 'clasica', finish: 'martele' }), 1)).toBe(
      'Alianza Alba martelé 4 mm',
    );
  });

  it('never runs out of model names', () => {
    expect(modelName(1)).toBe('Alba');
    expect(modelName(31)).toBe('Alba 2');
  });
});

describe('CatalogItemSchema', () => {
  it('rejects duplicated variants', () => {
    const v = { supplierSku: 'x', metal: 'ORO_18K', size: 52, cost: 1, stock: 1 } as const;
    expect(() => item({ variants: [v, v] })).toThrow(/Variante duplicada/);
  });
});

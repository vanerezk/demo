import { z } from 'zod';
import {
  collectValidated,
  formatZodError,
  type CatalogItemInput,
  type GoldColor,
  type Metal,
  type NormalizeResult,
  type RingFinish,
  type RingStyle,
  type Variant,
} from '../domain/model.js';
import { usSizesToEs } from '../domain/sizes.js';
import type { TextSource } from './sources.js';
import type { SupplierAdapter } from './types.js';

/**
 * Proveedor A: feed JSON de un fabricante estadounidense.
 * Precios en USD, textos en inglés y tallas en escala US.
 * Cada SKU es un modelo en un metal concreto; `parent_sku` agrupa los metales del mismo modelo.
 */
export const SupplierARecord = z.object({
  sku: z.string().min(1),
  parent_sku: z.string().min(1).optional(),
  title: z.string().min(1),
  metal: z.string().min(1),
  karat: z.number().int().nullable().optional(),
  width_mm: z.number().positive(),
  sizes: z.array(z.number().positive()).min(1),
  price_usd: z.number().positive(),
  stock: z.number().int().nonnegative(),
  images: z.array(z.string().min(1)).default([]),
  brand: z.string().optional(),
  diamond: z
    .object({
      carat_total: z.number().positive(),
      color: z.string().optional(),
      clarity: z.string().optional(),
    })
    .optional(),
});
export type SupplierARecord = z.infer<typeof SupplierARecord>;

/** Traduce el título en inglés a un perfil de la tienda. El orden importa ("half eternity" antes que "eternity"). */
const STYLE_KEYWORDS: [RegExp, RingStyle][] = [
  [/half[\s-]*eternity/i, 'media-eternity'],
  [/eternity/i, 'eternity'],
  [/knife[\s-]*edge/i, 'arista'],
  [/milgrain/i, 'milgrain'],
  [/bevel/i, 'biselada'],
  [/comfort[\s-]*fit/i, 'plana-confort'],
  [/flat/i, 'plana'],
  [/dome|half[\s-]*round|court/i, 'media-cana'],
];

const FINISH_KEYWORDS: [RegExp, RingFinish][] = [
  [/brushed|satin|matte/i, 'satinado'],
  [/hammered/i, 'martele'],
];

export function styleFromTitle(title: string): RingStyle {
  return STYLE_KEYWORDS.find(([re]) => re.test(title))?.[1] ?? 'clasica';
}

export function finishFromTitle(title: string): RingFinish {
  return FINISH_KEYWORDS.find(([re]) => re.test(title))?.[1] ?? 'pulido';
}

export function parseMetalA(
  metal: string,
  karat: number | null | undefined,
): { metal: Metal; goldColor?: GoldColor } {
  const m = metal.toLowerCase();
  if (m.includes('platinum')) return { metal: 'PLATINO_950' };
  if (!m.includes('gold')) throw new Error(`Metal no soportado: "${metal}"`);
  const goldColor: GoldColor = m.includes('white')
    ? 'blanco'
    : m.includes('rose')
      ? 'rosa'
      : 'amarillo';
  if (karat === 14) return { metal: 'ORO_14K', goldColor };
  if (karat === 18) return { metal: 'ORO_18K', goldColor };
  throw new Error(`Quilataje no soportado para oro: ${karat ?? 'sin indicar'}`);
}

export class SupplierAAdapter implements SupplierAdapter {
  readonly id = 'a';
  readonly displayName = 'Proveedor A (JSON, USD)';

  constructor(
    private readonly source: TextSource,
    readonly brands: string[] = [],
  ) {}

  async fetch(): Promise<unknown[]> {
    const json = JSON.parse(await this.source.read()) as unknown;
    const records = Array.isArray(json) ? json : (json as { products?: unknown }).products;
    if (!Array.isArray(records))
      throw new Error('El feed del proveedor A no contiene una lista de productos');
    return records as unknown[];
  }

  normalize(raw: unknown[]): NormalizeResult {
    const result: NormalizeResult = { items: [], rejected: [] };
    const groups = new Map<string, SupplierARecord[]>();

    for (const [index, record] of raw.entries()) {
      const parsed = SupplierARecord.safeParse(record);
      if (!parsed.success) {
        const sku = (record as { sku?: unknown } | null)?.sku;
        result.rejected.push({
          supplier: this.id,
          supplierRef: typeof sku === 'string' ? sku : `#${index}`,
          reason: formatZodError(parsed.error),
        });
        continue;
      }
      const key = parsed.data.parent_sku ?? parsed.data.sku;
      groups.set(key, [...(groups.get(key) ?? []), parsed.data]);
    }

    for (const [supplierRef, records] of groups) {
      try {
        collectValidated(this.toCatalogItem(supplierRef, records), result);
      } catch (error) {
        result.rejected.push({ supplier: this.id, supplierRef, reason: (error as Error).message });
      }
    }
    return result;
  }

  private toCatalogItem(supplierRef: string, records: SupplierARecord[]): CatalogItemInput {
    const [first] = records;
    if (!first) throw new Error('Grupo vacío');
    const widths = new Set(records.map((r) => r.width_mm));
    if (widths.size > 1)
      throw new Error(`Anchos distintos en el mismo modelo: ${[...widths].join(', ')} mm`);

    const variants: Variant[] = records.flatMap((r) => {
      const { metal, goldColor } = parseMetalA(r.metal, r.karat);
      const diamond = r.diamond
        ? {
            caratTotal: r.diamond.carat_total,
            ...(r.diamond.color && r.diamond.clarity
              ? { quality: `${r.diamond.color}/${r.diamond.clarity}` }
              : {}),
          }
        : undefined;
      // El proveedor da el stock por SKU (modelo + metal); se aplica a cada talla.
      return usSizesToEs(r.sizes).map((size) => ({
        supplierSku: r.sku,
        metal,
        ...(goldColor ? { goldColor } : {}),
        size,
        ...(diamond ? { diamond } : {}),
        cost: r.price_usd,
        stock: r.stock,
      }));
    });

    return {
      supplier: this.id,
      supplierRef,
      sourceTitle: first.title,
      ...(first.brand ? { brand: first.brand } : {}),
      style: styleFromTitle(first.title),
      finish: finishFromTitle(first.title),
      widthMm: first.width_mm,
      category: records.some((r) => r.diamond) ? 'alianzas-diamantes' : 'alianzas',
      currency: 'USD',
      images: records.flatMap((r) => r.images.map((img) => this.source.resolve(img))),
      variants,
    };
  }
}

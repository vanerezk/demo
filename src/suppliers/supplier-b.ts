import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import {
  collectValidated,
  type CatalogItemInput,
  type GoldColor,
  type Metal,
  type NormalizeResult,
  type RingFinish,
  type RingStyle,
} from '../domain/model.js';
import { parseSizeSpec } from '../domain/sizes.js';
import type { TextSource } from './sources.js';
import type { SupplierAdapter } from './types.js';

/**
 * Proveedor B: tarifa CSV de un taller español.
 * Separador ";", decimales con coma ("1.245,50"), cabeceras en castellano.
 * Una fila = un modelo en un metal. `pvp` es su precio de tarifa al distribuidor (sin IVA).
 */
const COLUMNS = [
  'ref',
  'nombre',
  'material',
  'ancho',
  'tallas',
  'pvp',
  'disponible',
  'foto1',
  'foto2',
] as const;
type Row = Record<(typeof COLUMNS)[number], string>;

/** "1.245,50 €" -> 1245.5 */
export function parseSpanishNumber(value: string): number {
  const cleaned = value.replace(/[€\s]|mm/gi, '');
  if (!/^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+(,\d+)?$/.test(cleaned)) {
    throw new Error(`Número no válido: "${value}"`);
  }
  return Number(cleaned.replace(/\./g, '').replace(',', '.'));
}

/** "12" -> 12, "sí" -> stock por defecto, "no"/"agotado" -> 0 */
export function parseAvailability(value: string, defaultStock: number): number {
  const v = value.trim().toLowerCase();
  if (/^\d+$/.test(v)) return Number(v);
  if (['si', 'sí', 's', 'yes', 'disponible'].includes(v)) return defaultStock;
  if (['no', 'n', 'agotado', '0', ''].includes(v)) return 0;
  throw new Error(`Disponibilidad no válida: "${value}"`);
}

export function parseMetalB(material: string): { metal: Metal; goldColor?: GoldColor } {
  const m = material.toLowerCase();
  if (m.includes('platino')) return { metal: 'PLATINO_950' };
  if (!m.includes('oro')) throw new Error(`Material no soportado: "${material}"`);
  const goldColor: GoldColor = m.includes('blanco')
    ? 'blanco'
    : m.includes('rosa')
      ? 'rosa'
      : 'amarillo';
  const karat = /(\d{2})\s*(?:k|kt|quilates)\b/i.exec(material)?.[1];
  if (karat === '14') return { metal: 'ORO_14K', goldColor };
  if (karat === '18') return { metal: 'ORO_18K', goldColor };
  throw new Error(`Quilataje no soportado: "${material}"`);
}

const STYLE_KEYWORDS: [RegExp, RingStyle][] = [
  [/media\s*eternity/i, 'media-eternity'],
  [/eternity/i, 'eternity'],
  [/media\s*ca[ñn]a/i, 'media-cana'],
  [/confort/i, 'plana-confort'],
  [/plana/i, 'plana'],
  [/arista/i, 'arista'],
  [/milgrain|granulad/i, 'milgrain'],
  [/bisel/i, 'biselada'],
];

const FINISH_KEYWORDS: [RegExp, RingFinish][] = [
  [/satinad|mate\b/i, 'satinado'],
  [/martel/i, 'martele'],
];

const RowSchema = z.object(
  Object.fromEntries(COLUMNS.map((c) => [c, z.string()])) as Record<keyof Row, z.ZodString>,
);

export class SupplierBAdapter implements SupplierAdapter<Row> {
  readonly id = 'b';
  readonly displayName = 'Proveedor B (CSV, EUR)';

  constructor(
    private readonly source: TextSource,
    readonly brands: string[] = [],
    /** Unidades que se asumen cuando el proveedor solo indica "sí". */
    private readonly defaultStock = 3,
  ) {}

  async fetch(): Promise<Row[]> {
    const text = await this.source.read();
    const records = parse<Record<string, string>>(text, {
      delimiter: ';',
      columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_column_count: true,
    });
    const missing = COLUMNS.filter((c) => records[0] && !(c in records[0]));
    if (missing.length)
      throw new Error(`Faltan columnas en el CSV del proveedor B: ${missing.join(', ')}`);
    return records.map((r) =>
      RowSchema.parse(Object.fromEntries(COLUMNS.map((c) => [c, r[c] ?? '']))),
    );
  }

  normalize(rows: Row[]): NormalizeResult {
    const result: NormalizeResult = { items: [], rejected: [] };
    for (const [index, row] of rows.entries()) {
      const supplierRef = row.ref || `fila ${index + 2}`;
      try {
        collectValidated(this.toCatalogItem(row), result);
      } catch (error) {
        result.rejected.push({ supplier: this.id, supplierRef, reason: (error as Error).message });
      }
    }
    return result;
  }

  private toCatalogItem(row: Row): CatalogItemInput {
    if (!row.ref) throw new Error('Fila sin referencia');
    const { metal, goldColor } = parseMetalB(row.material);
    const cost = parseSpanishNumber(row.pvp);
    const stock = parseAvailability(row.disponible, this.defaultStock);
    const sizes = parseSizeSpec(row.tallas);
    return {
      supplier: this.id,
      supplierRef: row.ref,
      sourceTitle: row.nombre,
      ...(this.brands[0] ? { brand: this.brands[0] } : {}),
      style: STYLE_KEYWORDS.find(([re]) => re.test(row.nombre))?.[1] ?? 'clasica',
      finish: FINISH_KEYWORDS.find(([re]) => re.test(row.nombre))?.[1] ?? 'pulido',
      widthMm: parseSpanishNumber(row.ancho),
      category: 'alianzas',
      currency: 'EUR',
      images: [row.foto1, row.foto2].filter(Boolean).map((img) => this.source.resolve(img)),
      variants: sizes.map((size) => ({
        supplierSku: row.ref,
        metal,
        ...(goldColor ? { goldColor } : {}),
        size,
        cost,
        stock,
      })),
    };
  }
}

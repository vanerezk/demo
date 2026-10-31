import { z } from 'zod';

// Mensajes de validación en castellano (aparecen en los registros y en el panel).
z.config(z.locales.es());

/** Metales que vende la joyería. Son los valores del grupo de atributos "Metal". */
export const METALS = ['ORO_14K', 'ORO_18K', 'PLATINO_950'] as const;
export type Metal = (typeof METALS)[number];

export const METAL_LABELS: Record<Metal, string> = {
  ORO_14K: 'Oro 14K',
  ORO_18K: 'Oro 18K',
  PLATINO_950: 'Platino 950',
};

export const GOLD_COLORS = ['amarillo', 'blanco', 'rosa'] as const;
export type GoldColor = (typeof GOLD_COLORS)[number];

/** Perfiles de alianza que la tienda sabe nombrar en castellano. */
export const RING_STYLES = [
  'media-cana',
  'plana',
  'plana-confort',
  'arista',
  'milgrain',
  'biselada',
  'eternity',
  'media-eternity',
  'clasica',
] as const;
export type RingStyle = (typeof RING_STYLES)[number];

export const RING_FINISHES = ['pulido', 'satinado', 'martele'] as const;
export type RingFinish = (typeof RING_FINISHES)[number];

export const CURRENCIES = ['EUR', 'USD'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Categorías de la tienda (se resuelven a ids de PrestaShop en la sincronización). */
export const CATEGORIES = {
  alianzas: 'Alianzas de boda',
  'alianzas-diamantes': 'Alianzas con diamantes',
} as const;
export type CategoryKey = keyof typeof CATEGORIES;

/** Talla española = circunferencia interior en mm (habitualmente 44–70). */
export const RingSize = z.number().int().min(40).max(75);

export const DiamondSchema = z.object({
  /** Peso total en quilates. */
  caratTotal: z.number().positive().max(10),
  /** Calidad, p. ej. "G/VS1". */
  quality: z.string().min(1).optional(),
});
export type Diamond = z.infer<typeof DiamondSchema>;

export const VariantSchema = z.object({
  /** SKU del proveedor para esta variante (dato interno, nunca se publica). */
  supplierSku: z.string().min(1),
  metal: z.enum(METALS),
  goldColor: z.enum(GOLD_COLORS).optional(),
  size: RingSize,
  diamond: DiamondSchema.optional(),
  /** Precio de coste en la moneda del proveedor. */
  cost: z.number().positive(),
  stock: z.number().int().nonnegative(),
});
export type Variant = z.infer<typeof VariantSchema>;

/**
 * Producto de catálogo en el modelo común, independiente del proveedor.
 * Todavía contiene datos del proveedor (marca, título original, referencias):
 * `toListing()` los elimina antes de publicar.
 */
export const CatalogItemSchema = z
  .object({
    supplier: z.string().min(1),
    /** Referencia del proveedor que identifica el modelo. Clave de idempotencia. */
    supplierRef: z.string().min(1),
    sourceTitle: z.string().min(1),
    brand: z.string().optional(),
    style: z.enum(RING_STYLES),
    finish: z.enum(RING_FINISHES).default('pulido'),
    widthMm: z.number().positive().max(20),
    category: z.enum(Object.keys(CATEGORIES) as [CategoryKey, ...CategoryKey[]]),
    currency: z.enum(CURRENCIES),
    /** URL o ruta local de cada imagen, en orden (la primera es la portada). */
    images: z.array(z.string().min(1)),
    variants: z.array(VariantSchema).min(1),
  })
  .superRefine((item, ctx) => {
    const seen = new Set<string>();
    for (const v of item.variants) {
      const key = variantKey(v);
      if (seen.has(key)) {
        ctx.addIssue({ code: 'custom', path: ['variants'], message: `Variante duplicada: ${key}` });
      }
      seen.add(key);
    }
  });
export type CatalogItem = z.infer<typeof CatalogItemSchema>;
export type CatalogItemInput = z.input<typeof CatalogItemSchema>;

/** Identifica una combinación dentro de un producto: metal + diamante + talla. */
export function variantKey(v: Pick<Variant, 'metal' | 'size' | 'diamond'>): string {
  const diamond = v.diamond
    ? `${v.diamond.caratTotal}ct${v.diamond.quality ? `-${v.diamond.quality}` : ''}`
    : '';
  return [v.metal, diamond, v.size].filter(Boolean).join('|');
}

/** Registro descartado al normalizar, con el motivo. No detiene el lote. */
export interface RejectedRecord {
  supplier: string;
  supplierRef: string;
  reason: string;
}

export interface NormalizeResult {
  items: CatalogItem[];
  rejected: RejectedRecord[];
}

/** Valida un item y lo añade a `items` o a `rejected`, con un motivo legible. */
export function collectValidated(input: CatalogItemInput, result: NormalizeResult): void {
  const parsed = CatalogItemSchema.safeParse(input);
  if (parsed.success) {
    result.items.push(parsed.data);
  } else {
    result.rejected.push({
      supplier: input.supplier,
      supplierRef: input.supplierRef,
      reason: formatZodError(parsed.error),
    });
  }
}

export function formatZodError(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(raíz)'}: ${i.message}`).join('; ');
}

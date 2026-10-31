import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import type { PriceCalculator } from '../pricing/calculator.js';
import { slugify } from '../shared/text.js';
import { findSupplierTraces, type SupplierMarks } from './conceal.js';
import {
  CATEGORIES,
  METAL_LABELS,
  variantKey,
  type CatalogItem,
  type CategoryKey,
  type Diamond,
  type Metal,
  type RingFinish,
  type RingStyle,
} from './model.js';
import { formatReference, type ReferenceAllocator } from './reference.js';
import { describeSizes } from './sizes.js';

/** Atributos de una combinación tal y como se crean en PrestaShop (grupo -> valor). */
export interface CombinationAttributes {
  Metal: string;
  Talla: string;
  Diamante?: string;
}

export interface ListingCombination {
  /** Clave estable dentro del producto (metal|diamante|talla). */
  key: string;
  /** SKU del proveedor: solo para la base de datos interna. */
  supplierSku: string;
  /** Referencia pública de la combinación, propia de la tienda. */
  reference: string;
  attributes: CombinationAttributes;
  /** PVP con IVA de esta combinación. */
  gross: number;
  taxExcl: number;
  /** Impacto sobre el precio base (sin IVA), que es como lo modela PrestaShop. */
  impactTaxExcl: number;
  stock: number;
  isDefault: boolean;
}

export interface ListingImage {
  /** URL o ruta del proveedor (interna). */
  source: string;
  /** Nombre de archivo con el que se sube: sin rastro del proveedor. */
  fileName: string;
}

/** Producto listo para publicar: sin ningún dato visible del proveedor. */
export interface Listing {
  supplier: string;
  supplierRef: string;
  reference: string;
  name: string;
  description: string;
  descriptionShort: string;
  category: { key: CategoryKey; name: string };
  /** Precio base del producto = combinación más barata. */
  gross: number;
  taxExcl: number;
  images: ListingImage[];
  combinations: ListingCombination[];
  /** Hash de nombre, textos, imágenes y combinaciones: si cambia, hay que actualizar la ficha. */
  contentHash: string;
  /** Hash de precios y stock: lo único que revisa `sync:prices`. */
  priceHash: string;
}

export interface ListingContext {
  pricing: PriceCalculator;
  references: ReferenceAllocator;
  referencePrefix: string;
  /** Marca/razón social del proveedor, además de la que venga en el propio item. */
  supplierBrands?: string[];
}

const STYLE_LABEL: Record<RingStyle, string> = {
  'media-cana': 'media caña',
  plana: 'plana',
  'plana-confort': 'plana confort',
  arista: 'con arista',
  milgrain: 'milgrain',
  biselada: 'biselada',
  eternity: 'eternity',
  'media-eternity': 'media eternity',
  clasica: 'clásica',
};

const STYLE_DESCRIPTION: Record<RingStyle, string> = {
  'media-cana': 'de perfil media caña, ligeramente abombada por fuera y plana por dentro',
  plana: 'de perfil plano y cantos rectos',
  'plana-confort':
    'de perfil plano con interior confort, redondeado para que se deslice con suavidad',
  arista: 'con una arista central que dibuja una línea de luz',
  milgrain: 'con bordes milgrain, un granulado fino de inspiración vintage',
  biselada: 'con cantos biselados que enmarcan la superficie central',
  eternity: 'con diamantes engastados en todo su contorno',
  'media-eternity': 'con diamantes engastados en la mitad superior',
  clasica: 'de líneas clásicas',
};

const FINISH_NAME: Record<RingFinish, string> = {
  pulido: '',
  satinado: 'satinada',
  martele: 'martelé',
};
const FINISH_DESCRIPTION: Record<RingFinish, string> = {
  pulido: 'pulido a espejo',
  satinado: 'satinado mate',
  martele: 'martelé, martillado a mano',
};

/** Nombres de modelo propios. Hacen que dos productos parecidos no se llamen igual. */
const MODEL_NAMES = [
  'Alba',
  'Aura',
  'Brisa',
  'Cala',
  'Calma',
  'Duna',
  'Elia',
  'Gala',
  'Iris',
  'Jara',
  'Lía',
  'Luna',
  'Mar',
  'Nácar',
  'Nora',
  'Olea',
  'Sal',
  'Selene',
  'Sena',
  'Vera',
  'Abril',
  'Ágata',
  'Bruma',
  'Cielo',
  'Edén',
  'Lira',
  'Mirto',
  'Noa',
  'Rocío',
  'Zafra',
];

export function modelName(sequence: number): string {
  const base = MODEL_NAMES[(sequence - 1) % MODEL_NAMES.length] ?? 'Alba';
  const round = Math.floor((sequence - 1) / MODEL_NAMES.length);
  return round === 0 ? base : `${base} ${round + 1}`;
}

const formatMm = (mm: number) => `${mm.toLocaleString('es-ES', { maximumFractionDigits: 1 })} mm`;
const formatCarat = (ct: number) =>
  `${ct.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ct`;

export function diamondLabel(d: Diamond): string {
  return d.quality ? `${formatCarat(d.caratTotal)} ${d.quality}` : formatCarat(d.caratTotal);
}

const listJoin = (items: string[]) =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} o ${items[items.length - 1] ?? ''}`;

/** "Alianza Duna media caña satinada 4 mm", "Alianza Gala eternity de diamantes 2,5 mm". */
export function commercialName(item: CatalogItem, sequence: number): string {
  const hasDiamonds = item.variants.some((v) => v.diamond);
  const parts = ['Alianza', modelName(sequence)];
  // "clásica" solo aporta si no hay otro rasgo que nombrar: "Alianza Duna martelé 5 mm".
  if (item.style !== 'clasica' || item.finish === 'pulido') parts.push(STYLE_LABEL[item.style]);
  if (item.style === 'eternity' || item.style === 'media-eternity') parts.push('de diamantes');
  else if (hasDiamonds) parts.push('con diamantes');
  if (FINISH_NAME[item.finish]) parts.push(FINISH_NAME[item.finish]);
  const colors = new Set(
    item.variants.filter((v) => v.metal !== 'PLATINO_950').map((v) => v.goldColor ?? 'amarillo'),
  );
  const onlyGold = item.variants.every((v) => v.metal !== 'PLATINO_950');
  const [color] = colors;
  if (onlyGold && colors.size === 1 && color && color !== 'amarillo') parts.push(`en oro ${color}`);
  parts.push(formatMm(item.widthMm));
  return parts.join(' ');
}

function metalsOf(item: CatalogItem): Metal[] {
  const order: Metal[] = ['ORO_14K', 'ORO_18K', 'PLATINO_950'];
  const present = new Set(item.variants.map((v) => v.metal));
  return order.filter((m) => present.has(m));
}

function diamondsOf(item: CatalogItem): Diamond[] {
  const map = new Map<string, Diamond>();
  for (const v of item.variants) if (v.diamond) map.set(diamondLabel(v.diamond), v.diamond);
  return [...map.values()].sort((a, b) => a.caratTotal - b.caratTotal);
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function buildDescription(item: CatalogItem): {
  description: string;
  descriptionShort: string;
} {
  const metals = metalsOf(item).map((m) => METAL_LABELS[m]);
  const sizes = describeSizes(item.variants.map((v) => v.size));
  const diamonds = diamondsOf(item);
  const finish = FINISH_DESCRIPTION[item.finish];

  const bullets = [
    `<li><strong>Metal:</strong> ${escapeHtml(listJoin(metals))}</li>`,
    `<li><strong>Ancho:</strong> ${formatMm(item.widthMm)}</li>`,
    `<li><strong>Tallas:</strong> ${sizes}</li>`,
    `<li><strong>Acabado:</strong> ${finish}</li>`,
  ];
  if (diamonds.length) {
    bullets.push(
      `<li><strong>Diamantes:</strong> ${escapeHtml(listJoin(diamonds.map(diamondLabel)))}</li>`,
    );
  }
  const description =
    `<p>Alianza ${STYLE_DESCRIPTION[item.style]}, de ${formatMm(item.widthMm)} de ancho y acabado ${finish}.</p>` +
    `<ul>${bullets.join('')}</ul>` +
    '<p>Elige el metal y la talla en el selector. Si tienes dudas con la talla, te ayudamos a medirla.</p>';
  const descriptionShort = `<p>${[
    STYLE_LABEL[item.style],
    formatMm(item.widthMm),
    metals.join(' / '),
  ]
    .map((s, i) => (i === 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s))
    .join(' · ')}</p>`;
  return { description, descriptionShort };
}

const METAL_CODE: Record<Metal, string> = { ORO_14K: '14K', ORO_18K: '18K', PLATINO_950: 'PT' };

function combinationReference(
  reference: string,
  metal: Metal,
  size: number,
  diamond?: Diamond,
): string {
  const d = diamond ? `-D${String(Math.round(diamond.caratTotal * 100)).padStart(3, '0')}` : '';
  return `${reference}-${METAL_CODE[metal]}${d}-${size}`;
}

function imageExtension(source: string): string {
  const path = source.split(/[?#]/)[0] ?? '';
  const ext = extname(path).toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)
    ? ext === '.jpeg'
      ? '.jpg'
      : ext
    : '.jpg';
}

const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

export class SupplierTraceError extends Error {
  override readonly name = 'SupplierTraceError';
  constructor(
    readonly field: string,
    readonly traces: string[],
  ) {
    super(`El campo "${field}" contiene datos del proveedor: ${traces.join(', ')}`);
  }
}

/** Convierte un item del catálogo en la ficha que se publica: textos propios, referencias propias, PVP. */
export async function toListing(item: CatalogItem, ctx: ListingContext): Promise<Listing> {
  const sequence = ctx.references.sequenceFor(item.supplier, item.supplierRef);
  const reference = formatReference(ctx.referencePrefix, sequence);
  const name = commercialName(item, sequence);
  const { description, descriptionShort } = buildDescription(item);

  const priced = await Promise.all(
    item.variants.map(async (v) => ({
      v,
      quote: await ctx.pricing.quote(v.cost, item.currency, item.supplier),
    })),
  );
  const cheapest = Math.min(...priced.map((p) => p.quote.gross));
  const baseTaxExcl = ctx.pricing.taxExclFromGross(cheapest);

  // Combinación por defecto: la más barata y, entre esas, la talla más cercana a la mediana.
  const sizes = [...new Set(item.variants.map((v) => v.size))].sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)] ?? 0;
  const defaultCandidate = priced
    .filter((p) => p.quote.gross === cheapest)
    .sort((a, b) => Math.abs(a.v.size - median) - Math.abs(b.v.size - median))[0];

  const combinations: ListingCombination[] = priced.map(({ v, quote }) => ({
    key: variantKey(v),
    supplierSku: v.supplierSku,
    reference: combinationReference(reference, v.metal, v.size, v.diamond),
    attributes: {
      Metal: METAL_LABELS[v.metal],
      Talla: String(v.size),
      ...(v.diamond ? { Diamante: diamondLabel(v.diamond) } : {}),
    },
    gross: quote.gross,
    taxExcl: quote.taxExcl,
    impactTaxExcl: Math.round((quote.taxExcl - baseTaxExcl) * 1e6) / 1e6,
    stock: v.stock,
    isDefault: v === defaultCandidate?.v,
  }));

  const slug = slugify(name);
  const images = [...new Set(item.images)].map((source, i) => ({
    source,
    fileName: `${slug}-${reference.toLowerCase()}-${i + 1}${imageExtension(source)}`,
  }));

  const listing: Listing = {
    supplier: item.supplier,
    supplierRef: item.supplierRef,
    reference,
    name,
    description,
    descriptionShort,
    category: { key: item.category, name: CATEGORIES[item.category] },
    gross: cheapest,
    taxExcl: baseTaxExcl,
    images,
    combinations,
    contentHash: hash({
      name,
      description,
      descriptionShort,
      category: item.category,
      images: images.map((i) => i.source),
      combinations: combinations.map((c) => [c.key, c.reference]),
    }),
    priceHash: hash(combinations.map((c) => [c.key, c.gross, c.stock])),
  };

  assertNoSupplierTraces(listing, {
    brands: [...(ctx.supplierBrands ?? []), ...(item.brand ? [item.brand] : [])],
    refs: [item.supplierRef, ...item.variants.map((v) => v.supplierSku)],
  });
  return listing;
}

/** Red de seguridad: ningún campo público puede contener la marca o una referencia del proveedor. */
export function assertNoSupplierTraces(listing: Listing, marks: SupplierMarks): void {
  const publicFields: [string, string][] = [
    ['name', listing.name],
    ['description', listing.description],
    ['descriptionShort', listing.descriptionShort],
    ['reference', listing.reference],
    ...listing.images.map((img, i): [string, string] => [`images[${i}]`, img.fileName]),
    ...listing.combinations.map((c): [string, string] => [`combination ${c.key}`, c.reference]),
  ];
  for (const [field, value] of publicFields) {
    const traces = findSupplierTraces(value, marks);
    if (traces.length) throw new SupplierTraceError(field, traces);
  }
}

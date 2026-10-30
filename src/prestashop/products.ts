import { slugify } from '../shared/text.js';
import type { PrestaShopClient } from './client.js';
import { el, langField, type XmlElement } from './xml.js';

/** Datos mínimos de un producto tal y como los publica la integración. */
export interface ProductInput {
  name: string;
  /** HTML permitido. */
  description: string;
  descriptionShort?: string;
  /** Referencia pública (propia de la tienda, nunca la del proveedor). */
  reference: string;
  /** Precio base sin IVA, en EUR. */
  priceTaxExcl: number;
  categoryIds: number[];
  active: boolean;
}

export interface ProductContext {
  idLang: number;
  idShop: number;
  idTaxRulesGroup: number;
}

/** Forma (parcial) de un producto leído con output_format=JSON. */
export interface PsProduct {
  // El Webservice devuelve el id como número en lecturas y como cadena tras un POST.
  id: number | string;
  reference: string;
  price: string;
  active: string;
  id_default_combination: string | number;
  link_rewrite: string | { id: string; value: string }[];
  associations?: {
    combinations?: { id: string }[];
    images?: { id: string }[];
    stock_availables?: { id: string; id_product_attribute: string }[];
  };
}

/**
 * Campos XML de un producto. Solo se envían campos escribibles: el Webservice
 * rechaza los de solo lectura (manufacturer_name, quantity, position_in_category…).
 */
export function buildProductFields(input: ProductInput, ctx: ProductContext): XmlElement[] {
  const [defaultCategory] = input.categoryIds;
  if (defaultCategory === undefined) throw new Error('El producto necesita al menos una categoría');
  const lang = (value: string) => ({ [ctx.idLang]: value });

  return [
    el('id_category_default', defaultCategory),
    el('id_shop_default', ctx.idShop),
    el('id_tax_rules_group', ctx.idTaxRulesGroup),
    el('reference', input.reference),
    el('price', input.priceTaxExcl.toFixed(6)),
    el('active', input.active),
    el('state', 1),
    el('available_for_order', 1),
    el('show_price', 1),
    el('minimal_quantity', 1),
    el('visibility', 'both'),
    el('condition', 'new'),
    langField('name', lang(input.name)),
    langField('link_rewrite', lang(slugify(input.name))),
    langField('description', lang(input.description)),
    langField('description_short', lang(input.descriptionShort ?? '')),
    el('associations', [
      el(
        'categories',
        input.categoryIds.map((id) => el('category', [el('id', id)])),
      ),
    ]),
  ];
}

export async function createProduct(
  client: PrestaShopClient,
  input: ProductInput,
  ctx: ProductContext,
): Promise<PsProduct> {
  return client.create<PsProduct>('products', buildProductFields(input, ctx));
}

export async function findProductByReference(
  client: PrestaShopClient,
  reference: string,
): Promise<PsProduct | undefined> {
  const [found] = await client.list<PsProduct>('products', { filter: { reference }, limit: 1 });
  return found;
}

/** URL pública de la ficha. Funciona con o sin URL amigables. */
export function productUrl(baseUrl: string, idProduct: number, idLang = 1): string {
  return `${baseUrl.replace(/\/+$/, '')}/index.php?controller=product&id_product=${idProduct}&id_lang=${idLang}`;
}

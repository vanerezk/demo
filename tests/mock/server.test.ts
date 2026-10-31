import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockPrestaShop } from '../../src/mock/server.js';
import { parseEntityXml } from '../../src/mock/xml.js';
import { PrestaShopClient } from '../../src/prestashop/client.js';
import { PrestaShopError } from '../../src/prestashop/errors.js';
import {
  createProduct,
  findProductByReference,
  type PsProduct,
} from '../../src/prestashop/products.js';
import { el, toPrestaShopXml } from '../../src/prestashop/xml.js';

const KEY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
const ctx = { idLang: 1, idShop: 1, idTaxRulesGroup: 1 };
const input = {
  name: 'Alianza Alba media caña 4 mm',
  description: '<p>Descripción</p>',
  reference: 'STR-AL-000001',
  priceTaxExcl: 449 / 1.21,
  categoryIds: [2],
  active: true,
};

let mock: MockPrestaShop;
let baseUrl: string;
let client: PrestaShopClient;

beforeAll(async () => {
  mock = new MockPrestaShop({ apiKey: KEY });
  baseUrl = await mock.listen(0);
  client = new PrestaShopClient({ baseUrl, apiKey: KEY, logger: pino({ level: 'silent' }) });
});
afterAll(() => mock.close());

describe('MockPrestaShop with the real client', () => {
  it('grants access to every resource used by the sync', async () => {
    for (const r of [
      'products',
      'combinations',
      'product_options',
      'product_option_values',
      'stock_availables',
      'categories',
      'images',
    ] as const) {
      expect(await client.canAccess(r)).toBe(true);
    }
  });

  it('rejects wrong or malformed keys like PrestaShop', async () => {
    const bad = new PrestaShopClient({
      baseUrl,
      apiKey: 'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ',
      logger: pino({ level: 'silent' }),
    });
    const error = (await bad.list('products').catch((e: unknown) => e)) as PrestaShopError;
    expect(error.status).toBe(401);
    expect(error.details[0]?.code).toBe(20);
  });

  it('creates a product, its stock row, and finds it by reference', async () => {
    const created = await createProduct(client, input, ctx);
    expect(Number(created.id)).toBeGreaterThan(0);
    const found = await findProductByReference(client, 'STR-AL-000001');
    expect(found?.id).toBe(Number(created.id));
    expect(found?.associations?.stock_availables).toEqual([
      expect.objectContaining({ id_product_attribute: '0' }),
    ]);
  });

  it('returns an empty list as []', async () => {
    expect(await findProductByReference(client, 'NO-EXISTE')).toBeUndefined();
  });

  it('serves the product page with the price including VAT', async () => {
    const found = (await findProductByReference(client, 'STR-AL-000001'))!;
    const html = await (
      await fetch(`${baseUrl}/index.php?controller=product&id_product=${found.id}`)
    ).text();
    expect(html).toContain('<h1>Alianza Alba media caña 4 mm</h1>');
    expect(html).toContain('449,00');
  });

  it('refuses read-only fields', async () => {
    const error = (await client
      .create('products', [el('price', 1), el('quantity', 5)])
      .catch((e: unknown) => e)) as PrestaShopError;
    expect(error.status).toBe(400);
    expect(error.message).toContain('"quantity" not writable');
  });

  it('replaces the whole entity on PUT', async () => {
    const found = (await findProductByReference(client, 'STR-AL-000001'))!;
    const updated = await client.update<PsProduct>('products', Number(found.id), [
      el('price', '100'),
      el('reference', 'STR-AL-000001'),
      el('name', [el('language', 'Nuevo', { id: 1 })]),
      el('link_rewrite', [el('language', 'nuevo', { id: 1 })]),
      el('active', 0),
    ]);
    expect(updated.price).toBe('100');
    expect(updated.active).toBe('0');
  });

  it('deletes a product and its stock rows', async () => {
    const found = (await findProductByReference(client, 'STR-AL-000001'))!;
    await client.delete('products', Number(found.id));
    expect(await client.list('stock_availables', { filter: { id_product: found.id } })).toEqual([]);
  });

  it('only allows reading and updating stock', async () => {
    const error = (await client
      .create('stock_availables', [el('quantity', 1)])
      .catch((e: unknown) => e)) as PrestaShopError;
    expect(error.status).toBe(405);
  });

  it('retries the 503s it injects', async () => {
    const flaky = new MockPrestaShop({ apiKey: KEY, failureRate: 0.5 });
    const url = await flaky.listen(0);
    const c = new PrestaShopClient({
      baseUrl: url,
      apiKey: KEY,
      logger: pino({ level: 'silent' }),
      retry: { attempts: 10, baseDelayMs: 1, maxDelayMs: 1 },
    });
    for (let i = 0; i < 5; i++) expect(await c.list('categories', { limit: 1 })).toHaveLength(1);
    await flaky.close();
  });
});

describe('parseEntityXml', () => {
  it('turns write XML into the JSON read shape', () => {
    const xml = toPrestaShopXml('product', [
      el('price', '10.5'),
      el('name', [el('language', 'Alianza & más', { id: 1 })]),
      el('associations', [
        el('categories', [el('category', [el('id', 2)]), el('category', [el('id', 3)])]),
      ]),
    ]);
    expect(parseEntityXml(xml)).toEqual({
      entity: 'product',
      fields: {
        price: '10.5',
        name: [{ id: '1', value: 'Alianza & más' }],
        associations: { categories: [{ id: '2' }, { id: '3' }] },
      },
    });
  });
});

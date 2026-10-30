import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { PrestaShopClient } from '../../src/prestashop/client.js';
import { PrestaShopError } from '../../src/prestashop/errors.js';
import { buildProductFields } from '../../src/prestashop/products.js';

const KEY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';

function makeClient(responses: Response[]) {
  const fetchImpl = vi.fn<typeof fetch>();
  for (const r of responses) fetchImpl.mockResolvedValueOnce(r);
  const client = new PrestaShopClient({
    baseUrl: 'http://shop.test/',
    apiKey: KEY,
    logger: pino({ level: 'silent' }),
    fetchImpl,
    retry: { attempts: 3, baseDelayMs: 1, maxDelayMs: 1, sleep: () => Promise.resolve() },
  });
  return { client, fetchImpl };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('PrestaShopClient', () => {
  it('sends Basic auth and builds filtered JSON list URLs', async () => {
    const { client, fetchImpl } = makeClient([json({ products: [{ id: 7, reference: 'STR-1' }] })]);
    const items = await client.list('products', { filter: { reference: 'STR-1' }, limit: 1 });

    expect(items).toEqual([{ id: 7, reference: 'STR-1' }]);
    const [url, init] = fetchImpl.mock.calls[0]!;
    const parsed = new URL(url instanceof Request ? url.url : url);
    expect(parsed.pathname).toBe('/api/products');
    expect(parsed.searchParams.get('output_format')).toBe('JSON');
    expect(parsed.searchParams.get('filter[reference]')).toBe('[STR-1]');
    expect(parsed.searchParams.get('display')).toBe('full');
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from(`${KEY}:`).toString('base64')}`,
    );
  });

  it('treats the empty-array response as an empty list', async () => {
    const { client } = makeClient([json([])]);
    await expect(client.list('products')).resolves.toEqual([]);
  });

  it('posts XML and returns the created entity', async () => {
    const { client, fetchImpl } = makeClient([json({ product: { id: '21' } }, 201)]);
    const fields = buildProductFields(
      {
        name: 'Alianza Ñandú',
        description: '<p>x</p>',
        reference: 'STR-AL-000001',
        priceTaxExcl: 100,
        categoryIds: [2],
        active: true,
      },
      { idLang: 1, idShop: 1, idTaxRulesGroup: 1 },
    );
    const created = await client.create<{ id: string }>('products', fields);

    expect(created.id).toBe('21');
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init?.method).toBe('POST');
    const body = init?.body as string;
    expect(body).toContain('<product>');
    expect(body).toContain(
      '<link_rewrite><language id="1"><![CDATA[alianza-nandu]]></language></link_rewrite>',
    );
    expect(body).toContain('<price><![CDATA[100.000000]]></price>');
    expect(body).toContain('<categories><category><id><![CDATA[2]]></id></category></categories>');
  });

  it('retries transient 5xx responses', async () => {
    const { client, fetchImpl } = makeClient([
      new Response('Service Unavailable', { status: 503 }),
      json({ product: { id: 3 } }),
    ]);
    await expect(client.get('products', 3)).resolves.toEqual({ id: 3 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry validation errors and surfaces the PrestaShop message', async () => {
    const { client, fetchImpl } = makeClient([
      json({ errors: [{ code: 85, message: 'Validation error: "price"' }] }, 500),
    ]);
    const error = await client.get('products', 1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PrestaShopError);
    expect((error as PrestaShopError).message).toContain('[85] Validation error');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('accepts 500 responses that only carry PHP notices', async () => {
    const { client } = makeClient([
      json(
        {
          product: { id: 20 },
          errors: [{ code: 5, message: '[PHP Notice #8] Undefined offset: 2' }],
        },
        500,
      ),
    ]);
    await expect(client.get('products', 20)).resolves.toEqual({ id: 20 });
  });

  it('reports missing permissions in canAccess', async () => {
    const { client } = makeClient([new Response('', { status: 401 })]);
    await expect(client.canAccess('images')).resolves.toBe(false);
  });
});

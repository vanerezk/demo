import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { langValue, MockStore, type Entity } from './store.js';
import { parseEntityXml } from './xml.js';

/**
 * Simulador del Webservice de PrestaShop 1.7.8 para probar la integración sin Docker.
 *
 * Reproduce lo que usa catalog-sync con el mismo comportamiento observable que la tienda real:
 * autenticación Basic, lecturas JSON, escrituras XML, `[]` en listas vacías, errores con
 * código, campos de solo lectura, el stock_available que crea cada producto y el HTTP 500
 * "solo con notices" de los productos sin imagen. No pretende ser PrestaShop: es un doble
 * de pruebas fiel a su contrato.
 */
export interface MockOptions {
  apiKey: string;
  /** Fichero JSON donde persistir los datos entre reinicios. */
  dataFile?: string;
  /** Reproduce los HTTP 500 por notices de PHP en productos sin imagen (por defecto, sí). */
  notices?: boolean;
  /** Probabilidad (0–1) de responder 503 para ver los reintentos en acción. */
  failureRate?: number;
  vatPct?: number;
}

interface ResourceDef {
  entity: string;
  methods: ('GET' | 'POST' | 'PUT' | 'DELETE')[];
  required: string[];
  readOnly: string[];
  defaults: () => Record<string, unknown>;
  afterCreate?: (e: Entity, store: MockStore) => void;
  afterDelete?: (e: Entity, store: MockStore) => void;
  /** Campos calculados en lectura, como hace PrestaShop con las asociaciones. */
  decorate?: (e: Entity, store: MockStore) => Entity;
}

const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

function createStock(store: MockStore, idProduct: number, idProductAttribute: number): void {
  store.insert('stock_availables', {
    id_product: String(idProduct),
    id_product_attribute: String(idProductAttribute),
    id_shop: '1',
    id_shop_group: '0',
    quantity: '0',
    depends_on_stock: '0',
    out_of_stock: '2',
    location: '',
  });
}

const RESOURCES: Record<string, ResourceDef | undefined> = {
  products: {
    entity: 'product',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    required: ['price', 'name', 'link_rewrite'],
    readOnly: ['manufacturer_name', 'quantity'],
    defaults: () => ({
      id_manufacturer: '0',
      id_supplier: '0',
      id_category_default: '2',
      id_default_image: '',
      id_default_combination: 0,
      id_tax_rules_group: '1',
      reference: '',
      supplier_reference: '',
      active: '1',
      state: '1',
      price: '0.000000',
      visibility: 'both',
      available_for_order: '1',
      show_price: '1',
      minimal_quantity: '1',
      condition: 'new',
      description: [],
      description_short: [],
      date_add: now(),
      date_upd: now(),
    }),
    afterCreate: (e, store) => {
      createStock(store, e.id, 0);
    },
    afterDelete: (e, store) => {
      for (const s of store.all('stock_availables'))
        if (s.id_product === String(e.id)) store.remove('stock_availables', s.id);
      for (const c of store.all('combinations'))
        if (c.id_product === String(e.id)) store.remove('combinations', c.id);
    },
    decorate: (e, store) => {
      const pid = String(e.id);
      const combinations = store.all('combinations').filter((c) => c.id_product === pid);
      const images = [...store.files.keys()]
        .filter((k) => k.startsWith(`products/${pid}/`))
        .map((k) => ({ id: k.split('/')[2] ?? '' }));
      const defaultCombination = combinations.find((c) => c.default_on === '1');
      return {
        ...e,
        id_default_combination: defaultCombination ? defaultCombination.id : 0,
        id_default_image: images[0]?.id ?? '',
        associations: {
          ...(e.associations ?? {}),
          ...(combinations.length
            ? { combinations: combinations.map((c) => ({ id: String(c.id) })) }
            : {}),
          ...(images.length ? { images } : {}),
          stock_availables: store
            .all('stock_availables')
            .filter((s) => s.id_product === pid)
            .map((s) => ({
              id: String(s.id),
              id_product_attribute: s.id_product_attribute as string,
            })),
        },
      };
    },
  },
  combinations: {
    entity: 'combination',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    required: ['id_product', 'minimal_quantity'],
    readOnly: [],
    defaults: () => ({ reference: '', price: '0.000000', default_on: '', minimal_quantity: '1' }),
    afterCreate: (e, store) => {
      createStock(store, Number(e.id_product), e.id);
    },
    afterDelete: (e, store) => {
      for (const s of store.all('stock_availables'))
        if (s.id_product_attribute === String(e.id)) store.remove('stock_availables', s.id);
    },
  },
  product_options: {
    entity: 'product_option',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    required: ['name', 'public_name', 'group_type'],
    readOnly: [],
    defaults: () => ({ is_color_group: '0', position: '0' }),
  },
  product_option_values: {
    entity: 'product_option_value',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    required: ['id_attribute_group', 'name'],
    readOnly: [],
    defaults: () => ({ color: '', position: '0' }),
  },
  stock_availables: {
    entity: 'stock_available',
    // Como en PrestaShop: el stock se crea solo; por Webservice únicamente se lee y se actualiza.
    methods: ['GET', 'PUT'],
    required: ['id_product', 'id_product_attribute', 'quantity'],
    readOnly: [],
    defaults: () => ({}),
  },
  categories: {
    entity: 'category',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    required: ['name', 'link_rewrite', 'active'],
    readOnly: [],
    defaults: () => ({ id_parent: '2', active: '1', is_root_category: '0', description: [] }),
  },
};

const PRODUCTS = RESOURCES.products as ResourceDef;

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

export class MockPrestaShop {
  readonly store: MockStore;
  private readonly server: Server;

  constructor(private readonly opts: MockOptions) {
    this.store = new MockStore(opts.dataFile);
    this.seed();
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((error: unknown) => {
        const e = error instanceof HttpError ? error : new HttpError(500, 0, String(error));
        this.sendJson(res, e.status, { errors: [{ code: e.code, message: e.message }] });
      });
    });
  }

  /** Escucha en todas las interfaces (IPv4 e IPv6), así "localhost" funciona en cualquier sistema. */
  listen(port: number): Promise<string> {
    return new Promise((resolve) => {
      this.server.listen(port, () => {
        const address = this.server.address();
        const actualPort = typeof address === 'object' && address ? address.port : port;
        resolve(`http://localhost:${actualPort}`);
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private seed(): void {
    if (this.store.all('categories').length) return;
    const lang = (v: string) => [{ id: '1', value: v }];
    this.store.insert('categories', {
      id: 1,
      id_parent: '0',
      active: '1',
      is_root_category: '0',
      name: lang('Raíz'),
      link_rewrite: lang('raiz'),
    });
    this.store.insert('categories', {
      id: 2,
      id_parent: '1',
      active: '1',
      is_root_category: '1',
      name: lang('Inicio'),
      link_rewrite: lang('inicio'),
    });
  }

  // ---------------------------------------------------------------------------

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://mock');
    if (!url.pathname.startsWith('/api')) {
      this.storefront(url, res);
      return;
    }

    this.authenticate(req, url);
    if (this.opts.failureRate && Math.random() < this.opts.failureRate) {
      res.writeHead(503, { 'Content-Type': 'text/html' }).end('<h1>503 Service Unavailable</h1>');
      return;
    }

    const [, , resource, rawId] = url.pathname.split('/');
    const method = (req.method ?? 'GET').toUpperCase();
    if (!resource) {
      this.sendJson(res, 200, {
        api: Object.fromEntries(Object.keys(RESOURCES).map((r) => [r, {}])),
      });
      return;
    }

    if (resource === 'images') {
      // Fase 3: subida de imágenes. De momento solo se valida el acceso.
      if (method === 'HEAD') return void res.writeHead(200).end();
      throw new HttpError(405, 0, 'Método no implementado en el simulador para images');
    }
    const def = RESOURCES[resource];
    if (!def) throw new HttpError(400, 22, `Resource of type "${resource}" does not exists`);
    if (method === 'HEAD') return void res.writeHead(200).end();
    if (!def.methods.includes(method as ResourceDef['methods'][number])) {
      throw new HttpError(405, 101, `Method ${method} is not allowed for the resource ${resource}`);
    }

    const id = rawId ? Number(rawId) : undefined;
    if (rawId && !Number.isInteger(id)) throw new HttpError(400, 0, `Id no válido: ${rawId}`);

    switch (method) {
      case 'GET':
        if (id === undefined) this.list(resource, def, url, res);
        else this.getOne(resource, def, id, res);
        return;
      case 'POST':
        if (id !== undefined) throw new HttpError(405, 0, 'POST no admite id');
        {
          this.create(resource, def, await readBody(req), res);
          return;
        }
      case 'PUT':
        if (id === undefined) throw new HttpError(400, 0, 'PUT requiere id');
        {
          this.update(resource, def, id, await readBody(req), res);
          return;
        }
      case 'DELETE': {
        const existing = id === undefined ? undefined : this.store.get(resource, id);
        if (!existing || id === undefined)
          throw new HttpError(404, 0, `No ${def.entity} with id ${rawId ?? ''}`);
        this.store.remove(resource, id);
        def.afterDelete?.(existing, this.store);
        return void res.writeHead(200).end();
      }
    }
  }

  private authenticate(req: IncomingMessage, url: URL): void {
    const header = req.headers.authorization ?? '';
    const fromHeader = header.startsWith('Basic ')
      ? Buffer.from(header.slice(6), 'base64').toString().split(':')[0]
      : undefined;
    const key = fromHeader ?? url.searchParams.get('ws_key') ?? '';
    if (!key) throw new HttpError(401, 17, 'Authentication key is empty');
    if (!/^[A-Z0-9]{32}$/.test(key))
      throw new HttpError(401, 18, 'Invalid authentication key format');
    if (key !== this.opts.apiKey)
      throw new HttpError(401, 20, 'Authentification key is not active');
  }

  private view(def: ResourceDef, e: Entity): Entity {
    return def.decorate ? def.decorate(e, this.store) : e;
  }

  private list(resource: string, def: ResourceDef, url: URL, res: ServerResponse): void {
    let rows = this.store.all(resource).map((e) => this.view(def, e));
    for (const [param, value] of url.searchParams) {
      const field = /^filter\[(\w+)\]$/.exec(param)?.[1];
      if (!field) continue;
      const wanted = value.replace(/^\[|\]$/g, '').split('|');
      rows = rows.filter((e) =>
        wanted.includes(field === 'id' ? String(e.id) : langValue(e[field])),
      );
    }
    const limit = url.searchParams.get('limit');
    if (limit) {
      const [a, b] = limit.split(',').map(Number);
      rows = b === undefined ? rows.slice(0, a) : rows.slice(a, (a ?? 0) + b);
    }
    if (!rows.length) {
      this.sendJson(res, 200, []);
      return;
    }

    const display = url.searchParams.get('display');
    const fields =
      display === 'full'
        ? undefined
        : display
          ? display.replace(/^\[|\]$/g, '').split(',')
          : ['id'];
    const shaped = fields
      ? rows.map((e) => Object.fromEntries(fields.map((f) => [f, e[f]])))
      : rows;
    const status =
      display === 'full' && resource === 'products'
        ? this.noticeStatus(rows)
        : { code: 200, extra: {} };
    this.sendJson(res, status.code, { [resource]: shaped, ...status.extra });
  }

  private getOne(resource: string, def: ResourceDef, id: number, res: ServerResponse): void {
    const e = this.store.get(resource, id);
    if (!e) throw new HttpError(404, 0, `There is no ${def.entity} with id ${id}`);
    const view = this.view(def, e);
    const status = resource === 'products' ? this.noticeStatus([view]) : { code: 200, extra: {} };
    this.sendJson(res, status.code, { [def.entity]: view, ...status.extra });
  }

  private create(resource: string, def: ResourceDef, body: string, res: ServerResponse): void {
    const fields = this.parseBody(def, body);
    // PrestaShop real responde aquí con un warning de PHP poco útil; el simulador da un error claro.
    for (const req of def.required) {
      if (!(req in fields) || langValue(fields[req]) === '') {
        throw new HttpError(400, 41, `parameter "${req}" required`);
      }
    }
    const created = this.store.insert(resource, {
      ...def.defaults(),
      ...fields,
      id: undefined,
    } as Omit<Entity, 'id'>);
    def.afterCreate?.(created, this.store);
    const view = this.view(def, created);
    const status = resource === 'products' ? this.noticeStatus([view]) : { code: 201, extra: {} };
    this.sendJson(res, status.code === 200 ? 201 : status.code, {
      [def.entity]: view,
      ...status.extra,
    });
  }

  private update(
    resource: string,
    def: ResourceDef,
    id: number,
    body: string,
    res: ServerResponse,
  ): void {
    const existing = this.store.get(resource, id);
    if (!existing) throw new HttpError(404, 0, `There is no ${def.entity} with id ${id}`);
    const fields = this.parseBody(def, body);
    if (fields.id !== undefined && Number(fields.id) !== id)
      throw new HttpError(400, 90, 'id is invalid');
    // PUT reemplaza el objeto: lo que no se envía vuelve a su valor por defecto.
    const replaced = this.store.replace(resource, {
      ...def.defaults(),
      ...pick(existing, [
        'date_add',
        'id_product',
        'id_product_attribute',
        'id_shop',
        'id_shop_group',
      ]),
      ...fields,
      date_upd: now(),
      id,
    });
    const view = this.view(def, replaced);
    const status = resource === 'products' ? this.noticeStatus([view]) : { code: 200, extra: {} };
    this.sendJson(res, status.code, { [def.entity]: view, ...status.extra });
  }

  private parseBody(def: ResourceDef, body: string): Record<string, unknown> {
    let parsed: ReturnType<typeof parseEntityXml>;
    try {
      parsed = parseEntityXml(body);
    } catch (error) {
      throw new HttpError(400, 127, `XML error: ${(error as Error).message}`);
    }
    if (parsed.entity !== def.entity)
      throw new HttpError(400, 127, `XML error: se esperaba <${def.entity}>`);
    for (const field of def.readOnly) {
      if (field in parsed.fields) {
        throw new HttpError(
          400,
          93,
          `parameter "${field}" not writable. Please remove this attribute of this XML`,
        );
      }
    }
    if ('price' in parsed.fields && Number.isNaN(Number(parsed.fields.price))) {
      throw new HttpError(500, 85, 'Validation error: "Property Product->price is not valid"');
    }
    return parsed.fields;
  }

  /** PrestaShop 1.7.8 + PHP 7.4: un producto sin imagen provoca un notice y un HTTP 500. */
  private noticeStatus(products: Entity[]): { code: number; extra: Record<string, unknown> } {
    if (this.opts.notices === false || products.every((p) => p.id_default_image !== ''))
      return { code: 200, extra: {} };
    return {
      code: 500,
      extra: {
        errors: [
          {
            code: 5,
            message:
              '[PHP Notice #8] Trying to access array offset on value of type bool (/var/www/html/classes/Product.php, line 7178)',
          },
        ],
      },
    };
  }

  private sendJson(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'PSWS-Version': '1.7.8.11',
    });
    res.end(JSON.stringify(body));
  }

  // --- Escaparate mínimo para comprobar el resultado ------------------------

  private storefront(url: URL, res: ServerResponse): void {
    const vat = 1 + (this.opts.vatPct ?? 21) / 100;
    const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
    const productId = Number(url.searchParams.get('id_product'));
    const products = this.store.all('products').map((p) => this.view(PRODUCTS, p));
    let body: string;
    if (url.searchParams.get('controller') === 'product' && productId) {
      const p = products.find((x) => x.id === productId);
      if (!p || p.active !== '1') {
        res
          .writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
          .end(page('No encontrado', '<p>Este producto no está disponible.</p>'));
        return;
      }
      const base = Number(p.price);
      const combos = this.store.all('combinations').filter((c) => c.id_product === String(p.id));
      const rows = combos
        .map(
          (c) =>
            `<tr><td>${esc(String(c.reference))}</td><td>${eur.format(Math.round((base + Number(c.price)) * vat * 100) / 100)}</td></tr>`,
        )
        .join('');
      body =
        `<p class="ref">Referencia: ${esc(String(p.reference))}</p>` +
        `<p class="price">${eur.format(Math.round(base * vat * 100) / 100)} <small>IVA incluido</small></p>` +
        `<div>${langValue(p.description_short)}</div><div>${langValue(p.description)}</div>` +
        (rows ? `<table><tr><th>Combinación</th><th>PVP</th></tr>${rows}</table>` : '');
      res
        .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        .end(page(langValue(p.name), body));
      return;
    }
    const items = products
      .filter((p) => p.active === '1')
      .map(
        (p) =>
          `<li><a href="/index.php?controller=product&id_product=${p.id}">${esc(langValue(p.name))}</a></li>`,
      )
      .join('');
    res
      .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      .end(
        page('Tienda (simulador)', items ? `<ul>${items}</ul>` : '<p>Aún no hay productos.</p>'),
      );
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function page(title: string, body: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 16px;color:#222}h1{font-weight:500}.price{font-size:1.6rem}.ref{color:#777}table{border-collapse:collapse}td,th{padding:4px 12px;border-bottom:1px solid #ddd;text-align:left}.banner{background:#fff4d6;padding:6px 12px;border-radius:6px;font-size:.85rem}</style>
</head><body><p class="banner">Simulador del Webservice de PrestaShop · catalog-sync</p><h1>${esc(title)}</h1>${body}</body></html>`;
}

function pick(e: Entity, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((k) => k in e).map((k) => [k, e[k]]));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

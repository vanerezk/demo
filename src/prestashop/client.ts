import type { Logger } from '../shared/logger.js';
import { defaultRetry, withRetry, type RetryOptions } from '../shared/retry.js';
import {
  PrestaShopError,
  isNoticeOnlyFailure,
  isRetryableError,
  parseErrorBody,
} from './errors.js';
import { toPrestaShopXml, type XmlElement } from './xml.js';

/** Recursos del Webservice que usa la integración, con el nombre de su entidad en XML/JSON. */
export const RESOURCES = {
  products: 'product',
  combinations: 'combination',
  product_options: 'product_option',
  product_option_values: 'product_option_value',
  stock_availables: 'stock_available',
  categories: 'category',
} as const;

export type Resource = keyof typeof RESOURCES;

export interface ListOptions {
  /** Filtro exacto por campo: { reference: 'STR-AL-000001' } -> filter[reference]=[STR-AL-000001] */
  filter?: Record<string, string | number>;
  /** 'full' o lista de campos. Por defecto, 'full'. */
  display?: 'full' | string[];
  limit?: number;
  sort?: string;
}

export interface PrestaShopClientOptions {
  baseUrl: string;
  apiKey: string;
  logger: Logger;
  retry?: RetryOptions;
  fetchImpl?: typeof fetch;
  /** Timeout por petición en ms. */
  timeoutMs?: number;
}

interface RequestOptions {
  query?: URLSearchParams;
  body?: string | Blob | FormData;
  contentType?: string;
}

/**
 * Cliente del Webservice de PrestaShop 1.7.
 *
 * - Autenticación Basic con la clave de API como usuario y contraseña vacía.
 * - Lecturas con output_format=JSON.
 * - Escrituras en XML (lo único que acepta el Webservice), pidiendo la respuesta en JSON.
 * - Reintentos con espera exponencial ante 5xx transitorios y errores de red.
 */
export class PrestaShopClient {
  private readonly apiRoot: string;
  private readonly authHeader: string;
  private readonly fetchImpl: typeof fetch;
  private readonly retry: RetryOptions;
  private readonly timeoutMs: number;
  private readonly log: Logger;

  constructor(opts: PrestaShopClientOptions) {
    this.apiRoot = `${opts.baseUrl.replace(/\/+$/, '')}/api`;
    this.authHeader = `Basic ${Buffer.from(`${opts.apiKey}:`).toString('base64')}`;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.retry = opts.retry ?? defaultRetry;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.log = opts.logger.child({ component: 'prestashop' });
  }

  /** Lista entidades de un recurso. El Webservice devuelve `[]` (no un objeto) cuando no hay resultados. */
  async list<T>(resource: Resource, opts: ListOptions = {}): Promise<T[]> {
    const query = new URLSearchParams({ output_format: 'JSON' });
    const display = opts.display ?? 'full';
    query.set('display', display === 'full' ? 'full' : `[${display.join(',')}]`);
    for (const [field, value] of Object.entries(opts.filter ?? {})) {
      query.set(`filter[${field}]`, `[${String(value)}]`);
    }
    if (opts.limit !== undefined) query.set('limit', String(opts.limit));
    if (opts.sort) query.set('sort', `[${opts.sort}]`);

    const json = await this.requestJson('GET', resource, { query });
    if (Array.isArray(json)) return [];
    const items = (json as Record<string, unknown>)[resource];
    return Array.isArray(items) ? (items as T[]) : [];
  }

  async get<T>(resource: Resource, id: number): Promise<T> {
    const json = await this.requestJson('GET', `${resource}/${id}`, {
      query: new URLSearchParams({ output_format: 'JSON' }),
    });
    return (json as Record<string, T>)[RESOURCES[resource]] as T;
  }

  /** Crea una entidad y devuelve la entidad creada (con su id). */
  async create<T extends { id: number | string }>(
    resource: Resource,
    fields: XmlElement[],
  ): Promise<T> {
    const json = await this.requestJson('POST', resource, {
      query: new URLSearchParams({ output_format: 'JSON' }),
      body: toPrestaShopXml(RESOURCES[resource], fields),
      contentType: 'application/xml',
    });
    return (json as Record<string, T>)[RESOURCES[resource]] as T;
  }

  /**
   * Actualiza una entidad. El PUT del Webservice reemplaza el objeto completo, así que
   * `fields` debe incluir todos los campos que se quieren conservar (y el id).
   */
  async update<T>(resource: Resource, id: number, fields: XmlElement[]): Promise<T> {
    const json = await this.requestJson('PUT', `${resource}/${id}`, {
      query: new URLSearchParams({ output_format: 'JSON' }),
      body: toPrestaShopXml(RESOURCES[resource], [
        { name: 'id', content: id },
        ...fields.filter((f) => f.name !== 'id'),
      ]),
      contentType: 'application/xml',
    });
    return (json as Record<string, T>)[RESOURCES[resource]] as T;
  }

  async delete(resource: Resource, id: number): Promise<void> {
    await this.request('DELETE', `${resource}/${id}`);
  }

  /** Comprueba que la clave tiene acceso a un recurso (HEAD devuelve 200 o 401). */
  async canAccess(resource: Resource | 'images'): Promise<boolean> {
    try {
      await this.request('HEAD', resource);
      return true;
    } catch (error) {
      if (error instanceof PrestaShopError && (error.status === 401 || error.status === 403))
        return false;
      throw error;
    }
  }

  // ---------------------------------------------------------------------------

  private async requestJson(
    method: string,
    path: string,
    opts: RequestOptions = {},
  ): Promise<unknown> {
    const text = await this.request(method, path, opts);
    if (!text.trim()) return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new PrestaShopError(
        method,
        path,
        200,
        [{ message: 'Respuesta no es JSON válido' }],
        text,
      );
    }
  }

  protected async request(
    method: string,
    path: string,
    opts: RequestOptions = {},
  ): Promise<string> {
    const url = `${this.apiRoot}/${path}${opts.query ? `?${opts.query.toString()}` : ''}`;
    return withRetry(
      async (attempt) => {
        const started = Date.now();
        const headers: Record<string, string> = { Authorization: this.authHeader };
        if (opts.contentType) headers['Content-Type'] = opts.contentType;
        const res = await this.fetchImpl(url, {
          method,
          headers,
          ...(opts.body !== undefined ? { body: opts.body } : {}),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        const body = await res.text();
        this.log.debug(
          { method, path, status: res.status, ms: Date.now() - started, attempt },
          'webservice',
        );
        if (res.ok) return body;
        const details = parseErrorBody(body);
        if (isNoticeOnlyFailure(res.status, details, body)) {
          this.log.warn(
            { method, path, notices: details.map((d) => d.message) },
            'PrestaShop devolvió 500 solo por notices de PHP; se acepta la respuesta',
          );
          return body;
        }
        throw new PrestaShopError(method, path, res.status, details, body);
      },
      isRetryableError,
      {
        ...this.retry,
        onRetry: ({ attempt, delayMs, error }) => {
          this.log.warn(
            {
              method,
              path,
              attempt,
              delayMs,
              err: error instanceof Error ? error.message : String(error),
            },
            'Fallo transitorio en el Webservice, reintentando',
          );
        },
      },
    );
  }
}

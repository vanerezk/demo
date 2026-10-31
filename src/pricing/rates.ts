import type { Currency } from '../domain/model.js';

/** Fuente de tipos de cambio. Devuelve cuántos EUR vale 1 unidad de `from`. */
export interface ExchangeRateProvider {
  readonly name: string;
  toEur(from: Currency): Promise<number>;
}

/** Tasa fija definida en .env (p. ej. USD_EUR_RATE=0.92). Es la opción por defecto. */
export class FixedRateProvider implements ExchangeRateProvider {
  readonly name = 'fixed';

  constructor(private readonly rates: Partial<Record<Currency, number>>) {}

  toEur(from: Currency): Promise<number> {
    if (from === 'EUR') return Promise.resolve(1);
    const rate = this.rates[from];
    if (rate === undefined || !(rate > 0)) {
      return Promise.reject(new Error(`No hay tipo de cambio configurado para ${from} -> EUR`));
    }
    return Promise.resolve(rate);
  }
}

/**
 * Punto de extensión para un tipo de cambio en vivo. Ejemplo con la API pública del BCE
 * vía Frankfurter (`EXCHANGE_RATE_SOURCE=ecb`). Cachea la tasa durante `ttlMs` para que un
 * lote de sincronización use siempre la misma y no dependa de la API producto a producto.
 */
export class HttpRateProvider implements ExchangeRateProvider {
  readonly name = 'ecb';
  private cache = new Map<Currency, { rate: number; at: number }>();

  constructor(
    private readonly opts: {
      baseUrl?: string;
      ttlMs?: number;
      fetchImpl?: typeof fetch;
      /** Si la API falla, se usa esta tasa (normalmente la fija de .env). */
      fallback?: ExchangeRateProvider;
    } = {},
  ) {}

  async toEur(from: Currency): Promise<number> {
    if (from === 'EUR') return 1;
    const cached = this.cache.get(from);
    if (cached && Date.now() - cached.at < (this.opts.ttlMs ?? 3_600_000)) return cached.rate;
    try {
      const base = this.opts.baseUrl ?? 'https://api.frankfurter.app';
      const res = await (this.opts.fetchImpl ?? fetch)(`${base}/latest?from=${from}&to=EUR`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { rates?: { EUR?: number } };
      const rate = json.rates?.EUR;
      if (!rate || rate <= 0) throw new Error('Respuesta sin tasa EUR');
      this.cache.set(from, { rate, at: Date.now() });
      return rate;
    } catch (error) {
      if (this.opts.fallback) return this.opts.fallback.toEur(from);
      throw error;
    }
  }
}

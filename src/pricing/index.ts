import { z } from 'zod';
import { PriceCalculator } from './calculator.js';
import { FixedRateProvider, HttpRateProvider, type ExchangeRateProvider } from './rates.js';
import { ROUNDING_MODES } from './rounding.js';

const pricingEnv = z.object({
  EXCHANGE_RATE_SOURCE: z.enum(['fixed', 'ecb']).default('fixed'),
  USD_EUR_RATE: z.coerce.number().positive().default(0.92),
  VAT_PCT: z.coerce.number().min(0).max(100).default(21),
  PRICE_ROUNDING: z.enum(ROUNDING_MODES).default('ends-in-9'),
  DEFAULT_MARGIN_PCT: z.coerce.number().min(0).default(100),
});

/** Márgenes por proveedor: SUPPLIER_<ID>_MARGIN_PCT (p. ej. SUPPLIER_A_MARGIN_PCT=90). */
function marginsFromEnv(env: NodeJS.ProcessEnv): Record<string, number> {
  const margins: Record<string, number> = {};
  for (const [key, value] of Object.entries(env)) {
    const m = /^SUPPLIER_([A-Z0-9]+)_MARGIN_PCT$/.exec(key);
    if (m?.[1] && value !== undefined && value !== '') {
      const pct = Number(value);
      if (!Number.isFinite(pct) || pct < 0) throw new Error(`${key} debe ser un número >= 0`);
      margins[m[1].toLowerCase()] = pct;
    }
  }
  return margins;
}

export function createPriceCalculator(env: NodeJS.ProcessEnv = process.env): PriceCalculator {
  const cfg = pricingEnv.parse(env);
  const fixed = new FixedRateProvider({ USD: cfg.USD_EUR_RATE });
  const rates: ExchangeRateProvider =
    cfg.EXCHANGE_RATE_SOURCE === 'ecb' ? new HttpRateProvider({ fallback: fixed }) : fixed;
  return new PriceCalculator(rates, {
    vatPct: cfg.VAT_PCT,
    rounding: cfg.PRICE_ROUNDING,
    defaultMarginPct: cfg.DEFAULT_MARGIN_PCT,
    marginPctBySupplier: marginsFromEnv(env),
  });
}

export { PriceCalculator, type PriceQuote, type PricingRules } from './calculator.js';
export { FixedRateProvider, HttpRateProvider, type ExchangeRateProvider } from './rates.js';
export { roundCommercial, ROUNDING_MODES, type RoundingMode } from './rounding.js';

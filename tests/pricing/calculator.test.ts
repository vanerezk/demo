import { describe, expect, it, vi } from 'vitest';
import {
  createPriceCalculator,
  FixedRateProvider,
  HttpRateProvider,
  PriceCalculator,
} from '../../src/pricing/index.js';

const calculator = (rounding: 'none' | 'integer' | 'ends-in-9' = 'ends-in-9') =>
  new PriceCalculator(new FixedRateProvider({ USD: 0.92 }), {
    vatPct: 21,
    rounding,
    defaultMarginPct: 100,
    marginPctBySupplier: { a: 90, b: 80 },
  });

describe('PriceCalculator', () => {
  it('converts USD, applies the supplier margin and VAT, then rounds', async () => {
    // 389 USD × 0,92 = 357,88 € · ×1,90 = 679,972 · ×1,21 = 822,77 € -> 829,00 €
    const q = await calculator().quote(389, 'USD', 'a');
    expect(q.costEur).toBe(357.88);
    expect(q.marginPct).toBe(90);
    expect(q.gross).toBe(829);
    expect(q.taxExcl).toBe(685.123967);
  });

  it('keeps EUR costs unconverted', async () => {
    // 498 € × 1,80 × 1,21 = 1084,64 € -> 1089,00 €
    const q = await calculator().quote(498, 'EUR', 'b');
    expect(q.rate).toBe(1);
    expect(q.gross).toBe(1089);
  });

  it('uses the default margin for unknown suppliers (manual entries)', async () => {
    const q = await calculator('none').quote(100, 'EUR', 'manual');
    expect(q.marginPct).toBe(100);
    expect(q.gross).toBe(242);
  });

  it('stores a tax-excluded price that PrestaShop turns back into the exact rounded PVP', () => {
    const calc = calculator();
    for (let euros = 1; euros <= 5000; euros++) {
      const taxExcl = calc.taxExclFromGross(euros);
      expect(Math.round(taxExcl * 1.21 * 100) / 100).toBe(euros);
    }
  });

  it('rejects non-positive costs', async () => {
    await expect(calculator().quote(0, 'EUR', 'b')).rejects.toThrow(/coste no válido/);
  });
});

describe('rate providers', () => {
  it('fails clearly when a currency has no configured rate', async () => {
    await expect(new FixedRateProvider({}).toEur('USD')).rejects.toThrow(/USD -> EUR/);
  });

  it('fetches, caches and falls back for live rates', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ rates: { EUR: 0.9 } })));
    const provider = new HttpRateProvider({
      fetchImpl,
      fallback: new FixedRateProvider({ USD: 0.92 }),
    });
    expect(await provider.toEur('USD')).toBe(0.9);
    expect(await provider.toEur('USD')).toBe(0.9);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const failing = new HttpRateProvider({
      fetchImpl: () => Promise.reject(new TypeError('offline')),
      fallback: new FixedRateProvider({ USD: 0.92 }),
    });
    expect(await failing.toEur('USD')).toBe(0.92);
  });
});

describe('createPriceCalculator', () => {
  it('reads per-supplier margins and rounding from the environment', async () => {
    const calc = createPriceCalculator({
      USD_EUR_RATE: '1',
      VAT_PCT: '0',
      PRICE_ROUNDING: 'none',
      SUPPLIER_A_MARGIN_PCT: '50',
    });
    expect(calc.marginFor('a')).toBe(50);
    expect((await calc.quote(100, 'USD', 'a')).gross).toBe(150);
  });

  it('rejects invalid margins', () => {
    expect(() => createPriceCalculator({ SUPPLIER_A_MARGIN_PCT: 'mucho' })).toThrow(
      /SUPPLIER_A_MARGIN_PCT/,
    );
  });
});

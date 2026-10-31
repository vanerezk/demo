import type { Currency } from '../domain/model.js';
import type { ExchangeRateProvider } from './rates.js';
import { roundCommercial, type RoundingMode } from './rounding.js';

export interface PricingRules {
  /** IVA en tanto por ciento (21 en España). */
  vatPct: number;
  /** Margen (markup) sobre coste por proveedor, en %. 100 = el doble del coste. */
  marginPctBySupplier: Record<string, number>;
  /** Margen si el proveedor no tiene uno propio (p. ej. altas manuales). */
  defaultMarginPct: number;
  rounding: RoundingMode;
}

export interface PriceQuote {
  currency: Currency;
  cost: number;
  rate: number;
  costEur: number;
  marginPct: number;
  /** PVP con IVA, ya redondeado comercialmente. Es lo que verá el cliente. */
  gross: number;
  /**
   * Base imponible con 6 decimales, que es lo que guarda PrestaShop.
   * Con 2 decimales, 449 € / 1,21 = 371,07 y la tienda mostraría 448,99 €.
   */
  taxExcl: number;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export class PriceCalculator {
  constructor(
    private readonly rates: ExchangeRateProvider,
    private readonly rules: PricingRules,
  ) {
    if (rules.vatPct < 0) throw new Error('El IVA no puede ser negativo');
  }

  get vatPct(): number {
    return this.rules.vatPct;
  }

  marginFor(supplier: string): number {
    return this.rules.marginPctBySupplier[supplier] ?? this.rules.defaultMarginPct;
  }

  async quote(cost: number, currency: Currency, supplier: string): Promise<PriceQuote> {
    if (!(cost > 0)) throw new Error(`Precio de coste no válido: ${cost}`);
    const rate = await this.rates.toEur(currency);
    const marginPct = this.marginFor(supplier);
    const costEur = cost * rate;
    const grossCents = costEur * (1 + marginPct / 100) * (1 + this.rules.vatPct / 100) * 100;
    const gross = roundCommercial(grossCents, this.rules.rounding) / 100;
    return {
      currency,
      cost,
      rate,
      costEur: Math.round(costEur * 100) / 100,
      marginPct,
      gross,
      taxExcl: this.taxExclFromGross(gross),
    };
  }

  taxExclFromGross(gross: number): number {
    return round6(gross / (1 + this.rules.vatPct / 100));
  }
}

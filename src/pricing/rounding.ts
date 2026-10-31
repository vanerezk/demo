/**
 * Redondeo comercial del PVP (precio con IVA que ve el cliente).
 * Siempre hacia arriba, para no recortar el margen.
 *
 * - none:      al céntimo (1.234,56 €)
 * - integer:   euros enteros terminados en ,00 (1.235,00 €)
 * - ends-in-9: euros enteros terminados en 9 (1.239,00 €)
 */
export const ROUNDING_MODES = ['none', 'integer', 'ends-in-9'] as const;
export type RoundingMode = (typeof ROUNDING_MODES)[number];

/** Redondea un importe en céntimos según el modo. Entrada y salida en céntimos enteros. */
export function roundCommercial(cents: number, mode: RoundingMode): number {
  // Tolerancia ante ruido de coma flotante: 44900.0000001 no debe subir a 45000.
  const exact = Math.ceil(cents - 1e-6);
  switch (mode) {
    case 'none':
      return exact;
    case 'integer':
      return Math.ceil(exact / 100 - 1e-9) * 100;
    case 'ends-in-9': {
      const euros = Math.ceil(exact / 100 - 1e-9);
      const lastDigit = euros % 10;
      return (lastDigit === 9 ? euros : euros + (9 - lastDigit)) * 100;
    }
  }
}

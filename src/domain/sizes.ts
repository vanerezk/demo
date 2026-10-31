/**
 * Tallas de anillo. En España la talla es la circunferencia interior en mm.
 * Los proveedores de EE. UU. usan la escala US: diámetro interior = 11,63 + 0,8128 × talla.
 */
export function usToEsSize(us: number): number {
  const diameterMm = 11.63 + 0.8128 * us;
  return Math.round(Math.PI * diameterMm);
}

/** Convierte una lista de tallas US a tallas españolas únicas y ordenadas. */
export function usSizesToEs(sizes: readonly number[]): number[] {
  return [...new Set(sizes.map(usToEsSize))].sort((a, b) => a - b);
}

/**
 * Interpreta tallas españolas en texto: "48-62" (rango), "48,50,52" o "48 50 52".
 * Lanza un error si el texto no es válido o el rango está invertido.
 */
export function parseSizeSpec(spec: string): number[] {
  const text = spec.trim();
  const range = /^(\d{2})\s*[-–a]\s*(\d{2})$/.exec(text);
  if (range) {
    const from = Number(range[1]);
    const to = Number(range[2]);
    if (from > to) throw new Error(`Rango de tallas invertido: "${spec}"`);
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  }
  const parts = text.split(/[\s,;/]+/).filter(Boolean);
  if (!parts.length || parts.some((p) => !/^\d{2}$/.test(p))) {
    throw new Error(`Tallas no válidas: "${spec}"`);
  }
  return [...new Set(parts.map(Number))].sort((a, b) => a - b);
}

/** "48 a 62", "52" o "48, 50 y 52" para textos de ficha. */
export function describeSizes(sizes: readonly number[]): string {
  const sorted = [...new Set(sizes)].sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === undefined || last === undefined) return '';
  if (sorted.length === 1) return String(first);
  const contiguous = last - first + 1 === sorted.length;
  if (contiguous) return `${first} a ${last}`;
  return `${sorted.slice(0, -1).join(', ')} y ${last}`;
}

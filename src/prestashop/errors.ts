export interface PrestaShopErrorDetail {
  code?: number;
  message: string;
}

/** Error devuelto por el Webservice, con el detalle que da PrestaShop. */
export class PrestaShopError extends Error {
  override readonly name = 'PrestaShopError';

  constructor(
    readonly method: string,
    readonly path: string,
    readonly status: number,
    readonly details: PrestaShopErrorDetail[],
    readonly body: string,
  ) {
    const summary = details.length
      ? details.map((d) => (d.code ? `[${d.code}] ${d.message}` : d.message)).join('; ')
      : body.slice(0, 200).replace(/\s+/g, ' ');
    super(`${method} ${path} -> HTTP ${status}: ${summary}`);
  }

  /**
   * PrestaShop responde 500 también a errores de validación (no transitorios),
   * pero entonces incluye un bloque <errors>. Solo reintentamos los 5xx "de verdad":
   * caídas, timeouts del proxy o errores de PHP sin mensaje de PrestaShop.
   */
  get isTransient(): boolean {
    if (this.status === 502 || this.status === 503 || this.status === 504) return true;
    return this.status >= 500 && this.details.length === 0;
  }
}

/** Extrae los mensajes de error de una respuesta del Webservice (XML o JSON). */
export function parseErrorBody(body: string): PrestaShopErrorDetail[] {
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) {
    try {
      const json = JSON.parse(trimmed) as {
        errors?: { code?: number | string; message?: string }[];
      };
      return (json.errors ?? []).map((e) => ({
        ...(e.code !== undefined ? { code: Number(e.code) } : {}),
        message: e.message ?? '',
      }));
    } catch {
      return [];
    }
  }
  const details: PrestaShopErrorDetail[] = [];
  const re =
    /<error>\s*(?:<code><!\[CDATA\[(\d+)\]\]><\/code>)?\s*<message><!\[CDATA\[([\s\S]*?)\]\]><\/message>/g;
  for (const m of trimmed.matchAll(re)) {
    details.push({ ...(m[1] ? { code: Number(m[1]) } : {}), message: m[2] ?? '' });
  }
  return details;
}

const PHP_NOTICE = /^\[PHP (Notice|Deprecated|User Notice|User Deprecated|Unknown error)/;

/**
 * PrestaShop 1.7 convierte cualquier notice de PHP en un HTTP 500 aunque la operación
 * haya terminado bien (p. ej. `Product::getCoverWs()` en un producto sin imágenes con
 * PHP 7.4). Si la respuesta trae la entidad y solo hay notices, es un éxito con ruido.
 */
export function isNoticeOnlyFailure(
  status: number,
  details: PrestaShopErrorDetail[],
  body: string,
): boolean {
  if (status !== 500 || details.length === 0) return false;
  if (!details.every((d) => PHP_NOTICE.test(d.message))) return false;
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) {
    try {
      const json = JSON.parse(trimmed) as Record<string, unknown>;
      return Object.keys(json).some((k) => k !== 'errors');
    } catch {
      return false;
    }
  }
  return false;
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof PrestaShopError) return error.isTransient;
  // Errores de red de fetch (ECONNRESET, ECONNREFUSED, timeouts…)
  return error instanceof TypeError || (error instanceof Error && error.name === 'TimeoutError');
}

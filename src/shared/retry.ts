export interface RetryOptions {
  /** Número máximo de intentos (incluido el primero). */
  attempts: number;
  /** Espera base en ms; se duplica en cada reintento. */
  baseDelayMs: number;
  /** Tope de espera entre intentos. */
  maxDelayMs: number;
  /** Inyectable para tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Llamado antes de cada reintento (para registrar el motivo). */
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

export const defaultRetry: RetryOptions = { attempts: 4, baseDelayMs: 500, maxDelayMs: 8_000 };

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Espera exponencial con "full jitter": evita que varios procesos reintenten a la vez. */
export function backoffDelay(
  attempt: number,
  opts: Pick<RetryOptions, 'baseDelayMs' | 'maxDelayMs'>,
  random = Math.random,
): number {
  const ceiling = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** (attempt - 1));
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

/**
 * Ejecuta `fn` y la reintenta mientras `isRetryable(error)` sea cierto,
 * con espera creciente entre intentos.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  isRetryable: (error: unknown) => boolean,
  opts: RetryOptions = defaultRetry,
): Promise<T> {
  const sleep = opts.sleep ?? realSleep;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= opts.attempts || !isRetryable(error)) throw error;
      const delayMs = backoffDelay(attempt, opts);
      opts.onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }
}

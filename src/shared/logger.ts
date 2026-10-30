import { pino, type Logger } from 'pino';

const level = process.env.LOG_LEVEL ?? 'info';

/**
 * Logger estructurado. En una terminal interactiva se formatea con pino-pretty;
 * en CI o en una tarea programada sale JSON por línea, listo para agregarse.
 */
export const logger: Logger = pino({
  level,
  base: { app: 'catalog-sync' },
  ...(process.stdout.isTTY && process.env.NODE_ENV !== 'test'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname,app' },
        },
      }
    : {}),
});

export type { Logger };

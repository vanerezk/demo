import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PS_BASE_URL: z.url().default('http://localhost:8080'),
  PS_WEBSERVICE_KEY: z
    .string()
    .regex(/^[A-Z0-9]{32}$/, 'PS_WEBSERVICE_KEY debe tener 32 caracteres A-Z0-9'),
  PS_ID_LANG: z.coerce.number().int().positive().default(1),
  PS_ID_SHOP: z.coerce.number().int().positive().default(1),
  PS_DEFAULT_CATEGORY_ID: z.coerce.number().int().positive().default(2),
  PS_TAX_RULES_GROUP_ID: z.coerce.number().int().nonnegative().default(1),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
});

export type AppConfig = z.infer<typeof envSchema>;

let cached: AppConfig | undefined;

/** Lee y valida la configuración de entorno una sola vez. Falla pronto y con un mensaje claro. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached && env === process.env) return cached;
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Configuración inválida en .env:\n${issues.join('\n')}`);
  }
  if (env === process.env) cached = parsed.data;
  return parsed.data;
}

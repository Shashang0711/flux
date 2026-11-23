import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /** Absolute session lifetime. */
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  /** Session ends after this much inactivity. */
  SESSION_IDLE_MINUTES: z.coerce.number().positive().default(120),
  /** Send the session cookie only over HTTPS. Defaults to true in production. */
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  /**
   * Express `trust proxy` setting, so req.ip is the real client behind the Next.js proxy or
   * a load balancer. 'loopback' trusts only local proxies. See expressjs.com/en/guide/behind-proxies.
   */
  TRUST_PROXY: z.string().default('loopback'),
  /** Login attempts allowed per client IP per minute. */
  LOGIN_RATE_LIMIT: z.coerce.number().int().positive().default(10),
  /**
   * Login attempts allowed per target email per minute, whatever the source IP. Stops
   * password guessing on one account even if the attacker rotates or spoofs IPs.
   */
  LOGIN_ACCOUNT_RATE_LIMIT: z.coerce.number().int().positive().default(5),
});

export type Env = z.infer<typeof envSchema>;

/** Used by ConfigModule: fail fast at boot if the environment is invalid. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}

export function isCookieSecure(env: Pick<Env, 'NODE_ENV' | 'COOKIE_SECURE'>): boolean {
  return env.COOKIE_SECURE === undefined
    ? env.NODE_ENV === 'production'
    : env.COOKIE_SECURE === 'true';
}

/** Converts TRUST_PROXY into the value Express expects. */
export function parseTrustProxy(value: string): boolean | number | string {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

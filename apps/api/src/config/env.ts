import { z } from 'zod';

const envSchema = z
  .object({
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
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

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

    /**
     * Where uploaded files are kept. 'local': a folder (STORAGE_LOCAL_DIR); 's3': any S3-compatible
     * object storage (AWS S3, MinIO, …) configured by the S3_* variables. Files are private either
     * way: downloads go through the API with short-lived signed links.
     */
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('./storage'),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    /** Path-style URLs (http://host/bucket/key), needed by most self-hosted S3 services. */
    S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('true'),
    /** Create the bucket at start-up if it is missing (local development; off in production). */
    S3_CREATE_BUCKET: z.enum(['true', 'false']).default('false'),
    /**
     * Secret for signing download links (at least 32 characters). Required in production; in
     * development a random one is generated at start-up, so links stop working after a restart.
     */
    FILE_URL_SECRET: z.string().min(32).optional(),

    /**
     * Outgoing email. Without SMTP_HOST, emails are only written to the log (and marked sent),
     * which suits development without a mail server.
     */
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    /** true: TLS from the start (port 465); false: STARTTLS when the server offers it. */
    SMTP_SECURE: z.enum(['true', 'false']).default('false'),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    MAIL_FROM: z.string().default('FLUX <no-reply@flux.local>'),
    /** The background sender for queued notifications (off in tests, which drive it directly). */
    NOTIFICATIONS_WORKER: z.enum(['on', 'off']).default('on'),
    NOTIFICATIONS_POLL_SECONDS: z.coerce.number().int().positive().default(10),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER === 's3' && !env.S3_BUCKET) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_BUCKET'],
        message: 'S3_BUCKET is required for STORAGE_DRIVER=s3',
      });
    }
    if (env.NODE_ENV === 'production' && !env.FILE_URL_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['FILE_URL_SECRET'],
        message: 'FILE_URL_SECRET is required in production',
      });
    }
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

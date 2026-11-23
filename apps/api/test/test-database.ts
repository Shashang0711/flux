import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Loads apps/api/.env (if present) without overriding variables already set. */
export function loadApiEnv(): void {
  const file = join(__dirname, '..', '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

/**
 * e2e tests run against `<database>_test`, derived from DATABASE_URL, so truncating tables
 * never touches development data.
 */
export function testDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw)
    throw new Error('DATABASE_URL must be set (environment or apps/api/.env) for e2e tests');
  const url = new URL(raw);
  const name = url.pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) url.pathname = `/${name}_test`;
  return url.toString();
}

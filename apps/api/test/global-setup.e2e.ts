import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { loadApiEnv, testDatabaseUrl } from './test-database';

/** Creates (if needed) and migrates the e2e test database once per run. */
export default function globalSetup(): void {
  loadApiEnv();
  execSync('npx prisma migrate deploy', {
    cwd: join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
    stdio: 'inherit',
  });
}

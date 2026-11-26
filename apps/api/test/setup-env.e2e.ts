import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadApiEnv, testDatabaseUrl } from './test-database';

// Runs in each test worker before modules load: point the app at the test database.
loadApiEnv();
process.env.DATABASE_URL = testDatabaseUrl();
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
// Many logins happen across the suite; the limit itself is covered by a dedicated test.
process.env.LOGIN_RATE_LIMIT = '1000';
process.env.LOGIN_ACCOUNT_RATE_LIMIT = '1000';
// Uploaded files go to a throwaway folder (local storage driver).
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_DIR = join(tmpdir(), `flux-e2e-storage-${process.pid}`);

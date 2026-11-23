// e2e: use the real DATABASE_URL (environment or apps/api/.env); only quieten logs.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

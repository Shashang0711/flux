// Runs before any test module is imported: ConfigModule validates the environment at import time.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
// Pipeline tests mock Prisma; e2e tests take the real DATABASE_URL from the environment or .env.
process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5432/unused';

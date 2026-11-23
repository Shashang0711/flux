/** End-to-end tests against a real database. Requires DATABASE_URL. */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
  setupFiles: ['<rootDir>/test/setup-env.e2e.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
};

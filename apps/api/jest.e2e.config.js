/** End-to-end tests against a real database (`<DATABASE_URL db>_test`). */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
  globalSetup: '<rootDir>/test/global-setup.e2e.ts',
  setupFiles: ['<rootDir>/test/setup-env.e2e.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
};

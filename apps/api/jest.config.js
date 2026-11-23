/** Unit + HTTP-pipeline tests. No database required (Prisma is mocked). */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/test/**/*.spec.ts'],
  testPathIgnorePatterns: ['\\.e2e-spec\\.ts$'],
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
};

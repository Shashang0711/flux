import { validateEnv } from './env';

describe('validateEnv', () => {
  it('applies defaults and splits CORS origins', () => {
    const env = validateEnv({
      DATABASE_URL: 'postgresql://x',
      CORS_ORIGINS: 'http://a.test, http://b.test',
    });
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 4000,
      LOG_LEVEL: 'info',
      CORS_ORIGINS: ['http://a.test', 'http://b.test'],
    });
  });

  it('fails fast with a readable message when DATABASE_URL is missing', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });
});

describe('validateEnv defaults', () => {
  it('defaults CORS_ORIGINS to the local web app', () => {
    expect(validateEnv({ DATABASE_URL: 'postgresql://x' }).CORS_ORIGINS).toEqual([
      'http://localhost:3000',
    ]);
  });
});

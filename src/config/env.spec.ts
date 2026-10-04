import { validateEnv } from './env.js';

const base = {
  APP_URL: 'http://localhost:3100',
  DATABASE_URL: 'postgresql://u:p@localhost:5433/db',
  REDIS_URL: 'redis://localhost:6380',
};

describe('validateEnv', () => {
  it('applies defaults for optional values', () => {
    const env = validateEnv(base);

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4100);
    expect(env.SWAGGER_ENABLED).toBe(false);
    expect(env.CORS_ORIGINS).toEqual([]);
  });

  it('splits CORS_ORIGINS and drops blanks', () => {
    const env = validateEnv({ ...base, CORS_ORIGINS: 'https://a.test, ,https://b.test' });

    expect(env.CORS_ORIGINS).toEqual(['https://a.test', 'https://b.test']);
  });

  it('reports every invalid key at once', () => {
    expect(() => validateEnv({ APP_URL: 'not-a-url', REDIS_URL: 'http://x' })).toThrow(
      /APP_URL[\s\S]*DATABASE_URL[\s\S]*REDIS_URL/,
    );
  });

  it('rejects a database URL with the wrong protocol', () => {
    expect(() => validateEnv({ ...base, DATABASE_URL: 'mysql://u:p@localhost/db' })).toThrow(
      /DATABASE_URL/,
    );
  });
});

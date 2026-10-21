import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';

const base = {
  JWT_SECRET: 'test-only-secret-with-at-least-32-characters',
  DATABASE_URL: 'postgresql://unused',
};

describe('CORS_ORIGINS', () => {
  it('accepts exact origins including the Capacitor https://localhost origin', () => {
    const config = loadConfig({
      ...base,
      CORS_ORIGINS: 'http://localhost:4200, http://localhost:8100,https://localhost',
    });

    expect(config.corsOrigins).toEqual([
      'http://localhost:4200',
      'http://localhost:8100',
      'https://localhost',
    ]);
  });

  it.each(['*', 'https://localhost/', 'https://localhost/app', 'localhost:4200'])(
    'rejects %s',
    (origin) => {
      expect(() => loadConfig({ ...base, CORS_ORIGINS: origin })).toThrow(
        'CORS_ORIGINS entry is not an exact origin',
      );
    },
  );
});

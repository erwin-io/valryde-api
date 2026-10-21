import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { MemoryIdentityRepository } from './support/memory-identity-repository.js';

const config: AppConfig = {
  environment: 'test',
  host: '127.0.0.1',
  port: 3000,
  logLevel: 'silent',
  corsOrigins: ['http://localhost:4200', 'https://localhost'],
  databaseUrl: 'postgresql://unused',
  databaseSsl: false,
  databaseSchema: 'dbo',
  jwtSecret: 'test-only-secret-with-at-least-32-characters',
  jwtIssuer: 'valryde-api-test',
  jwtAudience: 'valryde-test-clients',
  accessTokenTtlSeconds: 900,
  refreshTokenTtlDays: 30,
  authChallengeTtlMinutes: 30,
  authResendCooldownSeconds: 60,
  googleClientIds: [],
  email: { deliveryMode: 'disabled' },
};

type ErrorBody = { error: { code: string; message: string; requestId: string } };

describe('framework error mapping and CORS', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp({ config, repository: new MemoryIdentityRepository() });
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 400 VALIDATION_ERROR for malformed JSON', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{bad',
    });

    expect(response.statusCode).toBe(400);
    const { error } = response.json<ErrorBody>();
    expect(error).toMatchObject({ code: 'VALIDATION_ERROR', message: 'Request is malformed' });
    expect(error.requestId).toEqual(expect.any(String));
  });

  it('returns 429 RATE_LIMITED with retry-after once a route limit is exceeded', async () => {
    const request = () =>
      app.inject({
        method: 'POST',
        url: '/api/auth/forgot-password',
        payload: { email: 'nobody@example.com' },
      });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await request()).statusCode).not.toBe(429);
    }

    const limited = await request();

    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(limited.json<ErrorBody>().error).toMatchObject({
      code: 'RATE_LIMITED',
      message: 'Too many requests',
    });
  });

  it('allows only configured exact origins, including the Capacitor https://localhost origin', async () => {
    const preflight = (origin: string) =>
      app.inject({
        method: 'OPTIONS',
        url: '/api/auth/login',
        headers: { origin, 'access-control-request-method': 'POST' },
      });

    expect((await preflight('https://localhost')).headers['access-control-allow-origin']).toBe(
      'https://localhost',
    );
    expect((await preflight('http://localhost')).headers['access-control-allow-origin']).toBeUndefined();
    expect(
      (await preflight('https://evil.example')).headers['access-control-allow-origin'],
    ).toBeUndefined();
  });
});

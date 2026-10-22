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

const emailBase = {
  ...base,
  EMAIL_DELIVERY_MODE: 'smtp',
  EMAIL_FROM: 'VALRYDE <sender@example.com>',
  APP_VERIFICATION_URL: 'https://app.example.com/auth/verify-email',
  APP_PASSWORD_RESET_URL: 'https://app.example.com/auth/reset-password',
  APP_EMAIL_CHANGE_URL: 'https://app.example.com/account/confirm-email-change',
};

describe('SMTP configuration profiles', () => {
  it('loads an authenticated implicit-TLS provider profile', () => {
    const config = loadConfig({
      ...emailBase,
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_USER: 'sender@example.com',
      SMTP_PASSWORD: 'runtime-secret-not-used-by-this-test',
    });

    expect(config.email).toEqual({
      deliveryMode: 'smtp',
      from: 'VALRYDE <sender@example.com>',
      verificationOrigin: 'https://app.example.com/auth/verify-email',
      passwordResetOrigin: 'https://app.example.com/auth/reset-password',
      emailChangeOrigin: 'https://app.example.com/account/confirm-email-change',
      smtp: {
        host: 'smtp.example.com',
        port: 465,
        secure: true,
        user: 'sender@example.com',
        password: 'runtime-secret-not-used-by-this-test',
      },
    });
  });

  it('keeps an unauthenticated Mailpit profile available for integration tests', () => {
    const config = loadConfig({
      ...emailBase,
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '1025',
      SMTP_SECURE: 'false',
    });

    expect(config.email).toMatchObject({
      deliveryMode: 'smtp',
      smtp: { host: '127.0.0.1', port: 1025, secure: false },
    });
  });

  it.each([
    { SMTP_USER: 'sender@example.com' },
    { SMTP_PASSWORD: 'runtime-secret-not-used-by-this-test' },
  ])('rejects incomplete SMTP authentication configuration', (partialAuth) => {
    expect(() =>
      loadConfig({
        ...emailBase,
        SMTP_HOST: 'smtp.example.com',
        ...partialAuth,
      }),
    ).toThrow('SMTP_USER and SMTP_PASSWORD must either both be set or both be omitted');
  });
});

describe('Email callback URLs', () => {
  const smtp = { ...emailBase, SMTP_HOST: '127.0.0.1' };

  it('rejects plain http callbacks in production', () => {
    expect(() =>
      loadConfig({ ...smtp, NODE_ENV: 'production', APP_PASSWORD_RESET_URL: 'http://app.example.com/auth/reset-password' }),
    ).toThrow('APP_PASSWORD_RESET_URL must use https in production');
  });

  it('accepts https callbacks in production and http callbacks in development', () => {
    expect(loadConfig({ ...smtp, NODE_ENV: 'production' }).email.deliveryMode).toBe('smtp');
    expect(
      loadConfig({ ...smtp, NODE_ENV: 'development', APP_VERIFICATION_URL: 'http://localhost:4200/auth/verify-email' }).email,
    ).toMatchObject({ verificationOrigin: 'http://localhost:4200/auth/verify-email' });
  });

  it.each(['https://user:pass@app.example.com/auth/verify-email', 'https://user@app.example.com/auth/verify-email'])(
    'rejects callbacks with embedded credentials (%s)',
    (url) => {
      expect(() => loadConfig({ ...smtp, APP_VERIFICATION_URL: url })).toThrow(
        'APP_VERIFICATION_URL must not contain credentials',
      );
    },
  );

  it.each(['javascript:alert(1)', 'valryde://auth/verify-email'])('rejects non-web scheme %s', (url) => {
    expect(() => loadConfig({ ...smtp, APP_EMAIL_CHANGE_URL: url })).toThrow('APP_EMAIL_CHANGE_URL must use http or https');
  });
});

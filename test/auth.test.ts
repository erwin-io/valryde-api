import argon2 from 'argon2';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { tokenHash } from '../src/lib/crypto.js';
import type { GoogleIdentityService } from '../src/services/google-identity-service.js';
import type {
  AuthNotification,
  NotificationService,
} from '../src/services/notification-service.js';
import { MemoryIdentityRepository } from './support/memory-identity-repository.js';

const config: AppConfig = {
  environment: 'test',
  host: '127.0.0.1',
  port: 3000,
  logLevel: 'silent',
  corsOrigins: [],
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
  googleClientIds: ['test-client'],
  email: { deliveryMode: 'disabled' },
};

class CaptureNotifications implements NotificationService {
  readonly sent: AuthNotification[] = [];
  fail = false;
  async sendAuthChallenge(notification: AuthNotification): Promise<void> {
    if (this.fail) throw new Error('temporary provider outage');
    this.sent.push(notification);
  }
}

const googleIdentity: GoogleIdentityService = {
  async verifyIdToken(idToken) {
    if (idToken !== 'valid-google-token-for-test') throw new Error('invalid');
    return { subject: 'google-subject-1', email: 'google@example.com', displayName: 'Google User' };
  },
};

describe('authentication and RBAC', () => {
  let repository: MemoryIdentityRepository;
  let notifications: CaptureNotifications;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    repository = new MemoryIdentityRepository();
    notifications = new CaptureNotifications();
    app = await buildApp({
      config,
      repository,
      notificationService: notifications,
      googleIdentityService: googleIdentity,
      logger: false,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('registers, verifies, logs in, and returns the own profile', async () => {
    const registration = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'commuter@example.com',
        password: 'correct-horse-battery-staple',
        displayName: 'Test Commuter',
        role: 'COMMUTER',
      },
    });
    expect(registration.statusCode).toBe(201);

    const verification = notifications.sent.find((item) => item.type === 'VERIFY_EMAIL');
    expect(verification).toBeDefined();
    const verify = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token: verification?.token },
    });
    expect(verify.statusCode).toBe(200);

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'commuter@example.com', password: 'correct-horse-battery-staple' },
    });
    expect(login.statusCode).toBe(200);
    const tokens = login.json<{ accessToken: string; refreshToken: string }>();

    const profile = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json<{ user: { email: string } }>().user.email).toBe('commuter@example.com');
  });

  it('rotates refresh tokens and revokes the family when an old token is replayed', async () => {
    const tokens = await registeredLogin();
    const firstRefresh = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: tokens.refreshToken },
    });
    expect(firstRefresh.statusCode).toBe(200);
    const replacement = firstRefresh.json<{ refreshToken: string }>();

    const replay = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: tokens.refreshToken },
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.json<{ error: { code: string } }>().error.code).toBe('SESSION_REVOKED');

    const revokedReplacement = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: replacement.refreshToken },
    });
    expect(revokedReplacement.statusCode).toBe(401);
  });

  it('denies a commuter access to Admin user management', async () => {
    const tokens = await registeredLogin();
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('FORBIDDEN');
  });

  it('lets an Admin disable a user and invalidates that user access token', async () => {
    const tokens = await registeredLogin();
    const target = await repository.findUserByEmail('user@example.com');
    expect(target).not.toBeNull();

    const admin = await repository.createUser({
      email: 'admin@example.com',
      passwordHash: await argon2.hash('admin-password-for-tests'),
      displayName: 'Admin',
      role: 'COMMUTER',
      emailVerifiedAt: new Date(),
    });
    await repository.addRole(admin.id, 'ADMIN');
    const currentAdmin = await repository.findUserById(admin.id);
    expect(currentAdmin).not.toBeNull();
    const adminToken = app.jwt.sign({
      sub: admin.id,
      roles: currentAdmin?.roles ?? [],
      ver: currentAdmin?.credentialsVersion ?? 1,
      type: 'access',
    });

    const disable = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${target?.id}/status`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { status: 'DISABLED' },
    });
    expect(disable.statusCode).toBe(200);

    const profile = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(profile.statusCode).toBe(401);
    expect(profile.json<{ error: { code: string } }>().error.code).toBe('SESSION_REVOKED');
  });

  it('creates a local verified user from a valid Google identity', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/google',
      payload: { idToken: 'valid-google-token-for-test', role: 'DRIVER' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ user: unknown }>().user).toMatchObject({
      email: 'google@example.com',
      emailVerified: true,
      roles: ['DRIVER'],
    });
  });

  it('resends verification generically, enforces cooldown, and supersedes the old token', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'pending@example.com',
        password: 'correct-horse-battery-staple',
        displayName: 'Pending User',
        role: 'DRIVER',
      },
    });
    const first = notifications.sent.at(-1);
    expect(first).toBeDefined();

    const cooldown = await app.inject({
      method: 'POST',
      url: '/api/auth/resend-verification',
      payload: { email: 'pending@example.com' },
    });
    expect(cooldown.statusCode).toBe(202);
    expect(notifications.sent).toHaveLength(1);

    const user = await repository.findUserByEmail('pending@example.com');
    repository.ageActiveChallenge(user!.id, 'VERIFY_EMAIL', 61_000);
    const resent = await app.inject({
      method: 'POST',
      url: '/api/auth/resend-verification',
      payload: { email: 'pending@example.com' },
    });
    expect(resent.statusCode).toBe(202);
    expect(notifications.sent).toHaveLength(2);

    const superseded = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token: first!.token },
    });
    expect(superseded.statusCode).toBe(400);
    const current = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token: notifications.sent.at(-1)!.token },
    });
    expect(current.statusCode).toBe(200);
  });

  it('rejects invalid, expired, and consumed verification tokens', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'challenge@example.com',
        password: 'correct-horse-battery-staple',
        displayName: 'Challenge User',
        role: 'COMMUTER',
      },
    });
    const token = notifications.sent.at(-1)!.token;
    const invalid = await app.inject({
      method: 'POST', url: '/api/auth/verify-email', payload: { token: 'not-a-valid-token-value' },
    });
    expect(invalid.statusCode).toBe(400);

    repository.expireChallenge(tokenHash(token));
    const expired = await app.inject({
      method: 'POST', url: '/api/auth/verify-email', payload: { token },
    });
    expect(expired.statusCode).toBe(400);

    repository.ageActiveChallenge((await repository.findUserByEmail('challenge@example.com'))!.id, 'VERIFY_EMAIL', 61_000);
    await app.inject({
      method: 'POST', url: '/api/auth/resend-verification', payload: { email: 'challenge@example.com' },
    });
    const replacement = notifications.sent.at(-1)!.token;
    expect((await app.inject({ method: 'POST', url: '/api/auth/verify-email', payload: { token: replacement } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/auth/verify-email', payload: { token: replacement } })).statusCode).toBe(400);
  });

  it('keeps registration and generic recovery retry-safe during provider failure', async () => {
    notifications.fail = true;
    const registration = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'outage@example.com',
        password: 'correct-horse-battery-staple',
        displayName: 'Outage User',
        role: 'OPERATOR',
      },
    });
    expect(registration.statusCode).toBe(201);
    expect(await repository.findUserByEmail('outage@example.com')).not.toBeNull();
    expect(repository.audits.some((entry) => entry.action === 'AUTH_EMAIL_DELIVERY_FAILED')).toBe(true);

    const recovery = await app.inject({
      method: 'POST', url: '/api/auth/forgot-password', payload: { email: 'outage@example.com' },
    });
    const unknown = await app.inject({
      method: 'POST', url: '/api/auth/forgot-password', payload: { email: 'unknown@example.com' },
    });
    expect(recovery.statusCode).toBe(202);
    expect(unknown.statusCode).toBe(202);
    expect(recovery.json()).toEqual(unknown.json());

    notifications.fail = false;
    const retry = await app.inject({
      method: 'POST', url: '/api/auth/resend-verification', payload: { email: 'outage@example.com' },
    });
    expect(retry.statusCode).toBe(202);
    expect(notifications.sent.at(-1)?.type).toBe('VERIFY_EMAIL');
  });

  it('delivers retry-safe password recovery and rejects expired or consumed reset tokens', async () => {
    const originalPassword = 'correct-horse-battery-staple';
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'recovery@example.com',
        password: originalPassword,
        displayName: 'Recovery User',
        role: 'COMMUTER',
      },
    });
    const verification = notifications.sent.at(-1)!;
    await app.inject({
      method: 'POST', url: '/api/auth/verify-email', payload: { token: verification.token },
    });

    await app.inject({
      method: 'POST', url: '/api/auth/forgot-password', payload: { email: 'recovery@example.com' },
    });
    const firstReset = notifications.sent.at(-1)!;
    expect(firstReset.type).toBe('RESET_PASSWORD');
    await app.inject({
      method: 'POST', url: '/api/auth/forgot-password', payload: { email: 'recovery@example.com' },
    });
    expect(notifications.sent.filter((item) => item.type === 'RESET_PASSWORD')).toHaveLength(1);

    repository.expireChallenge(tokenHash(firstReset.token));
    expect((await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token: firstReset.token, password: 'replacement-password-one' },
    })).statusCode).toBe(400);

    await app.inject({
      method: 'POST', url: '/api/auth/forgot-password', payload: { email: 'recovery@example.com' },
    });
    const replacement = notifications.sent.at(-1)!;
    expect((await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token: replacement.token, password: 'replacement-password-two' },
    })).statusCode).toBe(204);
    expect((await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token: replacement.token, password: 'replacement-password-three' },
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'recovery@example.com', password: 'replacement-password-two' },
    })).statusCode).toBe(200);
  });

  async function registeredLogin(): Promise<{ accessToken: string; refreshToken: string }> {
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'user@example.com',
        password: 'correct-horse-battery-staple',
        displayName: 'Test User',
        role: 'COMMUTER',
      },
    });
    const verification = notifications.sent.find((item) => item.type === 'VERIFY_EMAIL');
    await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token: verification?.token },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'user@example.com', password: 'correct-horse-battery-staple' },
    });
    return login.json();
  }
});

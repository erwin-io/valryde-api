import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import type {
  AuthNotification,
  NotificationService,
} from '../src/services/notification-service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseSchema = process.env.TEST_DATABASE_SCHEMA ?? 'dbo';
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

class CaptureNotifications implements NotificationService {
  readonly sent: AuthNotification[] = [];

  async sendAuthChallenge(notification: AuthNotification): Promise<void> {
    this.sent.push(notification);
  }
}

describeDatabase('Fastify API with PostgreSQL', () => {
  const cleanupPool = new pg.Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${databaseSchema},public`,
  });
  const createdUserIds: string[] = [];
  const notifications = new CaptureNotifications();
  const config: AppConfig = {
    environment: 'test',
    host: '127.0.0.1',
    port: 3000,
    logLevel: 'silent',
    corsOrigins: [],
    databaseUrl: databaseUrl ?? 'postgresql://unused',
    databaseSsl: false,
    databaseSchema,
    jwtSecret: 'database-integration-secret-at-least-32-characters',
    jwtIssuer: 'valryde-api-test',
    jwtAudience: 'valryde-test-clients',
    accessTokenTtlSeconds: 900,
    refreshTokenTtlDays: 30,
    authChallengeTtlMinutes: 30,
    authResendCooldownSeconds: 60,
    googleClientIds: [],
    email: { deliveryMode: 'disabled' },
  };
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp({ config, notificationService: notifications, logger: false });
  });

  afterAll(async () => {
    await app.close();
    if (createdUserIds.length > 0) {
      await cleanupPool.query('DELETE FROM audit_logs WHERE actor_user_id = ANY($1::uuid[])', [
        createdUserIds,
      ]);
      await cleanupPool.query('DELETE FROM drivers WHERE user_id = ANY($1::uuid[])', [createdUserIds]);
      await cleanupPool.query('DELETE FROM operators WHERE owner_user_id = ANY($1::uuid[])', [
        createdUserIds,
      ]);
      await cleanupPool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [createdUserIds]);
    }
    await cleanupPool.end();
  });

  it('runs registration, verification, login, profile, and RBAC through dbo', async () => {
    const email = `api-driver-${randomUUID()}@example.com`;
    const registration = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email,
        password: 'correct-horse-battery-staple',
        displayName: 'PostgreSQL Driver',
        role: 'DRIVER',
      },
    });
    expect(registration.statusCode).toBe(201);
    const registeredUser = registration.json<{ user: { id: string } }>().user;
    createdUserIds.push(registeredUser.id);

    const verification = notifications.sent.find(
      (item) => item.type === 'VERIFY_EMAIL' && item.email === email,
    );
    expect(verification).toBeDefined();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/verify-email',
          payload: { token: verification?.token },
        })
      ).statusCode,
    ).toBe(200);

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'correct-horse-battery-staple' },
    });
    expect(login.statusCode).toBe(200);
    const accessToken = login.json<{ accessToken: string }>().accessToken;

    const profile = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json<{ user: { email: string; roles: string[] } }>().user).toMatchObject({
      email,
      roles: ['DRIVER'],
    });

    const adminUsers = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(adminUsers.statusCode).toBe(403);
  });
});

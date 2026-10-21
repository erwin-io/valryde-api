import { randomBytes, randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import {
  createDevelopmentFixtureManifest,
} from '../src/dev-fixtures/fixture-manifest.js';
import { PgIdentityRepository } from '../src/repositories/pg-identity-repository.js';
import {
  cleanupDevelopmentFixtures,
  countDevelopmentFixtureRows,
  inspectDevelopmentDatabase,
  seedDevelopmentFixtures,
} from '../src/services/development-fixture-service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseSchema = process.env.TEST_DATABASE_SCHEMA ?? 'dbo';
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

describeDatabase('development business fixtures with PostgreSQL', () => {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${databaseSchema},public`,
  });
  const repository = new PgIdentityRepository(pool);
  const manifest = createDevelopmentFixtureManifest('e', 'fixture-integration');
  const password = `Fixture-${randomBytes(18).toString('base64url')}!`;
  const cleanupOptions = {
    environment: 'development',
    expectedDatabase: '',
    schema: databaseSchema,
    confirmation: 'CLEAN_VALRYDE_DEVELOPMENT_FIXTURES',
    manifest,
  };
  const config: AppConfig = {
    environment: 'test',
    host: '127.0.0.1',
    port: 3000,
    logLevel: 'silent',
    corsOrigins: [],
    databaseUrl: databaseUrl ?? 'postgresql://unused',
    databaseSsl: false,
    databaseSchema,
    jwtSecret: 'development-fixture-test-secret-at-least-32-characters',
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
  let databaseName: string;
  let operatorAToken: string;
  let driverAToken: string;
  let adminToken: string;
  let unrelatedUserId: string | undefined;

  beforeAll(async () => {
    const database = await pool.query<{ database: string }>('SELECT current_database() AS database');
    databaseName = requireValue(database.rows[0]?.database);
    cleanupOptions.expectedDatabase = databaseName;
    await seedDevelopmentFixtures(pool, {
      ...cleanupOptions,
      confirmation: 'SEED_VALRYDE_DEVELOPMENT_FIXTURES',
      password,
    });
    app = await buildApp({ config, logger: false });
    operatorAToken = await login(manifest.accounts.operatorA.email);
    driverAToken = await login(manifest.accounts.driverA.email);
    adminToken = await login(manifest.accounts.admin.email);
  }, 30_000);

  afterAll(async () => {
    if (databaseName !== undefined) {
      await cleanupDevelopmentFixtures(pool, cleanupOptions);
    }
    if (unrelatedUserId !== undefined) {
      await pool.query('DELETE FROM users WHERE id = $1', [unrelatedUserId]);
    }
    await app?.close();
    await pool.end();
  }, 30_000);

  it('refuses an unexpected database identity before any write', async () => {
    const boundary = await inspectDevelopmentDatabase(pool, {
      environment: 'development',
      expectedDatabase: databaseName,
      schema: databaseSchema,
    });
    expect(boundary).toMatchObject({
      database: databaseName,
      schema: 'dbo',
      postgis: true,
      traccarTables: false,
    });
    await expect(
      inspectDevelopmentDatabase(pool, {
        environment: 'development',
        expectedDatabase: `${databaseName}-wrong`,
        schema: databaseSchema,
      }),
    ).rejects.toThrow('Database boundary mismatch');
    await expect(
      inspectDevelopmentDatabase(pool, {
        environment: 'production',
        expectedDatabase: databaseName,
        schema: databaseSchema,
      }),
    ).rejects.toThrow('NODE_ENV=development');
  });

  it('seeds all stable records idempotently with verified Argon2 login accounts and no email challenges', async () => {
    expect(await countDevelopmentFixtureRows(pool, manifest)).toBe(41);
    await seedDevelopmentFixtures(pool, {
      ...cleanupOptions,
      confirmation: 'SEED_VALRYDE_DEVELOPMENT_FIXTURES',
      password,
    });
    expect(await countDevelopmentFixtureRows(pool, manifest)).toBe(41);

    for (const [index, account] of Object.values(manifest.accounts).entries()) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: `127.0.1.${index + 1}`,
        payload: { email: account.email, password },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<{ user: { emailVerified: boolean; roles: string[] } }>().user).toMatchObject({
        emailVerified: true,
        roles: account.roles,
      });
    }
    const challenges = await pool.query<{ count: number }>(
      'SELECT count(*)::integer AS count FROM auth_challenges WHERE user_id = ANY($1::uuid[])',
      [Object.values(manifest.accounts).map(({ id }) => id)],
    );
    expect(challenges.rows[0]?.count).toBe(0);
  });

  it('uses normal refresh rotation and logout for a fixture account', async () => {
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: '127.0.2.1',
      payload: { email: manifest.accounts.commuter.email, password },
    });
    expect(loginResponse.statusCode).toBe(200);
    const firstRefresh = loginResponse.json<{ refreshToken: string }>().refreshToken;
    const refreshResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: firstRefresh },
    });
    expect(refreshResponse.statusCode).toBe(200);
    const rotatedRefresh = refreshResponse.json<{ refreshToken: string }>().refreshToken;
    expect(rotatedRefresh).not.toBe(firstRefresh);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/logout',
          payload: { refreshToken: rotatedRefresh },
        })
      ).statusCode,
    ).toBe(204);
  });

  it('exposes linked success, failure, no-assignment, and effective-route scenarios', async () => {
    const jeepneys = await get('/api/jeepneys', operatorAToken);
    expect(jeepneys.statusCode).toBe(200);
    const operatorAJeepneyIds = jeepneys.json<{ jeepneys: Array<{ id: string }> }>().jeepneys.map(({ id }) => id);
    expect(operatorAJeepneyIds).toEqual(
      expect.arrayContaining([
        manifest.jeepneys.activeA,
        manifest.jeepneys.pendingA,
        manifest.jeepneys.noAssignmentA,
        manifest.jeepneys.conflictA,
      ]),
    );
    expect(operatorAJeepneyIds).not.toContain(manifest.jeepneys.operatorB);

    const effective = await get(
      `/api/jeepneys/${manifest.jeepneys.activeA}/effective-route`,
      operatorAToken,
    );
    expect(effective.statusCode).toBe(200);
    expect(effective.json()).toMatchObject({
      effectiveRouteDirection: {
        source: 'DIRECT',
        direction: { id: manifest.directions.routeAOutbound },
      },
    });
    const noAssignment = await get(
      `/api/jeepneys/${manifest.jeepneys.noAssignmentA}/effective-route`,
      operatorAToken,
    );
    expect(noAssignment.json()).toEqual({ effectiveRouteDirection: null });

    const gps = await get('/api/gps-setup-requests', adminToken);
    const requests = gps.json<{ requests: Array<{ id: string; status: string; verificationStatus: string }> }>().requests;
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: manifest.gpsRequests.installedA,
          status: 'INSTALLED',
          verificationStatus: 'VERIFIED',
        }),
        expect.objectContaining({ id: manifest.gpsRequests.pendingA, status: 'PENDING' }),
        expect.objectContaining({ id: manifest.gpsRequests.rejectedB, status: 'REJECTED' }),
      ]),
    );
  });

  it('proves cross-operator isolation and seeded conflict behavior through the API', async () => {
    const denied = await app.inject({
      method: 'POST',
      url: `/api/jeepneys/${manifest.jeepneys.activeA}/driver-assignment`,
      headers: authorization(operatorAToken),
      payload: { driverId: manifest.drivers.driverB },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });

    const conflict = await app.inject({
      method: 'POST',
      url: `/api/fleet-groups/${manifest.groups.conflictingA}/jeepneys`,
      headers: authorization(operatorAToken),
      payload: { jeepneyId: manifest.jeepneys.conflictA },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: { code: 'ROUTE_ASSIGNMENT_CONFLICT' } });

    const driverVisible = await get('/api/jeepneys', driverAToken);
    expect(driverVisible.statusCode).toBe(200);
    expect(
      driverVisible.json<{ jeepneys: Array<{ id: string }> }>().jeepneys.map(({ id }) => id),
    ).not.toContain(manifest.jeepneys.operatorB);
  });

  it('cleans only manifest-owned records and leaves unrelated application data untouched', async () => {
    const unrelated = await repository.createUser({
      email: `fixture-sentinel-${randomUUID()}@example.com`,
      displayName: 'Fixture cleanup sentinel',
      passwordHash: null,
      role: 'COMMUTER',
      emailVerifiedAt: new Date(),
    });
    unrelatedUserId = unrelated.id;

    await cleanupDevelopmentFixtures(pool, cleanupOptions);
    expect(await countDevelopmentFixtureRows(pool, manifest)).toBe(0);
    expect(await repository.findUserById(unrelated.id)).not.toBeNull();
  });

  async function login(email: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password },
    });
    expect(response.statusCode).toBe(200);
    return response.json<{ accessToken: string }>().accessToken;
  }

  function get(url: string, token: string) {
    return app.inject({ method: 'GET', url, headers: authorization(token) });
  }
});

function authorization(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

function requireValue(value: string | undefined): string {
  if (value === undefined) throw new Error('Expected database value was not returned');
  return value;
}

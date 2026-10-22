import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import type { User } from '../src/domain/identity.js';
import { PgIdentityRepository } from '../src/repositories/pg-identity-repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseSchema = process.env.TEST_DATABASE_SCHEMA ?? 'dbo';
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

describeDatabase('vehicle application and GPS workflow with PostgreSQL', () => {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${databaseSchema},public`,
  });
  const repository = new PgIdentityRepository(pool);
  const userIds: string[] = [];
  const config: AppConfig = {
    environment: 'test',
    host: '127.0.0.1',
    port: 3000,
    logLevel: 'silent',
    corsOrigins: [],
    databaseUrl: databaseUrl ?? 'postgresql://unused',
    databaseSsl: false,
    databaseSchema,
    jwtSecret: 'workflow-integration-secret-at-least-32-characters',
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
  let admin: User;
  let operatorA: User;
  let operatorB: User;

  beforeAll(async () => {
    app = await buildApp({ config, logger: false });
    const adminBase = await createUser('COMMUTER', 'GPS Admin');
    admin = await repository.addRole(adminBase.id, 'ADMIN');
    operatorA = await createUser('OPERATOR', 'GPS Operator A');
    operatorB = await createUser('OPERATOR', 'GPS Operator B');
  });

  afterAll(async () => {
    if (userIds.length > 0) {
      const devices = await pool.query<{ gps_device_id: string }>(
        `DELETE FROM traccar_device_mappings
         WHERE mapped_by_user_id = ANY($1::uuid[]) RETURNING gps_device_id`,
        [userIds],
      );
      await pool.query('DELETE FROM gps_setup_requests WHERE requested_by_user_id = ANY($1::uuid[])', [
        userIds,
      ]);
      await pool.query(
        'DELETE FROM vehicle_applications WHERE submitted_by_user_id = ANY($1::uuid[])',
        [userIds],
      );
      await pool.query('DELETE FROM jeepneys WHERE created_by_user_id = ANY($1::uuid[])', [userIds]);
      if (devices.rows.length > 0) {
        await pool.query('DELETE FROM gps_devices WHERE id = ANY($1::uuid[])', [
          devices.rows.map((row) => row.gps_device_id),
        ]);
      }
      await pool.query('DELETE FROM audit_logs WHERE actor_user_id = ANY($1::uuid[])', [userIds]);
      await pool.query('DELETE FROM operators WHERE owner_user_id = ANY($1::uuid[])', [userIds]);
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
    }
    await app.close();
    await pool.end();
  });

  it('requires approval, valid state transitions, mapping, and verification before activation', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    const adminToken = token(admin);
    const operatorAToken = token(operatorA);
    const operatorBToken = token(operatorB);
    const jeepneyResponse = await app.inject({
      method: 'POST',
      url: '/api/jeepneys',
      headers: auth(operatorAToken),
      payload: { plateNo: `WF-${suffix}`, colorHex: '#778899' },
    });
    expect(jeepneyResponse.statusCode).toBe(201);
    const jeepneyId = jeepneyResponse.json<{ jeepney: { id: string } }>().jeepney.id;

    const crossOperator = await app.inject({
      method: 'POST',
      url: '/api/vehicle-applications',
      headers: auth(operatorBToken),
      payload: { jeepneyId },
    });
    expect(crossOperator.statusCode).toBe(403);

    const applicationResponse = await app.inject({
      method: 'POST',
      url: '/api/vehicle-applications',
      headers: auth(operatorAToken),
      payload: { jeepneyId, applicantNotes: 'Ready for inspection' },
    });
    expect(applicationResponse.statusCode).toBe(201);
    const applicationId = applicationResponse.json<{ application: { id: string } }>().application.id;

    const prematureGps = await app.inject({
      method: 'POST',
      url: '/api/gps-setup-requests',
      headers: auth(operatorAToken),
      payload: { vehicleApplicationId: applicationId },
    });
    expect(prematureGps.statusCode).toBe(409);
    expect(prematureGps.json<{ error: { code: string } }>().error.code).toBe('VEHICLE_NOT_APPROVED');

    const approval = await app.inject({
      method: 'PATCH',
      url: `/api/admin/vehicle-applications/${applicationId}/review`,
      headers: auth(adminToken),
      payload: { decision: 'APPROVED', reviewNotes: 'Requirements complete' },
    });
    expect(approval.statusCode).toBe(200);
    expect(approval.json<{ application: { status: string } }>().application.status).toBe('APPROVED');

    const repeatedReview = await app.inject({
      method: 'PATCH',
      url: `/api/admin/vehicle-applications/${applicationId}/review`,
      headers: auth(adminToken),
      payload: { decision: 'REJECTED' },
    });
    expect(repeatedReview.statusCode).toBe(409);

    const gpsResponse = await app.inject({
      method: 'POST',
      url: '/api/gps-setup-requests',
      headers: auth(operatorAToken),
      payload: { vehicleApplicationId: applicationId },
    });
    expect(gpsResponse.statusCode).toBe(201);
    const requestId = gpsResponse.json<{ request: { id: string } }>().request.id;

    const missingMapping = await app.inject({
      method: 'GET',
      url: `/api/admin/gps-setup-requests/${requestId}/device-mapping`,
      headers: auth(adminToken),
    });
    expect(missingMapping.statusCode).toBe(200);
    expect(missingMapping.json<{ mapping: null }>().mapping).toBeNull();
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/admin/gps-setup-requests/${requestId}/device-mapping`,
          headers: auth(operatorAToken),
        })
      ).statusCode,
    ).toBe(403);

    const invalidJump = await transition(requestId, adminToken, { status: 'INSTALLED' });
    expect(invalidJump.statusCode).toBe(409);
    const approvedTransition = await transition(requestId, adminToken, { status: 'APPROVED' });
    expect(approvedTransition.statusCode, approvedTransition.body).toBe(200);
    expect(
      (
        await transition(requestId, adminToken, {
          status: 'SCHEDULED',
          scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
        })
      ).statusCode,
    ).toBe(200);

    const mapping = await app.inject({
      method: 'POST',
      url: `/api/admin/gps-setup-requests/${requestId}/device-mapping`,
      headers: auth(adminToken),
      payload: {
        imei: `86${randomUUID().replaceAll('-', '').replace(/[^0-9]/g, '7').slice(0, 13)}`,
        serialNumber: `TEST-${suffix}`,
        traccarUniqueId: `test-${suffix}`,
      },
    });
    expect(mapping.statusCode).toBe(201);
    const mappingBody = mapping.json<{ mapping: Record<string, unknown> }>().mapping;
    const mappingRead = await app.inject({
      method: 'GET',
      url: `/api/admin/gps-setup-requests/${requestId}/device-mapping`,
      headers: auth(adminToken),
    });
    expect(mappingRead.statusCode).toBe(200);
    expect(mappingRead.json<{ mapping: Record<string, unknown> }>().mapping).toEqual(mappingBody);

    const unknownRequest = await app.inject({
      method: 'GET',
      url: `/api/admin/gps-setup-requests/${randomUUID()}/device-mapping`,
      headers: auth(adminToken),
    });
    expect(unknownRequest.statusCode).toBe(404);
    expect((await transition(requestId, adminToken, { status: 'INSTALLED' })).statusCode).toBe(200);

    const failedVerification = await verify(requestId, adminToken, false);
    expect(failedVerification.statusCode).toBe(200);
    expect(failedVerification.json<{ request: { verificationStatus: string } }>().request.verificationStatus).toBe(
      'FAILED',
    );
    expect(await jeepneyStatus(jeepneyId)).toBe('APPROVED');

    const successfulVerification = await verify(requestId, adminToken, true);
    expect(successfulVerification.statusCode).toBe(200);
    expect(
      successfulVerification.json<{ request: { verificationStatus: string } }>().request.verificationStatus,
    ).toBe('VERIFIED');
    expect(await jeepneyStatus(jeepneyId)).toBe('ACTIVE');
  });

  async function createUser(
    role: 'COMMUTER' | 'OPERATOR',
    displayName: string,
  ): Promise<User> {
    const user = await repository.createUser({
      email: `${role.toLowerCase()}-${randomUUID()}@example.com`,
      passwordHash: null,
      displayName,
      role,
      emailVerifiedAt: new Date(),
    });
    userIds.push(user.id);
    return user;
  }

  function token(user: User): string {
    return app.jwt.sign({
      sub: user.id,
      roles: user.roles,
      ver: user.credentialsVersion,
      type: 'access',
    });
  }

  async function transition(
    requestId: string,
    accessToken: string,
    payload: Record<string, unknown>,
  ) {
    return app.inject({
      method: 'PATCH',
      url: `/api/admin/gps-setup-requests/${requestId}/status`,
      headers: auth(accessToken),
      payload,
    });
  }

  async function verify(requestId: string, accessToken: string, success: boolean) {
    return app.inject({
      method: 'POST',
      url: `/api/admin/gps-setup-requests/${requestId}/verification`,
      headers: auth(accessToken),
      payload: { powerOk: success, simOk: success, serverOk: success, gpsFixOk: success },
    });
  }

  async function jeepneyStatus(jeepneyId: string): Promise<string | undefined> {
    const result = await pool.query<{ status: string }>('SELECT status::text FROM jeepneys WHERE id = $1', [
      jeepneyId,
    ]);
    return result.rows[0]?.status;
  }
});

function auth(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

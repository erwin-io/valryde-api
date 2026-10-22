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

describeDatabase('current Driver assignment API with PostgreSQL', () => {
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
    jwtSecret: 'current-assignment-test-secret-at-least-32-chars',
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
  let operator: User;
  let assignedDriver: User;
  let visibleOnlyDriver: User;
  let commuter: User;
  let operatorId: string;
  let assignedDriverId: string;
  let visibleOnlyDriverId: string;

  beforeAll(async () => {
    app = await buildApp({ config, logger: false });
    [operator, assignedDriver, visibleOnlyDriver, commuter] = await Promise.all([
      createUser('OPERATOR', 'Assignment Operator'),
      createUser('DRIVER', 'Assigned Driver'),
      createUser('DRIVER', 'Visible Only Driver'),
      createUser('COMMUTER', 'Assignment Commuter'),
    ]);
    const operatorRow = await pool.query<{ id: string }>(
      'SELECT id FROM operators WHERE owner_user_id = $1',
      [operator.id],
    );
    operatorId = requireValue(operatorRow.rows[0]?.id);
    await pool.query(
      'UPDATE drivers SET operator_id = $1 WHERE user_id = ANY($2::uuid[])',
      [operatorId, [assignedDriver.id, visibleOnlyDriver.id]],
    );
    const drivers = await pool.query<{ id: string; user_id: string }>(
      'SELECT id, user_id FROM drivers WHERE user_id = ANY($1::uuid[])',
      [[assignedDriver.id, visibleOnlyDriver.id]],
    );
    assignedDriverId = requireValue(
      drivers.rows.find((row) => row.user_id === assignedDriver.id)?.id,
    );
    visibleOnlyDriverId = requireValue(
      drivers.rows.find((row) => row.user_id === visibleOnlyDriver.id)?.id,
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM audit_logs WHERE actor_user_id = ANY($1::uuid[])', [userIds]);
    await pool.query(
      `DELETE FROM driver_jeepney_assignments
       WHERE driver_id IN (SELECT id FROM drivers WHERE user_id = ANY($1::uuid[]))`,
      [userIds],
    );
    await pool.query('DELETE FROM fleet_groups WHERE operator_id = $1', [operatorId]);
    await pool.query('DELETE FROM jeepneys WHERE created_by_user_id = ANY($1::uuid[])', [userIds]);
    await pool.query('DELETE FROM drivers WHERE user_id = ANY($1::uuid[])', [userIds]);
    await pool.query('DELETE FROM operators WHERE owner_user_id = ANY($1::uuid[])', [userIds]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
    await app.close();
    await pool.end();
  });

  it('returns only the active assignment and does not treat group visibility as assignment', async () => {
    const operatorToken = token(operator);
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const assignedJeepney = await createJeepney(operatorToken, `AS-${suffix}`);
    const visibleJeepney = await createJeepney(operatorToken, `VI-${suffix}`);
    const group = await app.inject({
      method: 'POST',
      url: '/api/fleet-groups',
      headers: authorization(operatorToken),
      payload: { name: `Visible ${suffix}` },
    });
    expect(group.statusCode).toBe(201);
    const groupId = group.json<{ group: { id: string } }>().group.id;
    for (const [path, payload] of [
      [`drivers`, { driverId: visibleOnlyDriverId }],
      [`jeepneys`, { jeepneyId: visibleJeepney }],
    ] as const) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/fleet-groups/${groupId}/${path}`,
            headers: authorization(operatorToken),
            payload,
          })
        ).statusCode,
      ).toBe(200);
    }

    const assignmentResponse = await app.inject({
      method: 'POST',
      url: `/api/jeepneys/${assignedJeepney}/driver-assignment`,
      headers: authorization(operatorToken),
      payload: { driverId: assignedDriverId },
    });
    expect(assignmentResponse.statusCode).toBe(201);
    const expected = assignmentResponse.json<{ assignment: { id: string } }>().assignment.id;

    const assigned = await app.inject({
      method: 'GET',
      url: '/api/me/assignment',
      headers: authorization(token(assignedDriver)),
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json()).toMatchObject({
      assignment: {
        id: expected,
        driverId: assignedDriverId,
        jeepneyId: assignedJeepney,
        activeTo: null,
      },
    });
    const assignedPayload = assigned.json<{ assignment: Record<string, unknown> }>();
    expect(assignedPayload.assignment).not.toHaveProperty('userId');

    const visibleOnly = await app.inject({
      method: 'GET',
      url: '/api/me/assignment',
      headers: authorization(token(visibleOnlyDriver)),
    });
    expect(visibleOnly.statusCode).toBe(200);
    expect(visibleOnly.json()).toEqual({ assignment: null });

    for (const caller of [operator, commuter]) {
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/api/me/assignment',
            headers: authorization(token(caller)),
          })
        ).statusCode,
      ).toBe(403);
    }
  });

  async function createJeepney(accessToken: string, plateNo: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/jeepneys',
      headers: authorization(accessToken),
      payload: { plateNo, colorHex: '#336699' },
    });
    expect(response.statusCode).toBe(201);
    return response.json<{ jeepney: { id: string } }>().jeepney.id;
  }

  async function createUser(
    role: 'COMMUTER' | 'DRIVER' | 'OPERATOR',
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
});

function authorization(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

function requireValue(value: string | undefined): string {
  if (value === undefined) throw new Error('Expected database identifier was not found');
  return value;
}

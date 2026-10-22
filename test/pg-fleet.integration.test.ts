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

describeDatabase('fleet API with PostgreSQL', () => {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${databaseSchema},public`,
  });
  const repository = new PgIdentityRepository(pool);
  const userIds: string[] = [];
  const entityIds: string[] = [];
  const config: AppConfig = {
    environment: 'test',
    host: '127.0.0.1',
    port: 3000,
    logLevel: 'silent',
    corsOrigins: [],
    databaseUrl: databaseUrl ?? 'postgresql://unused',
    databaseSsl: false,
    databaseSchema,
    jwtSecret: 'fleet-integration-secret-at-least-32-characters',
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
  let operatorA: User;
  let operatorB: User;
  let driverA1: User;
  let driverA2: User;
  let driverB: User;
  let admin: User;
  let commuter: User;
  let operatorAId: string;
  let operatorBId: string;
  let driverA1Id: string;
  let driverA2Id: string;
  let driverBId: string;

  beforeAll(async () => {
    app = await buildApp({ config, logger: false });
    [operatorA, operatorB, driverA1, driverA2, driverB, admin, commuter] = await Promise.all([
      createUser('OPERATOR', 'Operator A'),
      createUser('OPERATOR', 'Operator B'),
      createUser('DRIVER', 'Driver A1'),
      createUser('DRIVER', 'Driver A2'),
      createUser('DRIVER', 'Driver B'),
      createAdminUser(),
      createUser('COMMUTER', 'Commuter'),
    ]);

    const operators = await pool.query<{ id: string; owner_user_id: string }>(
      'SELECT id, owner_user_id FROM operators WHERE owner_user_id = ANY($1::uuid[])',
      [[operatorA.id, operatorB.id]],
    );
    operatorAId = requireValue(
      operators.rows.find((row) => row.owner_user_id === operatorA.id)?.id,
    );
    operatorBId = requireValue(
      operators.rows.find((row) => row.owner_user_id === operatorB.id)?.id,
    );

    await pool.query(
      `UPDATE drivers SET operator_id = CASE
         WHEN user_id = ANY($1::uuid[]) THEN $3::uuid
         WHEN user_id = $2::uuid THEN $4::uuid
       END
       WHERE user_id = ANY($5::uuid[])`,
      [
        [driverA1.id, driverA2.id],
        driverB.id,
        operatorAId,
        operatorBId,
        [driverA1.id, driverA2.id, driverB.id],
      ],
    );
    const drivers = await pool.query<{ id: string; user_id: string }>(
      'SELECT id, user_id FROM drivers WHERE user_id = ANY($1::uuid[])',
      [[driverA1.id, driverA2.id, driverB.id]],
    );
    driverA1Id = requireValue(drivers.rows.find((row) => row.user_id === driverA1.id)?.id);
    driverA2Id = requireValue(drivers.rows.find((row) => row.user_id === driverA2.id)?.id);
    driverBId = requireValue(drivers.rows.find((row) => row.user_id === driverB.id)?.id);
  });

  afterAll(async () => {
    if (userIds.length > 0) {
      await pool.query('DELETE FROM audit_logs WHERE actor_user_id = ANY($1::uuid[])', [userIds]);
      await pool.query(
        `DELETE FROM driver_jeepney_assignments
         WHERE assigned_by_user_id = ANY($1::uuid[])`,
        [userIds],
      );
      await pool.query('DELETE FROM fleet_groups WHERE operator_id = ANY($1::uuid[])', [
        [operatorAId, operatorBId].filter(Boolean),
      ]);
      await pool.query('DELETE FROM jeepneys WHERE created_by_user_id = ANY($1::uuid[])', [userIds]);
      await pool.query('DELETE FROM drivers WHERE user_id = ANY($1::uuid[])', [userIds]);
      await pool.query('DELETE FROM operators WHERE owner_user_id = ANY($1::uuid[])', [userIds]);
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
    }
    await app.close();
    await pool.end();
  });

  it('enforces tenant membership and driver visibility while replacing assignments', async () => {
    const operatorAToken = token(operatorA);
    const operatorBToken = token(operatorB);
    const plateSuffix = randomUUID().slice(0, 8).toUpperCase();

    const jeepneyAResponse = await app.inject({
      method: 'POST',
      url: '/api/jeepneys',
      headers: authorization(operatorAToken),
      payload: { plateNo: `A-${plateSuffix}`, colorHex: '#123ABC' },
    });
    expect(jeepneyAResponse.statusCode).toBe(201);
    const jeepneyAId = jeepneyAResponse.json<{ jeepney: { id: string } }>().jeepney.id;
    entityIds.push(jeepneyAId);

    const jeepneyBResponse = await app.inject({
      method: 'POST',
      url: '/api/jeepneys',
      headers: authorization(operatorBToken),
      payload: { plateNo: `B-${plateSuffix}`, colorHex: '#456DEF' },
    });
    expect(jeepneyBResponse.statusCode).toBe(201);
    const jeepneyBId = jeepneyBResponse.json<{ jeepney: { id: string } }>().jeepney.id;
    entityIds.push(jeepneyBId);

    const groupResponse = await app.inject({
      method: 'POST',
      url: '/api/fleet-groups',
      headers: authorization(operatorAToken),
      payload: { name: `Group ${plateSuffix}` },
    });
    expect(groupResponse.statusCode).toBe(201);
    const groupId = groupResponse.json<{ group: { id: string } }>().group.id;
    entityIds.push(groupId);

    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/fleet-groups/${groupId}/drivers`,
          headers: authorization(operatorAToken),
          payload: { driverId: driverA1Id },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/fleet-groups/${groupId}/jeepneys`,
          headers: authorization(operatorAToken),
          payload: { jeepneyId: jeepneyAId },
        })
      ).statusCode,
    ).toBe(200);

    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/fleet-groups/${groupId}/drivers`,
          headers: authorization(operatorAToken),
          payload: { driverId: driverBId },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/fleet-groups/${groupId}/jeepneys`,
          headers: authorization(operatorAToken),
          payload: { jeepneyId: jeepneyBId },
        })
      ).statusCode,
    ).toBe(403);

    const firstAssignment = await app.inject({
      method: 'POST',
      url: `/api/jeepneys/${jeepneyAId}/driver-assignment`,
      headers: authorization(operatorAToken),
      payload: { driverId: driverA1Id },
    });
    expect(firstAssignment.statusCode).toBe(201);
    entityIds.push(firstAssignment.json<{ assignment: { id: string } }>().assignment.id);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/jeepneys/${jeepneyAId}/driver-assignment`,
          headers: authorization(operatorAToken),
          payload: { driverId: driverBId },
        })
      ).statusCode,
    ).toBe(403);

    const secondAssignment = await app.inject({
      method: 'POST',
      url: `/api/jeepneys/${jeepneyAId}/driver-assignment`,
      headers: authorization(operatorAToken),
      payload: { driverId: driverA2Id },
    });
    expect(secondAssignment.statusCode).toBe(201);
    entityIds.push(secondAssignment.json<{ assignment: { id: string } }>().assignment.id);

    const assignmentState = await pool.query<{ active_count: string; closed_count: string }>(
      `SELECT
         count(*) FILTER (WHERE active_to IS NULL)::text AS active_count,
         count(*) FILTER (WHERE active_to IS NOT NULL)::text AS closed_count
       FROM driver_jeepney_assignments WHERE jeepney_id = $1`,
      [jeepneyAId],
    );
    expect(assignmentState.rows[0]).toMatchObject({ active_count: '1', closed_count: '1' });

    const driverAJeepneys = await app.inject({
      method: 'GET',
      url: '/api/jeepneys',
      headers: authorization(token(driverA1)),
    });
    expect(driverAJeepneys.statusCode).toBe(200);
    expect(
      driverAJeepneys.json<{ jeepneys: { id: string }[] }>().jeepneys.map((item) => item.id),
    ).toContain(jeepneyAId);

    const driverAGroups = await app.inject({
      method: 'GET',
      url: '/api/fleet-groups',
      headers: authorization(token(driverA1)),
    });
    expect(driverAGroups.statusCode).toBe(200);
    expect(driverAGroups.json<{ groups: { id: string }[] }>().groups.map((item) => item.id)).toContain(
      groupId,
    );

    const driverBJeepneys = await app.inject({
      method: 'GET',
      url: '/api/jeepneys',
      headers: authorization(token(driverB)),
    });
    expect(driverBJeepneys.statusCode).toBe(200);
    expect(
      driverBJeepneys.json<{ jeepneys: { id: string }[] }>().jeepneys.map((item) => item.id),
    ).not.toContain(jeepneyAId);

    const driverBGroups = await app.inject({
      method: 'GET',
      url: '/api/fleet-groups',
      headers: authorization(token(driverB)),
    });
    expect(driverBGroups.statusCode).toBe(200);
    expect(driverBGroups.json<{ groups: { id: string }[] }>().groups).toHaveLength(0);

    const operatorMembers = await app.inject({
      method: 'GET',
      url: `/api/fleet-groups/${groupId}/members?page=1&pageSize=1`,
      headers: authorization(operatorAToken),
    });
    expect(operatorMembers.statusCode).toBe(200);
    expect(operatorMembers.json<{
      members: Array<Record<string, unknown>>;
      pagination: { page: number; pageSize: number; total: number; totalPages: number };
    }>()).toMatchObject({ pagination: { page: 1, pageSize: 1, total: 2, totalPages: 2 } });

    const adminMembers = await app.inject({
      method: 'GET',
      url: `/api/fleet-groups/${groupId}/members`,
      headers: authorization(token(admin)),
    });
    expect(adminMembers.statusCode).toBe(200);
    expect(adminMembers.json<{ pagination: { total: number } }>().pagination.total).toBe(2);

    const driverMembers = await app.inject({
      method: 'GET',
      url: `/api/fleet-groups/${groupId}/members?memberType=DRIVER`,
      headers: authorization(token(driverA1)),
    });
    expect(driverMembers.statusCode).toBe(200);
    const driverMemberPayload = driverMembers.json<{
      members: Array<Record<string, unknown>>;
      pagination: { total: number };
    }>();
    expect(driverMemberPayload.pagination.total).toBe(1);
    expect(driverMemberPayload.members[0]).toMatchObject({
      memberType: 'DRIVER',
      driverId: driverA1Id,
      displayName: driverA1.displayName,
    });
    expect(driverMemberPayload.members[0]).not.toHaveProperty('email');
    expect(driverMemberPayload.members[0]).not.toHaveProperty('userId');

    for (const caller of [operatorB, driverB]) {
      const denied = await app.inject({
        method: 'GET',
        url: `/api/fleet-groups/${groupId}/members`,
        headers: authorization(token(caller)),
      });
      expect(denied.statusCode).toBe(403);
    }
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/fleet-groups/${groupId}/members`,
          headers: authorization(token(commuter)),
        })
      ).statusCode,
    ).toBe(403);

    const crossOperatorRemoval = await app.inject({
      method: 'DELETE',
      url: `/api/fleet-groups/${groupId}/drivers/${driverA1Id}`,
      headers: authorization(operatorBToken),
    });
    expect(crossOperatorRemoval.statusCode).toBe(403);

    const removeDriver = await app.inject({
      method: 'DELETE',
      url: `/api/fleet-groups/${groupId}/drivers/${driverA1Id}`,
      headers: authorization(operatorAToken),
    });
    expect(removeDriver.statusCode).toBe(204);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/fleet-groups/${groupId}/drivers/${driverA1Id}`,
          headers: authorization(operatorAToken),
        })
      ).statusCode,
    ).toBe(404);

    const removeJeepney = await app.inject({
      method: 'DELETE',
      url: `/api/fleet-groups/${groupId}/jeepneys/${jeepneyAId}`,
      headers: authorization(operatorAToken),
    });
    expect(removeJeepney.statusCode).toBe(204);

    const emptyMembers = await app.inject({
      method: 'GET',
      url: `/api/fleet-groups/${groupId}/members`,
      headers: authorization(operatorAToken),
    });
    expect(emptyMembers.statusCode).toBe(200);
    expect(emptyMembers.json()).toMatchObject({
      members: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    });

    const auditRows = await pool.query<{ action: string }>(
      `SELECT action FROM audit_logs
       WHERE actor_user_id = $1
         AND action IN ('FLEET_GROUP_DRIVER_REMOVED', 'FLEET_GROUP_JEEPNEY_REMOVED')`,
      [operatorA.id],
    );
    expect(auditRows.rows.map((row) => row.action).sort()).toEqual([
      'FLEET_GROUP_DRIVER_REMOVED',
      'FLEET_GROUP_JEEPNEY_REMOVED',
    ]);
  });

  it('associates a verified Driver by email and blocks cross-operator ownership', async () => {
    const unassigned = await createUser('DRIVER', 'Unassigned Driver');
    const operatorAToken = token(operatorA);
    const operatorBToken = token(operatorB);

    const association = await app.inject({
      method: 'POST',
      url: '/api/driver-associations',
      headers: authorization(operatorAToken),
      payload: { email: unassigned.email },
    });
    expect(association.statusCode).toBe(200);
    expect(association.json<{ association: { operatorId: string } }>().association.operatorId).toBe(operatorAId);

    const idempotent = await app.inject({
      method: 'POST',
      url: '/api/driver-associations',
      headers: authorization(operatorAToken),
      payload: { email: unassigned.email },
    });
    expect(idempotent.statusCode).toBe(200);

    const crossOperator = await app.inject({
      method: 'POST',
      url: '/api/driver-associations',
      headers: authorization(operatorBToken),
      payload: { email: unassigned.email },
    });
    expect(crossOperator.statusCode).toBe(409);
    expect(crossOperator.json<{ error: { code: string } }>().error.code).toBe('DRIVER_ALREADY_ASSOCIATED');

    const missing = await app.inject({
      method: 'POST',
      url: '/api/driver-associations',
      headers: authorization(operatorAToken),
      payload: { email: `missing-${randomUUID()}@example.com` },
    });
    expect(missing.statusCode).toBe(409);
    expect(missing.json<{ error: { code: string } }>().error.code).toBe('DRIVER_NOT_READY');

    const unverified = await repository.createUser({
      email: `unverified-${randomUUID()}@example.com`,
      passwordHash: null,
      displayName: 'Unverified Driver',
      role: 'DRIVER',
    });
    userIds.push(unverified.id);
    const unverifiedResponse = await app.inject({
      method: 'POST',
      url: '/api/driver-associations',
      headers: authorization(operatorAToken),
      payload: { email: unverified.email },
    });
    expect(unverifiedResponse.statusCode).toBe(409);
    expect(unverifiedResponse.json<{ error: { code: string } }>().error.code).toBe('DRIVER_NOT_READY');
  });

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

  async function createAdminUser(): Promise<User> {
    const user = await createUser('COMMUTER', 'Admin');
    await pool.query(
      `INSERT INTO user_roles(user_id, role) VALUES ($1, 'ADMIN')`,
      [user.id],
    );
    return { ...user, roles: [...user.roles, 'ADMIN'] };
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

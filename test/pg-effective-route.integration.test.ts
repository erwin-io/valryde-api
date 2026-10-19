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

describeDatabase('effective jeepney route contract with PostgreSQL', () => {
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
    jwtSecret: 'effective-route-secret-at-least-32-characters',
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
  let operator: User;

  beforeAll(async () => {
    app = await buildApp({ config, logger: false });
    const adminBase = await createUser('COMMUTER', 'Effective Route Admin');
    admin = await repository.addRole(adminBase.id, 'ADMIN');
    operator = await createUser('OPERATOR', 'Effective Route Operator');
  });

  afterAll(async () => {
    if (userIds.length > 0) {
      await pool.query('DELETE FROM audit_logs WHERE actor_user_id = ANY($1::uuid[])', [userIds]);
      await pool.query(
        'DELETE FROM vehicle_route_assignments WHERE assigned_by_user_id = ANY($1::uuid[])',
        [userIds],
      );
      await pool.query(
        'DELETE FROM fleet_groups WHERE operator_id IN (SELECT id FROM operators WHERE owner_user_id = ANY($1::uuid[]))',
        [userIds],
      );
      await pool.query('DELETE FROM jeepneys WHERE created_by_user_id = ANY($1::uuid[])', [userIds]);
      await pool.query(
        `DELETE FROM route_directions WHERE route_id IN (
           SELECT id FROM transit_routes WHERE route_code LIKE 'EFFECTIVE-%'
         )`,
      );
      await pool.query("DELETE FROM transit_routes WHERE route_code LIKE 'EFFECTIVE-%'");
      await pool.query('DELETE FROM operators WHERE owner_user_id = ANY($1::uuid[])', [userIds]);
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
    }
    await app.close();
    await pool.end();
  });

  it('resolves a direct assignment as the effective route', async () => {
    const directionId = await createDirection('DIRECT');
    const jeepneyId = await createJeepney('DIRECT');
    await assignRoute({ jeepneyId, routeDirectionId: directionId });

    const effective = await getEffectiveRoute(jeepneyId);
    expect(effective).toMatchObject({ source: 'DIRECT', groupId: null });
    expect(effective?.direction.id).toBe(directionId);
  });

  it('resolves one inherited group assignment when no direct assignment exists', async () => {
    const directionId = await createDirection('GROUP');
    const jeepneyId = await createJeepney('GROUP');
    const groupId = await createGroup('Group only');
    await addJeepneyToGroup(groupId, jeepneyId);
    await assignRoute({ groupId, routeDirectionId: directionId });

    const effective = await getEffectiveRoute(jeepneyId);
    expect(effective).toMatchObject({ source: 'GROUP', groupId });
    expect(effective?.direction.id).toBe(directionId);
  });

  it('uses a direct assignment in preference to an inherited group assignment', async () => {
    const groupDirectionId = await createDirection('PRECEDENCE-GROUP');
    const directDirectionId = await createDirection('PRECEDENCE-DIRECT');
    const jeepneyId = await createJeepney('PRECEDENCE');
    const groupId = await createGroup('Precedence');
    await addJeepneyToGroup(groupId, jeepneyId);
    await assignRoute({ jeepneyId, routeDirectionId: directDirectionId });
    await assignRoute({ groupId, routeDirectionId: groupDirectionId });

    const effective = await getEffectiveRoute(jeepneyId);
    expect(effective).toMatchObject({ source: 'DIRECT', groupId: null });
    expect(effective?.direction.id).toBe(directDirectionId);
  });

  it('rejects conflicts created by group assignment or later group membership', async () => {
    const firstDirectionId = await createDirection('CONFLICT-A');
    const secondDirectionId = await createDirection('CONFLICT-B');
    const jeepneyId = await createJeepney('CONFLICT-A');
    const firstGroupId = await createGroup('Conflict A');
    const secondGroupId = await createGroup('Conflict B');
    await addJeepneyToGroup(firstGroupId, jeepneyId);
    await addJeepneyToGroup(secondGroupId, jeepneyId);
    await assignRoute({ groupId: firstGroupId, routeDirectionId: firstDirectionId });

    const assignmentConflict = await assignRoute(
      { groupId: secondGroupId, routeDirectionId: secondDirectionId },
      409,
    );
    expect(assignmentConflict.json()).toMatchObject({
      error: { code: 'ROUTE_ASSIGNMENT_CONFLICT' },
    });

    const laterMemberId = await createJeepney('CONFLICT-B');
    const thirdGroupId = await createGroup('Conflict C');
    const fourthGroupId = await createGroup('Conflict D');
    await addJeepneyToGroup(thirdGroupId, laterMemberId);
    await assignRoute({ groupId: thirdGroupId, routeDirectionId: firstDirectionId });
    await assignRoute({ groupId: fourthGroupId, routeDirectionId: secondDirectionId });
    const membershipConflict = await app.inject({
      method: 'POST',
      url: `/api/fleet-groups/${fourthGroupId}/jeepneys`,
      headers: auth(token(operator)),
      payload: { jeepneyId: laterMemberId },
    });
    expect(membershipConflict.statusCode).toBe(409);
    expect(membershipConflict.json()).toMatchObject({
      error: { code: 'ROUTE_ASSIGNMENT_CONFLICT' },
    });
  });

  it('closes the prior direct assignment when effective route is reassigned', async () => {
    const firstDirectionId = await createDirection('REASSIGN-A');
    const secondDirectionId = await createDirection('REASSIGN-B');
    const jeepneyId = await createJeepney('REASSIGN');
    const first = await assignRoute({ jeepneyId, routeDirectionId: firstDirectionId });
    const firstAssignmentId = first.json<{ assignment: { id: string } }>().assignment.id;
    await assignRoute({ jeepneyId, routeDirectionId: secondDirectionId });

    const effective = await getEffectiveRoute(jeepneyId);
    expect(effective?.direction.id).toBe(secondDirectionId);
    const history = await pool.query<{ id: string; active_to: Date | null }>(
      `SELECT id, active_to FROM vehicle_route_assignments
       WHERE jeepney_id = $1 ORDER BY active_from`,
      [jeepneyId],
    );
    expect(history.rows).toHaveLength(2);
    expect(history.rows.find((row) => row.id === firstAssignmentId)?.active_to).toBeInstanceOf(Date);
    expect(history.rows.filter((row) => row.active_to === null)).toHaveLength(1);
  });

  async function createUser(role: 'COMMUTER' | 'OPERATOR', displayName: string): Promise<User> {
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

  async function createDirection(label: string): Promise<string> {
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const route = await app.inject({
      method: 'POST',
      url: '/api/admin/transit-routes',
      headers: auth(token(admin)),
      payload: {
        routeCode: `EFFECTIVE-${label.slice(0, 10)}-${suffix}`,
        publicName: `Effective ${label}`,
        routeColorHex: '#2468AC',
      },
    });
    expect(route.statusCode).toBe(201);
    const routeId = route.json<{ route: { id: string } }>().route.id;
    const direction = await app.inject({
      method: 'POST',
      url: `/api/admin/transit-routes/${routeId}/directions`,
      headers: auth(token(admin)),
      payload: {
        directionLabel: label,
        originName: 'Origin',
        destinationName: 'Destination',
        geometry: { type: 'LineString', coordinates: [[123.86, 10.26], [123.9, 10.3]] },
      },
    });
    expect(direction.statusCode).toBe(201);
    const directionId = direction.json<{ direction: { id: string } }>().direction.id;
    await app.inject({
      method: 'PATCH',
      url: `/api/admin/transit-routes/${routeId}`,
      headers: auth(token(admin)),
      payload: { status: 'ACTIVE' },
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/admin/route-directions/${directionId}`,
      headers: auth(token(admin)),
      payload: { status: 'ACTIVE' },
    });
    return directionId;
  }

  async function createJeepney(label: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/jeepneys',
      headers: auth(token(operator)),
      payload: { plateNo: `ER-${label}-${randomUUID().slice(0, 6)}`, colorHex: '#334455' },
    });
    expect(response.statusCode).toBe(201);
    return response.json<{ jeepney: { id: string } }>().jeepney.id;
  }

  async function createGroup(label: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/fleet-groups',
      headers: auth(token(operator)),
      payload: { name: `${label} ${randomUUID().slice(0, 8)}` },
    });
    expect(response.statusCode).toBe(201);
    return response.json<{ group: { id: string } }>().group.id;
  }

  async function addJeepneyToGroup(groupId: string, jeepneyId: string): Promise<void> {
    const response = await app.inject({
      method: 'POST',
      url: `/api/fleet-groups/${groupId}/jeepneys`,
      headers: auth(token(operator)),
      payload: { jeepneyId },
    });
    expect(response.statusCode).toBe(200);
  }

  async function assignRoute(
    payload: { routeDirectionId: string; jeepneyId?: string; groupId?: string },
    expectedStatus = 201,
  ) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/route-assignments',
      headers: auth(token(operator)),
      payload,
    });
    expect(response.statusCode).toBe(expectedStatus);
    return response;
  }

  async function getEffectiveRoute(jeepneyId: string): Promise<{
    source: 'DIRECT' | 'GROUP';
    groupId: string | null;
    direction: { id: string };
  } | null> {
    const response = await app.inject({
      method: 'GET',
      url: `/api/jeepneys/${jeepneyId}/effective-route`,
      headers: auth(token(operator)),
    });
    expect(response.statusCode).toBe(200);
    return response.json<{ effectiveRouteDirection: {
      source: 'DIRECT' | 'GROUP';
      groupId: string | null;
      direction: { id: string };
    } | null }>().effectiveRouteDirection;
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

function auth(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

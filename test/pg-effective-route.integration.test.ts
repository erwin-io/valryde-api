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
        `DELETE FROM driver_jeepney_assignments
         WHERE assigned_by_user_id = ANY($1::uuid[])
           OR driver_id IN (SELECT id FROM drivers WHERE user_id = ANY($1::uuid[]))`,
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
      await pool.query('DELETE FROM drivers WHERE user_id = ANY($1::uuid[])', [userIds]);
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

  it('allows an authorized Driver when the jeepney belongs to multiple groups and denies an unrelated Driver', async () => {
    const assignedDriver = await createUser('DRIVER', 'Assigned Effective Route Driver');
    const unrelatedDriver = await createUser('DRIVER', 'Unrelated Effective Route Driver');
    const assignedDriverId = await associateDriver(assignedDriver);
    await associateDriver(unrelatedDriver);
    const jeepneyId = await createJeepney('DRIVER-MULTI');
    const firstGroupId = await createGroup('Driver access A');
    const secondGroupId = await createGroup('Driver access B');
    await addJeepneyToGroup(firstGroupId, jeepneyId);
    await addJeepneyToGroup(secondGroupId, jeepneyId);

    const assignment = await app.inject({
      method: 'POST',
      url: `/api/jeepneys/${jeepneyId}/driver-assignment`,
      headers: auth(token(operator)),
      payload: { driverId: assignedDriverId },
    });
    expect(assignment.statusCode).toBe(201);

    const permitted = await app.inject({
      method: 'GET',
      url: `/api/jeepneys/${jeepneyId}/effective-route`,
      headers: auth(token(assignedDriver)),
    });
    expect(permitted.statusCode).toBe(200);
    expect(permitted.json()).toEqual({ effectiveRouteDirection: null });

    const denied = await app.inject({
      method: 'GET',
      url: `/api/jeepneys/${jeepneyId}/effective-route`,
      headers: auth(token(unrelatedDriver)),
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('lists scoped assignments and previews effective affected vehicles with direct precedence', async () => {
    const targetDirectionId = await createDirection('IMPACT-TARGET');
    const overrideDirectionId = await createDirection('IMPACT-OVERRIDE');
    const directJeepneyId = await createJeepney('IMPACT-DIRECT');
    const inheritedJeepneyId = await createJeepney('IMPACT-GROUP');
    const overriddenJeepneyId = await createJeepney('IMPACT-OVERRIDDEN');
    const groupId = await createGroup('Impact group');
    await addJeepneyToGroup(groupId, inheritedJeepneyId);
    await addJeepneyToGroup(groupId, overriddenJeepneyId);
    await assignRoute({ jeepneyId: directJeepneyId, routeDirectionId: targetDirectionId });
    await assignRoute({ groupId, routeDirectionId: targetDirectionId });
    await assignRoute({ jeepneyId: overriddenJeepneyId, routeDirectionId: overrideDirectionId });

    const otherOperator = await createUser('OPERATOR', 'Other Assignment Operator');
    const otherJeepneyResponse = await app.inject({
      method: 'POST',
      url: '/api/jeepneys',
      headers: auth(token(otherOperator)),
      payload: { plateNo: `ER-OTHER-${randomUUID().slice(0, 6)}`, colorHex: '#778899' },
    });
    expect(otherJeepneyResponse.statusCode).toBe(201);
    const otherJeepneyId = otherJeepneyResponse.json<{ jeepney: { id: string } }>().jeepney.id;
    const otherAssignment = await app.inject({
      method: 'POST',
      url: '/api/route-assignments',
      headers: auth(token(otherOperator)),
      payload: { jeepneyId: otherJeepneyId, routeDirectionId: targetDirectionId },
    });
    expect(otherAssignment.statusCode).toBe(201);

    const operatorList = await app.inject({
      method: 'GET',
      url: `/api/route-assignments?routeDirectionId=${targetDirectionId}&page=1&pageSize=1`,
      headers: auth(token(operator)),
    });
    expect(operatorList.statusCode).toBe(200);
    expect(operatorList.json()).toMatchObject({
      pagination: { page: 1, pageSize: 1, total: 2, totalPages: 2 },
    });
    expect(operatorList.json<{ assignments: unknown[] }>().assignments).toHaveLength(1);

    const driver = await createUser('DRIVER', 'Assignment Read Driver');
    const driverDenied = await app.inject({
      method: 'GET',
      url: '/api/route-assignments',
      headers: auth(token(driver)),
    });
    expect(driverDenied.statusCode).toBe(403);

    const impact = await app.inject({
      method: 'GET',
      url: `/api/admin/route-directions/${targetDirectionId}/assignment-impact?page=1&pageSize=20`,
      headers: auth(token(admin)),
    });
    expect(impact.statusCode, impact.body).toBe(200);
    expect(impact.json()).toMatchObject({
      impact: {
        routeDirectionId: targetDirectionId,
        activeDirectAssignmentCount: 2,
        activeGroupAssignmentCount: 1,
        affectedJeepneyCount: 3,
      },
      pagination: { page: 1, pageSize: 20, total: 3, totalPages: 1 },
    });
    const affected = impact.json<{ impact: { affectedJeepneys: Array<{ jeepneyId: string }> } }>()
      .impact.affectedJeepneys;
    expect(affected.map((item) => item.jeepneyId).sort()).toEqual(
      [directJeepneyId, inheritedJeepneyId, otherJeepneyId].sort(),
    );
    expect(affected.some((item) => item.jeepneyId === overriddenJeepneyId)).toBe(false);

    const nonAdminImpact = await app.inject({
      method: 'GET',
      url: `/api/admin/route-directions/${targetDirectionId}/assignment-impact`,
      headers: auth(token(operator)),
    });
    expect(nonAdminImpact.statusCode).toBe(403);

    const outOfRange = await app.inject({
      method: 'GET',
      url: `/api/admin/route-directions/${targetDirectionId}/assignment-impact?page=5&pageSize=20`,
      headers: auth(token(admin)),
    });
    expect(outOfRange.statusCode, outOfRange.body).toBe(200);
    expect(outOfRange.json()).toMatchObject({
      impact: {
        activeDirectAssignmentCount: 2,
        activeGroupAssignmentCount: 1,
        affectedJeepneyCount: 3,
        affectedJeepneys: [],
      },
      pagination: { page: 5, pageSize: 20, total: 3, totalPages: 1 },
    });

    const commuter = await createUser('COMMUTER', 'Assignment Read Commuter');
    for (const url of [
      '/api/route-assignments',
      `/api/admin/route-directions/${targetDirectionId}/assignment-impact`,
    ]) {
      const commuterDenied = await app.inject({ method: 'GET', url, headers: auth(token(commuter)) });
      expect(commuterDenied.statusCode, url).toBe(403);
      expect(commuterDenied.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    }

    const unknownDirection = await app.inject({
      method: 'GET',
      url: `/api/admin/route-directions/${randomUUID()}/assignment-impact`,
      headers: auth(token(admin)),
    });
    expect(unknownDirection.statusCode).toBe(404);
    expect(unknownDirection.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('rejects an impact preview instead of guessing through an inherited assignment conflict', async () => {
    const firstDirectionId = await createDirection('IMPACT-CONFLICT-A');
    const secondDirectionId = await createDirection('IMPACT-CONFLICT-B');
    const jeepneyId = await createJeepney('IMPACT-CONFLICT');
    const firstGroupId = await createGroup('Impact conflict A');
    const secondGroupId = await createGroup('Impact conflict B');
    await addJeepneyToGroup(firstGroupId, jeepneyId);
    await addJeepneyToGroup(secondGroupId, jeepneyId);
    await assignRoute({ groupId: firstGroupId, routeDirectionId: firstDirectionId });

    await pool.query(
      `INSERT INTO vehicle_route_assignments(group_id, route_direction_id, assigned_by_user_id)
       VALUES ($1, $2, $3)`,
      [secondGroupId, secondDirectionId, operator.id],
    );

    const response = await app.inject({
      method: 'GET',
      url: `/api/admin/route-directions/${firstDirectionId}/assignment-impact`,
      headers: auth(token(admin)),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'ROUTE_ASSIGNMENT_CONFLICT' } });

    // The per-jeepney resolver shares the same decision boundary.
    const resolved = await app.inject({
      method: 'GET',
      url: `/api/jeepneys/${jeepneyId}/effective-route`,
      headers: auth(token(operator)),
    });
    expect(resolved.statusCode).toBe(409);
    expect(resolved.json()).toMatchObject({ error: { code: 'ROUTE_ASSIGNMENT_CONFLICT' } });
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

  async function associateDriver(driver: User): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/driver-associations',
      remoteAddress: nextRemoteAddress(),
      headers: auth(token(operator)),
      payload: { email: driver.email },
    });
    expect(response.statusCode).toBe(200);
    return response.json<{ association: { driverId: string } }>().association.driverId;
  }

  async function createDirection(label: string): Promise<string> {
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const route = await app.inject({
      method: 'POST',
      url: '/api/admin/transit-routes',
      remoteAddress: nextRemoteAddress(),
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
      remoteAddress: nextRemoteAddress(),
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
      remoteAddress: nextRemoteAddress(),
      headers: auth(token(admin)),
      payload: { status: 'ACTIVE' },
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/admin/route-directions/${directionId}`,
      remoteAddress: nextRemoteAddress(),
      headers: auth(token(admin)),
      payload: { status: 'ACTIVE' },
    });
    return directionId;
  }

  async function createJeepney(label: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/jeepneys',
      remoteAddress: nextRemoteAddress(),
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
      remoteAddress: nextRemoteAddress(),
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
      remoteAddress: nextRemoteAddress(),
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
      remoteAddress: nextRemoteAddress(),
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

let remoteAddressSequence = 1;
function nextRemoteAddress(): string {
  remoteAddressSequence = (remoteAddressSequence % 250) + 1;
  return `127.0.1.${remoteAddressSequence}`;
}

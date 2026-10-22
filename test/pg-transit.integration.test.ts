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

describeDatabase('transit route API with PostgreSQL and PostGIS', () => {
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
    jwtSecret: 'transit-integration-secret-at-least-32-characters',
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
    const adminBase = await createUser('COMMUTER', 'Route Admin');
    admin = await repository.addRole(adminBase.id, 'ADMIN');
    operatorA = await createUser('OPERATOR', 'Route Operator A');
    operatorB = await createUser('OPERATOR', 'Route Operator B');
  });

  afterAll(async () => {
    if (userIds.length > 0) {
      await pool.query('DELETE FROM audit_logs WHERE actor_user_id = ANY($1::uuid[])', [userIds]);
      await pool.query(
        'DELETE FROM vehicle_route_assignments WHERE assigned_by_user_id = ANY($1::uuid[])',
        [userIds],
      );
      await pool.query('DELETE FROM jeepneys WHERE created_by_user_id = ANY($1::uuid[])', [userIds]);
      await pool.query(
        `DELETE FROM route_directions WHERE route_id IN (
           SELECT id FROM transit_routes WHERE route_code LIKE 'TEST-%'
         )`,
      );
      await pool.query("DELETE FROM transit_routes WHERE route_code LIKE 'TEST-%'");
      await pool.query('DELETE FROM operators WHERE owner_user_id = ANY($1::uuid[])', [userIds]);
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
    }
    await app.close();
    await pool.end();
  });

  it('restricts canonical geometry to Admin and assignments to operator ownership', async () => {
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const adminToken = token(admin);
    const operatorAToken = token(operatorA);
    const operatorBToken = token(operatorB);

    const deniedRoute = await app.inject({
      method: 'POST',
      url: '/api/admin/transit-routes',
      headers: auth(operatorAToken),
      payload: {
        routeCode: `TEST-DENIED-${suffix}`,
        publicName: 'Denied',
        routeColorHex: '#AA0000',
      },
    });
    expect(deniedRoute.statusCode).toBe(403);

    const routeResponse = await app.inject({
      method: 'POST',
      url: '/api/admin/transit-routes',
      headers: auth(adminToken),
      payload: {
        routeCode: `TEST-${suffix}`,
        publicName: 'Bulacao to Colon',
        routeColorHex: '#12AB34',
      },
    });
    expect(routeResponse.statusCode).toBe(201);
    const routeId = routeResponse.json<{ route: { id: string } }>().route.id;

    const invalidGeometry = await app.inject({
      method: 'POST',
      url: `/api/admin/transit-routes/${routeId}/directions`,
      headers: auth(adminToken),
      payload: {
        directionLabel: 'Outbound',
        originName: 'Bulacao',
        destinationName: 'Colon',
        geometry: { type: 'LineString', coordinates: [[200, 10], [123.9, 10.3]] },
      },
    });
    expect(invalidGeometry.statusCode).toBe(400);

    const directionResponse = await app.inject({
      method: 'POST',
      url: `/api/admin/transit-routes/${routeId}/directions`,
      headers: auth(adminToken),
      payload: {
        directionLabel: 'Outbound',
        originName: 'Bulacao',
        destinationName: 'Colon',
        geometry: {
          type: 'LineString',
          coordinates: [
            [123.86, 10.26],
            [123.9, 10.3],
          ],
        },
        corridorM: 100,
      },
    });
    expect(directionResponse.statusCode).toBe(201);
    const directionId = directionResponse.json<{ direction: { id: string } }>().direction.id;

    const inboundResponse = await app.inject({
      method: 'POST',
      url: `/api/admin/transit-routes/${routeId}/directions`,
      headers: auth(adminToken),
      payload: {
        directionLabel: 'Inbound',
        originName: 'Colon',
        destinationName: 'Bulacao',
        geometry: {
          type: 'LineString',
          coordinates: [
            [123.9, 10.3],
            [123.86, 10.26],
          ],
        },
      },
    });
    expect(inboundResponse.statusCode).toBe(201);
    const inboundId = inboundResponse.json<{ direction: { id: string } }>().direction.id;

    const duplicateLabelUpdate = await app.inject({
      method: 'PATCH',
      url: `/api/admin/route-directions/${inboundId}`,
      headers: auth(adminToken),
      payload: { directionLabel: 'Outbound' },
    });
    expect(duplicateLabelUpdate.statusCode).toBe(409);
    expect(duplicateLabelUpdate.json<{ error: { code: string; message: string } }>().error).toEqual(
      expect.objectContaining({
        code: 'CONFLICT',
        message: 'Direction label already exists for this route',
      }),
    );
    const persistedInbound = await pool.query<{ direction_label: string }>(
      'SELECT direction_label FROM route_directions WHERE id = $1',
      [inboundId],
    );
    expect(persistedInbound.rows[0]?.direction_label).toBe('Inbound');

    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/admin/transit-routes/${routeId}`,
          headers: auth(adminToken),
          payload: { status: 'ACTIVE' },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/admin/route-directions/${directionId}`,
          headers: auth(adminToken),
          payload: { status: 'ACTIVE' },
        })
      ).statusCode,
    ).toBe(200);

    const publicRoutes = await app.inject({
      method: 'GET',
      url: '/api/transit-routes?q=Colon&page=1&pageSize=1',
    });
    expect(publicRoutes.statusCode).toBe(200);
    const publicPayload = publicRoutes.json<{
      routes: { id: string; directions: { id: string; geometry: unknown }[] }[];
      pagination: { page: number; pageSize: number; total: number; totalPages: number };
    }>();
    expect(publicPayload.pagination).toMatchObject({ page: 1, pageSize: 1 });
    expect(publicPayload.pagination.total).toBeGreaterThanOrEqual(1);
    const publicRoute = publicPayload.routes.find((item) => item.id === routeId);
    expect(publicRoute?.directions[0]).toMatchObject({ id: directionId });
    expect(publicRoute?.directions[0]?.geometry).toEqual({
      type: 'LineString',
      coordinates: [
        [123.86, 10.26],
        [123.9, 10.3],
      ],
    });

    const routeDetails = await app.inject({ method: 'GET', url: `/api/transit-routes/${routeId}` });
    expect(routeDetails.statusCode).toBe(200);
    expect(routeDetails.json<{ route: { id: string } }>().route.id).toBe(routeId);

    const noSearchMatch = await app.inject({
      method: 'GET',
      url: '/api/transit-routes?q=definitely-no-route-match&page=1&pageSize=20',
    });
    expect(noSearchMatch.statusCode).toBe(200);
    expect(noSearchMatch.json<{ routes: unknown[]; pagination: { total: number } }>()).toMatchObject({
      routes: [],
      pagination: { total: 0 },
    });

    const jeepneyAId = await createJeepney(operatorAToken, `RA-${suffix}`);
    const jeepneyBId = await createJeepney(operatorBToken, `RB-${suffix}`);
    const assignment = await app.inject({
      method: 'POST',
      url: '/api/route-assignments',
      headers: auth(operatorAToken),
      payload: { jeepneyId: jeepneyAId, routeDirectionId: directionId },
    });
    expect(assignment.statusCode).toBe(201);

    const crossOperatorAssignment = await app.inject({
      method: 'POST',
      url: '/api/route-assignments',
      headers: auth(operatorAToken),
      payload: { jeepneyId: jeepneyBId, routeDirectionId: directionId },
    });
    expect(crossOperatorAssignment.statusCode).toBe(403);
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

  async function createJeepney(accessToken: string, plateNo: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/jeepneys',
      headers: auth(accessToken),
      payload: { plateNo, colorHex: '#334455' },
    });
    expect(response.statusCode).toBe(201);
    return response.json<{ jeepney: { id: string } }>().jeepney.id;
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

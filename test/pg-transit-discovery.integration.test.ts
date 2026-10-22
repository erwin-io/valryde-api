import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseSchema = process.env.TEST_DATABASE_SCHEMA ?? 'dbo';
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

// Fixtures sit on an isolated Palawan street so other suites' Cebu routes cannot match.
const lat = 9.5;
const west = 118.7;
const east = 118.74;

interface DiscoveryBody {
  candidates: Array<{
    route: { id: string };
    direction: { id: string };
    originDistanceM: number;
  }>;
  directRouteFound: boolean;
}

describeDatabase('direct transit discovery with PostgreSQL and PostGIS', () => {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${databaseSchema},public`,
  });
  const config: AppConfig = {
    environment: 'test',
    host: '127.0.0.1',
    port: 3000,
    logLevel: 'silent',
    corsOrigins: [],
    databaseUrl: databaseUrl ?? 'postgresql://unused',
    databaseSsl: false,
    databaseSchema,
    jwtSecret: 'discovery-integration-secret-at-least-32-characters',
    jwtIssuer: 'valryde-api-test',
    jwtAudience: 'valryde-test-clients',
    accessTokenTtlSeconds: 900,
    refreshTokenTtlDays: 30,
    authChallengeTtlMinutes: 30,
    authResendCooldownSeconds: 60,
    googleClientIds: [],
    email: { deliveryMode: 'disabled' },
  };
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const routeIds: string[] = [];
  let app: Awaited<ReturnType<typeof buildApp>>;
  let forwardId: string;
  let reverseId: string;
  let routeCode: string;

  async function route(code: string, status: string): Promise<string> {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO transit_routes(route_code, public_name, route_color_hex, status)
       VALUES ($1, $2, '#43A047', $3::record_status) RETURNING id`,
      [code, `Discovery ${code}`, status],
    );
    const id = result.rows[0]?.id ?? '';
    routeIds.push(id);
    return id;
  }

  async function direction(routeId: string, label: string, coordinates: number[][], status = 'ACTIVE') {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO route_directions(route_id, direction_label, origin_name, destination_name, geometry, status)
       VALUES ($1, $2, 'West', 'East', ST_SetSRID(ST_GeomFromGeoJSON($3), 4326), $4::record_status)
       RETURNING id`,
      [routeId, label, JSON.stringify({ type: 'LineString', coordinates }), status],
    );
    return result.rows[0]?.id ?? '';
  }

  beforeAll(async () => {
    app = await buildApp({ config, logger: false });
    routeCode = `TEST-DISC-${suffix}`;
    const active = await route(routeCode, 'ACTIVE');
    forwardId = await direction(active, 'Eastbound', [[west, lat], [east, lat]]);
    reverseId = await direction(active, 'Westbound', [[east, lat], [west, lat]]);
    const draft = await route(`TEST-DISC-DRAFT-${suffix}`, 'DRAFT');
    await direction(draft, 'Eastbound', [[west, lat], [east, lat]]);
    const originOnly = await route(`TEST-DISC-ORIGIN-${suffix}`, 'ACTIVE');
    await direction(originOnly, 'Northbound', [[west + 0.005, lat - 0.02], [west + 0.005, lat + 0.02]]);
  });

  afterAll(async () => {
    if (routeIds.length > 0) {
      await pool.query('DELETE FROM route_directions WHERE route_id = ANY($1::uuid[])', [routeIds]);
      await pool.query('DELETE FROM transit_routes WHERE id = ANY($1::uuid[])', [routeIds]);
    }
    await app.close();
    await pool.end();
  });

  // Origin and destination sit about 55 m north of the street.
  const discover = (query: Record<string, number>) =>
    app.inject({
      method: 'GET',
      url: `/api/transit-routes/discover?${new URLSearchParams(
        Object.entries({
          lat: lat + 0.0005,
          lng: west + 0.005,
          destinationLat: lat + 0.0005,
          destinationLng: east - 0.005,
          ...query,
        }).map(([key, value]): [string, string] => [key, String(value)]),
      ).toString()}`,
    });

  it('returns only the active direction travelling from origin to destination, without auth', async () => {
    const response = await discover({});
    expect(response.statusCode).toBe(200);
    const body = response.json<DiscoveryBody>();
    expect(body.directRouteFound).toBe(true);
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0]).toMatchObject({
      route: { id: routeIds[0], routeCode, routeColorHex: '#43A047' },
      direction: { id: forwardId, directionLabel: 'Eastbound', originName: 'West', destinationName: 'East' },
    });
    expect(body.candidates[0]?.originDistanceM).toBeGreaterThanOrEqual(50);
    expect(body.candidates[0]?.originDistanceM).toBeLessThanOrEqual(60);
    expect(body.candidates.map((c) => c.direction.id)).not.toContain(reverseId);
  });

  it('finds the reverse direction when travelling the other way', async () => {
    const response = await discover({ lng: east - 0.005, destinationLng: west + 0.005 });
    expect(response.json<DiscoveryBody>().candidates.map((c) => c.direction.id))
      .toEqual([reverseId]);
  });

  it('respects the maxWalkM boundary', async () => {
    const tooFar = await discover({ maxWalkM: 50 });
    expect(tooFar.json()).toEqual({ candidates: [], directRouteFound: false });
    const nearEnough = await discover({ maxWalkM: 60 });
    expect(nearEnough.json<DiscoveryBody>().candidates).toHaveLength(1);
  });

  it('returns directRouteFound=false when no single route serves both points', async () => {
    const response = await discover({ destinationLat: lat + 0.05, destinationLng: east + 0.05 });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ candidates: [], directRouteFound: false });
  });

  it.each([
    [{ lat: 35 }],
    [{ destinationLng: 140 }],
    [{ maxWalkM: 1001 }],
    [{ maxWalkM: 49 }],
    [{ limit: 11 }],
  ])('rejects %o with 400 VALIDATION_ERROR', async (query) => {
    const response = await discover(query);
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR');
  });
});

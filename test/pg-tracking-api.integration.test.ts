import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { bumpTrackingContexts, lockTrackingContexts } from '../src/db/tracking-context.js';
import type { User } from '../src/domain/identity.js';
import { PgIdentityRepository } from '../src/repositories/pg-identity-repository.js';
import { TrackingContextService } from '../src/services/tracking-context-service.js';
import { TransitService } from '../src/services/transit-service.js';
import { TrackingLeaseService, type WriterLease } from '../src/tracking/tracking-lease.js';
import {
  type DeviceStatusObservation, type TrackingObservation, TrackingStateWriter,
} from '../src/tracking/tracking-state-writer.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseSchema = process.env.TEST_DATABASE_SCHEMA ?? 'dbo';
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;
const leaseTestMutex = 8_642_100_013;

type Json = Record<string, unknown>;
interface Vehicle { jeepneyId: string; uniqueId: string; deviceId: string; gpsDeviceId: string }

// Runnable end-to-end slice: Bridge-shaped observations → fenced writer (real A006 context) →
// proposed T1–T3 over the real Fastify app with role JWTs. Live persistence stays disabled elsewhere.
describeDatabase('Stage 13b status ingestion and proposed T1–T3 tracking REST', () => {
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${databaseSchema},public`, max: 12 });
  const repository = new PgIdentityRepository(pool);
  const contexts = new TrackingContextService(new TransitService(pool));
  const writer = new TrackingStateWriter(pool, contexts);
  const leases = new TrackingLeaseService(pool);
  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const jeepneyIds: string[] = [];
  const config: AppConfig = {
    environment: 'test', host: '127.0.0.1', port: 3000, logLevel: 'silent', corsOrigins: [],
    databaseUrl: databaseUrl ?? 'postgresql://unused', databaseSsl: false, databaseSchema,
    jwtSecret: 'tracking-api-integration-secret-at-least-32-chars', jwtIssuer: 'valryde-api-test',
    jwtAudience: 'valryde-test-clients', accessTokenTtlSeconds: 900, refreshTokenTtlDays: 30,
    authChallengeTtlMinutes: 30, authResendCooldownSeconds: 60, googleClientIds: [],
    email: { deliveryMode: 'disabled' }, trackingApiEnabled: true,
  };
  let app: Awaited<ReturnType<typeof buildApp>>;
  let mutex: pg.PoolClient;
  let lease: WriterLease;
  let operatorA: User, operatorB: User, driverAssigned: User, driverGroup: User, commuter: User, admin: User;
  let operatorAId: string, operatorBId: string, directionId: string, groupId: string;
  let own: Vehicle, offRoute: Vehicle, untracked: Vehicle, other: Vehicle;
  let sequence = 0;
  let positionId = 50_000;

  beforeAll(async () => {
    mutex = await pool.connect();
    await mutex.query('SELECT pg_advisory_lock($1)', [leaseTestMutex]);
    await pool.query(`UPDATE tracking_bridge_leases SET owner_id = NULL, expires_at = NULL, heartbeat_at = NULL,
      phase = 'STOPPED' WHERE deployment_key = 'primary'`);
    lease = await acquired();
    app = await buildApp({ config, logger: false });
    [operatorA, operatorB, driverAssigned, driverGroup, commuter] = await Promise.all([
      createUser('OPERATOR'), createUser('OPERATOR'), createUser('DRIVER'), createUser('DRIVER'), createUser('COMMUTER'),
    ]);
    admin = await repository.addRole((await createUser('COMMUTER')).id, 'ADMIN');
    operatorAId = await operatorOf(operatorA);
    operatorBId = await operatorOf(operatorB);
    const route = await pool.query<{ id: string }>(
      `INSERT INTO transit_routes(route_code, public_name, route_color_hex, status)
       VALUES ($1, 'API route', '#445566', 'ACTIVE') RETURNING id`, [`B5-${suffix}`]);
    directionId = (await pool.query<{ id: string }>(
      `INSERT INTO route_directions(route_id, direction_label, origin_name, destination_name, geometry, status)
       VALUES ($1, 'OUTBOUND', 'A', 'B', ST_GeomFromText('LINESTRING(123.88 10.29,123.88 10.31)', 4326), 'ACTIVE')
       RETURNING id`, [route.rows[0]?.id])).rows[0]?.id ?? '';
    own = await vehicle(operatorAId);
    offRoute = await vehicle(operatorAId);
    untracked = await vehicle(operatorAId);
    other = await vehicle(operatorBId);
    const drivers = await pool.query<{ id: string; user_id: string }>(
      'UPDATE drivers SET operator_id = $1 WHERE user_id = ANY($2::uuid[]) RETURNING id, user_id',
      [operatorAId, [driverAssigned.id, driverGroup.id]]);
    const driverId = (user: User) => drivers.rows.find((row) => row.user_id === user.id)?.id;
    await pool.query(
      'INSERT INTO driver_jeepney_assignments(driver_id, jeepney_id, assigned_by_user_id) VALUES ($1, $2, $3)',
      [driverId(driverAssigned), own.jeepneyId, operatorA.id]);
    groupId = (await pool.query<{ id: string }>(
      'INSERT INTO fleet_groups(operator_id, name) VALUES ($1, $2) RETURNING id', [operatorAId, `B5 ${suffix}`])).rows[0]?.id ?? '';
    await pool.query('INSERT INTO fleet_group_jeepneys(group_id, jeepney_id) VALUES ($1, $2), ($1, $3)',
      [groupId, own.jeepneyId, offRoute.jeepneyId]);
    await pool.query('INSERT INTO fleet_group_drivers(group_id, driver_id) VALUES ($1, $2)', [groupId, driverId(driverGroup)]);

    // Bridge-shaped ingestion: connectivity first, then fixes, exactly as TrackingPersistence orders a batch.
    for (const item of [own, offRoute, other]) await status(item, 'online', await dbNow(-1_000));
    await writer.apply(fix(own, await dbNow(-1_000), { motion: true }), lease);
    await writer.apply(fix(other, await dbNow(-1_000)), lease);
    const away = { latitude: 10.3, longitude: 123.8853 }; // ~300 m east of the corridor
    for (const offset of [-3_000, -2_000, -1_000]) await writer.apply(fix(offRoute, await dbNow(offset), away), lease);
  }, 60_000);

  afterAll(async () => {
    try {
      await pool.query(`UPDATE tracking_bridge_leases SET owner_id = NULL, expires_at = NULL, heartbeat_at = NULL,
        phase = 'STOPPED' WHERE deployment_key = 'primary'`);
      await pool.query('DELETE FROM route_compliance_events WHERE jeepney_id = ANY($1::uuid[])', [jeepneyIds]);
      await pool.query('DELETE FROM vehicle_latest_states WHERE jeepney_id = ANY($1::uuid[])', [jeepneyIds]);
      await pool.query('DELETE FROM traccar_device_mappings WHERE jeepney_id = ANY($1::uuid[])', [jeepneyIds]);
      await pool.query('DELETE FROM gps_devices WHERE serial_number LIKE $1', [`B5-${suffix}-%`]);
      await pool.query('DELETE FROM gps_setup_requests WHERE jeepney_id = ANY($1::uuid[])', [jeepneyIds]);
      await pool.query('DELETE FROM vehicle_applications WHERE jeepney_id = ANY($1::uuid[])', [jeepneyIds]);
      await pool.query('DELETE FROM vehicle_route_assignments WHERE jeepney_id = ANY($1::uuid[])', [jeepneyIds]);
      await pool.query('DELETE FROM driver_jeepney_assignments WHERE jeepney_id = ANY($1::uuid[])', [jeepneyIds]);
      await pool.query('DELETE FROM fleet_groups WHERE operator_id = ANY($1::uuid[])', [[operatorAId, operatorBId]]);
      await pool.query('DELETE FROM jeepneys WHERE id = ANY($1::uuid[])', [jeepneyIds]);
      await pool.query('DELETE FROM route_directions WHERE id = $1', [directionId]);
      await pool.query('DELETE FROM transit_routes WHERE route_code = $1', [`B5-${suffix}`]);
      await pool.query('DELETE FROM drivers WHERE user_id = ANY($1::uuid[])', [userIds]);
      await pool.query('DELETE FROM operators WHERE owner_user_id = ANY($1::uuid[])', [userIds]);
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
      await mutex.query('SELECT pg_advisory_unlock($1)', [leaseTestMutex]);
    } finally {
      mutex.release();
      await app.close();
      await pool.end();
    }
  });

  it('orders connectivity by Traccar lastUpdate: delayed, duplicated, conflicting and untimed observations', async () => {
    const at = await dbNow(-500);
    expect(await status(own, 'online', at)).toMatchObject({ disposition: 'APPLIED' });
    expect(await status(own, 'online', at)).toMatchObject({ disposition: 'DUPLICATE', materializedChange: false });
    expect(await status(own, 'offline', at - 10_000)).toMatchObject({ disposition: 'OUT_OF_ORDER' });
    expect(await status(own, 'offline', null)).toMatchObject({ disposition: 'OUT_OF_ORDER' });
    expect(await status(own, 'online', at + 60_000)).toMatchObject({ disposition: 'REJECTED', reason: 'CLOCK_AHEAD' });
    // Same instant, different report: neither is trusted.
    expect(await status(own, 'offline', at)).toMatchObject({ disposition: 'APPLIED', reason: 'STATUS_CONFLICT' });
    expect(await state(own)).toMatchObject({ tracker_status: 'UNKNOWN', status_source: 'DEVICE', status_epoch: lease.fence });
    expect(await status(own, 'online', at + 100)).toMatchObject({ disposition: 'APPLIED', reason: null });
    // A never-connected device (no lastUpdate) is UNKNOWN, not a confirmed OFFLINE.
    expect(await status(untracked, 'offline', null, 'REST_RECONCILIATION')).toMatchObject({ disposition: 'APPLIED' });
    expect(await state(untracked)).toMatchObject({ tracker_status: 'UNKNOWN', status_source: 'REST_RECONCILIATION', fix_time: null });
    expect(await writer.applyStatus({ ...statusOf(own, 'online', null), uniqueId: `unmapped-${suffix}` }, lease))
      .toMatchObject({ disposition: 'UNMAPPED' });
  });

  it('T1 serves only ONLINE, fresh, ON_ROUTE, eligible vehicles with public-safe fields and no-store', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/tracking/route-directions/${directionId}/vehicles` });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = response.json<Json & { vehicles: Json[] }>();
    expect(body).toMatchObject({ schemaVersion: 1, complete: true, scope: { kind: 'ROUTE_DIRECTION', id: directionId } });
    expect(body.vehicles.map((v) => v.jeepneyId).sort()).toEqual([own.jeepneyId, other.jeepneyId].sort());
    expect(body.count).toBe(2);
    const mine = body.vehicles.find((v) => v.jeepneyId === own.jeepneyId);
    expect(Object.keys(mine ?? {}).sort()).toEqual([
      'availableUntil', 'directionId', 'jeepneyId', 'lastSuccessfulUpdateAt', 'motionStatus', 'physicalColorHex',
      'plateNo', 'position', 'routeCompliance', 'routeId', 'stateRevision', 'trackerStatus',
    ]);
    expect(mine).toMatchObject({ trackerStatus: 'ONLINE', motionStatus: 'MOVING', routeCompliance: 'ON_ROUTE' });
    expect(body.vehicles.find((v) => v.jeepneyId === other.jeepneyId)).toMatchObject({ motionStatus: 'UNKNOWN' });
    expect(response.body).not.toMatch(new RegExp([own.uniqueId, other.uniqueId, operatorAId, 'fence', 'imei'].join('|')));

    expect((await app.inject({ method: 'GET', url: `/api/tracking/route-directions/${randomUUID()}/vehicles` })).statusCode)
      .toBe(404);
  });

  it('T2 scopes by role and keeps connectivity, freshness and movement separate', async () => {
    const operatorView = await get('/api/tracking/vehicles', operatorA);
    expect(operatorView.statusCode).toBe(200);
    const body = operatorView.json<Json & { vehicles: Json[]; summary: Json }>();
    expect(body.vehicles.map((v) => v.jeepneyId).sort()).toEqual([own, offRoute, untracked].map((v) => v.jeepneyId).sort());
    expect(body.summary).toMatchObject({ total: 3, online: 2, unknown: 1, moving: 1, onRoute: 1, offRoute: 1 });
    const deviating = body.vehicles.find((v) => v.jeepneyId === offRoute.jeepneyId);
    expect(deviating).toMatchObject({
      relation: ['OWNED'], positionIsLastKnown: false,
      tracking: { trackerStatus: 'ONLINE', locationStatus: 'CURRENT', routeCompliance: 'OFF_ROUTE', motionStatus: 'UNKNOWN' },
    });
    expect((deviating?.tracking as Json).deviation).toMatchObject({ corridorM: 100 });
    expect(body.vehicles.find((v) => v.jeepneyId === untracked.jeepneyId)).toMatchObject({
      tracking: { trackerStatus: 'UNKNOWN', locationStatus: 'NONE' }, position: null,
    });

    const assigned = (await get('/api/tracking/vehicles', driverAssigned)).json<{ vehicles: Json[] }>();
    expect(assigned.vehicles.map((v) => [v.jeepneyId, v.relation])).toEqual([[own.jeepneyId, ['ASSIGNED']]]);
    const grouped = (await get(`/api/tracking/vehicles?groupId=${groupId}`, driverGroup)).json<{ vehicles: Json[] }>();
    expect(grouped.vehicles.map((v) => v.jeepneyId).sort()).toEqual([own.jeepneyId, offRoute.jeepneyId].sort());
    expect(grouped.vehicles.every((v) => (v.relation as string[]).includes('GROUP'))).toBe(true);
    expect((await get('/api/tracking/vehicles', operatorB)).json<{ vehicles: Json[] }>().vehicles.map((v) => v.jeepneyId))
      .toEqual([other.jeepneyId]);

    expect((await get('/api/tracking/vehicles', commuter)).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/tracking/vehicles' })).statusCode).toBe(401);
  });

  it('T3 uses Agent A private visibility: 403 outside scope, PLATFORM for Admin, null tracking without state', async () => {
    expect((await get(`/api/tracking/jeepneys/${own.jeepneyId}/latest`, operatorB)).statusCode).toBe(403);
    const adminView = await get(`/api/tracking/jeepneys/${own.jeepneyId}/latest`, admin);
    expect(adminView.statusCode).toBe(200);
    expect(adminView.json()).toMatchObject({ vehicle: { relation: ['PLATFORM'], tracking: { locationStatus: 'CURRENT' } } });
    const bare = await vehicle(operatorAId);
    expect((await get(`/api/tracking/jeepneys/${bare.jeepneyId}/latest`, operatorA)).json())
      .toMatchObject({ vehicle: { tracking: null, position: null, stateRevision: null } });
  });

  it('a disconnected tracker keeps its fresh fix private but leaves public availability', async () => {
    await status(other, 'offline', await dbNow(0));
    const publicIds = (await app.inject({ method: 'GET', url: `/api/tracking/route-directions/${directionId}/vehicles` }))
      .json<{ vehicles: Json[] }>().vehicles.map((v) => v.jeepneyId);
    expect(publicIds).not.toContain(other.jeepneyId);
    expect((await get(`/api/tracking/jeepneys/${other.jeepneyId}/latest`, operatorB)).json()).toMatchObject({
      vehicle: { tracking: { trackerStatus: 'OFFLINE', locationStatus: 'CURRENT' } },
    });
  });

  it('stale fixes, a lost writer lease and an A006 context change are never shown as live', async () => {
    const stale = await vehicle(operatorAId);
    await status(stale, 'online', await dbNow(0));
    await writer.apply(fix(stale, await dbNow(-31_000)), lease);
    expect((await get(`/api/tracking/jeepneys/${stale.jeepneyId}/latest`, operatorA)).json()).toMatchObject({
      vehicle: { positionIsLastKnown: true, tracking: { locationStatus: 'LAST_KNOWN', reason: 'STALE_FIX', availableUntil: null } },
    });

    expect(await leases.release(lease)).toBe(true);
    const leaseless = (await app.inject({ method: 'GET', url: `/api/tracking/route-directions/${directionId}/vehicles` }))
      .json<{ vehicles: Json[] }>();
    expect(leaseless.vehicles).toEqual([]);
    expect((await get(`/api/tracking/jeepneys/${own.jeepneyId}/latest`, operatorA)).json()).toMatchObject({
      vehicle: {
        positionIsLastKnown: true,
        tracking: { trackerStatus: 'UNKNOWN', locationStatus: 'LAST_KNOWN', reason: 'WRITER_UNAVAILABLE', routeCompliance: 'UNKNOWN' },
      },
    });
    lease = await acquired();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await lockTrackingContexts(client, [own.jeepneyId]);
      await bumpTrackingContexts(client, [own.jeepneyId]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    expect((await get(`/api/tracking/jeepneys/${own.jeepneyId}/latest`, operatorA)).json()).toMatchObject({
      vehicle: { position: null, routeId: null, tracking: { reason: 'CONTEXT_CHANGED', locationStatus: 'NONE' } },
    });
  });

  it('is not registered unless TRACKING_API_ENABLED is true', async () => {
    const disabled = await buildApp({ config: { ...config, trackingApiEnabled: false }, logger: false });
    try {
      expect((await disabled.inject({ method: 'GET', url: `/api/tracking/route-directions/${directionId}/vehicles` })).statusCode)
        .toBe(404);
    } finally {
      await disabled.close();
    }
  });

  async function get(url: string, user: User) {
    return app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token(user)}` } });
  }

  function token(user: User): string {
    return app.jwt.sign({ sub: user.id, roles: user.roles, ver: user.credentialsVersion, type: 'access' });
  }

  function statusOf(item: Vehicle, reported: string, lastUpdate: number | null,
    source: DeviceStatusObservation['source'] = 'DEVICE'): DeviceStatusObservation {
    sequence += 1;
    return {
      deviceId: item.deviceId, uniqueId: item.uniqueId, status: reported,
      lastUpdate: lastUpdate === null ? null : new Date(lastUpdate).toISOString(), source, sequence: String(sequence),
    };
  }

  function status(item: Vehicle, reported: string, lastUpdate: number | null,
    source: DeviceStatusObservation['source'] = 'DEVICE') {
    return writer.applyStatus(statusOf(item, reported, lastUpdate, source), lease);
  }

  function fix(item: Vehicle, fixMs: number, overrides: Partial<TrackingObservation> = {}): TrackingObservation {
    const time = new Date(fixMs).toISOString();
    positionId += 1;
    return {
      deviceId: item.deviceId, uniqueId: item.uniqueId, positionId: String(positionId), valid: true,
      latitude: 10.3, longitude: 123.88, fixTime: time, deviceTime: time, serverTime: time,
      speedKph: 20, heading: 0, receivedAt: new Date().toISOString(), ...overrides,
    };
  }

  async function vehicle(operatorId: string): Promise<Vehicle> {
    const owner = operatorId === operatorAId ? operatorA : operatorB;
    const jeepneyId = (await pool.query<{ id: string }>(
      `INSERT INTO jeepneys(operator_id, created_by_user_id, plate_no, color_hex, status)
       VALUES ($1, $2, $3, '#112233', 'ACTIVE') RETURNING id`,
      [operatorId, owner.id, `B5-${suffix}-${randomUUID().slice(0, 6)}`])).rows[0]?.id ?? '';
    jeepneyIds.push(jeepneyId);
    const application = await pool.query<{ id: string }>(
      `INSERT INTO vehicle_applications(jeepney_id, submitted_by_user_id, status, reviewed_by_user_id, reviewed_at)
       VALUES ($1, $2, 'APPROVED', $3, now()) RETURNING id`, [jeepneyId, owner.id, admin.id]);
    const request = await pool.query<{ id: string }>(
      `INSERT INTO gps_setup_requests(vehicle_application_id, jeepney_id, requested_by_user_id, status,
         scheduled_at, installed_at, verification_status, verified_by_user_id, verified_at)
       VALUES ($1, $2, $3, 'INSTALLED', now(), now(), 'VERIFIED', $4, now()) RETURNING id`,
      [application.rows[0]?.id, jeepneyId, owner.id, admin.id]);
    const gpsDeviceId = (await pool.query<{ id: string }>(
      'INSERT INTO gps_devices(imei, serial_number) VALUES ($1, $2) RETURNING id',
      [String(100_000_000_000_000 + Math.floor(Math.random() * 899_999_999_999_999)), `B5-${suffix}-${randomUUID().slice(0, 8)}`],
    )).rows[0]?.id ?? '';
    const uniqueId = `b5-${randomUUID()}`;
    await pool.query(
      `INSERT INTO traccar_device_mappings(gps_setup_request_id, gps_device_id, jeepney_id, traccar_unique_id,
         mapped_by_user_id, mapped_at) VALUES ($1, $2, $3, $4, $5, clock_timestamp() - interval '1 minute')`,
      [request.rows[0]?.id, gpsDeviceId, jeepneyId, uniqueId, admin.id]);
    await pool.query('INSERT INTO vehicle_route_assignments(jeepney_id, route_direction_id, assigned_by_user_id) VALUES ($1, $2, $3)',
      [jeepneyId, directionId, owner.id]);
    await pool.query(`UPDATE jeepneys SET tracking_context_changed_at = clock_timestamp() - interval '1 minute' WHERE id = $1`,
      [jeepneyId]);
    return { jeepneyId, uniqueId, deviceId: String(jeepneyIds.length + 700), gpsDeviceId };
  }

  async function createUser(role: 'COMMUTER' | 'DRIVER' | 'OPERATOR'): Promise<User> {
    const user = await repository.createUser({
      email: `b5-${role.toLowerCase()}-${randomUUID()}@example.com`, passwordHash: null,
      displayName: `B5 ${role}`, role, emailVerifiedAt: new Date(),
    });
    userIds.push(user.id);
    return user;
  }

  async function operatorOf(user: User): Promise<string> {
    return (await pool.query<{ id: string }>('SELECT id FROM operators WHERE owner_user_id = $1', [user.id])).rows[0]?.id ?? '';
  }

  async function state(item: Vehicle): Promise<Json> {
    return (await pool.query<Json>(
      `SELECT *, status_epoch::text AS status_epoch FROM vehicle_latest_states WHERE jeepney_id = $1`,
      [item.jeepneyId])).rows[0] ?? {};
  }

  async function dbNow(offsetMs: number): Promise<number> {
    return ((await pool.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]?.now ?? new Date()).getTime() + offsetMs;
  }

  async function acquired(): Promise<WriterLease> {
    const taken = await leases.acquire(randomUUID());
    if (taken === null) throw new Error('Lease was not acquired');
    return taken;
  }
});

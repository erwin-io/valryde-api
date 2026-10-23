import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bumpTrackingContexts, lockTrackingContexts } from '../src/db/tracking-context.js';
import { TrackingContextService } from '../src/services/tracking-context-service.js';
import { TransitService } from '../src/services/transit-service.js';
import { LeaseLostError, TrackingLeaseService, type WriterLease } from '../src/tracking/tracking-lease.js';
import { TrackingStateWriter, type TrackingObservation } from '../src/tracking/tracking-state-writer.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;
const schema = process.env.TEST_DATABASE_SCHEMA ?? 'dbo';
// Session lock shared with the schema test: the primary lease row is a singleton.
const leaseTestMutex = 8_642_100_013;

type Row = Record<string, unknown>;

// Stage 13b B2 evidence on real PostgreSQL/PostGIS with Agent A's A006 context (not a stub).
describeDatabase('Stage 13b B2 durable tracking writer', () => {
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 12 });
  const contexts = new TrackingContextService(new TransitService(pool));
  const leases = new TrackingLeaseService(pool);
  const writer = new TrackingStateWriter(pool, contexts);
  const suffix = randomUUID().slice(0, 8);
  const jeepneyIds: string[] = [];
  let mutex: pg.PoolClient;
  let userId: string;
  let directionId: string;
  let lease: WriterLease;
  let positionSequence = 1_000;

  beforeAll(async () => {
    mutex = await pool.connect();
    await mutex.query('SELECT pg_advisory_lock($1)', [leaseTestMutex]);
    await releaseLease();
    userId = randomUUID();
    await pool.query('INSERT INTO users(id, email, display_name) VALUES ($1, $2, $3)',
      [userId, `${userId}@writer.example.test`, 'Writer fixture']);
    const route = await pool.query<{ id: string }>(
      `INSERT INTO transit_routes(route_code, public_name, route_color_hex, status)
       VALUES ($1, 'Writer route', '#445566', 'ACTIVE') RETURNING id`, [`B2-${suffix}`]);
    const direction = await pool.query<{ id: string }>(
      `INSERT INTO route_directions(route_id, direction_label, origin_name, destination_name, geometry, status)
       VALUES ($1, 'OUTBOUND', 'A', 'B', ST_GeomFromText('LINESTRING(123.88 10.29,123.88 10.31)', 4326), 'ACTIVE')
       RETURNING id`, [route.rows[0]?.id]);
    directionId = direction.rows[0]?.id ?? '';
    lease = await acquired(randomUUID());
  });

  afterAll(async () => {
    try {
      await releaseLease();
      await pool.query('DELETE FROM vehicle_latest_states WHERE jeepney_id = ANY($1::uuid[])', [jeepneyIds]);
      await pool.query('DELETE FROM traccar_device_mappings WHERE jeepney_id = ANY($1::uuid[])', [jeepneyIds]);
      await pool.query(
        'DELETE FROM gps_devices WHERE id NOT IN (SELECT gps_device_id FROM traccar_device_mappings) AND serial_number LIKE $1',
        [`B2-${suffix}-%`]);
      await pool.query('DELETE FROM gps_setup_requests WHERE jeepney_id = ANY($1::uuid[])', [jeepneyIds]);
      await pool.query('DELETE FROM vehicle_applications WHERE jeepney_id = ANY($1::uuid[])', [jeepneyIds]);
      await pool.query('DELETE FROM vehicle_route_assignments WHERE jeepney_id = ANY($1::uuid[])', [jeepneyIds]);
      await pool.query('DELETE FROM jeepneys WHERE id = ANY($1::uuid[])', [jeepneyIds]);
      await pool.query('DELETE FROM route_directions WHERE id = $1', [directionId]);
      await pool.query('DELETE FROM transit_routes WHERE route_code = $1', [`B2-${suffix}`]);
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
      await mutex.query('SELECT pg_advisory_unlock($1)', [leaseTestMutex]);
    } finally {
      mutex.release();
      await pool.end();
    }
  });

  it('fences the lease: one live owner, heartbeat, release, and a new fence on every acquisition', async () => {
    const other = randomUUID();
    expect(await leases.acquire(other)).toBeNull();
    expect(await leases.heartbeat(lease)).toBe(true);
    expect(await leases.release({ ownerId: other, fence: lease.fence })).toBe(false);
    expect(await leases.release(lease)).toBe(true);
    expect(await leases.heartbeat(lease)).toBe(false);
    const takeover = await acquired(other);
    expect(BigInt(takeover.fence)).toBe(BigInt(lease.fence) + 1n);

    // Expiry is judged on the DB clock: an expired owner cannot heartbeat and a new owner takes over.
    await pool.query(`UPDATE tracking_bridge_leases SET expires_at = clock_timestamp() - interval '1 second'
      WHERE deployment_key = 'primary'`);
    expect(await leases.heartbeat(takeover)).toBe(false);
    lease = await acquired(randomUUID());
    expect(BigInt(lease.fence)).toBe(BigInt(takeover.fence) + 1n);
  });

  it('applies a valid eligible fix once, privately, with compliance left UNKNOWN for B3', async () => {
    const vehicle = await eligibleVehicle();
    const fix = await dbNow(-2_000);
    const result = await writer.apply(observation(vehicle, fix), lease);
    expect(result).toEqual({ disposition: 'APPLIED', reason: null, materializedChange: true, revision: '1' });
    const row = await state(vehicle.jeepneyId);
    expect(row).toMatchObject({
      revision: '1', writer_fence: lease.fence, location_status: 'FRESH', location_reason: 'VALID_FIX',
      route_resolution: 'RESOLVED', route_direction_id: directionId, context_version: '1',
      route_compliance: 'UNKNOWN', traccar_device_id: vehicle.deviceId, speed_kph: 30, point: 'POINT(123.88 10.3)',
    });
    expect((row.fresh_until as Date).getTime()).toBe(fix + 30_000);
    expect(row.mapping_fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps duplicate replays, equal-time fixes and older fixes from advancing the revision', async () => {
    const vehicle = await eligibleVehicle();
    const fix = await dbNow(-5_000);
    const first = observation(vehicle, fix);
    await writer.apply(first, lease);
    expect(await writer.apply(first, lease)).toMatchObject({ disposition: 'DUPLICATE', materializedChange: false, revision: '1' });
    expect(await writer.apply(observation(vehicle, fix), lease)).toMatchObject({ disposition: 'DUPLICATE', revision: '1' });
    expect(await writer.apply(observation(vehicle, fix - 1_000), lease)).toMatchObject({ disposition: 'OUT_OF_ORDER', revision: '1' });
    expect(await writer.apply(observation(vehicle, fix + 1_000), lease)).toMatchObject({ disposition: 'APPLIED', revision: '2' });
    expect((await state(vehicle.jeepneyId)).fix_time).toEqual(new Date(fix + 1_000));
  });

  it('excludes a stale writer after takeover and replays correctly after a restart', async () => {
    const vehicle = await eligibleVehicle();
    const fix = await dbNow(-6_000);
    const old = observation(vehicle, fix);
    await writer.apply(old, lease);
    const previous = lease;
    expect(await leases.release(previous)).toBe(true);
    lease = await acquired(randomUUID());

    await expect(writer.apply(observation(vehicle, fix + 1_000), previous)).rejects.toBeInstanceOf(LeaseLostError);
    expect(await state(vehicle.jeepneyId)).toMatchObject({ revision: '1', writer_fence: previous.fence });

    // A restarted Bridge redelivers its REST snapshot: nothing older or equal moves the durable state.
    const restarted = new TrackingStateWriter(pool, contexts);
    expect(await restarted.apply(old, lease)).toMatchObject({ disposition: 'DUPLICATE', revision: '1' });
    expect(await restarted.apply(observation(vehicle, fix - 1_000), lease)).toMatchObject({ disposition: 'OUT_OF_ORDER' });
    expect(await restarted.apply(observation(vehicle, fix + 2_000), lease)).toMatchObject({ disposition: 'APPLIED', revision: '2' });
    expect((await state(vehicle.jeepneyId)).writer_fence).toBe(lease.fence);
  });

  it('records invalid fixes and speeds over 300 km/h as observations without a new valid point', async () => {
    const vehicle = await eligibleVehicle();
    const fix = await dbNow(-10_000);
    await writer.apply(observation(vehicle, fix), lease);
    const before = await state(vehicle.jeepneyId);

    expect(await writer.apply(observation(vehicle, fix + 2_000, { speedKph: 300.5 }), lease))
      .toMatchObject({ disposition: 'APPLIED', revision: '2' });
    const invalid = await state(vehicle.jeepneyId);
    expect(invalid).toMatchObject({
      location_status: 'INVALID', location_reason: 'INVALID_FIX', route_compliance: 'UNKNOWN',
      point: before.point, speed_kph: 30, traccar_position_id: before.traccar_position_id,
    });
    expect(invalid.observed_at).toEqual(new Date(fix + 2_000));
    expect(invalid.last_successful_update_at).toEqual(before.last_successful_update_at);

    expect(await writer.apply(observation(vehicle, fix + 4_000, { valid: false }), lease)).toMatchObject({ revision: '3' });
    // A valid fix older than the invalid watermark is out of order, not a resurrection.
    expect(await writer.apply(observation(vehicle, fix + 3_000), lease)).toMatchObject({ disposition: 'OUT_OF_ORDER' });
    expect(await writer.apply(observation(vehicle, fix + 5_000), lease)).toMatchObject({ disposition: 'APPLIED', revision: '4' });
    expect((await state(vehicle.jeepneyId)).location_status).toBe('FRESH');
  });

  it('rejects fixes beyond the 5 s clock tolerance and malformed identities without touching state', async () => {
    const vehicle = await eligibleVehicle();
    const fix = await dbNow(-1_000);
    await writer.apply(observation(vehicle, fix), lease);
    expect(await writer.apply(observation(vehicle, fix + 60_000), lease))
      .toEqual({ disposition: 'REJECTED', reason: 'CLOCK_AHEAD', materializedChange: false, revision: '1' });
    for (const malformed of [
      { positionId: '1.5' }, { positionId: '9223372036854775808' }, { deviceId: '0' }, { fixTime: 'not a time' },
    ]) {
      expect(await writer.apply(observation(vehicle, fix + 1_000, malformed), lease))
        .toMatchObject({ disposition: 'REJECTED', reason: 'MALFORMED' });
    }
    expect(await writer.apply(observation({ ...vehicle, uniqueId: `unmapped-${randomUUID()}` }, fix + 1_000), lease))
      .toMatchObject({ disposition: 'UNMAPPED' });
    expect((await state(vehicle.jeepneyId)).revision).toBe('1');
    // Within the tolerance a slightly-ahead fix is stored (commuter visibility is the gateway's rule).
    expect(await writer.apply(observation(vehicle, await dbNow(3_000)), lease)).toMatchObject({ disposition: 'APPLIED' });
  });

  it('stores a late fix as STALE and normalizes expiry strictly after fresh_until', async () => {
    const late = await eligibleVehicle();
    expect(await writer.apply(observation(late, await dbNow(-45_000)), lease)).toMatchObject({ disposition: 'APPLIED' });
    expect(await state(late.jeepneyId)).toMatchObject({ location_status: 'STALE', location_reason: 'EXPIRED' });

    const vehicle = await eligibleVehicle();
    const fix = await dbNow(-29_400);
    const first = observation(vehicle, fix);
    await writer.apply(first, lease);
    expect((await state(vehicle.jeepneyId)).location_status).toBe('FRESH');
    await delay(900);
    // The duplicate is not applied, but the overdue freshness is materialized in a new revision.
    expect(await writer.apply(first, lease)).toEqual({
      disposition: 'DUPLICATE', reason: null, materializedChange: true, revision: '2',
    });
    expect(await state(vehicle.jeepneyId)).toMatchObject({
      location_status: 'STALE', location_reason: 'EXPIRED', point: 'POINT(123.88 10.3)',
    });
  });

  it('fences fixes from before the mapping generation and before an A006 context cutover', async () => {
    const vehicle = await eligibleVehicle();
    expect(await writer.apply(observation(vehicle, vehicle.mappedAt.getTime() - 1_000), lease))
      .toEqual({ disposition: 'INVALIDATED', reason: 'PRE_MAPPING', materializedChange: false, revision: null });

    const beforeCutover = await dbNow(-3_000);
    await writer.apply(observation(vehicle, beforeCutover), lease);
    await bump(vehicle.jeepneyId);
    expect(await writer.apply(observation(vehicle, beforeCutover + 1_000), lease))
      .toMatchObject({ disposition: 'INVALIDATED', reason: 'PRE_CUTOVER', materializedChange: true, revision: '2' });
    // The context change clears the retained point; the revision keeps increasing.
    expect(await state(vehicle.jeepneyId)).toMatchObject({
      location_status: 'UNKNOWN', location_reason: 'CONTEXT_CHANGED', context_version: '2', point: null, fix_time: null,
    });
    expect(await writer.apply(observation(vehicle, await dbNow(0)), lease))
      .toMatchObject({ disposition: 'APPLIED', revision: '3' });
    expect(await state(vehicle.jeepneyId)).toMatchObject({ location_status: 'FRESH', context_version: '2' });
  });

  it('clears coordinates when telemetry eligibility is lost and keeps private GPS for unassigned routes', async () => {
    const vehicle = await eligibleVehicle();
    const fix = await dbNow(-4_000);
    await writer.apply(observation(vehicle, fix), lease);
    await pool.query(`UPDATE gps_devices SET status = 'INACTIVE' WHERE id = $1`, [vehicle.gpsDeviceId]);
    expect(await writer.apply(observation(vehicle, fix + 1_000), lease))
      .toMatchObject({ disposition: 'REJECTED', reason: 'INELIGIBLE', materializedChange: true, revision: '2' });
    expect(await state(vehicle.jeepneyId)).toMatchObject({ location_reason: 'INELIGIBLE', point: null });
    expect(await writer.apply(observation(vehicle, fix + 2_000), lease))
      .toMatchObject({ disposition: 'REJECTED', materializedChange: false, revision: '2' });

    const unassigned = await eligibleVehicle(false);
    expect(await writer.apply(observation(unassigned, await dbNow(-1_000)), lease)).toMatchObject({ disposition: 'APPLIED' });
    expect(await state(unassigned.jeepneyId)).toMatchObject({
      location_status: 'FRESH', route_resolution: 'UNASSIGNED', route_direction_id: null, route_compliance: 'UNKNOWN',
    });
  });

  it('serializes concurrent writers per jeepney: one application per position, newest fix wins', async () => {
    const vehicle = await eligibleVehicle();
    const fix = await dbNow(-8_000);
    const same = observation(vehicle, fix);
    const replays = await Promise.all(Array.from({ length: 6 }, () => writer.apply(same, lease)));
    expect(replays.filter((result) => result.disposition === 'APPLIED')).toHaveLength(1);
    expect(replays.filter((result) => result.disposition === 'DUPLICATE')).toHaveLength(5);

    const racing = await Promise.all([1_000, 3_000, 2_000].map((offset) => writer.apply(observation(vehicle, fix + offset), lease)));
    const applied = racing.filter((result) => result.disposition === 'APPLIED').length;
    expect(racing.every((result) => ['APPLIED', 'OUT_OF_ORDER'].includes(result.disposition))).toBe(true);
    const row = await state(vehicle.jeepneyId);
    expect(row.revision).toBe(String(1 + applied));
    expect(row.fix_time).toEqual(new Date(fix + 3_000));
  });

  it('retries the whole transaction on lock timeout and gives up after 3 attempts without a write', async () => {
    const vehicle = await eligibleVehicle();
    const fix = await dbNow(-2_000);
    const waits: number[] = [];
    const counted = new TrackingStateWriter(pool, contexts, {
      sleep: async (ms) => { waits.push(ms); await delay(ms); },
    });

    await holdingKey(vehicle.jeepneyId, async () => {
      await expect(counted.apply(observation(vehicle, fix), lease)).rejects.toMatchObject({ code: '55P03' });
    });
    expect(waits).toHaveLength(2);
    expect(waits.every((ms) => ms >= 50 && ms < 200)).toBe(true);
    expect(await state(vehicle.jeepneyId).catch(() => null)).toBeNull();

    waits.length = 0;
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await lockTrackingContexts(holder, [vehicle.jeepneyId]);
      const pending = counted.apply(observation(vehicle, fix), lease);
      setTimeout(() => void holder.query('COMMIT'), 1_200);
      expect(await pending).toMatchObject({ disposition: 'APPLIED', revision: '1' });
      expect(waits.length).toBeGreaterThanOrEqual(1);
    } finally {
      holder.release();
    }
  }, 20_000);

  interface Vehicle { jeepneyId: string; gpsDeviceId: string; uniqueId: string; deviceId: string; mappedAt: Date }

  function observation(vehicle: Vehicle, fixMs: number, overrides: Partial<TrackingObservation> = {}): TrackingObservation {
    const fixTime = new Date(fixMs).toISOString();
    positionSequence += 1;
    return {
      deviceId: vehicle.deviceId, uniqueId: vehicle.uniqueId, positionId: String(positionSequence), valid: true,
      latitude: 10.3, longitude: 123.88, fixTime, deviceTime: fixTime, serverTime: fixTime,
      speedKph: 30, heading: 90, receivedAt: new Date().toISOString(), ...overrides,
    };
  }

  async function eligibleVehicle(assigned = true): Promise<Vehicle> {
    const jeepney = await pool.query<{ id: string }>(
      `INSERT INTO jeepneys(created_by_user_id, plate_no, color_hex, status) VALUES ($1, $2, '#112233', 'ACTIVE')
       RETURNING id`, [userId, `B2-${suffix}-${randomUUID().slice(0, 8)}`]);
    const jeepneyId = jeepney.rows[0]?.id ?? '';
    jeepneyIds.push(jeepneyId);
    const application = await pool.query<{ id: string }>(
      `INSERT INTO vehicle_applications(jeepney_id, submitted_by_user_id, status, reviewed_by_user_id, reviewed_at)
       VALUES ($1, $2, 'APPROVED', $2, now()) RETURNING id`, [jeepneyId, userId]);
    const request = await pool.query<{ id: string }>(
      `INSERT INTO gps_setup_requests(vehicle_application_id, jeepney_id, requested_by_user_id, status,
         scheduled_at, installed_at, verification_status, verified_by_user_id, verified_at)
       VALUES ($1, $2, $3, 'INSTALLED', now(), now(), 'VERIFIED', $3, now()) RETURNING id`,
      [application.rows[0]?.id, jeepneyId, userId]);
    const imei = String(100_000_000_000_000 + Math.floor(Math.random() * 899_999_999_999_999));
    const device = await pool.query<{ id: string }>(
      'INSERT INTO gps_devices(imei, serial_number) VALUES ($1, $2) RETURNING id',
      [imei, `B2-${suffix}-${randomUUID().slice(0, 8)}`]);
    const gpsDeviceId = device.rows[0]?.id ?? '';
    const uniqueId = `b2-${randomUUID()}`;
    const mapping = await pool.query<{ mapped_at: Date }>(
      `INSERT INTO traccar_device_mappings(gps_setup_request_id, gps_device_id, jeepney_id, traccar_unique_id, mapped_by_user_id,
         mapped_at)
       VALUES ($1, $2, $3, $4, $5, clock_timestamp() - interval '1 minute') RETURNING mapped_at`, [request.rows[0]?.id, gpsDeviceId, jeepneyId, uniqueId, userId]);
    if (assigned) {
      await pool.query(
        'INSERT INTO vehicle_route_assignments(jeepney_id, route_direction_id, assigned_by_user_id) VALUES ($1, $2, $3)',
        [jeepneyId, directionId, userId]);
    }
    // Mapping and cutover precede the fixtures' fixes, as a real mapping workflow's version bump would.
    await pool.query(`UPDATE jeepneys SET tracking_context_changed_at = clock_timestamp() - interval '1 minute' WHERE id = $1`,
      [jeepneyId]);
    return {
      jeepneyId, gpsDeviceId, uniqueId, deviceId: String(jeepneyIds.length + 100), mappedAt: mapping.rows[0]?.mapped_at ?? new Date(),
    };
  }

  async function state(jeepneyId: string): Promise<Row> {
    const result = await pool.query<Row>(
      `SELECT *, revision::text AS revision, ST_AsText(position) AS point FROM vehicle_latest_states WHERE jeepney_id = $1`,
      [jeepneyId]);
    const row = result.rows[0];
    if (row === undefined) throw new Error('No tracking state row');
    return row;
  }

  async function dbNow(offsetMs: number): Promise<number> {
    const result = await pool.query<{ now: Date }>('SELECT clock_timestamp() AS now');
    return (result.rows[0]?.now ?? new Date()).getTime() + offsetMs;
  }

  async function bump(jeepneyId: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await lockTrackingContexts(client, [jeepneyId]);
      await bumpTrackingContexts(client, [jeepneyId]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  }

  async function holdingKey(jeepneyId: string, work: () => Promise<void>): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await lockTrackingContexts(client, [jeepneyId]);
      await work();
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }

  async function acquired(ownerId: string): Promise<WriterLease> {
    const taken = await leases.acquire(ownerId);
    if (taken === null) throw new Error('Lease was not acquired');
    return taken;
  }

  async function releaseLease(): Promise<void> {
    await pool.query(`UPDATE tracking_bridge_leases SET owner_id = NULL, expires_at = NULL, heartbeat_at = NULL,
      phase = 'STOPPED' WHERE deployment_key = 'primary'`);
  }
});

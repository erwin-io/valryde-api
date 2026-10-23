import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;
const schema = process.env.TEST_DATABASE_SCHEMA ?? 'dbo';

type Row = Record<string, unknown>;

// B007/B008 catalog and constraint evidence. Every test runs in one transaction that is rolled back.
describeDatabase('Stage 13b B007/B008 tracking schema', () => {
  let pool: pg.Pool;
  let client: pg.PoolClient;
  let jeepneyId: string, gpsDeviceId: string, directionId: string, userId: string;

  const fixTime = '2026-10-23T00:00:00.000Z';
  const freshUntil = '2026-10-23T00:00:30.000Z';
  const validFix: Row = {
    traccar_position_id: 41, fix_time: fixTime, device_time: fixTime, server_time: fixTime,
    latitude: 10.3, longitude: 123.88, speed_kph: 25, heading: 90,
    last_successful_update_at: fixTime, fresh_until: freshUntil, observed_at: fixTime,
  };

  const mapping = (): Row => ({
    mapping_id: randomUUID(), gps_device_id: gpsDeviceId, mapping_mapped_at: '2026-10-22T00:00:00Z',
    mapping_fingerprint: 'a'.repeat(64), traccar_device_id: 7,
  });
  const freshState = (overrides: Row = {}): Row => ({
    jeepney_id: jeepneyId, writer_fence: 1, ...mapping(), ...validFix,
    location_status: 'FRESH', location_reason: 'VALID_FIX', ...overrides,
  });
  const onRoute = (overrides: Row = {}): Row => freshState({
    route_direction_id: directionId, route_resolution: 'RESOLVED', context_version: 1,
    context_cutover_at: '2026-10-22T00:00:00Z', context_fingerprint: 'b'.repeat(64),
    route_compliance: 'ON_ROUTE', distance_m: 3, ...overrides,
  });

  async function insert(table: string, row: Row): Promise<pg.QueryResult> {
    const keys = Object.keys(row);
    return client.query(
      `INSERT INTO ${table}(${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
      Object.values(row),
    );
  }

  async function rejects(code: string, run: () => Promise<unknown>): Promise<void> {
    await client.query('SAVEPOINT expected_failure');
    try {
      await run();
      throw new Error(`expected SQLSTATE ${code}`);
    } catch (error) {
      expect((error as { code?: string }).code, (error as Error).message).toBe(code);
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT expected_failure');
    }
  }

  async function accepts(run: () => Promise<unknown>): Promise<void> {
    await client.query('SAVEPOINT expected_success');
    try { await run(); } finally { await client.query('ROLLBACK TO SAVEPOINT expected_success'); }
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public` });
    client = await pool.connect();
    // Shared with the B2 writer test, which commits lease changes to the singleton primary row.
    await client.query('SELECT pg_advisory_lock(8642100013)');
    await client.query('BEGIN');
    userId = randomUUID(); jeepneyId = randomUUID(); gpsDeviceId = randomUUID(); directionId = randomUUID();
    const routeId = randomUUID();
    await client.query('INSERT INTO users(id, email, display_name) VALUES ($1, $2, $3)',
      [userId, `${userId}@tracking.example.test`, 'Schema fixture']);
    await client.query(
      `INSERT INTO jeepneys(id, created_by_user_id, plate_no, color_hex, status) VALUES ($1, $2, $3, '#112233', 'ACTIVE')`,
      [jeepneyId, userId, `S-${jeepneyId}`]);
    const imei = randomUUID().replaceAll(/[^0-9]/g, '').padEnd(15, '0').slice(0, 15);
    await client.query('INSERT INTO gps_devices(id, imei, serial_number) VALUES ($1, $2, $3)', [gpsDeviceId, imei, randomUUID()]);
    await client.query(
      `INSERT INTO transit_routes(id, route_code, public_name, route_color_hex, status) VALUES ($1, $2, 'Schema route', '#445566', 'ACTIVE')`,
      [routeId, `SCH-${routeId}`]);
    await client.query(
      `INSERT INTO route_directions(id, route_id, direction_label, origin_name, destination_name, geometry, status)
       VALUES ($1, $2, 'OUTBOUND', 'A', 'B', ST_GeomFromText('LINESTRING(123.88 10.29,123.88 10.31)', 4326), 'ACTIVE')`,
      [directionId, routeId]);
  });

  afterAll(async () => {
    try {
      await client.query('ROLLBACK');
      await client.query('SELECT pg_advisory_unlock(8642100013)');
    } finally { client.release(); await pool.end(); }
  });

  it('applies 007 before 008 and fails loudly on re-application', async () => {
    const applied = await client.query<{ filename: string }>(
      "SELECT filename FROM schema_migrations WHERE filename LIKE '00%' ORDER BY filename");
    const names = applied.rows.map((row) => row.filename);
    expect(names).toContain('007_tracking_latest_state.sql');
    expect(names).toContain('008_route_compliance_events.sql');
    expect(names.indexOf('008_route_compliance_events.sql')).toBeGreaterThan(names.indexOf('007_tracking_latest_state.sql'));

    const b007 = await readFile(new URL('../migrations/007_tracking_latest_state.sql', import.meta.url), 'utf8');
    await rejects('42P07', () => client.query(b007));
  });

  it('seeds exactly one released primary lease and rejects a second deployment or partial owner', async () => {
    const leases = await client.query('SELECT deployment_key, fence, owner_id, phase FROM tracking_bridge_leases');
    // The fence only ever increases, so a released row may carry a fence from an earlier writer test.
    expect(leases.rows).toHaveLength(1);
    expect(leases.rows[0]).toMatchObject({ deployment_key: 'primary', owner_id: null, phase: 'STOPPED' });
    expect(String((leases.rows[0] as Row).fence)).toMatch(/^[0-9]+$/);
    await rejects('23514', () => insert('tracking_bridge_leases', { deployment_key: 'secondary' }));
    await rejects('23514', () => client.query(
      "UPDATE tracking_bridge_leases SET owner_id = $1, fence = 1 WHERE deployment_key = 'primary'", [randomUUID()]));
    await rejects('23514', () => client.query(
      "UPDATE tracking_bridge_leases SET phase = 'DANCING' WHERE deployment_key = 'primary'"));
    await accepts(() => client.query(
      `UPDATE tracking_bridge_leases SET owner_id = $1, fence = 1, expires_at = clock_timestamp() + interval '15 seconds',
         heartbeat_at = clock_timestamp(), phase = 'RUNNING' WHERE deployment_key = 'primary'`, [randomUUID()]));
  });

  it('stores a fresh fix with a generated SRID 4326 point and an empty row with no coordinates', async () => {
    await accepts(async () => {
      const row = (await insert('vehicle_latest_states', freshState())).rows[0] as Row;
      expect(row.revision).toBe('1');
      const point = await client.query(
        'SELECT ST_SRID(position) AS srid, ST_X(position) AS x, ST_Y(position) AS y FROM vehicle_latest_states WHERE jeepney_id = $1',
        [jeepneyId]);
      expect(point.rows).toEqual([{ srid: 4326, x: 123.88, y: 10.3 }]);
      await rejects('428C9', () => client.query('UPDATE vehicle_latest_states SET position = NULL WHERE jeepney_id = $1', [jeepneyId]));
    });
    await accepts(async () => {
      const row = (await insert('vehicle_latest_states', { jeepney_id: jeepneyId, writer_fence: 1 })).rows[0] as Row;
      expect(row).toMatchObject({ location_status: 'UNKNOWN', location_reason: 'NO_FIX', route_compliance: 'UNKNOWN', position: null });
    });
  });

  it('rejects invalid speed, coordinates, units and partial groups', async () => {
    const invalid: Array<[string, Row]> = [
      ['speed above 300 km/h (M2)', freshState({ speed_kph: 300.01 })],
      ['negative speed', freshState({ speed_kph: -1 })],
      ['NaN latitude', freshState({ latitude: Number.NaN })],
      ['infinite longitude', freshState({ longitude: Number.POSITIVE_INFINITY })],
      ['heading 360 (normalized to 0)', freshState({ heading: 360 })],
      ['partial valid fix', freshState({ server_time: null })],
      ['fresh_until not fix_time + 30 s', freshState({ fresh_until: '2026-10-23T00:00:31Z' })],
      ['partial mapping generation', freshState({ mapping_fingerprint: null })],
      ['upper-case fingerprint', freshState({ mapping_fingerprint: 'A'.repeat(64) })],
      ['fix without mapping', { ...freshState(), mapping_id: null, gps_device_id: null, mapping_mapped_at: null,
        mapping_fingerprint: null, traccar_device_id: null }],
      ['observed before fix', freshState({ observed_at: '2026-10-22T23:59:59Z' })],
      ['FRESH without a fix', { jeepney_id: jeepneyId, writer_fence: 1, location_status: 'FRESH', location_reason: 'VALID_FIX' }],
      ['unknown location reason', freshState({ location_reason: 'PROVIDER_SAID_SO' })],
      ['zero fence', freshState({ writer_fence: 0 })],
      ['status without source', freshState({ tracker_status: 'ONLINE' })],
    ];
    for (const [label, row] of invalid) {
      await client.query('SAVEPOINT invalid_case');
      const error = await insert('vehicle_latest_states', row).then(() => null, (caught: unknown) => caught as { code?: string });
      await client.query('ROLLBACK TO SAVEPOINT invalid_case');
      expect(error?.code, label).toBe('23514');
    }
    await accepts(() => insert('vehicle_latest_states', freshState({ speed_kph: 300 })));
    await accepts(() => insert('vehicle_latest_states', freshState({ heading: 0, speed_kph: 0 })));
  });

  it('keeps compliance UNKNOWN unless the fix is fresh and the route context is resolved', async () => {
    await accepts(() => insert('vehicle_latest_states', onRoute()));
    const invalid: Array<[string, Row]> = [
      ['ON_ROUTE while STALE', onRoute({ location_status: 'STALE', location_reason: 'EXPIRED' })],
      ['ON_ROUTE without resolved route', freshState({ route_compliance: 'ON_ROUTE' })],
      ['RESOLVED without context version', onRoute({ context_version: null, context_cutover_at: null })],
      ['UNASSIGNED with a direction', freshState({ route_direction_id: directionId })],
      ['outside count without outside_since', onRoute({ consecutive_outside: 1 })],
      ['both runs positive', onRoute({ consecutive_outside: 1, outside_since: fixTime, consecutive_inside: 1 })],
      ['outside run above 3', onRoute({ consecutive_outside: 4, outside_since: fixTime })],
      ['inside run above 2', onRoute({ consecutive_inside: 3 })],
      ['OFF_ROUTE without re-entry latch', onRoute({ route_compliance: 'OFF_ROUTE' })],
      ['ON_ROUTE with re-entry latch', onRoute({ reentry_required: true })],
      ['infinite distance', onRoute({ distance_m: Number.POSITIVE_INFINITY })],
    ];
    for (const [label, row] of invalid) {
      await client.query('SAVEPOINT invalid_case');
      const error = await insert('vehicle_latest_states', row).then(() => null, (caught: unknown) => caught as { code?: string });
      await client.query('ROLLBACK TO SAVEPOINT invalid_case');
      expect(error?.code, label).toBe('23514');
    }
    // Initial UNKNOWN may accumulate an outside run, and UNKNOWN may keep a same-context re-entry latch.
    await accepts(() => insert('vehicle_latest_states', onRoute({
      route_compliance: 'UNKNOWN', consecutive_outside: 2, outside_since: fixTime })));
    await accepts(() => insert('vehicle_latest_states', freshState({
      location_status: 'INVALID', location_reason: 'INVALID_FIX', reentry_required: true })));
  });

  it('records idempotent, direction-consistent compliance transitions only', async () => {
    await client.query('SAVEPOINT events');
    try {
      await insert('vehicle_latest_states', onRoute({
        route_compliance: 'OFF_ROUTE', reentry_required: true, revision: 5, distance_m: 150 }));
      const event = (overrides: Row = {}): Row => ({
        jeepney_id: jeepneyId, route_direction_id: directionId, mapping_id: randomUUID(), context_version: 1,
        context_fingerprint: 'b'.repeat(64), state_revision: 5, event_type: 'ROUTE_DEVIATION', from_state: 'ON_ROUTE',
        to_state: 'OFF_ROUTE', fix_time: fixTime, traccar_position_id: 41, distance_m: 150, corridor_m: 100, ...overrides,
      });
      await insert('route_compliance_events', event());
      await rejects('23505', () => insert('route_compliance_events', event()));
      const invalid: Array<[string, Row]> = [
        ['deviation inside the corridor', event({ state_revision: 6, distance_m: 100 })],
        ['re-entry outside the corridor', event({ state_revision: 6, event_type: 'ROUTE_REENTRY', from_state: 'OFF_ROUTE', to_state: 'ON_ROUTE' })],
        ['re-entry from ON_ROUTE', event({ state_revision: 6, event_type: 'ROUTE_REENTRY', from_state: 'ON_ROUTE', to_state: 'ON_ROUTE', distance_m: 5 })],
        ['UNKNOWN as a target', event({ state_revision: 6, to_state: 'UNKNOWN' })],
        ['non-Valryde source', event({ state_revision: 6, source: 'TRACCAR' })],
        ['corridor out of range', event({ state_revision: 6, corridor_m: 5001 })],
      ];
      for (const [label, row] of invalid) {
        await client.query('SAVEPOINT invalid_case');
        const error = await insert('route_compliance_events', row).then(() => null, (caught: unknown) => caught as { code?: string });
        await client.query('ROLLBACK TO SAVEPOINT invalid_case');
        expect(error?.code, label).toBe('23514');
      }
      await accepts(() => insert('route_compliance_events', event({
        state_revision: 7, event_type: 'ROUTE_REENTRY', from_state: 'OFF_ROUTE', to_state: 'ON_ROUTE', distance_m: 100 })));
      await rejects('23503', () => insert('route_compliance_events', event({ jeepney_id: randomUUID(), state_revision: 8 })));
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT events');
    }
  });

  it('M4 grants: Bridge role reads A context and writes only B tables, without DELETE', async () => {
    const grants = await readFile(new URL('../db/grants/tracking_bridge_role.sql', import.meta.url), 'utf8');
    await client.query(grants);
    await client.query('SET LOCAL ROLE valryde_tracking_bridge');
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('valryde:tracking-context:' || $1::uuid::text, 0))", [jeepneyId]);
      for (const table of ['jeepneys', 'fleet_group_jeepneys', 'vehicle_route_assignments', 'route_directions', 'traccar_device_mappings']) {
        await client.query(`SELECT 1 FROM ${table} LIMIT 1`);
      }
      await accepts(() => insert('vehicle_latest_states', onRoute()));
      await accepts(() => client.query("UPDATE tracking_bridge_leases SET phase = 'STOPPED' WHERE deployment_key = 'primary'"));

      await rejects('42501', () => client.query("UPDATE jeepneys SET status = 'INACTIVE' WHERE id = $1", [jeepneyId]));
      await rejects('42501', () => client.query('DELETE FROM vehicle_latest_states'));
      await rejects('42501', () => client.query('DELETE FROM route_compliance_events'));
      await rejects('42501', () => client.query('UPDATE route_compliance_events SET distance_m = 0'));
      await rejects('42501', () => client.query('INSERT INTO tracking_bridge_leases(deployment_key) VALUES ($1)', ['primary']));
      await rejects('42501', () => client.query('SELECT email FROM users LIMIT 1'));
      await rejects('42501', () => client.query('SELECT 1 FROM refresh_tokens LIMIT 1'));
    } finally {
      await client.query('RESET ROLE');
    }
    const role = await client.query(
      'SELECT rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls FROM pg_roles WHERE rolname = $1',
      ['valryde_tracking_bridge']);
    expect(role.rows).toEqual([{ rolcanlogin: false, rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolbypassrls: false }]);
  });
});

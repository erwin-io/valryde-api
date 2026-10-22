import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  bumpTrackingContexts,
  lockTrackingContexts,
  maxAffectedJeepneys,
} from '../src/db/tracking-context.js';
import type { User } from '../src/domain/identity.js';
import { PgIdentityRepository } from '../src/repositories/pg-identity-repository.js';
import { FleetService } from '../src/services/fleet-service.js';
import { TrackingContextService } from '../src/services/tracking-context-service.js';
import { TrackingVisibilityService } from '../src/services/tracking-visibility-service.js';
import { TransitService } from '../src/services/transit-service.js';
import { VehicleWorkflowService } from '../src/services/vehicle-workflow-service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseSchema = process.env.TEST_DATABASE_SCHEMA ?? 'dbo';
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

// Stage 13b A006: real concurrent PostgreSQL clients. Barriers are a held advisory key or an open
// transaction plus a wait for the other backend to be queued on that key; never a fixed sleep.
describeDatabase('Stage 13b tracking context generation with PostgreSQL', () => {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${databaseSchema},public`,
    max: 20,
  });
  const repository = new PgIdentityRepository(pool);
  const transit = new TransitService(pool);
  const fleet = new FleetService(pool);
  const workflow = new VehicleWorkflowService(pool);
  const context = new TrackingContextService(transit);
  const visibility = new TrackingVisibilityService(pool);
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const userIds: string[] = [];
  const jeepneyIds: string[] = [];
  const deviceIds: string[] = [];
  let admin: User;
  let operator: User;
  let operatorId: string;
  let directionId: string;
  let otherDirectionId: string;

  beforeAll(async () => {
    admin = await repository.addRole((await createUser('COMMUTER')).id, 'ADMIN');
    operator = await createUser('OPERATOR');
    operatorId = await operatorOf(operator);
    directionId = await createDirection('A');
    otherDirectionId = await createDirection('B');
  });

  afterAll(async () => {
    await pool.query(
      `DELETE FROM traccar_device_mappings WHERE jeepney_id = ANY($1::uuid[])`,
      [jeepneyIds],
    );
    await pool.query('DELETE FROM gps_devices WHERE id = ANY($1::uuid[])', [deviceIds]);
    await pool.query('DELETE FROM gps_setup_requests WHERE jeepney_id = ANY($1::uuid[])', [jeepneyIds]);
    await pool.query('DELETE FROM vehicle_applications WHERE jeepney_id = ANY($1::uuid[])', [jeepneyIds]);
    await pool.query('DELETE FROM audit_logs WHERE actor_user_id = ANY($1::uuid[])', [userIds]);
    await pool.query(
      'DELETE FROM vehicle_route_assignments WHERE assigned_by_user_id = ANY($1::uuid[])',
      [userIds],
    );
    await pool.query(
      'DELETE FROM driver_jeepney_assignments WHERE assigned_by_user_id = ANY($1::uuid[])',
      [userIds],
    );
    await pool.query('DELETE FROM fleet_groups WHERE operator_id = $1', [operatorId]);
    await pool.query('DELETE FROM jeepneys WHERE id = ANY($1::uuid[])', [jeepneyIds]);
    await pool.query(
      `DELETE FROM route_directions WHERE route_id IN
         (SELECT id FROM transit_routes WHERE route_code LIKE $1)`,
      [`A006-${suffix}-%`],
    );
    await pool.query('DELETE FROM transit_routes WHERE route_code LIKE $1', [`A006-${suffix}-%`]);
    await pool.query('DELETE FROM drivers WHERE user_id = ANY($1::uuid[])', [userIds]);
    await pool.query('DELETE FROM operators WHERE owner_user_id = ANY($1::uuid[])', [userIds]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
    await pool.end();
  });

  it('migration 006 starts every jeepney at version 1 with a cutover instant', async () => {
    const jeepneyId = await createJeepney();
    const row = await state(jeepneyId);
    expect(row.version).toBe('1');
    expect(row.changedAt).toBeInstanceOf(Date);
  });

  it('T1/T2: the resolver uses the caller executor and keeps direct-over-group precedence', async () => {
    const jeepneyId = await createJeepney();
    const groupId = await createGroup([jeepneyId]);
    await transit.assignRoute(operator, { groupId, routeDirectionId: otherDirectionId });
    await withClient(async (client) => {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO vehicle_route_assignments(jeepney_id, route_direction_id, assigned_by_user_id)
         VALUES ($1, $2, $3)`,
        [jeepneyId, directionId, operator.id],
      );
      expect(await transit.resolveEffectiveRouteDirection(jeepneyId, client)).toMatchObject({
        source: 'DIRECT',
        direction: { id: directionId },
      });
      expect(await transit.resolveEffectiveRouteDirection(jeepneyId)).toMatchObject({
        source: 'GROUP',
        groupId,
        direction: { id: otherDirectionId },
      });
      await client.query('ROLLBACK');
    });
  });

  it('T3: an A mutation waits for a held B key, then commits its version bump', async () => {
    const jeepneyId = await createJeepney();
    await withClient(async (holder) => {
      await holder.query('BEGIN');
      await lockTrackingContexts(holder, [jeepneyId]);
      const mutation = fleet.updateJeepney(admin, jeepneyId, { status: 'INACTIVE' });
      await waitForWaiters(jeepneyId, 1);
      expect((await state(jeepneyId)).version).toBe('1');
      await holder.query('COMMIT');
      await mutation;
    });
    expect(await state(jeepneyId)).toMatchObject({ version: '2', status: 'INACTIVE' });
  });

  it('T4/T4-X1: a READ COMMITTED reader that waited on the key sees the new committed context', async () => {
    const jeepneyId = await createJeepney();
    await withClient(async (writer) => {
      await withClient(async (reader) => {
        await reader.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        expect((await context.resolve(jeepneyId, reader)).contextVersion).toBe('1');
        await writer.query('BEGIN');
        await lockTrackingContexts(writer, [jeepneyId]);
        await bumpTrackingContexts(writer, [jeepneyId]);
        const waiting = lockTrackingContexts(reader, [jeepneyId]);
        await waitForWaiters(jeepneyId, 1);
        await writer.query('COMMIT');
        await waiting;
        expect((await context.resolve(jeepneyId, reader)).contextVersion).toBe('2');
        await reader.query('COMMIT');
      });
    });
  });

  it('T7-X8: membership removal and a group route assignment serialize; each bumps once', async () => {
    const removed = await createJeepney();
    const kept = await createJeepney();
    const groupId = await createGroup([removed, kept]);
    await withClient(async (holder) => {
      await holder.query('BEGIN');
      await lockTrackingContexts(holder, [removed]);
      const removal = fleet.removeGroupJeepney(operator, groupId, removed);
      await waitForWaiters(removed, 1);
      const assignment = transit.assignRoute(operator, { groupId, routeDirectionId: directionId });
      await waitForWaiters(removed, 2);
      await holder.query('COMMIT');
      await Promise.all([removal, assignment]);
    });
    // Removal won the queue; the assignment revalidated without the removed jeepney.
    expect((await state(removed)).version).toBe('2');
    expect((await state(kept)).version).toBe('2');
    expect(await transit.resolveEffectiveRouteDirection(removed)).toBeNull();
    expect(await transit.resolveEffectiveRouteDirection(kept)).toMatchObject({ source: 'GROUP', groupId });
  });

  it('T11: an A→B→A route change advances the version on every change', async () => {
    const jeepneyId = await createJeepney();
    const versions = [(await state(jeepneyId)).version];
    for (const routeDirectionId of [directionId, otherDirectionId, directionId]) {
      await transit.assignRoute(operator, { jeepneyId, routeDirectionId });
      versions.push((await state(jeepneyId)).version);
    }
    expect(versions).toEqual(['1', '2', '3', '4']);
  });

  it('T8-X8/T13: updateDirection rolls back geometry and version together when its audit fails', async () => {
    const ownDirectionId = await createDirection('ROLLBACK');
    const jeepneyId = await createJeepney();
    await transit.assignRoute(operator, { jeepneyId, routeDirectionId: ownDirectionId });
    const before = await state(jeepneyId);
    await failAuditFor(ownDirectionId, async () => {
      await expect(
        transit.updateDirection(admin, ownDirectionId, {
          corridorM: 250,
          geometry: { type: 'LineString', coordinates: [[123.8, 10.2], [123.81, 10.21]] },
        }),
      ).rejects.toMatchObject({ code: 'P0001' });
    });
    const direction = await pool.query<{ corridor_m: number; length: number }>(
      'SELECT corridor_m, ST_NPoints(geometry) AS length FROM route_directions WHERE id = $1',
      [ownDirectionId],
    );
    expect(direction.rows[0]).toEqual({ corridor_m: 100, length: 3 });
    expect((await state(jeepneyId)).version).toBe(before.version);

    await transit.updateDirection(admin, ownDirectionId, { corridorM: 250 });
    expect(Number((await state(jeepneyId)).version)).toBe(Number(before.version) + 1);
    await transit.updateDirection(admin, ownDirectionId, { originName: 'Renamed origin' });
    expect(Number((await state(jeepneyId)).version)).toBe(Number(before.version) + 1);
  });

  it('T15-X7: a mutation blocked beyond its lock budget returns 503 with nothing committed', async () => {
    const jeepneyId = await createJeepney();
    await withClient(async (holder) => {
      await holder.query('BEGIN');
      await lockTrackingContexts(holder, [jeepneyId]);
      await expect(fleet.updateJeepney(admin, jeepneyId, { status: 'INACTIVE' })).rejects.toMatchObject({
        statusCode: 503,
        code: 'TRACKING_CONTEXT_BUSY',
      });
      await holder.query('ROLLBACK');
    });
    expect(await state(jeepneyId)).toMatchObject({ version: '1', status: 'DRAFT' });
  }, 30_000);

  it('T16: a member committed after discovery forces a retry with the complete key set', async () => {
    const member = await createJeepney();
    const lateMember = await createJeepney();
    const groupId = await createGroup([member]);
    await withClient(async (holder) => {
      await holder.query('BEGIN');
      await lockTrackingContexts(holder, [member]);
      const assignment = transit.assignRoute(operator, { groupId, routeDirectionId: directionId });
      await waitForWaiters(member, 1);
      await pool.query('INSERT INTO fleet_group_jeepneys(group_id, jeepney_id) VALUES ($1, $2)', [
        groupId,
        lateMember,
      ]);
      await holder.query('COMMIT');
      await assignment;
    });
    expect((await state(member)).version).toBe('2');
    expect((await state(lateMember)).version).toBe('2');
    expect(await transit.resolveEffectiveRouteDirection(lateMember)).toMatchObject({ source: 'GROUP' });
  });

  it('T20: the cutover instant is read after the lock is acquired, not at transaction start', async () => {
    const jeepneyId = await createJeepney();
    let released: Date | undefined;
    await withClient(async (holder) => {
      await holder.query('BEGIN');
      await lockTrackingContexts(holder, [jeepneyId]);
      const mutation = fleet.updateJeepney(admin, jeepneyId, { status: 'INACTIVE' });
      await waitForWaiters(jeepneyId, 1);
      released = (await holder.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]?.now;
      await holder.query('COMMIT');
      await mutation;
    });
    expect((await state(jeepneyId)).changedAt.getTime()).toBeGreaterThan(released?.getTime() ?? Infinity);
  });

  it('T21: snapshot mode keeps one consistent version inside a REPEATABLE READ READ ONLY read', async () => {
    const jeepneyId = await createJeepney();
    await withClient(async (snapshot) => {
      await snapshot.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      expect((await context.resolve(jeepneyId, snapshot)).contextVersion).toBe('1');
      await fleet.updateJeepney(admin, jeepneyId, { status: 'INACTIVE' });
      expect((await context.resolve(jeepneyId, snapshot)).contextVersion).toBe('1');
      await snapshot.query('COMMIT');
    });
    expect((await context.resolve(jeepneyId, pool)).contextVersion).toBe('2');
  });

  it('T22: opposite-order multi-key acquisition never deadlocks', async () => {
    const first = await createJeepney();
    const second = await createJeepney();
    const third = await createJeepney();
    for (let round = 0; round < 10; round += 1) {
      await Promise.all([
        lockedTransaction([first, second, third]),
        lockedTransaction([third, second, first]),
        lockedTransaction([second, first, second]),
      ]);
    }
  });

  it('T22: an affected set over the cap is rejected before any lock or write', async () => {
    const created = await pool.query<{ id: string }>(
      `INSERT INTO jeepneys(operator_id, created_by_user_id, plate_no, color_hex)
       SELECT $1, $2, 'A006-CAP-' || $3 || '-' || n, '#123456' FROM generate_series(1, $4::int) n
       RETURNING id`,
      [operatorId, operator.id, suffix, maxAffectedJeepneys + 1],
    );
    const ids = created.rows.map((row) => row.id);
    jeepneyIds.push(...ids);
    const groupId = await createGroup(ids);
    await expect(
      transit.assignRoute(operator, { groupId, routeDirectionId: directionId }),
    ).rejects.toMatchObject({ statusCode: 422, code: 'TRACKING_CONTEXT_MUTATION_TOO_LARGE' });
    const unchanged = await pool.query<{ bumped: string; assignments: string }>(
      `SELECT
         (SELECT count(*) FROM jeepneys WHERE id = ANY($1::uuid[]) AND tracking_context_version <> 1)::text AS bumped,
         (SELECT count(*) FROM vehicle_route_assignments WHERE group_id = $2)::text AS assignments`,
      [ids, groupId],
    );
    expect(unchanged.rows[0]).toEqual({ bumped: '0', assignments: '0' });
  });

  it('T9/T10/T19: the GPS workflow bumps eligibility changes; mapping is create-only', async () => {
    const jeepneyId = await createJeepney();
    const versions = async () => (await state(jeepneyId)).version;
    const application = await workflow.submitApplication(operator, jeepneyId);
    expect(await versions()).toBe('2');
    await workflow.reviewApplication(admin, application.id, 'APPROVED');
    expect(await versions()).toBe('3');
    const request = await workflow.submitGpsRequest(operator, application.id);
    await workflow.transitionGpsRequest(admin, request.id, 'APPROVED', {});
    await workflow.transitionGpsRequest(admin, request.id, 'SCHEDULED', {
      scheduledAt: new Date().toISOString(),
    });
    expect(await versions()).toBe('5');

    const imei = `35${Date.now()}`.slice(0, 15);
    const mapping = await workflow.mapDevice(admin, request.id, {
      imei,
      serialNumber: `A006-${suffix}-${randomUUID().slice(0, 6)}`,
      traccarUniqueId: `a006-${randomUUID()}`,
    });
    deviceIds.push(mapping.gpsDeviceId);
    const mapped = await state(jeepneyId);
    expect(mapped.version).toBe('6');
    expect(mapped.changedAt.getTime()).toBeGreaterThanOrEqual(mapping.mappedAt.getTime());

    await expect(
      workflow.mapDevice(admin, request.id, {
        imei: `36${imei.slice(2)}`,
        serialNumber: `A006-${suffix}-${randomUUID().slice(0, 6)}`,
        traccarUniqueId: `a006-${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: 'DEVICE_MAPPING_CONFLICT' });
    expect(await versions()).toBe('6');

    let resolved = await context.resolve(jeepneyId, pool);
    expect(resolved).toMatchObject({ telemetryEligible: false, telemetryIneligibilityReason: 'JEEPNEY_NOT_ACTIVE' });
    await workflow.transitionGpsRequest(admin, request.id, 'INSTALLED', {});
    await workflow.verifyInstallation(admin, request.id, {
      powerOk: true,
      simOk: true,
      serverOk: true,
      gpsFixOk: true,
    });
    resolved = await context.resolve(jeepneyId, pool);
    expect(resolved).toMatchObject({
      contextVersion: '8',
      operatorId,
      telemetryEligible: true,
      telemetryIneligibilityReason: null,
      routeUsability: 'UNASSIGNED',
      mapping: { mappingId: mapping.id, gpsDeviceId: mapping.gpsDeviceId, gpsSetupRequestId: request.id },
    });
    expect(resolved.mapping?.mappedAt.getTime()).toBe(mapping.mappedAt.getTime());

    const ownDirectionId = await createDirection('USABLE');
    await transit.assignRoute(operator, { jeepneyId, routeDirectionId: ownDirectionId });
    expect((await context.resolve(jeepneyId, pool)).routeUsability).toBe('USABLE');
    await transit.updateDirection(admin, ownDirectionId, { status: 'INACTIVE' });
    resolved = await context.resolve(jeepneyId, pool);
    expect(resolved).toMatchObject({ routeUsability: 'INACTIVE', telemetryEligible: true, contextVersion: '10' });
  });

  it('T19: a route conflict is a route-usability outcome, and a missing jeepney is not an error', async () => {
    const jeepneyId = await createJeepney();
    for (const routeDirectionId of [directionId, otherDirectionId]) {
      const groupId = await createGroup([jeepneyId]);
      // Raw insert: the API refuses to create this conflict, but the resolver must classify it.
      await pool.query(
        `INSERT INTO vehicle_route_assignments(group_id, route_direction_id, assigned_by_user_id)
         VALUES ($1, $2, $3)`,
        [groupId, routeDirectionId, operator.id],
      );
    }
    expect(await context.resolve(jeepneyId, pool)).toMatchObject({
      routeUsability: 'CONFLICT',
      effectiveRouteDirection: null,
      telemetryIneligibilityReason: 'JEEPNEY_NOT_ACTIVE',
    });
    expect(await context.resolve(randomUUID(), pool)).toMatchObject({
      contextVersion: '0',
      telemetryEligible: false,
      telemetryIneligibilityReason: 'JEEPNEY_NOT_FOUND',
    });
  });

  it('T12: private visibility uses existence semantics and denies other scopes', async () => {
    const jeepneyId = await createJeepney();
    const driver = await createUser('DRIVER');
    const driverId = await associate(driver);
    for (let index = 0; index < 2; index += 1) {
      const groupId = await createGroup([jeepneyId]);
      await pool.query('INSERT INTO fleet_group_drivers(group_id, driver_id) VALUES ($1, $2)', [groupId, driverId]);
    }
    await expect(visibility.assertCanReadPrivateTracking(driver, jeepneyId)).resolves.toBeUndefined();
    await expect(visibility.assertCanReadPrivateTracking(admin, jeepneyId)).resolves.toBeUndefined();
    await expect(visibility.assertCanReadPrivateTracking(operator, jeepneyId)).resolves.toBeUndefined();
    await expect(
      visibility.assertCanReadPrivateTracking(await createUser('DRIVER'), jeepneyId),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      visibility.assertCanReadPrivateTracking(await createUser('OPERATOR'), jeepneyId),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      visibility.assertCanReadPrivateTracking(await createUser('COMMUTER'), jeepneyId),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(visibility.assertCanReadPrivateTracking(admin, randomUUID())).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('T26: removeGroupDriver and unassignDriver change visibility without a context bump', async () => {
    const jeepneyId = await createJeepney();
    const driver = await createUser('DRIVER');
    const driverId = await associate(driver);
    const groupId = await createGroup([jeepneyId]);
    await fleet.addGroupDriver(operator, groupId, driverId);
    await fleet.assignDriver(operator, jeepneyId, driverId);
    const before = (await state(jeepneyId)).version;

    await fleet.unassignDriver(operator, jeepneyId);
    expect((await state(jeepneyId)).version).toBe(before);
    await expect(visibility.assertCanReadPrivateTracking(driver, jeepneyId)).resolves.toBeUndefined();

    await fleet.removeGroupDriver(operator, groupId, driverId);
    expect((await state(jeepneyId)).version).toBe(before);
    await expect(visibility.assertCanReadPrivateTracking(driver, jeepneyId)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  async function createUser(role: 'COMMUTER' | 'DRIVER' | 'OPERATOR'): Promise<User> {
    const user = await repository.createUser({
      email: `a006-${role.toLowerCase()}-${randomUUID()}@example.com`,
      passwordHash: null,
      displayName: `A006 ${role}`,
      role,
      emailVerifiedAt: new Date(),
    });
    userIds.push(user.id);
    return user;
  }

  async function operatorOf(user: User): Promise<string> {
    const result = await pool.query<{ id: string }>('SELECT id FROM operators WHERE owner_user_id = $1', [user.id]);
    return result.rows[0]?.id ?? '';
  }

  async function associate(driver: User): Promise<string> {
    const result = await pool.query<{ id: string }>(
      'UPDATE drivers SET operator_id = $2 WHERE user_id = $1 RETURNING id',
      [driver.id, operatorId],
    );
    return result.rows[0]?.id ?? '';
  }

  async function createDirection(label: string): Promise<string> {
    const route = await pool.query<{ id: string }>(
      `INSERT INTO transit_routes(route_code, public_name, route_color_hex, status)
       VALUES ($1, $2, '#2468AC', 'ACTIVE') RETURNING id`,
      [`A006-${suffix}-${label}`, `A006 ${label}`],
    );
    const direction = await pool.query<{ id: string }>(
      `INSERT INTO route_directions(route_id, direction_label, origin_name, destination_name, geometry, status)
       VALUES ($1, 'Outbound', 'Origin', 'Destination',
         ST_SetSRID(ST_GeomFromGeoJSON('{"type":"LineString","coordinates":[[123.86,10.26],[123.9,10.3],[123.92,10.31]]}'), 4326),
         'ACTIVE')
       RETURNING id`,
      [route.rows[0]?.id],
    );
    return direction.rows[0]?.id ?? '';
  }

  async function createJeepney(): Promise<string> {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO jeepneys(operator_id, created_by_user_id, plate_no, color_hex)
       VALUES ($1, $2, $3, '#334455') RETURNING id`,
      [operatorId, operator.id, `A006-${suffix}-${randomUUID().slice(0, 8)}`],
    );
    const id = result.rows[0]?.id ?? '';
    jeepneyIds.push(id);
    return id;
  }

  async function createGroup(members: string[]): Promise<string> {
    const result = await pool.query<{ id: string }>(
      'INSERT INTO fleet_groups(operator_id, name) VALUES ($1, $2) RETURNING id',
      [operatorId, `A006 ${randomUUID()}`],
    );
    const groupId = result.rows[0]?.id ?? '';
    await pool.query(
      'INSERT INTO fleet_group_jeepneys(group_id, jeepney_id) SELECT $1, unnest($2::uuid[])',
      [groupId, members],
    );
    return groupId;
  }

  async function state(jeepneyId: string): Promise<{ version: string; changedAt: Date; status: string }> {
    const result = await pool.query<{ version: string; changed_at: Date; status: string }>(
      `SELECT tracking_context_version::text AS version, tracking_context_changed_at AS changed_at,
         status::text AS status FROM jeepneys WHERE id = $1`,
      [jeepneyId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('Fixture jeepney is missing');
    return { version: row.version, changedAt: row.changed_at, status: row.status };
  }

  async function withClient(work: (client: pg.PoolClient) => Promise<void>): Promise<void> {
    const client = await pool.connect();
    try {
      await work(client);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async function lockedTransaction(ids: string[]): Promise<void> {
    await withClient(async (client) => {
      await client.query('BEGIN');
      await lockTrackingContexts(client, ids);
      await client.query('COMMIT');
    });
  }

  // Barrier: resolves once `count` backends are queued on this jeepney's advisory key.
  async function waitForWaiters(jeepneyId: string, count: number): Promise<void> {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const result = await pool.query<{ waiting: number }>(
        `SELECT count(*)::int AS waiting FROM pg_locks
         WHERE locktype = 'advisory' AND NOT granted AND objsubid = 1
           AND ((classid::bigint << 32) | objid::bigint)
             = hashtextextended('valryde:tracking-context:' || $1::text, 0)`,
        [jeepneyId],
      );
      if ((result.rows[0]?.waiting ?? 0) >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${count} advisory-lock waiter(s)`);
  }

  // Injects a failure into one audit insert, after the business UPDATE and before the version bump.
  async function failAuditFor(entityId: string, work: () => Promise<void>): Promise<void> {
    const name = `a006_fail_${suffix.toLowerCase()}`;
    await pool.query(
      `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN RAISE EXCEPTION 'injected audit failure'; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER ${name} BEFORE INSERT ON audit_logs FOR EACH ROW
       WHEN (NEW.entity_id = '${entityId}') EXECUTE FUNCTION ${name}()`,
    );
    try {
      await work();
    } finally {
      await pool.query(`DROP TRIGGER ${name} ON audit_logs`);
      await pool.query(`DROP FUNCTION ${name}()`);
    }
  }
});

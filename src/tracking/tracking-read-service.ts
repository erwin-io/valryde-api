import type pg from 'pg';

import type { User } from '../domain/identity.js';
import { ApiError } from '../lib/api-error.js';
import type { TrackingContextService } from '../services/tracking-context-service.js';
import type { TrackingVisibilityService } from '../services/tracking-visibility-service.js';

// PROPOSED (M7, not frozen). Bounded snapshot size; oversized scopes are refused, never truncated.
export const maxSnapshotVehicles = 1_000;

export type Relation = 'ASSIGNED' | 'GROUP' | 'OWNED' | 'PLATFORM';

export interface PositionV1 { latitude: number; longitude: number; fixTime: string; speedKph: number; heading: number }

export interface PublicVehicleV1 {
  jeepneyId: string;
  plateNo: string;
  physicalColorHex: string;
  routeId: string;
  directionId: string;
  stateRevision: string;
  position: PositionV1;
  trackerStatus: 'ONLINE';
  motionStatus: 'MOVING' | 'STOPPED' | 'UNKNOWN';
  routeCompliance: 'ON_ROUTE';
  lastSuccessfulUpdateAt: string;
  availableUntil: string;
}

export interface PrivateTrackingV1 {
  trackerStatus: 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
  motionStatus: 'MOVING' | 'STOPPED' | 'UNKNOWN';
  locationStatus: 'CURRENT' | 'LAST_KNOWN' | 'NONE';
  routeCompliance: 'ON_ROUTE' | 'OFF_ROUTE' | 'UNKNOWN';
  routeResolution: 'USABLE' | 'UNASSIGNED' | 'INACTIVE' | 'CONFLICT';
  reason: string | null;
  deviation: { since: string; distanceM: number; corridorM: number } | null;
  fixTime: string | null;
  lastSuccessfulUpdateAt: string | null;
  availableUntil: string | null;
}

export interface PrivateVehicleV1 {
  jeepneyId: string;
  plateNo: string;
  physicalColorHex: string;
  relation: Relation[];
  routeId: string | null;
  directionId: string | null;
  stateRevision: string | null;
  tracking: PrivateTrackingV1 | null;
  position: PositionV1 | null;
  positionIsLastKnown: boolean;
}

export interface TrackingSummaryV1 {
  total: number; online: number; offline: number; unknown: number;
  moving: number; stopped: number; onRoute: number; offRoute: number;
}

interface Row {
  jeepney_id: string;
  plate_no: string;
  color_hex: string;
  current_version: string;
  revision: string | null;
  mapping_id: string | null;
  context_version: string | null;
  route_id: string | null;
  route_direction_id: string | null;
  route_resolution: string | null;
  fix_time: Date | null;
  latitude: number | null;
  longitude: number | null;
  speed_kph: number | null;
  heading: number | null;
  last_successful_update_at: Date | null;
  location_status: string | null;
  location_reason: string | null;
  tracker_status: 'ONLINE' | 'OFFLINE' | 'UNKNOWN' | null;
  motion_status: 'MOVING' | 'STOPPED' | 'UNKNOWN' | null;
  route_compliance: 'ON_ROUTE' | 'OFF_ROUTE' | 'UNKNOWN' | null;
  distance_m: number | null;
  now: Date;
  lease_live: boolean;
  /** FRESH, DB now <= fresh_until and fix_time <= now (age >= 0), all on the DB clock. */
  current: boolean;
  fix_ahead: boolean;
  available_until: Date | null;
  deviation_since: Date | null;
  deviation_corridor_m: number | null;
  relation: Relation[];
}

/**
 * Stage 13b B5a read projection (PROPOSED T1–T3, not frozen). Each call runs in one
 * REPEATABLE READ READ ONLY snapshot (X2), re-derives scope from current Agent A tables, and masks at
 * read time: expired fixes, a lost writer lease, A006 context mismatch and (T1) current eligibility.
 * Never writes and never presents an unverified position as live.
 */
export class TrackingReadService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly contexts: Pick<TrackingContextService, 'resolve'>,
    private readonly visibility: Pick<TrackingVisibilityService, 'assertCanReadPrivateTracking'>,
  ) {}

  /** T1: public-safe vehicles currently available on one ACTIVE direction. */
  async publicDirection(directionId: string) {
    return this.snapshot(async (client) => {
      const direction = await client.query(
        `SELECT 1 FROM route_directions rd JOIN transit_routes tr ON tr.id = rd.route_id
         WHERE rd.id = $1 AND rd.status = 'ACTIVE' AND tr.status = 'ACTIVE'`,
        [directionId],
      );
      if (direction.rowCount !== 1) throw new ApiError(404, 'NOT_FOUND', 'Route direction not found');
      const candidates = await client.query<{ jeepney_id: string }>(
        `SELECT s.jeepney_id FROM vehicle_latest_states s JOIN jeepneys j ON j.id = s.jeepney_id
         WHERE s.route_direction_id = $1 AND s.location_status = 'FRESH' AND s.route_compliance = 'ON_ROUTE'
           AND s.tracker_status = 'ONLINE' AND s.context_version = j.tracking_context_version
         LIMIT $2`,
        [directionId, maxSnapshotVehicles + 1],
      );
      assertWithinCap(candidates.rowCount ?? 0);
      const rows = await this.rows(client, candidates.rows.map((row) => row.jeepney_id), null);
      const vehicles: PublicVehicleV1[] = [];
      for (const row of rows) {
        if (!row.current || !row.lease_live || row.revision === null || row.route_id === null) continue;
        // Public visibility re-checks Agent A eligibility and route precedence in this same snapshot.
        const context = await this.contexts.resolve(row.jeepney_id, client);
        if (!context.telemetryEligible || context.routeUsability !== 'USABLE' ||
            context.effectiveRouteDirection?.direction.id !== directionId ||
            context.mapping?.mappingId !== row.mapping_id || context.contextVersion !== row.context_version) continue;
        vehicles.push({
          jeepneyId: row.jeepney_id,
          plateNo: row.plate_no,
          physicalColorHex: row.color_hex,
          routeId: row.route_id,
          directionId,
          stateRevision: row.revision,
          position: position(row),
          trackerStatus: 'ONLINE',
          motionStatus: row.motion_status ?? 'UNKNOWN',
          routeCompliance: 'ON_ROUTE',
          lastSuccessfulUpdateAt: iso(row.last_successful_update_at),
          availableUntil: iso(row.available_until),
        });
      }
      return {
        schemaVersion: 1 as const,
        snapshotAt: (rows[0]?.now ?? await dbNow(client)).toISOString(),
        scope: { kind: 'ROUTE_DIRECTION' as const, id: directionId },
        complete: true as const,
        count: vehicles.length,
        vehicles,
      };
    });
  }

  /** T2: the caller's private scope (DRIVER assigned/group/created, OPERATOR own, ADMIN all). */
  async privateFleet(actor: User, groupId: string | null) {
    return this.snapshot(async (client) => {
      const scope = await scopeFor(actor, client);
      const ids = await client.query<{ id: string }>(
        `SELECT j.id FROM jeepneys j
         WHERE ${scope.predicate}
           AND ($${scope.values.length + 1}::uuid IS NULL OR EXISTS (
             SELECT 1 FROM fleet_group_jeepneys g WHERE g.group_id = $${scope.values.length + 1} AND g.jeepney_id = j.id))
         LIMIT $${scope.values.length + 2}`,
        [...scope.values, groupId, maxSnapshotVehicles + 1],
      );
      assertWithinCap(ids.rowCount ?? 0);
      const rows = await this.rows(client, ids.rows.map((row) => row.id), actor);
      const vehicles = rows.map(projectPrivate);
      return {
        schemaVersion: 1 as const,
        snapshotAt: (rows[0]?.now ?? await dbNow(client)).toISOString(),
        scope: { kind: scope.kind, groupId },
        complete: true as const,
        summary: summarize(vehicles),
        vehicles,
      };
    });
  }

  /** T3: one vehicle under Agent A's private-tracking authorization (403 outside scope, 404 unknown). */
  async privateVehicle(actor: User, jeepneyId: string) {
    return this.snapshot(async (client) => {
      await this.visibility.assertCanReadPrivateTracking(actor, jeepneyId, client);
      const [row] = await this.rows(client, [jeepneyId], actor);
      if (row === undefined) throw new ApiError(404, 'NOT_FOUND', 'Jeepney not found');
      return { snapshotAt: row.now.toISOString(), vehicle: projectPrivate(row) };
    });
  }

  private async rows(client: pg.PoolClient, ids: string[], actor: User | null): Promise<Row[]> {
    if (ids.length === 0) return [];
    const result = await client.query<Row>(
      `WITH c AS (SELECT clock_timestamp() AS now),
       lease AS (SELECT expires_at FROM tracking_bridge_leases
                 WHERE deployment_key = 'primary' AND owner_id IS NOT NULL)
       SELECT j.id AS jeepney_id, j.plate_no, j.color_hex, j.tracking_context_version::text AS current_version,
         s.revision::text AS revision, s.mapping_id, s.context_version::text AS context_version,
         rd.route_id, s.route_direction_id, s.route_resolution, s.fix_time, s.latitude, s.longitude, s.speed_kph,
         s.heading, s.last_successful_update_at, s.location_status, s.location_reason, s.tracker_status,
         s.motion_status, s.route_compliance, s.distance_m, c.now,
         COALESCE((SELECT expires_at > c.now FROM lease), false) AS lease_live,
         COALESCE(s.location_status = 'FRESH' AND c.now <= s.fresh_until AND s.fix_time <= c.now, false) AS current,
         COALESCE(s.fix_time > c.now, false) AS fix_ahead,
         LEAST(s.fresh_until, (SELECT expires_at FROM lease)) AS available_until,
         d.fix_time AS deviation_since, d.corridor_m AS deviation_corridor_m,
         ${relationSql(actor)} AS relation
       FROM c CROSS JOIN jeepneys j
       LEFT JOIN vehicle_latest_states s ON s.jeepney_id = j.id
       LEFT JOIN route_directions rd ON rd.id = s.route_direction_id
       LEFT JOIN LATERAL (
         SELECT e.fix_time, e.corridor_m FROM route_compliance_events e
         WHERE e.jeepney_id = j.id AND e.event_type = 'ROUTE_DEVIATION' AND e.context_version = s.context_version
         ORDER BY e.state_revision DESC LIMIT 1) d ON true
       WHERE j.id = ANY($1::uuid[])
       ORDER BY j.plate_no, j.id`,
      usesActorParameter(actor) ? [ids, actor?.id] : [ids],
    );
    return result.rows;
  }

  private async snapshot<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const value = await work(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

function projectPrivate(row: Row): PrivateVehicleV1 {
  const identity = {
    jeepneyId: row.jeepney_id, plateNo: row.plate_no, physicalColorHex: row.color_hex, relation: row.relation,
  };
  if (row.revision === null) {
    return {
      ...identity, routeId: null, directionId: null, stateRevision: null,
      tracking: null, position: null, positionIsLastKnown: false,
    };
  }
  // A stored context older than Agent A's current version is not authority for anything shown.
  const contextCurrent = row.context_version === row.current_version;
  const live = contextCurrent && row.lease_live && row.current;
  const hasFix = contextCurrent && row.fix_time !== null;
  const reason = !contextCurrent ? 'CONTEXT_CHANGED'
    : !row.lease_live ? 'WRITER_UNAVAILABLE'
      : row.fix_time === null ? row.location_reason
        : row.fix_ahead ? 'FIX_AHEAD'
          : !row.current ? (row.location_status === 'INVALID' ? 'INVALID_FIX' : 'STALE_FIX')
            : null;
  const compliance = live ? row.route_compliance ?? 'UNKNOWN' : 'UNKNOWN';
  return {
    ...identity,
    routeId: contextCurrent ? row.route_id : null,
    directionId: contextCurrent ? row.route_direction_id : null,
    stateRevision: row.revision,
    tracking: {
      // Connectivity needs a live writer; without one it is UNKNOWN, never an invented OFFLINE.
      trackerStatus: contextCurrent && row.lease_live ? row.tracker_status ?? 'UNKNOWN' : 'UNKNOWN',
      motionStatus: live ? row.motion_status ?? 'UNKNOWN' : 'UNKNOWN',
      locationStatus: live ? 'CURRENT' : hasFix ? 'LAST_KNOWN' : 'NONE',
      routeCompliance: compliance,
      routeResolution: !contextCurrent ? 'UNASSIGNED' : row.route_resolution === 'RESOLVED' ? 'USABLE'
        : (row.route_resolution as 'UNASSIGNED' | 'INACTIVE' | 'CONFLICT' | null) ?? 'UNASSIGNED',
      reason,
      deviation: compliance === 'OFF_ROUTE' && row.deviation_since !== null && row.distance_m !== null &&
        row.deviation_corridor_m !== null
        ? { since: row.deviation_since.toISOString(), distanceM: row.distance_m, corridorM: row.deviation_corridor_m }
        : null,
      fixTime: hasFix ? iso(row.fix_time) : null,
      lastSuccessfulUpdateAt: hasFix ? iso(row.last_successful_update_at) : null,
      availableUntil: live ? iso(row.available_until) : null,
    },
    position: hasFix ? position(row) : null,
    positionIsLastKnown: hasFix && !live,
  };
}

function summarize(vehicles: PrivateVehicleV1[]): TrackingSummaryV1 {
  const count = (test: (vehicle: PrivateVehicleV1) => boolean) => vehicles.filter(test).length;
  return {
    total: vehicles.length,
    online: count((v) => v.tracking?.trackerStatus === 'ONLINE'),
    offline: count((v) => v.tracking?.trackerStatus === 'OFFLINE'),
    unknown: count((v) => (v.tracking?.trackerStatus ?? 'UNKNOWN') === 'UNKNOWN'),
    moving: count((v) => v.tracking?.motionStatus === 'MOVING'),
    stopped: count((v) => v.tracking?.motionStatus === 'STOPPED'),
    onRoute: count((v) => v.tracking?.routeCompliance === 'ON_ROUTE'),
    offRoute: count((v) => v.tracking?.routeCompliance === 'OFF_ROUTE'),
  };
}

interface Scope { kind: 'DRIVER' | 'OPERATOR' | 'ADMIN'; predicate: string; values: unknown[] }

// Mirrors Agent A's TrackingVisibilityService existence semantics as one set predicate.
async function scopeFor(actor: User, client: pg.PoolClient): Promise<Scope> {
  if (actor.roles.includes('ADMIN')) return { kind: 'ADMIN', predicate: 'true', values: [] };
  if (actor.roles.includes('OPERATOR')) {
    const operator = await client.query<{ id: string }>(
      `SELECT id FROM operators WHERE owner_user_id = $1 AND status = 'ACTIVE'`, [actor.id]);
    const operatorId = operator.rows[0]?.id;
    if (operatorId === undefined) throw new ApiError(403, 'FORBIDDEN', 'Active operator profile required');
    return { kind: 'OPERATOR', predicate: 'j.operator_id = $1', values: [operatorId] };
  }
  if (actor.roles.includes('DRIVER')) {
    return {
      kind: 'DRIVER',
      predicate: `EXISTS (
        SELECT 1 FROM drivers d
        LEFT JOIN driver_jeepney_assignments dja
          ON dja.jeepney_id = j.id AND dja.driver_id = d.id AND dja.active_to IS NULL
        LEFT JOIN fleet_group_jeepneys fgj ON fgj.jeepney_id = j.id
        LEFT JOIN fleet_group_drivers fgd ON fgd.group_id = fgj.group_id AND fgd.driver_id = d.id
        WHERE d.user_id = $1 AND (j.created_by_user_id = $1 OR dja.id IS NOT NULL OR fgd.driver_id IS NOT NULL))`,
      values: [actor.id],
    };
  }
  throw new ApiError(403, 'FORBIDDEN', 'This role cannot view private vehicle tracking');
}

function relationSql(actor: User | null): string {
  if (actor === null) return `ARRAY[]::text[]`;
  if (actor.roles.includes('ADMIN')) return `ARRAY['PLATFORM']::text[]`;
  if (actor.roles.includes('OPERATOR')) return `ARRAY['OWNED']::text[]`;
  return `ARRAY_REMOVE(ARRAY[
    CASE WHEN EXISTS (SELECT 1 FROM drivers d JOIN driver_jeepney_assignments dja ON dja.driver_id = d.id
      WHERE d.user_id = $2 AND dja.jeepney_id = j.id AND dja.active_to IS NULL) THEN 'ASSIGNED' END,
    CASE WHEN EXISTS (SELECT 1 FROM drivers d JOIN fleet_group_drivers fgd ON fgd.driver_id = d.id
      JOIN fleet_group_jeepneys fgj ON fgj.group_id = fgd.group_id
      WHERE d.user_id = $2 AND fgj.jeepney_id = j.id) THEN 'GROUP' END,
    CASE WHEN j.created_by_user_id = $2 THEN 'OWNED' END], NULL)::text[]`;
}

function usesActorParameter(actor: User | null): boolean {
  return actor !== null && !actor.roles.includes('ADMIN') && !actor.roles.includes('OPERATOR');
}

function assertWithinCap(count: number): void {
  if (count > maxSnapshotVehicles) {
    // Proposed dedicated code TRACKING_SCOPE_TOO_LARGE is pending M7; Agent A's code set is unchanged.
    throw new ApiError(422, 'VALIDATION_ERROR', 'Tracking scope is too large; narrow the request', {
      reason: 'TRACKING_SCOPE_TOO_LARGE', maxVehicles: maxSnapshotVehicles,
    });
  }
}

// B007 makes the valid-fix columns all-or-none, so a present fix_time means every value is present.
function position(row: Row): PositionV1 {
  return {
    latitude: present(row.latitude), longitude: present(row.longitude), fixTime: iso(row.fix_time),
    speedKph: present(row.speed_kph), heading: present(row.heading),
  };
}

function present(value: number | null): number {
  if (value === null) throw new Error('Tracking projection found a partial fix');
  return value;
}

function iso(value: Date | null): string {
  if (value === null) throw new Error('Tracking projection expected a timestamp');
  return value.toISOString();
}

async function dbNow(client: pg.PoolClient): Promise<Date> {
  const result = await client.query<{ now: Date }>('SELECT clock_timestamp() AS now');
  return result.rows[0]?.now ?? new Date();
}

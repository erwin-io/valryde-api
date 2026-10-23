import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import type pg from 'pg';

import { lockTrackingContexts } from '../db/tracking-context.js';
import type { TrackingBusinessContext, TrackingContextService } from '../services/tracking-context-service.js';
import {
  applyQualifyingFix, type ComplianceFields, type ComplianceTransition, expireCompliance, resetCompliance,
} from './route-compliance.js';
import { LeaseLostError, type WriterLease } from './tracking-lease.js';

// Frozen Stage 13b values (B0 matrix M2, Amendment 1 X7); deliberately not configuration.
const freshnessMs = 30_000;
const maxSpeedKph = 300;
const maxAttempts = 3;
const deadlineMs = 10_000;
const transientCodes = new Set(['40P01', '40001', '55P03']);

/** One Traccar position as the Bridge received it. Server-only: provider IDs never reach a client. */
export interface TrackingObservation {
  /** Traccar device and position IDs as positive decimal strings, never rounded JS numbers. */
  deviceId: string;
  uniqueId: string;
  positionId: string;
  valid: boolean;
  latitude: number;
  longitude: number;
  fixTime: string;
  deviceTime: string;
  serverTime: string;
  speedKph: number;
  heading: number;
  receivedAt: string;
}

export type PersistDisposition = 'APPLIED' | 'DUPLICATE' | 'OUT_OF_ORDER' | 'INVALIDATED' | 'REJECTED' | 'UNMAPPED';
export type PersistReason = 'MALFORMED' | 'CLOCK_AHEAD' | 'INELIGIBLE' | 'PRE_MAPPING' | 'PRE_CUTOVER';

/** Resolved only after COMMIT, so a result is the commit acknowledgement. */
export interface PersistResult {
  disposition: PersistDisposition;
  reason: PersistReason | null;
  /** True when this call committed a new revision (including expiry or context normalization). */
  materializedChange: boolean;
  revision: string | null;
}

const columns = [
  'writer_fence',
  'mapping_id', 'gps_device_id', 'mapping_mapped_at', 'mapping_fingerprint', 'traccar_device_id',
  'traccar_position_id', 'fix_time', 'device_time', 'server_time', 'latitude', 'longitude', 'speed_kph', 'heading',
  'last_successful_update_at', 'fresh_until',
  'observed_at', 'received_at', 'location_status', 'location_reason',
  'tracker_status', 'status_source_time', 'status_observed_at', 'status_source', 'status_epoch', 'status_sequence',
  'motion_status',
  'route_direction_id', 'route_assignment_id', 'route_resolution', 'context_version', 'context_cutover_at',
  'context_fingerprint',
  'route_compliance', 'distance_m', 'outside_since', 'consecutive_outside', 'consecutive_inside', 'reentry_required',
  'compliance_changed_at',
] as const;
type State = Record<(typeof columns)[number], unknown>;
type StoredState = State & { revision: string };

interface Parsed { fix: Date; received: Date; device: Date | null; server: Date | null; qualifies: boolean }
interface Clock {
  now: Date; lease_live: boolean; expired: boolean;
  pre_mapping: boolean; pre_cutover: boolean; ahead: boolean; fix_ahead: boolean; arrived_stale: boolean;
}
interface Corridor { distance_m: number; inside: boolean; corridor_m: number }

export interface WriterDependencies {
  now?: () => number;
  random?: () => number;
  sleep?: (ms: number) => Promise<unknown>;
  /** Test hook only: replaces the post-lock clock_timestamp() reading so boundaries are deterministic. */
  databaseNow?: () => Date;
}

/**
 * Durable, fenced latest-state writer (Stage 13b B2). One jeepney per READ COMMITTED transaction:
 * lease FOR SHARE → shared advisory key → Agent A context on the same client → state FOR UPDATE →
 * DB-clock normalization → classification → compare-and-set revision → COMMIT. No network I/O
 * happens while locks are held. Route compliance (B3) and its transition event commit in the same
 * transaction as the state revision.
 */
export class TrackingStateWriter {
  readonly #now: () => number;
  readonly #random: () => number;
  readonly #sleep: (ms: number) => Promise<unknown>;
  readonly #databaseNow: (() => Date) | undefined;

  constructor(
    private readonly pool: pg.Pool,
    private readonly contexts: Pick<TrackingContextService, 'resolve'>,
    dependencies: WriterDependencies = {},
  ) {
    this.#now = dependencies.now ?? Date.now;
    this.#random = dependencies.random ?? Math.random;
    this.#sleep = dependencies.sleep ?? delay;
    this.#databaseNow = dependencies.databaseNow;
  }

  async apply(observation: TrackingObservation, lease: WriterLease): Promise<PersistResult> {
    const parsed = parse(observation);
    if (parsed === null) return outcome('REJECTED', 'MALFORMED');
    // Unlocked discovery only chooses the advisory key; the mapping is revalidated under it.
    const found = await this.pool.query<{ jeepney_id: string }>(
      'SELECT jeepney_id FROM traccar_device_mappings WHERE traccar_unique_id = $1',
      [observation.uniqueId],
    );
    const jeepneyId = found.rows[0]?.jeepney_id;
    if (jeepneyId === undefined) return outcome('UNMAPPED');
    return this.transaction((client) => this.applyLocked(client, jeepneyId, observation, parsed, lease));
  }

  private async applyLocked(
    client: pg.PoolClient,
    jeepneyId: string,
    observation: TrackingObservation,
    parsed: Parsed,
    lease: WriterLease,
  ): Promise<PersistResult> {
    const held = await client.query(
      `SELECT 1 FROM tracking_bridge_leases
       WHERE deployment_key = 'primary' AND owner_id = $1 AND fence = $2 AND expires_at > clock_timestamp()
       FOR SHARE`,
      [lease.ownerId, lease.fence],
    );
    if (held.rowCount !== 1) throw new LeaseLostError();
    await lockTrackingContexts(client, [jeepneyId]);
    const context = await this.contexts.resolve(jeepneyId, client);
    const mapping = context.mapping;
    if (mapping === null || mapping.traccarUniqueId !== observation.uniqueId) return outcome('UNMAPPED');

    const stored = await client.query<StoredState>(
      `SELECT ${columns.join(', ')}, revision FROM vehicle_latest_states WHERE jeepney_id = $1 FOR UPDATE`,
      [jeepneyId],
    );
    const current = stored.rows[0];
    // One DB clock reading after every lock (X4); all boundary comparisons stay in microsecond SQL time.
    const clockRow = await client.query<Clock>(
      `WITH c AS (SELECT COALESCE($6::timestamptz, clock_timestamp()) AS now)
       SELECT c.now,
         EXISTS (SELECT 1 FROM tracking_bridge_leases WHERE deployment_key = 'primary'
           AND owner_id = $1 AND fence = $2 AND expires_at > c.now) AS lease_live,
         COALESCE(c.now > s.fresh_until, false) AS expired,
         $5::timestamptz < m.mapped_at AS pre_mapping,
         $5::timestamptz < j.tracking_context_changed_at AS pre_cutover,
         $5::timestamptz > c.now + interval '5 seconds' AS ahead,
         $5::timestamptz > c.now AS fix_ahead,
         c.now > $5::timestamptz + interval '30 seconds' AS arrived_stale
       FROM c
       JOIN jeepneys j ON j.id = $3
       JOIN traccar_device_mappings m ON m.id = $4
       LEFT JOIN vehicle_latest_states s ON s.jeepney_id = j.id`,
      [lease.ownerId, lease.fence, jeepneyId, mapping.mappingId, parsed.fix, this.#databaseNow?.() ?? null],
    );
    const clock = clockRow.rows[0];
    if (clock === undefined) throw new Error('Tracking context disappeared under its advisory key');
    // A lock wait may outlast the lease; an expired token must not write anything.
    if (!clock.lease_live) throw new LeaseLostError();

    const next: State = current === undefined ? blankState() : pick(current);
    const compliance = next as unknown as ComplianceFields;
    const mappingFingerprint = sha256([
      mapping.mappingId, mapping.mappedAt.toISOString(), mapping.gpsDeviceId, mapping.gpsSetupRequestId,
      mapping.traccarUniqueId,
    ]);
    const contextFingerprint = sha256(contextIdentity(context, mappingFingerprint));
    if (current !== undefined) {
      if (next.mapping_id !== mapping.mappingId || next.traccar_device_id !== observation.deviceId ||
          next.mapping_fingerprint !== mappingFingerprint) {
        clear(next, 'MAPPING_CHANGED', clock.now);
      } else if (next.context_fingerprint !== null && next.context_fingerprint !== contextFingerprint) {
        // Fail closed: no retained point or debounce run may carry into a new ownership/route context.
        clear(next, 'CONTEXT_CHANGED', clock.now);
      }
    }
    const effective = context.effectiveRouteDirection;
    Object.assign(next, {
      mapping_id: mapping.mappingId,
      gps_device_id: mapping.gpsDeviceId,
      mapping_mapped_at: mapping.mappedAt,
      mapping_fingerprint: mappingFingerprint,
      traccar_device_id: observation.deviceId,
      route_direction_id: context.routeUsability === 'USABLE' || context.routeUsability === 'INACTIVE'
        ? effective?.direction.id ?? null : null,
      route_assignment_id: effective?.assignmentId ?? null,
      route_resolution: resolution[context.routeUsability],
      context_version: context.contextVersion,
      context_cutover_at: context.contextChangedAt,
      context_fingerprint: contextFingerprint,
    });

    const write = (disposition: PersistDisposition, reason: PersistReason | null = null) =>
      this.persist(client, jeepneyId, current, next, lease, disposition, reason);

    if (!context.telemetryEligible) {
      if (next.location_reason !== 'INELIGIBLE') clear(next, 'INELIGIBLE', clock.now);
      return write('REJECTED', 'INELIGIBLE');
    }
    // Expiry is strictly DB now > fresh_until, normalized before the observation is classified.
    if (next.location_status === 'FRESH' && clock.expired) {
      Object.assign(next, { location_status: 'STALE', location_reason: 'EXPIRED', motion_status: 'UNKNOWN' });
      expireCompliance(compliance, clock.now);
    }
    // X5: the cutover fences use the GPS fix time only.
    if (clock.pre_mapping) return write('INVALIDATED', 'PRE_MAPPING');
    if (clock.pre_cutover) return write('INVALIDATED', 'PRE_CUTOVER');
    if (clock.ahead) return write('REJECTED', 'CLOCK_AHEAD');
    if (next.traccar_position_id === observation.positionId) return write('DUPLICATE');
    if (next.observed_at instanceof Date) {
      // Equal fix times with different position IDs: first committed wins.
      if (parsed.fix.getTime() === next.observed_at.getTime()) return write('DUPLICATE');
      if (parsed.fix.getTime() < next.observed_at.getTime()) return write('OUT_OF_ORDER');
    }

    const priorFix = next.fix_time instanceof Date ? next.fix_time : null;
    const continuous = priorFix !== null && next.observed_at instanceof Date &&
      next.observed_at.getTime() === priorFix.getTime() &&
      parsed.fix.getTime() - priorFix.getTime() <= freshnessMs;
    if (parsed.qualifies) {
      Object.assign(next, {
        traccar_position_id: observation.positionId,
        fix_time: parsed.fix,
        device_time: parsed.device,
        server_time: parsed.server,
        latitude: observation.latitude,
        longitude: observation.longitude,
        speed_kph: observation.speedKph,
        heading: observation.heading,
        last_successful_update_at: clock.now,
        fresh_until: new Date(parsed.fix.getTime() + freshnessMs),
        location_status: clock.arrived_stale ? 'STALE' : 'FRESH',
        location_reason: clock.arrived_stale ? 'EXPIRED' : 'VALID_FIX',
      });
    } else {
      // An invalid fix advances the watermark but keeps the last valid point private and unchanged.
      Object.assign(next, { location_status: 'INVALID', location_reason: 'INVALID_FIX' });
    }
    Object.assign(next, { observed_at: parsed.fix, received_at: parsed.received, motion_status: 'UNKNOWN' });

    // Only a newly accepted, fresh, not-ahead fix on a usable route counts toward compliance.
    let transition: ComplianceTransition | null = null;
    let corridor: Corridor | undefined;
    const directionId = context.routeUsability === 'USABLE' ? effective?.direction.id : undefined;
    if (parsed.qualifies && !clock.arrived_stale && !clock.fix_ahead && directionId !== undefined) {
      const geometry = await client.query<Corridor>(
        `SELECT ST_Distance(point.g, rd.geometry::geography, true) AS distance_m,
           ST_DWithin(point.g, rd.geometry::geography, rd.corridor_m, true) AS inside, rd.corridor_m
         FROM route_directions rd, (SELECT ST_SetSRID(ST_MakePoint($2::float8, $3::float8), 4326)::geography AS g) point
         WHERE rd.id = $1`,
        [directionId, observation.longitude, observation.latitude],
      );
      corridor = geometry.rows[0];
      if (corridor === undefined) throw new Error('Resolved route direction disappeared under its advisory key');
      transition = applyQualifyingFix(compliance, {
        inside: corridor.inside, distanceM: corridor.distance_m, fixTime: parsed.fix, continuous, now: clock.now,
      });
    } else {
      resetCompliance(compliance, true, clock.now);
    }
    const result = await write('APPLIED');
    if (transition !== null && corridor !== undefined) {
      // Same transaction as the revision; UNIQUE(jeepney_id, state_revision) makes a replay a no-op.
      await client.query(
        `INSERT INTO route_compliance_events(jeepney_id, route_direction_id, mapping_id, context_version,
           context_fingerprint, state_revision, event_type, from_state, to_state, fix_time, traccar_position_id,
           distance_m, corridor_m, operator_id_at_event)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (jeepney_id, state_revision) DO NOTHING`,
        [jeepneyId, directionId, mapping.mappingId, context.contextVersion, contextFingerprint, result.revision,
          transition.eventType, transition.fromState, transition.toState, parsed.fix, observation.positionId,
          corridor.distance_m, corridor.corridor_m, context.operatorId],
      );
    }
    return result;
  }

  private async persist(
    client: pg.PoolClient,
    jeepneyId: string,
    current: StoredState | undefined,
    next: State,
    lease: WriterLease,
    disposition: PersistDisposition,
    reason: PersistReason | null,
  ): Promise<PersistResult> {
    const changed = current === undefined
      ? disposition === 'APPLIED'
      : columns.some((column) => column !== 'writer_fence' && !same(current[column], next[column]));
    if (!changed) return outcome(disposition, reason, false, current?.revision ?? null);
    const values = columns.map((column) => (column === 'writer_fence' ? lease.fence : next[column]));
    const result = current === undefined
      ? await client.query<{ revision: string }>(
        `INSERT INTO vehicle_latest_states(jeepney_id, ${columns.join(', ')})
         VALUES ($1, ${columns.map((_, index) => `$${index + 2}`).join(', ')})
         ON CONFLICT (jeepney_id) DO NOTHING RETURNING revision`,
        [jeepneyId, ...values],
      )
      : await client.query<{ revision: string }>(
        `UPDATE vehicle_latest_states
         SET ${columns.map((column, index) => `${column} = $${index + 4}`).join(', ')},
           revision = revision + 1, updated_at = clock_timestamp()
         WHERE jeepney_id = $1 AND revision = $2 AND writer_fence <= $3 RETURNING revision`,
        [jeepneyId, current.revision, lease.fence, ...values],
      );
    const revision = result.rows[0]?.revision;
    if (revision === undefined) {
      // Under the advisory key and row lock only a newer fence can have moved an existing row.
      if (current !== undefined) throw new LeaseLostError();
      throw new Error('Tracking state row was inserted outside the shared advisory key');
    }
    return outcome(disposition, reason, true, revision);
  }

  /** Retries the whole transaction, never a statement, and acknowledges only after COMMIT. */
  private async transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const deadline = this.#now() + deadlineMs;
    for (let attempt = 1; ; attempt += 1) {
      let failure: unknown;
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await client.query("SET LOCAL lock_timeout = '1s'");
        await client.query("SET LOCAL statement_timeout = '5s'");
        const value = await work(client);
        await client.query('COMMIT');
        return value;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        failure = error;
      } finally {
        client.release();
      }
      const wait = 50 + Math.floor(this.#random() * 150);
      if (!isTransient(failure) || attempt >= maxAttempts || this.#now() + wait >= deadline) throw failure;
      await this.#sleep(wait);
    }
  }
}

const resolution = { USABLE: 'RESOLVED', UNASSIGNED: 'UNASSIGNED', INACTIVE: 'INACTIVE', CONFLICT: 'CONFLICT' } as const;

function contextIdentity(context: TrackingBusinessContext, mappingFingerprint: string): unknown[] {
  const effective = context.effectiveRouteDirection;
  return [
    context.contextVersion, mappingFingerprint, context.operatorId, context.routeUsability,
    effective?.assignmentId ?? null, effective?.direction.id ?? null, effective?.direction.status ?? null,
    effective?.direction.corridorM ?? null, effective?.direction.geometry ?? null,
  ];
}

function blankState(): State {
  const state = Object.fromEntries(columns.map((column) => [column, null])) as State;
  Object.assign(state, {
    location_status: 'UNKNOWN', location_reason: 'NO_FIX', tracker_status: 'UNKNOWN', status_source: 'NONE',
    motion_status: 'UNKNOWN', route_resolution: 'UNASSIGNED', route_compliance: 'UNKNOWN',
    consecutive_outside: 0, consecutive_inside: 0, reentry_required: false,
  });
  return state;
}

function pick(row: StoredState): State {
  return Object.fromEntries(columns.map((column) => [column, row[column]])) as State;
}

/** Drops every fix, observation, tracker status and compliance value; the revision keeps increasing. */
function clear(state: State, reason: string, now: Date): void {
  const blank = blankState();
  for (const column of [
    'traccar_position_id', 'fix_time', 'device_time', 'server_time', 'latitude', 'longitude', 'speed_kph', 'heading',
    'last_successful_update_at', 'fresh_until', 'observed_at', 'received_at',
    'tracker_status', 'status_source_time', 'status_observed_at', 'status_source', 'status_epoch', 'status_sequence',
    'motion_status',
  ] as const) state[column] = blank[column];
  Object.assign(state, { location_status: 'UNKNOWN', location_reason: reason });
  resetCompliance(state as unknown as ComplianceFields, false, now);
}

function parse(observation: TrackingObservation): Parsed | null {
  if (!isBigint(observation.deviceId) || !isBigint(observation.positionId)) return null;
  if (typeof observation.uniqueId !== 'string' || observation.uniqueId === '') return null;
  const fix = time(observation.fixTime);
  const received = time(observation.receivedAt);
  if (fix === null || received === null) return null;
  const device = time(observation.deviceTime);
  const server = time(observation.serverTime);
  const qualifies = observation.valid === true && device !== null && server !== null &&
    within(observation.latitude, -90, 90) && within(observation.longitude, -180, 180) &&
    within(observation.speedKph, 0, maxSpeedKph) && within(observation.heading, 0, 360) && observation.heading < 360;
  return { fix, received, device, server, qualifies };
}

function isBigint(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n;
}

function time(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

function within(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function same(left: unknown, right: unknown): boolean {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  return left === right;
}

function sha256(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function outcome(
  disposition: PersistDisposition,
  reason: PersistReason | null = null,
  materializedChange = false,
  revision: string | null = null,
): PersistResult {
  return { disposition, reason, materializedChange, revision };
}

function isTransient(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    typeof error.code === 'string' && transientCodes.has(error.code);
}

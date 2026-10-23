import type { QueryExecutor } from '../db/tracking-context.js';
import type { EffectiveRouteDirection, RecordStatus } from '../domain/transit.js';
import { ApiError } from '../lib/api-error.js';
import type { TransitService } from './transit-service.js';

export type TelemetryIneligibilityReason =
  | 'JEEPNEY_NOT_FOUND'
  | 'JEEPNEY_NOT_ACTIVE'
  | 'MAPPING_MISSING'
  | 'DEVICE_NOT_ACTIVE'
  | 'APPLICATION_NOT_APPROVED'
  | 'GPS_NOT_INSTALLED'
  | 'GPS_NOT_VERIFIED';

export type RouteUsability = 'USABLE' | 'UNASSIGNED' | 'INACTIVE' | 'CONFLICT';

export interface TrackingMappingGeneration {
  mappingId: string;
  mappedAt: Date;
  gpsDeviceId: string;
  gpsSetupRequestId: string;
  traccarUniqueId: string;
}

export interface TrackingBusinessContext {
  jeepneyId: string;
  operatorId: string | null;
  /** PostgreSQL bigint as a decimal string; '0' only when the jeepney does not exist. */
  contextVersion: string;
  contextChangedAt: Date | null;
  mapping: TrackingMappingGeneration | null;
  effectiveRouteDirection: EffectiveRouteDirection | null;
  telemetryEligible: boolean;
  telemetryIneligibilityReason: TelemetryIneligibilityReason | null;
  routeUsability: RouteUsability;
}

interface ContextRow {
  operator_id: string | null;
  jeepney_status: string;
  context_version: string;
  context_changed_at: Date;
  mapping_id: string | null;
  mapped_at: Date | null;
  gps_device_id: string | null;
  gps_setup_request_id: string | null;
  traccar_unique_id: string | null;
  device_status: RecordStatus | null;
  request_jeepney_id: string | null;
  request_status: string | null;
  verification_status: string | null;
  application_status: string | null;
}

/**
 * Resolves the Agent A business context Agent B stamps on tracking state (Stage 13b §2).
 * Write mode: inside a READ COMMITTED transaction after taking the jeepney advisory key.
 * Snapshot mode: inside a REPEATABLE READ READ ONLY transaction with no key; never writes.
 * The mode is the caller's precondition. Only reads; never controls the caller's transaction.
 */
export class TrackingContextService {
  constructor(private readonly transitService: TransitService) {}

  async resolve(jeepneyId: string, executor: QueryExecutor): Promise<TrackingBusinessContext> {
    // One statement, so eligibility is judged from a single coherent view of the joined rows.
    const result = await executor.query<ContextRow>(
      `SELECT j.operator_id, j.status::text AS jeepney_status,
         j.tracking_context_version::text AS context_version,
         j.tracking_context_changed_at AS context_changed_at,
         m.id AS mapping_id, m.mapped_at, m.gps_device_id, m.gps_setup_request_id, m.traccar_unique_id,
         device.status AS device_status,
         request.jeepney_id AS request_jeepney_id, request.status::text AS request_status,
         request.verification_status::text AS verification_status,
         application.status::text AS application_status
       FROM jeepneys j
       LEFT JOIN traccar_device_mappings m ON m.jeepney_id = j.id
       LEFT JOIN gps_devices device ON device.id = m.gps_device_id
       LEFT JOIN gps_setup_requests request ON request.id = m.gps_setup_request_id
       LEFT JOIN vehicle_applications application
         ON application.id = request.vehicle_application_id AND application.jeepney_id = j.id
       WHERE j.id = $1`,
      [jeepneyId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return {
        jeepneyId,
        operatorId: null,
        contextVersion: '0',
        contextChangedAt: null,
        mapping: null,
        effectiveRouteDirection: null,
        telemetryEligible: false,
        telemetryIneligibilityReason: 'JEEPNEY_NOT_FOUND',
        routeUsability: 'UNASSIGNED',
      };
    }

    const reason = ineligibility(row, jeepneyId);
    const route = await this.routeContext(jeepneyId, executor);
    return {
      jeepneyId,
      operatorId: row.operator_id,
      contextVersion: row.context_version,
      contextChangedAt: row.context_changed_at,
      mapping: mappingGeneration(row),
      effectiveRouteDirection: route.effective,
      telemetryEligible: reason === null,
      telemetryIneligibilityReason: reason,
      routeUsability: route.usability,
    };
  }

  // Only the known conflict outcome becomes CONFLICT; every other error propagates and rolls back.
  private async routeContext(
    jeepneyId: string,
    executor: QueryExecutor,
  ): Promise<{ effective: EffectiveRouteDirection | null; usability: RouteUsability }> {
    let effective: EffectiveRouteDirection | null;
    try {
      effective = await this.transitService.resolveEffectiveRouteDirection(jeepneyId, executor);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'ROUTE_ASSIGNMENT_CONFLICT') {
        return { effective: null, usability: 'CONFLICT' };
      }
      throw error;
    }
    if (effective === null) return { effective: null, usability: 'UNASSIGNED' };
    const route = await executor.query<{ status: RecordStatus }>(
      'SELECT status FROM transit_routes WHERE id = $1',
      [effective.direction.routeId],
    );
    const usable = effective.direction.status === 'ACTIVE' && route.rows[0]?.status === 'ACTIVE';
    return { effective, usability: usable ? 'USABLE' : 'INACTIVE' };
  }
}

function ineligibility(row: ContextRow, jeepneyId: string): TelemetryIneligibilityReason | null {
  if (row.jeepney_status !== 'ACTIVE') return 'JEEPNEY_NOT_ACTIVE';
  if (row.mapping_id === null || row.request_jeepney_id !== jeepneyId) return 'MAPPING_MISSING';
  if (row.device_status !== 'ACTIVE') return 'DEVICE_NOT_ACTIVE';
  if (row.application_status !== 'APPROVED') return 'APPLICATION_NOT_APPROVED';
  if (row.request_status !== 'INSTALLED') return 'GPS_NOT_INSTALLED';
  if (row.verification_status !== 'VERIFIED') return 'GPS_NOT_VERIFIED';
  return null;
}

function mappingGeneration(row: ContextRow): TrackingMappingGeneration | null {
  if (
    row.mapping_id === null ||
    row.mapped_at === null ||
    row.gps_device_id === null ||
    row.gps_setup_request_id === null ||
    row.traccar_unique_id === null
  ) {
    return null;
  }
  return {
    mappingId: row.mapping_id,
    mappedAt: row.mapped_at,
    gpsDeviceId: row.gps_device_id,
    gpsSetupRequestId: row.gps_setup_request_id,
    traccarUniqueId: row.traccar_unique_id,
  };
}

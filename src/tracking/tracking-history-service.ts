import type pg from 'pg';

import type { User } from '../domain/identity.js';
import { ApiError } from '../lib/api-error.js';
import type { FleetService } from '../services/fleet-service.js';
import type { HistoryRange, TraccarClient, TraccarDevice } from './traccar-client.js';
import { TraccarError, validateHistoryRange } from './traccar-client.js';

export class PgTrackingMappingRepository {
  constructor(private readonly pool: Pick<pg.Pool, 'query'>) {}

  async uniqueIdForJeepney(jeepneyId: string): Promise<string | null> {
    const result = await this.pool.query<{ traccar_unique_id: string }>(
      `SELECT m.traccar_unique_id FROM traccar_device_mappings m
       JOIN gps_devices d ON d.id = m.gps_device_id AND d.status = 'ACTIVE'
       JOIN jeepneys j ON j.id = m.jeepney_id AND j.status = 'ACTIVE'
       JOIN gps_setup_requests s ON s.id = m.gps_setup_request_id
         AND s.jeepney_id = m.jeepney_id AND s.status = 'INSTALLED' AND s.verification_status = 'VERIFIED'
       JOIN vehicle_applications a ON a.id = s.vehicle_application_id AND a.jeepney_id = m.jeepney_id
         AND a.status = 'APPROVED'
       WHERE m.jeepney_id = $1`, [jeepneyId],
    );
    return result.rows[0]?.traccar_unique_id ?? null;
  }
}

// Internal integration boundary, awaiting approval of public HTTP paths/response schemas.
// The injected FleetService reuses Agent A's own-fleet/same-group/platform visibility.
export class TrackingHistoryService {
  constructor(
    private readonly fleet: Pick<FleetService, 'listJeepneys'>,
    private readonly mappings: Pick<PgTrackingMappingRepository, 'uniqueIdForJeepney'>,
    private readonly traccar: Pick<TraccarClient, 'devices' | 'history' | 'events'>,
  ) {}

  async history(actor: User, jeepneyId: string, range: HistoryRange) {
    const device = await this.authorizedDevice(actor, jeepneyId, range);
    if (device === null) return [];
    const positions = await this.traccar.history(device.id, range);
    this.assertDevice(positions, device.id);
    return positions.filter((p) => p.valid && inRange(p.fixTime, range)).map((p) => ({
      jeepneyId,
      latitude: p.latitude, longitude: p.longitude,
      fixTime: p.fixTime, deviceTime: p.deviceTime, serverTime: p.serverTime,
      speedKph: p.speed * 1.852, heading: p.course,
    }));
  }

  async events(actor: User, jeepneyId: string, range: HistoryRange) {
    const device = await this.authorizedDevice(actor, jeepneyId, range);
    if (device === null) return [];
    const events = await this.traccar.events(device.id, range);
    this.assertDevice(events, device.id);
    return events.filter((e) => inRange(e.eventTime, range)).map((e) => ({
      jeepneyId, source: 'TRACCAR' as const, type: e.type, occurredAt: e.eventTime,
    }));
  }

  private async authorizedDevice(actor: User, jeepneyId: string, range: HistoryRange): Promise<TraccarDevice | null> {
    if (actor.status !== 'ACTIVE' || !actor.roles.some((role) => ['ADMIN', 'OPERATOR', 'DRIVER'].includes(role))) {
      throw new ApiError(403, 'FORBIDDEN', 'This role cannot view tracking history');
    }
    const visible = await this.fleet.listJeepneys(actor);
    if (!visible.some((vehicle) => vehicle.id === jeepneyId)) {
      throw new ApiError(403, 'FORBIDDEN', 'Jeepney is outside the permitted scope');
    }
    try { validateHistoryRange(range); } catch {
      throw new ApiError(400, 'VALIDATION_ERROR', 'An ordered ISO time range of at most 30 days is required');
    }
    const uniqueId = await this.mappings.uniqueIdForJeepney(jeepneyId);
    if (uniqueId === null) return null;
    const devices = await this.traccar.devices(uniqueId);
    if (devices.some((d) => d.uniqueId !== uniqueId) || devices.length > 1) {
      throw new TraccarError('INVALID_RESPONSE');
    }
    return devices[0] ?? null;
  }

  private assertDevice(records: Array<{ deviceId: number }>, expected: number): void {
    if (records.some((row) => row.deviceId !== expected)) throw new TraccarError('INVALID_RESPONSE');
  }
}

function inRange(time: string, range: HistoryRange): boolean {
  return Date.parse(time) >= Date.parse(range.from) && Date.parse(time) <= Date.parse(range.to);
}

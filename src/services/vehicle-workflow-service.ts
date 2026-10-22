import type pg from 'pg';

import type { User } from '../domain/identity.js';
import type {
  DeviceMapping,
  GpsSetupRequest,
  GpsSetupStatus,
  VehicleApplication,
  VehicleApplicationStatus,
} from '../domain/vehicle-workflow.js';
import { ApiError } from '../lib/api-error.js';

interface ApplicationRow {
  id: string;
  jeepney_id: string;
  submitted_by_user_id: string;
  status: VehicleApplicationStatus;
  applicant_notes: string | null;
  review_notes: string | null;
  reviewed_by_user_id: string | null;
  reviewed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface SetupRow {
  id: string;
  vehicle_application_id: string;
  jeepney_id: string;
  requested_by_user_id: string;
  status: GpsSetupStatus;
  verification_status: 'NOT_STARTED' | 'PENDING' | 'VERIFIED' | 'FAILED';
  scheduled_at: Date | null;
  installed_at: Date | null;
  rejected_reason: string | null;
  verification_checks: Record<string, unknown>;
  verified_by_user_id: string | null;
  verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface MappingRow {
  id: string | null;
  gps_setup_request_id: string | null;
  gps_device_id: string | null;
  jeepney_id: string | null;
  imei: string | null;
  serial_number: string | null;
  traccar_unique_id: string | null;
  mapped_at: Date | null;
}

export class VehicleWorkflowService {
  constructor(private readonly pool: pg.Pool) {}

  async listApplications(actor: User): Promise<VehicleApplication[]> {
    const scope = await this.scope(actor);
    const result = await this.pool.query<ApplicationRow>(
      `SELECT va.* FROM vehicle_applications va
       JOIN jeepneys j ON j.id = va.jeepney_id
       WHERE $1::boolean OR va.submitted_by_user_id = $2
         OR ($3::uuid IS NOT NULL AND j.operator_id = $3)
         OR ($4::uuid IS NOT NULL AND ${driverJeepneyAccess('j', '$4')})
       ORDER BY va.created_at DESC`,
      [scope.admin, actor.id, scope.operatorId, scope.driverId],
    );
    return result.rows.map(mapApplication);
  }

  async submitApplication(
    actor: User,
    jeepneyId: string,
    applicantNotes?: string,
  ): Promise<VehicleApplication> {
    await this.assertJeepneyAccess(actor, jeepneyId);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM jeepneys WHERE id = $1 FOR UPDATE', [jeepneyId]);
      const result = await client.query<ApplicationRow>(
        `INSERT INTO vehicle_applications(jeepney_id, submitted_by_user_id, applicant_notes)
         VALUES ($1, $2, $3) RETURNING *`,
        [jeepneyId, actor.id, applicantNotes ?? null],
      );
      await client.query(
        `UPDATE jeepneys SET status = 'PENDING_APPROVAL', updated_at = now() WHERE id = $1`,
        [jeepneyId],
      );
      const application = mapApplication(requireRow(result.rows[0]));
      await audit(client, actor.id, 'VEHICLE_APPLICATION_SUBMITTED', 'VEHICLE_APPLICATION', application.id, {
        jeepneyId,
      });
      await client.query('COMMIT');
      return application;
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) {
        throw new ApiError(409, 'CONFLICT', 'This jeepney already has an open application');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async reviewApplication(
    actor: User,
    applicationId: string,
    decision: 'APPROVED' | 'REJECTED',
    reviewNotes?: string,
  ): Promise<VehicleApplication> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<ApplicationRow>(
        'SELECT * FROM vehicle_applications WHERE id = $1 FOR UPDATE',
        [applicationId],
      );
      const row = current.rows[0];
      if (row === undefined) throw new ApiError(404, 'NOT_FOUND', 'Vehicle application not found');
      if (row.status !== 'PENDING') {
        throw new ApiError(409, 'CONFLICT', 'Only pending applications can be reviewed');
      }
      const result = await client.query<ApplicationRow>(
        `UPDATE vehicle_applications SET status = $2, review_notes = $3,
           reviewed_by_user_id = $4, reviewed_at = now(), updated_at = now()
         WHERE id = $1 RETURNING *`,
        [applicationId, decision, reviewNotes ?? null, actor.id],
      );
      await client.query(
        `UPDATE jeepneys SET status = $2::jeepney_status,
           approved_at = CASE WHEN $2 = 'APPROVED' THEN now() ELSE approved_at END,
           updated_at = now() WHERE id = $1`,
        [row.jeepney_id, decision === 'APPROVED' ? 'APPROVED' : 'REJECTED'],
      );
      const application = mapApplication(requireRow(result.rows[0]));
      await audit(client, actor.id, 'VEHICLE_APPLICATION_REVIEWED', 'VEHICLE_APPLICATION', applicationId, {
        decision,
      });
      await client.query('COMMIT');
      return application;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listGpsRequests(actor: User): Promise<GpsSetupRequest[]> {
    const scope = await this.scope(actor);
    const result = await this.pool.query<SetupRow>(
      `SELECT gr.* FROM gps_setup_requests gr JOIN jeepneys j ON j.id = gr.jeepney_id
       WHERE $1::boolean OR gr.requested_by_user_id = $2
         OR ($3::uuid IS NOT NULL AND j.operator_id = $3)
         OR ($4::uuid IS NOT NULL AND ${driverJeepneyAccess('j', '$4')})
       ORDER BY gr.created_at DESC`,
      [scope.admin, actor.id, scope.operatorId, scope.driverId],
    );
    return result.rows.map(mapSetup);
  }

  async submitGpsRequest(actor: User, applicationId: string): Promise<GpsSetupRequest> {
    const application = await this.pool.query<ApplicationRow>(
      'SELECT * FROM vehicle_applications WHERE id = $1',
      [applicationId],
    );
    const row = application.rows[0];
    if (row === undefined) throw new ApiError(404, 'NOT_FOUND', 'Vehicle application not found');
    if (row.status !== 'APPROVED') {
      throw new ApiError(409, 'VEHICLE_NOT_APPROVED', 'Vehicle application must be approved first');
    }
    await this.assertJeepneyAccess(actor, row.jeepney_id);
    try {
      const result = await this.pool.query<SetupRow>(
        `INSERT INTO gps_setup_requests(
           vehicle_application_id, jeepney_id, requested_by_user_id
         ) VALUES ($1, $2, $3) RETURNING *`,
        [applicationId, row.jeepney_id, actor.id],
      );
      const request = mapSetup(requireRow(result.rows[0]));
      await audit(this.pool, actor.id, 'GPS_SETUP_REQUESTED', 'GPS_SETUP_REQUEST', request.id, {
        jeepneyId: row.jeepney_id,
      });
      return request;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError(409, 'CONFLICT', 'GPS setup has already been requested for this application');
      }
      throw error;
    }
  }

  async transitionGpsRequest(
    actor: User,
    requestId: string,
    nextStatus: Exclude<GpsSetupStatus, 'PENDING'>,
    input: { scheduledAt?: string; rejectedReason?: string },
  ): Promise<GpsSetupRequest> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<SetupRow>(
        'SELECT * FROM gps_setup_requests WHERE id = $1 FOR UPDATE',
        [requestId],
      );
      const row = current.rows[0];
      if (row === undefined) throw new ApiError(404, 'NOT_FOUND', 'GPS setup request not found');
      const allowed: Record<GpsSetupStatus, GpsSetupStatus[]> = {
        PENDING: ['APPROVED', 'REJECTED'],
        APPROVED: ['SCHEDULED', 'REJECTED'],
        SCHEDULED: ['INSTALLED', 'REJECTED'],
        INSTALLED: [],
        REJECTED: [],
      };
      if (!allowed[row.status].includes(nextStatus)) {
        throw new ApiError(409, 'CONFLICT', `Invalid GPS setup transition: ${row.status} to ${nextStatus}`);
      }
      if (nextStatus === 'SCHEDULED' && input.scheduledAt === undefined) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'scheduledAt is required when scheduling installation');
      }
      if (nextStatus === 'REJECTED' && input.rejectedReason === undefined) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'rejectedReason is required when rejecting a request');
      }
      const result = await client.query<SetupRow>(
        `UPDATE gps_setup_requests SET status = $2::gps_setup_status,
           scheduled_at = CASE WHEN $2::gps_setup_status = 'SCHEDULED' THEN $3::timestamptz ELSE scheduled_at END,
           installed_at = CASE WHEN $2::gps_setup_status = 'INSTALLED' THEN now() ELSE installed_at END,
           rejected_reason = CASE WHEN $2::gps_setup_status = 'REJECTED' THEN $4 ELSE rejected_reason END,
           verification_status = CASE WHEN $2::gps_setup_status = 'INSTALLED' THEN 'PENDING' ELSE verification_status END,
           updated_at = now() WHERE id = $1 RETURNING *`,
        [requestId, nextStatus, input.scheduledAt ?? null, input.rejectedReason ?? null],
      );
      const request = mapSetup(requireRow(result.rows[0]));
      await audit(client, actor.id, 'GPS_SETUP_STATUS_CHANGED', 'GPS_SETUP_REQUEST', requestId, {
        from: row.status,
        to: nextStatus,
      });
      await client.query('COMMIT');
      return request;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async mapDevice(
    actor: User,
    requestId: string,
    input: { imei: string; serialNumber: string; traccarUniqueId: string },
  ): Promise<DeviceMapping> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const setup = await client.query<SetupRow>(
        'SELECT * FROM gps_setup_requests WHERE id = $1 FOR UPDATE',
        [requestId],
      );
      const request = setup.rows[0];
      if (request === undefined) throw new ApiError(404, 'NOT_FOUND', 'GPS setup request not found');
      if (request.status !== 'SCHEDULED' && request.status !== 'INSTALLED') {
        throw new ApiError(409, 'CONFLICT', 'Device mapping requires a scheduled installation');
      }
      const device = await client.query<{ id: string }>(
        `INSERT INTO gps_devices(imei, serial_number) VALUES ($1, $2)
         RETURNING id`,
        [input.imei, input.serialNumber.trim()],
      );
      const deviceId = requireRow(device.rows[0]).id;
      const mapping = await client.query<MappingRow>(
        `INSERT INTO traccar_device_mappings(
           gps_setup_request_id, gps_device_id, jeepney_id, traccar_unique_id, mapped_by_user_id
         ) VALUES ($1, $2, $3, $4, $5)
         RETURNING id, gps_setup_request_id, gps_device_id, jeepney_id,
           $6::text AS imei, $7::text AS serial_number, traccar_unique_id, mapped_at`,
        [
          requestId,
          deviceId,
          request.jeepney_id,
          input.traccarUniqueId.trim(),
          actor.id,
          input.imei,
          input.serialNumber.trim(),
        ],
      );
      const mapped = mapMapping(requireRow(mapping.rows[0]));
      await audit(client, actor.id, 'GPS_DEVICE_MAPPED', 'GPS_SETUP_REQUEST', requestId, {
        jeepneyId: request.jeepney_id,
        gpsDeviceId: deviceId,
      });
      await client.query('COMMIT');
      return mapped;
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) {
        throw new ApiError(409, 'DEVICE_MAPPING_CONFLICT', 'Device or Traccar identity is already mapped');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async getDeviceMapping(requestId: string): Promise<DeviceMapping | null> {
    const result = await this.pool.query<MappingRow>(
      `SELECT mapping.id, mapping.gps_setup_request_id, mapping.gps_device_id,
         mapping.jeepney_id, device.imei, device.serial_number,
         mapping.traccar_unique_id, mapping.mapped_at
       FROM gps_setup_requests request
       LEFT JOIN traccar_device_mappings mapping
         ON mapping.gps_setup_request_id = request.id
       LEFT JOIN gps_devices device ON device.id = mapping.gps_device_id
       WHERE request.id = $1`,
      [requestId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new ApiError(404, 'NOT_FOUND', 'GPS setup request not found');
    if (row.id === null) return null;
    return mapMapping(row);
  }

  async verifyInstallation(
    actor: User,
    requestId: string,
    checks: {
      powerOk: boolean;
      simOk: boolean;
      serverOk: boolean;
      gpsFixOk: boolean;
      notes?: string;
    },
  ): Promise<GpsSetupRequest> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const setup = await client.query<SetupRow>(
        'SELECT * FROM gps_setup_requests WHERE id = $1 FOR UPDATE',
        [requestId],
      );
      const row = setup.rows[0];
      if (row === undefined) throw new ApiError(404, 'NOT_FOUND', 'GPS setup request not found');
      if (row.status !== 'INSTALLED') {
        throw new ApiError(409, 'GPS_NOT_INSTALLED', 'Installation must be marked installed first');
      }
      const mapping = await client.query(
        'SELECT 1 FROM traccar_device_mappings WHERE gps_setup_request_id = $1',
        [requestId],
      );
      if (mapping.rowCount !== 1) {
        throw new ApiError(409, 'GPS_NOT_INSTALLED', 'A device mapping is required before verification');
      }
      const verified = checks.powerOk && checks.simOk && checks.serverOk && checks.gpsFixOk;
      const result = await client.query<SetupRow>(
        `UPDATE gps_setup_requests SET verification_status = $2,
           verification_checks = $3::jsonb, verified_by_user_id = $4,
           verified_at = now(), updated_at = now() WHERE id = $1 RETURNING *`,
        [requestId, verified ? 'VERIFIED' : 'FAILED', JSON.stringify(checks), actor.id],
      );
      if (verified) {
        await client.query(
          `UPDATE jeepneys SET status = 'ACTIVE', updated_at = now() WHERE id = $1`,
          [row.jeepney_id],
        );
      }
      await audit(client, actor.id, 'GPS_INSTALLATION_VERIFIED', 'GPS_SETUP_REQUEST', requestId, {
        result: verified ? 'VERIFIED' : 'FAILED',
      });
      await client.query('COMMIT');
      return mapSetup(requireRow(result.rows[0]));
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async assertJeepneyAccess(actor: User, jeepneyId: string): Promise<void> {
    if (actor.roles.includes('ADMIN')) return;
    const scope = await this.scope(actor);
    const result = await this.pool.query(
      `SELECT 1 FROM jeepneys j WHERE j.id = $1 AND (
         j.created_by_user_id = $2
         OR ($3::uuid IS NOT NULL AND j.operator_id = $3)
         OR ($4::uuid IS NOT NULL AND ${driverJeepneyAccess('j', '$4')})
       )`,
      [jeepneyId, actor.id, scope.operatorId, scope.driverId],
    );
    if (result.rowCount !== 1) throw new ApiError(403, 'FORBIDDEN', 'Jeepney is outside the permitted scope');
  }

  private async scope(actor: User): Promise<{ admin: boolean; operatorId: string | null; driverId: string | null }> {
    if (actor.roles.includes('ADMIN')) return { admin: true, operatorId: null, driverId: null };
    const result = await this.pool.query<{ operator_id: string | null; driver_id: string | null }>(
      `SELECT
         (SELECT id FROM operators WHERE owner_user_id = $1 AND status = 'ACTIVE') AS operator_id,
         (SELECT id FROM drivers WHERE user_id = $1 AND status = 'ACTIVE') AS driver_id`,
      [actor.id],
    );
    return {
      admin: false,
      operatorId: result.rows[0]?.operator_id ?? null,
      driverId: result.rows[0]?.driver_id ?? null,
    };
  }
}

function driverJeepneyAccess(jeepneyAlias: string, driverParameter: string): string {
  return `(
    EXISTS (SELECT 1 FROM driver_jeepney_assignments dja
      WHERE dja.jeepney_id = ${jeepneyAlias}.id AND dja.driver_id = ${driverParameter}
        AND dja.active_to IS NULL)
    OR EXISTS (SELECT 1 FROM fleet_group_jeepneys fgj
      JOIN fleet_group_drivers fgd ON fgd.group_id = fgj.group_id
      WHERE fgj.jeepney_id = ${jeepneyAlias}.id AND fgd.driver_id = ${driverParameter})
  )`;
}

async function audit(
  executor: Pick<pg.Pool | pg.PoolClient, 'query'>,
  actorUserId: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await executor.query(
    `INSERT INTO audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [actorUserId, action, entityType, entityId, JSON.stringify(metadata)],
  );
}

function mapApplication(row: ApplicationRow): VehicleApplication {
  return {
    id: row.id,
    jeepneyId: row.jeepney_id,
    submittedByUserId: row.submitted_by_user_id,
    status: row.status,
    applicantNotes: row.applicant_notes,
    reviewNotes: row.review_notes,
    reviewedByUserId: row.reviewed_by_user_id,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSetup(row: SetupRow): GpsSetupRequest {
  return {
    id: row.id,
    vehicleApplicationId: row.vehicle_application_id,
    jeepneyId: row.jeepney_id,
    requestedByUserId: row.requested_by_user_id,
    status: row.status,
    verificationStatus: row.verification_status,
    scheduledAt: row.scheduled_at,
    installedAt: row.installed_at,
    rejectedReason: row.rejected_reason,
    verificationChecks: row.verification_checks,
    verifiedByUserId: row.verified_by_user_id,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMapping(row: MappingRow): DeviceMapping {
  if (
    row.id === null ||
    row.gps_setup_request_id === null ||
    row.gps_device_id === null ||
    row.jeepney_id === null ||
    row.imei === null ||
    row.serial_number === null ||
    row.traccar_unique_id === null ||
    row.mapped_at === null
  ) {
    throw new Error('Device mapping row is incomplete');
  }
  return {
    id: row.id,
    gpsSetupRequestId: row.gps_setup_request_id,
    gpsDeviceId: row.gps_device_id,
    jeepneyId: row.jeepney_id,
    imei: row.imei,
    serialNumber: row.serial_number,
    traccarUniqueId: row.traccar_unique_id,
    mappedAt: row.mapped_at,
  };
}

function requireRow<T>(row: T | undefined): T {
  if (row === undefined) throw new Error('Database operation returned no row');
  return row;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

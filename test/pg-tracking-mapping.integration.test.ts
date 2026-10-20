import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { describe, expect, it } from 'vitest';

import { PgTrackingMappingRepository } from '../src/tracking/tracking-history-service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

describeDatabase('tracking eligibility with PostgreSQL', () => {
  it('requires active vehicle/device, approved application and installed verified GPS mapping', async () => {
    const pool = new pg.Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${process.env.TEST_DATABASE_SCHEMA ?? 'dbo'},public`,
    });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const userId = randomUUID(), jeepneyId = randomUUID(), applicationId = randomUUID();
      const requestId = randomUUID(), gpsId = randomUUID(), uniqueId = randomUUID();
      await client.query('INSERT INTO users(id, email, display_name) VALUES ($1, $2, $3)',
        [userId, `${userId}@tracking.example.test`, 'Tracking fixture']);
      await client.query(
        `INSERT INTO jeepneys(id, created_by_user_id, plate_no, color_hex, status)
         VALUES ($1, $2, $3, '#112233', 'ACTIVE')`, [jeepneyId, userId, `B-${jeepneyId}`]);
      await client.query(
        `INSERT INTO vehicle_applications(id, jeepney_id, submitted_by_user_id, status, reviewed_by_user_id, reviewed_at)
         VALUES ($1, $2, $3, 'APPROVED', $3, now())`, [applicationId, jeepneyId, userId]);
      await client.query(
        `INSERT INTO gps_setup_requests(id, vehicle_application_id, jeepney_id, requested_by_user_id,
           status, installed_at, verification_status, verified_by_user_id, verified_at)
         VALUES ($1, $2, $3, $4, 'INSTALLED', now(), 'VERIFIED', $4, now())`,
        [requestId, applicationId, jeepneyId, userId]);
      // Random numeric IMEI stays inside this rolled-back fixture.
      const imei = randomUUID().replaceAll(/[^0-9]/g, '').padEnd(15, '0').slice(0, 15);
      await client.query('INSERT INTO gps_devices(id, imei, serial_number) VALUES ($1, $2, $3)', [gpsId, imei, uniqueId]);
      await client.query(
        `INSERT INTO traccar_device_mappings(gps_setup_request_id, gps_device_id, jeepney_id, traccar_unique_id, mapped_by_user_id)
         VALUES ($1, $2, $3, $4, $5)`, [requestId, gpsId, jeepneyId, uniqueId, userId]);
      const mappings = new PgTrackingMappingRepository(client);
      expect(await mappings.uniqueIdForJeepney(jeepneyId)).toBe(uniqueId);
      expect(await mappings.uniqueIdForJeepney(randomUUID())).toBeNull();
      await client.query("UPDATE gps_setup_requests SET verification_status = 'FAILED' WHERE id = $1", [requestId]);
      expect(await mappings.uniqueIdForJeepney(jeepneyId)).toBeNull();
      await client.query("UPDATE gps_setup_requests SET verification_status = 'VERIFIED', status = 'SCHEDULED', scheduled_at = now() WHERE id = $1", [requestId]);
      expect(await mappings.uniqueIdForJeepney(jeepneyId)).toBeNull();
      await client.query("UPDATE gps_setup_requests SET status = 'INSTALLED' WHERE id = $1", [requestId]);
      await client.query("UPDATE gps_devices SET status = 'INACTIVE' WHERE id = $1", [gpsId]);
      expect(await mappings.uniqueIdForJeepney(jeepneyId)).toBeNull();
      await client.query("UPDATE gps_devices SET status = 'ACTIVE' WHERE id = $1", [gpsId]);
      await client.query("UPDATE jeepneys SET status = 'INACTIVE' WHERE id = $1", [jeepneyId]);
      expect(await mappings.uniqueIdForJeepney(jeepneyId)).toBeNull();
      await client.query("UPDATE jeepneys SET status = 'ACTIVE' WHERE id = $1", [jeepneyId]);
      await client.query("UPDATE vehicle_applications SET status = 'REJECTED' WHERE id = $1", [applicationId]);
      expect(await mappings.uniqueIdForJeepney(jeepneyId)).toBeNull();
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
    }
  });
});

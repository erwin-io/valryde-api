import type pg from 'pg';

import type { BridgeState } from './tracking-bridge.js';

/** The fenced single-writer token. A higher fence always supersedes a lower one. */
export interface WriterLease {
  ownerId: string;
  /** PostgreSQL bigint as a decimal string. */
  fence: string;
}

export class LeaseLostError extends Error {
  constructor() {
    super('Tracking writer lease is not held');
    this.name = 'LeaseLostError';
  }
}

// Stage 13b recovery contract: 5 s heartbeat inside a 15 s lease, all expiry on the DB clock.
export const leaseHeartbeatMs = 5_000;
const leaseInterval = "interval '15 seconds'";

/** Lease row writes for the single `primary` Bridge deployment (B007 tracking_bridge_leases). */
export class TrackingLeaseService {
  constructor(private readonly pool: Pick<pg.Pool, 'query'>) {}

  /** Takes a released or expired lease with a new fence; null while another owner's lease is live. */
  async acquire(ownerId: string): Promise<WriterLease | null> {
    const result = await this.pool.query<{ fence: string }>(
      `UPDATE tracking_bridge_leases SET fence = fence + 1, owner_id = $1, phase = 'RECONCILING',
         heartbeat_at = clock_timestamp(), expires_at = clock_timestamp() + ${leaseInterval},
         updated_at = clock_timestamp()
       WHERE deployment_key = 'primary' AND (owner_id IS NULL OR expires_at <= clock_timestamp())
       RETURNING fence::text AS fence`,
      [ownerId],
    );
    const fence = result.rows[0]?.fence;
    return fence === undefined ? null : { ownerId, fence };
  }

  /** Extends a still-live lease. False means it was lost and the writer must stop and reacquire. */
  async heartbeat(lease: WriterLease, phase: BridgeState = 'RUNNING'): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE tracking_bridge_leases SET phase = $3, heartbeat_at = clock_timestamp(),
         expires_at = clock_timestamp() + ${leaseInterval}, updated_at = clock_timestamp()
       WHERE deployment_key = 'primary' AND owner_id = $1 AND fence = $2 AND expires_at > clock_timestamp()`,
      [lease.ownerId, lease.fence, phase],
    );
    return result.rowCount === 1;
  }

  /** Releases only while owner and fence still match; the fence itself never goes back. */
  async release(lease: WriterLease): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE tracking_bridge_leases SET owner_id = NULL, expires_at = NULL, heartbeat_at = NULL,
         phase = 'STOPPED', updated_at = clock_timestamp()
       WHERE deployment_key = 'primary' AND owner_id = $1 AND fence = $2`,
      [lease.ownerId, lease.fence],
    );
    return result.rowCount === 1;
  }
}

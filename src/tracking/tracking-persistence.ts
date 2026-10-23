import type { BridgeLogger, BridgeState, TelemetryBatch, TelemetrySink } from './tracking-bridge.js';
import { LeaseLostError, leaseHeartbeatMs, type TrackingLeaseService, type WriterLease } from './tracking-lease.js';
import type { NormalizedPosition } from './telemetry.js';
import type {
  PersistDisposition, PersistResult, TrackingObservation, TrackingStateWriter,
} from './tracking-state-writer.js';

export interface PersistenceOptions {
  ownerId: string;
  log?: BridgeLogger;
  now?: () => number;
  phase?: () => BridgeState;
  heartbeatMs?: number;
  /** Stage 13b recovery contract: 1 s sweep in batches of 100. */
  sweepMs?: number;
  sweepBatch?: number;
}

/**
 * B4 durable mode for the Tracking Bridge: holds the fenced writer lease (heartbeat, reacquire with a
 * new fence after loss), turns each batch into ordered writer calls and runs the expiry/context sweep.
 * Only constructed when persistence is explicitly enabled; the default Bridge stays log-only.
 * A sink error (lease lost, DB outage, exhausted retries) propagates so the Bridge reconnects and
 * redelivers; nothing uncommitted is acknowledged.
 */
export class TrackingPersistence {
  readonly #writer: Pick<TrackingStateWriter, 'apply' | 'applyStatus' | 'sweep'>;
  readonly #leases: Pick<TrackingLeaseService, 'acquire' | 'heartbeat' | 'release'>;
  readonly #options: PersistenceOptions;
  readonly #now: () => number;
  readonly #log: BridgeLogger;
  readonly #counts = new Map<PersistDisposition, number>();
  #lease: WriterLease | null = null;
  #timers: NodeJS.Timeout[] = [];
  #tick: Promise<void> = Promise.resolve();
  #lastCommitAt: number | undefined;
  #lastError: string | undefined;
  /** Status ingress order; strictly increasing for the life of the process (epoch = lease fence). */
  #statusSequence = 0n;

  constructor(
    writer: Pick<TrackingStateWriter, 'apply' | 'applyStatus' | 'sweep'>,
    leases: Pick<TrackingLeaseService, 'acquire' | 'heartbeat' | 'release'>,
    options: PersistenceOptions,
  ) {
    this.#writer = writer;
    this.#leases = leases;
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#log = options.log ?? (() => undefined);
  }

  /** Tries to take the lease now and starts heartbeat/sweep ticks either way. */
  async start(): Promise<boolean> {
    await this.#maintain();
    this.#timers = [
      setInterval(() => this.#serial(() => this.#maintain()), this.#options.heartbeatMs ?? leaseHeartbeatMs),
      setInterval(() => this.#serial(() => this.#sweep()), this.#options.sweepMs ?? 1_000),
    ];
    return this.#lease !== null;
  }

  readonly sink: TelemetrySink = async (batch: TelemetryBatch) => {
    const lease = this.#lease;
    if (lease === null) throw new LeaseLostError();
    const receivedAt = new Date(this.#now()).toISOString();
    // Connectivity first, in arrival order; ordered in the DB by Traccar lastUpdate, never by fixes.
    for (const device of batch.devices) {
      this.#statusSequence += 1n;
      await this.#write(() => this.#writer.applyStatus({
        deviceId: String(device.id), uniqueId: device.uniqueId, status: device.status,
        lastUpdate: device.lastUpdate ?? null,
        source: batch.reconciliation ? 'REST_RECONCILIATION' : 'DEVICE',
        sequence: String(this.#statusSequence),
      }, lease));
    }
    // Fix-time order inside a batch, so an invalid fix never makes an earlier valid one look old.
    const items = [
      ...batch.positions.map((position) => observation(position, true, receivedAt)),
      ...batch.invalidPositions.map((position) => observation(position, false, receivedAt)),
    ].sort((left, right) => Date.parse(left.fixTime) - Date.parse(right.fixTime));
    for (const item of items) await this.#write(() => this.#writer.apply(item, lease));
  };

  async #write(run: () => Promise<PersistResult>): Promise<void> {
    try {
      const result = await run();
      this.#counts.set(result.disposition, (this.#counts.get(result.disposition) ?? 0) + 1);
      if (result.materializedChange) this.#lastCommitAt = this.#now();
    } catch (error) {
      // A failed database call cannot prove the old fence is still live.
      this.#lease = null;
      this.#lastError = error instanceof LeaseLostError ? 'LEASE_LOST' : 'WRITE_FAILED';
      throw error;
    }
  }

  /** Idempotent: stops ticks, waits for the running one, then releases only a still-matching lease. */
  async stop(): Promise<void> {
    for (const timer of this.#timers) clearInterval(timer);
    this.#timers = [];
    await this.#tick;
    const lease = this.#lease;
    this.#lease = null;
    if (lease !== null) await this.#leases.release(lease).catch(() => false);
  }

  // Health fields exclude coordinates, provider identities and credentials.
  health() {
    return {
      leaseHeld: this.#lease !== null,
      fence: this.#lease?.fence ?? null,
      lastCommitAt: this.#lastCommitAt === undefined ? null : new Date(this.#lastCommitAt).toISOString(),
      lastError: this.#lastError ?? null,
      dispositions: Object.fromEntries(this.#counts),
    };
  }

  #serial(task: () => Promise<void>): void {
    this.#tick = this.#tick.then(task).catch(() => undefined);
  }

  async #maintain(): Promise<void> {
    try {
      if (this.#lease !== null && await this.#leases.heartbeat(this.#lease, this.#options.phase?.())) return;
      if (this.#lease !== null) this.#log('Tracking writer lease lost', { fence: this.#lease.fence });
      this.#lease = await this.#leases.acquire(this.#options.ownerId);
      if (this.#lease !== null) this.#log('Tracking writer lease acquired', { fence: this.#lease.fence });
    } catch {
      // A heartbeat exception leaves ownership uncertain until a new acquisition succeeds.
      this.#lease = null;
      this.#lastError = 'LEASE_UNAVAILABLE';
    }
  }

  async #sweep(): Promise<void> {
    const lease = this.#lease;
    if (lease === null) return;
    try {
      if (await this.#writer.sweep(lease, this.#options.sweepBatch ?? 100) > 0) this.#lastCommitAt = this.#now();
    } catch {
      // A failed sweep also makes the cached lease unsafe for subsequent writes.
      this.#lease = null;
      this.#lastError = 'SWEEP_FAILED';
    }
  }
}

function observation(position: NormalizedPosition, valid: boolean, receivedAt: string): TrackingObservation {
  return {
    deviceId: String(position.deviceId), uniqueId: position.uniqueId, positionId: String(position.positionId), valid,
    latitude: position.latitude, longitude: position.longitude,
    fixTime: position.fixTime, deviceTime: position.deviceTime, serverTime: position.serverTime,
    speedKph: position.speedKph, heading: position.heading, motion: position.motion, receivedAt,
  };
}

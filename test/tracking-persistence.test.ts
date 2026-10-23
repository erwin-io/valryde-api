import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadBridgeConfig } from '../src/tracking/bridge-config.js';
import type { TelemetryBatch } from '../src/tracking/tracking-bridge.js';
import { LeaseLostError, type WriterLease } from '../src/tracking/tracking-lease.js';
import { TrackingPersistence } from '../src/tracking/tracking-persistence.js';
import type { NormalizedPosition } from '../src/tracking/telemetry.js';
import type { PersistResult, TrackingObservation } from '../src/tracking/tracking-state-writer.js';

const T = Date.parse('2026-10-23T00:00:00.000Z');
const applied: PersistResult = { disposition: 'APPLIED', reason: null, materializedChange: true, revision: '1' };

function position(id: number, offsetMs: number): NormalizedPosition {
  const time = new Date(T + offsetMs).toISOString();
  return {
    deviceId: 7, uniqueId: 'VALRYDE-SIM-0001', positionId: id, latitude: 10.3, longitude: 123.88,
    fixTime: time, deviceTime: time, serverTime: time, speedKph: 20, heading: 90, motion: true,
  };
}

function batch(positions: NormalizedPosition[], invalidPositions: NormalizedPosition[] = []): TelemetryBatch {
  return { devices: [], positions, invalidPositions, events: [], reconciliation: false };
}

function setup() {
  let fence = 0;
  const calls: Array<{ item: TrackingObservation; lease: WriterLease }> = [];
  const writer = {
    apply: vi.fn(async (item: TrackingObservation, lease: WriterLease) => { calls.push({ item, lease }); return applied; }),
    applyStatus: vi.fn(async () => applied),
    sweep: vi.fn(async () => 0),
  };
  const leases = {
    acquire: vi.fn(async (ownerId: string): Promise<WriterLease | null> => ({ ownerId, fence: String(++fence) })),
    heartbeat: vi.fn(async () => true),
    release: vi.fn(async () => true),
  };
  const persistence = new TrackingPersistence(writer, leases, { ownerId: 'owner-1', now: () => T + 100 });
  return { writer, leases, persistence, calls };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('Stage 13b B4 durable persistence supervisor', () => {
  it('acquires the lease and writes valid and invalid fixes in fix-time order with decimal-string IDs', async () => {
    const f = setup();
    expect(await f.persistence.start()).toBe(true);
    await f.persistence.sink(batch([position(11, 0), position(13, 2_000)], [position(12, 1_000)]));
    expect(f.calls.map(({ item }) => [item.positionId, item.valid])).toEqual([['11', true], ['12', false], ['13', true]]);
    expect(f.calls[0]?.item).toMatchObject({ deviceId: '7', receivedAt: new Date(T + 100).toISOString() });
    expect(f.calls.every(({ lease }) => lease.fence === '1')).toBe(true);
    await f.persistence.stop();
  });

  it('fails the batch on a lost lease, then reacquires with a new fence on the next heartbeat', async () => {
    const f = setup();
    await f.persistence.start();
    f.writer.apply.mockRejectedValueOnce(new LeaseLostError());
    await expect(f.persistence.sink(batch([position(21, 0)]))).rejects.toBeInstanceOf(LeaseLostError);
    // With no lease nothing is written: the Bridge reconnects and redelivers instead.
    await expect(f.persistence.sink(batch([position(22, 0)]))).rejects.toBeInstanceOf(LeaseLostError);
    expect(f.persistence.health()).toMatchObject({ leaseHeld: false, lastError: 'LEASE_LOST' });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.persistence.health()).toMatchObject({ leaseHeld: true, fence: '2' });
    await f.persistence.sink(batch([position(22, 0)]));
    expect(f.calls.at(-1)?.lease.fence).toBe('2');
    await f.persistence.stop();
  });

  it('drops the lease when a heartbeat is refused and runs the sweep only while it holds one', async () => {
    const f = setup();
    await f.persistence.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.writer.sweep).toHaveBeenCalledWith({ ownerId: 'owner-1', fence: '1' }, 100);
    f.leases.heartbeat.mockResolvedValueOnce(false);
    f.leases.acquire.mockResolvedValueOnce(null);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.persistence.health().leaseHeld).toBe(false);
    const sweeps = f.writer.sweep.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.writer.sweep.mock.calls.length).toBe(sweeps);
    await f.persistence.stop();
  });

  it('fails closed on a database outage and resumes only after acquiring a new fence', async () => {
    const f = setup();
    await f.persistence.start();
    f.writer.apply.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(f.persistence.sink(batch([position(23, 0)]))).rejects.toThrow('database unavailable');
    expect(f.persistence.health()).toMatchObject({ leaseHeld: false, lastError: 'WRITE_FAILED' });
    await expect(f.persistence.sink(batch([position(24, 0)]))).rejects.toBeInstanceOf(LeaseLostError);
    f.leases.acquire.mockResolvedValueOnce(null);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.persistence.health().leaseHeld).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.persistence.health()).toMatchObject({ leaseHeld: true, fence: '2' });
    await f.persistence.sink(batch([position(24, 0)]));
    expect(f.calls.at(-1)?.lease.fence).toBe('2');
    await f.persistence.stop();
  });

  it('discards an uncertain lease after a heartbeat exception', async () => {
    const f = setup();
    await f.persistence.start();
    f.leases.heartbeat.mockRejectedValueOnce(new Error('database unavailable'));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.persistence.health()).toMatchObject({ leaseHeld: false, lastError: 'LEASE_UNAVAILABLE' });
    await expect(f.persistence.sink(batch([position(25, 0)]))).rejects.toBeInstanceOf(LeaseLostError);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.persistence.health()).toMatchObject({ leaseHeld: true, fence: '2' });
    await f.persistence.stop();
  });

  it('stops ticking and releases only the lease it still holds; health carries no identities or points', async () => {
    const f = setup();
    await f.persistence.start();
    await f.persistence.sink(batch([position(31, 0)]));
    const health = JSON.stringify(f.persistence.health());
    expect(health).not.toMatch(/VALRYDE-SIM|123\.88|10\.3|owner-1/);
    await f.persistence.stop();
    expect(f.leases.release).toHaveBeenCalledWith({ ownerId: 'owner-1', fence: '1' });
    const sweeps = f.writer.sweep.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.writer.sweep.mock.calls.length).toBe(sweeps);
    await f.persistence.stop();
    expect(f.leases.release).toHaveBeenCalledTimes(1);
  });

  it('keeps durable persistence off unless explicitly enabled with its own database URL', () => {
    const env = { TRACCAR_BASE_URL: 'http://127.0.0.1:8082', TRACCAR_EMAIL: 'bridge@example.test', TRACCAR_PASSWORD: 'x' };
    expect(loadBridgeConfig(env).persistence).toBeNull();
    expect(loadBridgeConfig({ ...env, TRACKING_PERSISTENCE_ENABLED: 'false' }).persistence).toBeNull();
    expect(() => loadBridgeConfig({ ...env, TRACKING_PERSISTENCE_ENABLED: 'yes' })).toThrow(/true or false/);
    expect(() => loadBridgeConfig({ ...env, TRACKING_PERSISTENCE_ENABLED: 'true' })).toThrow(/TRACKING_DATABASE_URL/);
    expect(loadBridgeConfig({
      ...env, TRACKING_PERSISTENCE_ENABLED: 'true', TRACKING_DATABASE_URL: 'postgres://bridge@localhost/valryde',
    }).persistence).toEqual({ databaseUrl: 'postgres://bridge@localhost/valryde', databaseSchema: 'dbo', databaseSsl: false });
  });
});

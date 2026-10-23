import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadBridgeConfig } from '../src/tracking/bridge-config.js';
import { normalizePosition, TelemetryGate } from '../src/tracking/telemetry.js';
import { parseDevice, parseEvent, parsePosition, TraccarClient, type TraccarPosition } from '../src/tracking/traccar-client.js';
import { TrackingBridge, type BridgeSocket, type TelemetryBatch } from '../src/tracking/tracking-bridge.js';

const T = Date.parse('2026-10-22T00:00:00Z');
const configuration = { TRACCAR_BASE_URL: 'https://provider.example.test', TRACCAR_EMAIL: 'synthetic@example.test', TRACCAR_PASSWORD: 'synthetic-password-canary' };
const device = { id: 1, uniqueId: 'synthetic-provider-identity-canary', status: 'online' };
const position = (id: number, offset = 0, extra: Partial<TraccarPosition> = {}): TraccarPosition => ({
  id, deviceId: 1, valid: true, latitude: 10.3157, longitude: 123.8854, speed: 10, course: 90,
  fixTime: new Date(T + offset).toISOString(), deviceTime: new Date(T + offset).toISOString(), serverTime: new Date(T + offset).toISOString(), ...extra,
});
class Socket implements BridgeSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  close() { this.closed = true; }
  open() { this.onopen?.(); }
  frame(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
const bridges: TrackingBridge[] = [];
function setup(options: { env?: Record<string, string>; sink?: (batch: TelemetryBatch) => void | Promise<void> } = {}) {
  const sockets: Socket[] = [], batches: TelemetryBatch[] = [];
  const logs: unknown[] = [];
  const client = {
    sessionCookie: vi.fn(async () => 'JSESSIONID=synthetic-cookie-canary'),
    invalidateSession: vi.fn(),
    devices: vi.fn(async () => [device]),
    positions: vi.fn(async (): Promise<TraccarPosition[]> => []),
  };
  const bridge = new TrackingBridge(loadBridgeConfig({ ...configuration, ...options.env }), {
    client, random: () => 0,
    sink: options.sink ?? ((batch) => { batches.push(batch); }),
    socket: () => { const socket = new Socket(); sockets.push(socket); return socket; },
    log: (message, fields) => { logs.push({ message, fields }); },
  });
  bridges.push(bridge);
  return { bridge, client, sockets, batches, logs, socket: () => sockets.at(-1)! };
}
const flush = () => vi.advanceTimersByTimeAsync(0);
async function running(f: ReturnType<typeof setup>) {
  f.bridge.start(); await flush(); f.socket().open(); await flush();
  expect(f.bridge.state).toBe('RUNNING');
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T); });
afterEach(async () => {
  for (const bridge of bridges.splice(0)) await bridge.stop();
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});

describe('independent provider admission and classification', () => {
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '1'])('rejects unsafe provider identity %s before telemetry binding', (id) => {
    expect(() => parseDevice({ ...device, id })).toThrow();
    expect(() => parsePosition({ ...position(1), deviceId: id })).toThrow();
    expect(() => parseEvent({ id, deviceId: 1, type: 'deviceOnline', eventTime: new Date(T).toISOString() })).toThrow();
  });
  it('keeps the maximum safe provider ID lossless and uniqueId opaque', () => {
    const id = Number.MAX_SAFE_INTEGER;
    expect(parseDevice({ id, uniqueId: 'opaque:not-a-number', status: 'unknown' })).toEqual({ id, uniqueId: 'opaque:not-a-number', status: 'unknown' });
    expect(normalizePosition(parsePosition(position(id)), 'opaque:not-a-number').positionId).toBe(id);
  });
  it.each([
    { latitude: 90.001 }, { longitude: -180.001 }, { latitude: NaN }, { longitude: Infinity },
    { speed: -1 }, { speed: Infinity }, { course: 360.001 }, { course: NaN }, { fixTime: 'not-a-time' },
  ])('rejects malformed numeric/time input %j', (extra) => {
    expect(() => parsePosition({ ...position(1), ...extra })).toThrow();
  });
  it.each([Number.MAX_VALUE, Number.MAX_VALUE / 1.852])('rejects finite speed %s that overflows normalized kilometres per hour', (speed) => {
    expect(() => parsePosition(position(1, 0, { speed }))).toThrow();
  });
  it('keeps every admitted speed representable after normalization', () => {
    for (const speed of [0, 10, Number.MAX_VALUE / 2]) {
      expect(Number.isFinite(normalizePosition(parsePosition(position(1, 0, { speed })), device.uniqueId).speedKph)).toBe(true);
    }
  });
  it('normalizes time zones while preserving distinct device/server/fix instants', () => {
    const parsed = parsePosition(position(1, 0, {
      fixTime: '2026-10-22T08:00:00+08:00', deviceTime: '2026-10-22T00:00:01Z', serverTime: '2026-10-22T00:00:02Z',
    }));
    expect(normalizePosition(parsed, device.uniqueId)).toMatchObject({
      fixTime: '2026-10-22T00:00:00.000Z', deviceTime: '2026-10-22T00:00:01.000Z', serverTime: '2026-10-22T00:00:02.000Z',
    });
  });
  it('strips provider attributes and identity metadata from the normalized record allowlist', () => {
    const normalized = normalizePosition(parsePosition({ ...position(1), attributes: { secret: 'attribute-canary' }, driverId: 'private-driver-canary' }), device.uniqueId);
    expect(Object.keys(normalized).sort()).toEqual(['deviceId', 'uniqueId', 'positionId', 'latitude', 'longitude', 'fixTime', 'deviceTime', 'serverTime', 'speedKph', 'heading', 'motion'].sort());
    expect(JSON.stringify(normalized)).not.toMatch(/attribute-canary|private-driver-canary/);
    // Provider identity/coordinates remain private in this internal model: this is not a public DTO.
    expect(normalized.uniqueId).toBe(device.uniqueId);
  });
  it('does not let a rejected far-future observation poison the ordering watermark', () => {
    const gate = new TelemetryGate(5_000);
    expect(gate.admit(position(1, 5_001), T)).toBe('FUTURE');
    expect(gate.admit(position(2), T)).toBe('ACCEPT');
    expect(gate.admit(position(3, 5_000), T)).toBe('ACCEPT');
  });
  it('isolates per-device watermarks and requires explicit reset before older replay', () => {
    const gate = new TelemetryGate(5_000);
    expect(gate.admit(position(1, 2_000), T)).toBe('ACCEPT');
    expect(gate.admit(position(2, 0, { deviceId: 2 }), T)).toBe('ACCEPT');
    expect(gate.admit(position(3, 1_000), T)).toBe('OUT_OF_ORDER');
    gate.forget(2);
    expect(gate.admit(position(4, 1_000), T)).toBe('OUT_OF_ORDER');
    gate.clear();
    expect(gate.admit(position(4, 1_000), T)).toBe('ACCEPT');
  });
  it('documents the accepted in-memory invalid-fix gap without pretending to persist invalid observations', () => {
    const gate = new TelemetryGate(5_000);
    expect(gate.admit(position(1), T)).toBe('ACCEPT');
    expect(gate.admit(position(3, 2_000, { valid: false }), T)).toBe('INVALID');
    // Stage13a drops invalid fixes; future D03/D04 durable invalid watermark remains approval-gated.
    expect(gate.admit(position(2, 1_000), T)).toBe('ACCEPT');
  });
});

describe('independent lifecycle, stationary reporting and backpressure', () => {
  it('enforces the configured frame size in UTF-8 bytes, not UTF-16 characters', async () => {
    const f = setup({ env: { BRIDGE_MAX_FRAME_BYTES: '1024' } }); await running(f);
    const data = JSON.stringify({ logs: '漢'.repeat(600) });
    expect(data.length).toBeLessThan(1024);
    expect(Buffer.byteLength(data, 'utf8')).toBeGreaterThan(1024);
    f.socket().onmessage?.({ data }); await flush();
    expect(f.bridge.health().lastError).toBe('INVALID_FRAME');
    expect(f.socket().closed).toBe(true);
  });
  it('accepts an ASCII frame at the byte limit and rejects one byte over', async () => {
    const f = setup({ env: { BRIDGE_MAX_FRAME_BYTES: '1024' } }); await running(f);
    const prefix = JSON.stringify({ logs: '' });
    const data = JSON.stringify({ logs: 'x'.repeat(1024 - prefix.length) });
    f.socket().onmessage?.({ data }); await flush();
    expect(f.bridge.health().counters.keepalives).toBe(1);
    f.socket().onmessage?.({ data: data + ' ' }); await flush();
    expect(f.bridge.health().lastError).toBe('INVALID_FRAME');
  });
  it('rejects an overflowing-speed item without losing a valid socket sibling', async () => {
    const f = setup(); await running(f);
    f.socket().frame({ positions: [position(1, 0, { speed: Number.MAX_VALUE }), position(2)] }); await flush();
    expect(f.bridge.state).toBe('RUNNING');
    expect(f.batches.flatMap((batch) => batch.positions.map((p) => p.positionId))).toEqual([2]);
    expect(f.bridge.health().counters.invalidItems).toBe(1);
  });
  it('stays transport-online during a60s stationary interval without inventing fresh positions', async () => {
    const f = setup(); f.client.positions.mockResolvedValue([position(1, 0, { speed: 0 })]); await running(f);
    const acceptedAt = f.bridge.health().lastAcceptedPositionAt;
    await vi.advanceTimersByTimeAsync(30_001);
    expect(f.bridge.state).toBe('RUNNING');
    expect(f.bridge.health().lastAcceptedPositionAt).toBe(acceptedAt);
    await vi.advanceTimersByTimeAsync(24_999); f.socket().frame({});
    await vi.advanceTimersByTimeAsync(5_000); f.socket().frame({ positions: [position(2, 60_000, { speed: 0 })] }); await flush();
    expect(f.batches.flatMap((batch) => batch.positions.map((p) => [p.positionId, p.speedKph]))).toEqual([[1, 0], [2, 0]]);
    expect(f.bridge.health().reconnects).toBe(0);
    // Transport RUNNING is not public GPS freshness, and no public eligibility is implemented here.
  });
  it('characterizes old reconciliation fixes as internal telemetry, not public freshness approval', async () => {
    const f = setup(); f.client.positions.mockResolvedValue([position(1, -60_000)]); await running(f);
    expect(f.batches.flatMap((batch) => batch.positions).at(-1)?.fixTime).toBe(new Date(T - 60_000).toISOString());
    expect(f.bridge.health().lastAcceptedPositionAt).toBe(new Date(T).toISOString());
  });
  it('deduplicates event IDs but preserves arrival order without fabricating status chronology', async () => {
    const f = setup(); await running(f);
    const newer = { id: 11, deviceId: 1, type: 'deviceOnline', eventTime: new Date(T).toISOString() };
    const older = { id: 10, deviceId: 1, type: 'deviceOffline', eventTime: new Date(T - 1_000).toISOString() };
    f.socket().frame({ events: [newer, older, newer] }); await flush();
    expect(f.batches.flatMap((batch) => batch.events.map((event) => event.id))).toEqual([11, 10]);
    expect(f.bridge.health().counters.eventsDuplicate).toBe(1);
    // Durable status/source-time ordering is a future D03/D04 contract, not a Stage13a guarantee.
  });
  it('does not synthesize a position for offline/unknown device status updates', async () => {
    const f = setup(); await running(f);
    f.socket().frame({ devices: [{ ...device, status: 'offline' }, { ...device, status: 'unknown' }] }); await flush();
    expect(f.batches.flatMap((batch) => batch.devices.map((d) => d.status))).toEqual(['online', 'offline', 'unknown']);
    expect(f.batches.flatMap((batch) => batch.positions)).toEqual([]);
    expect(f.bridge.health().lastAcceptedPositionAt).toBeNull();
  });
  it('does not run queued work after stop while draining only the in-flight sink', async () => {
    let release!: () => void;
    const written: number[] = [];
    const f = setup({ sink: async (batch) => {
      if (batch.positions.length === 0) return;
      await new Promise<void>((resolve) => { release = resolve; });
      written.push(...batch.positions.map((p) => p.positionId));
    } }); await running(f);
    f.socket().frame({ positions: [position(1)] }); await flush();
    f.socket().frame({ positions: [position(2, 1_000)] });
    let stopped = false; const stop = f.bridge.stop().then(() => { stopped = true; }); await flush();
    expect(stopped).toBe(false); release(); await stop;
    expect(written).toEqual([1]); expect(f.bridge.state).toBe('STOPPED');
  });
  it('invalidates continuity at bounded queue overflow, then drains in-flight work once', async () => {
    let release!: () => void;
    const written: number[] = [];
    const f = setup({ env: { BRIDGE_MAX_QUEUED_FRAMES: '2' }, sink: async (batch) => {
      if (batch.positions.length === 0) return;
      await new Promise<void>((resolve) => { release = resolve; }); written.push(...batch.positions.map((p) => p.positionId));
    } }); await running(f);
    f.socket().frame({ positions: [position(1)] }); await flush();
    f.socket().frame({ positions: [position(2, 1_000)] }); f.socket().frame({ positions: [position(3, 2_000)] });
    expect(f.socket().closed).toBe(true); release(); await flush();
    expect(f.bridge.health().lastError).toBe('QUEUE_OVERFLOW'); expect(written).toEqual([1]);
  });
  it('discards callbacks captured from a disconnected socket after reconciliation on a new socket', async () => {
    const f = setup(); await running(f);
    const oldMessage = f.socket().onmessage; f.socket().onclose?.(); await vi.advanceTimersByTimeAsync(500);
    f.socket().open(); await flush(); const count = f.bridge.health().counters.framesReceived;
    oldMessage?.({ data: JSON.stringify({ positions: [position(9)] }) }); await flush();
    expect(f.bridge.health().counters.framesReceived).toBe(count);
    expect(f.batches.flatMap((batch) => batch.positions)).toEqual([]);
  });
  it('refuses a second supervisor loop and leaves no timers after idempotent shutdown', async () => {
    const f = setup(); await running(f);
    expect(() => f.bridge.start()).toThrow('already started');
    expect(f.client.sessionCookie).toHaveBeenCalledTimes(1);
    await f.bridge.stop(); await f.bridge.stop(); expect(f.socket().closed).toBe(true);
  });
  it('redacts sink exception canaries from all health/log fields', async () => {
    const canary = 'sink-password-cookie-coordinate-canary';
    const f = setup({ sink: (batch) => { if (batch.positions.length) throw new Error(canary); } }); await running(f);
    f.socket().frame({ positions: [position(1)] }); await flush();
    expect(f.bridge.health().lastError).toBe('SINK_FAILURE');
    expect(JSON.stringify({ logs: f.logs, health: f.bridge.health() })).not.toMatch(new RegExp(`${canary}|synthetic-password|synthetic-cookie|synthetic-provider|123\\.8854`));
  });
});

describe('provider error privacy without real service access', () => {
  it('does not retain raw transport exceptions or configuration secrets in public error serialization', async () => {
    const client = new TraccarClient(loadBridgeConfig({ ...configuration, TRACCAR_MAX_RETRIES: '0' }).traccar, {
      fetch: vi.fn().mockRejectedValue(new Error('network-cookie-password-canary')), sleep: vi.fn().mockResolvedValue(undefined),
    });
    let caught: unknown;
    try { await client.devices(); } catch (error) { caught = error; }
    expect(caught).toMatchObject({ code: 'NETWORK' });
    expect(JSON.stringify(caught) + String(caught)).not.toMatch(/network-cookie-password-canary|synthetic-password|synthetic-cookie|synthetic@example/);
  });
});

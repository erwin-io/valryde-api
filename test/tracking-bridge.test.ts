import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadBridgeConfig } from '../src/tracking/bridge-config.js';
import { TelemetryGate, normalizePosition } from '../src/tracking/telemetry.js';
import { TraccarError, type TraccarPosition } from '../src/tracking/traccar-client.js';
import { TrackingBridge, type BridgeSocket, type TelemetryBatch } from '../src/tracking/tracking-bridge.js';

const T = Date.parse('2026-10-21T00:00:00.000Z');
const env = { TRACCAR_BASE_URL: 'http://127.0.0.1:8082', TRACCAR_EMAIL: 'bridge@example.test', TRACCAR_PASSWORD: 'test-secret' };
const device = { id: 1, uniqueId: 'VALRYDE-SIM-0001', status: 'online' };

function pos(id: number, offsetMs = 0, extra: Partial<TraccarPosition> = {}): TraccarPosition {
  const time = new Date(T + offsetMs).toISOString();
  return {
    id, deviceId: 1, valid: true, latitude: 10.3157, longitude: 123.8854,
    fixTime: time, deviceTime: time, serverTime: time, speed: 10, course: 90, ...extra,
  };
}

class FakeSocket implements BridgeSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string, readonly cookie: string) {}
  close() { this.closed = true; }
  open() { this.onopen?.(); }
  send(frame: unknown) { this.onmessage?.({ data: typeof frame === 'string' ? frame : JSON.stringify(frame) }); }
}

function setup(options: { env?: Record<string, string>; sink?: (batch: TelemetryBatch) => void | Promise<void> } = {}) {
  const config = loadBridgeConfig({ ...env, ...options.env });
  const sockets: FakeSocket[] = [];
  const batches: TelemetryBatch[] = [];
  const sleeps: number[] = [];
  let logins = 0;
  const client = {
    sessionCookie: vi.fn(async () => `JSESSIONID=s${++logins}`),
    invalidateSession: vi.fn(),
    devices: vi.fn(async () => [device]),
    positions: vi.fn(async (): Promise<TraccarPosition[]> => []),
  };
  const bridge = new TrackingBridge(config, {
    client,
    sink: options.sink ?? ((batch) => { batches.push(batch); }),
    socket: (url, cookie) => { const socket = new FakeSocket(url, cookie); sockets.push(socket); return socket; },
    random: () => 0,
    sleep: (ms, signal) => new Promise((resolve, reject) => {
      sleeps.push(ms);
      const timer = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }, { once: true });
    }),
  });
  const last = () => sockets[sockets.length - 1]!;
  const accepted = () => batches.flatMap((batch) => batch.positions.map((p) => p.positionId));
  return { bridge, client, sockets, batches, sleeps, last, accepted };
}
const flush = () => vi.advanceTimersByTimeAsync(0);

async function running(fixture: ReturnType<typeof setup>) {
  fixture.bridge.start();
  await flush();
  fixture.last().open();
  await flush();
  expect(fixture.bridge.state).toBe('RUNNING');
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T); });
afterEach(() => { vi.useRealTimers(); });

describe('telemetry gate and normalization', () => {
  it('orders by fix time only and rejects duplicates, equal-time, older, invalid and future fixes (B-S05/S06/S07)', () => {
    const gate = new TelemetryGate(5_000);
    expect(gate.admit(pos(101), T)).toBe('ACCEPT');
    expect(gate.admit(pos(102, 10_000), T + 10_000)).toBe('ACCEPT');
    expect(gate.admit(pos(101), T + 10_000)).toBe('OUT_OF_ORDER');
    expect(gate.admit(pos(102, 10_000), T + 10_000)).toBe('DUPLICATE');
    expect(gate.admit(pos(103, 10_000, { serverTime: new Date(T + 60_000).toISOString() }), T + 10_000)).toBe('DUPLICATE');
    expect(gate.admit(pos(104, 20_000, { valid: false }), T + 20_000)).toBe('INVALID');
    expect(gate.admit(pos(105, 25_001), T + 20_000)).toBe('FUTURE');
    expect(gate.admit(pos(106, 25_000), T + 20_000)).toBe('ACCEPT');
    gate.forget(1);
    expect(gate.admit(pos(107, 0), T + 20_000)).toBe('ACCEPT');
  });

  it('converts knots to km/h, normalizes heading 360 to 0 and keeps all three provider times (B-S13)', () => {
    const p = pos(1, 0, { speed: 10, course: 360, deviceTime: '2026-10-21T00:00:01.000Z', serverTime: '2026-10-21T00:00:02.000Z' });
    expect(normalizePosition(p, 'tracker')).toMatchObject({
      speedKph: 18.52, heading: 0, latitude: 10.3157, longitude: 123.8854,
      fixTime: p.fixTime, deviceTime: p.deviceTime, serverTime: p.serverTime, uniqueId: 'tracker', positionId: 1,
    });
    expect(normalizePosition(pos(2, 0, { speed: 0 }), 'tracker').speedKph).toBe(0);
  });
});

describe('bridge configuration', () => {
  it('derives the socket URL from the origin and validates operational bounds', () => {
    expect(loadBridgeConfig(env).socketUrl).toBe('ws://127.0.0.1:8082/api/socket');
    expect(loadBridgeConfig({ ...env, TRACCAR_BASE_URL: 'https://traccar.example.test' }).socketUrl).toBe('wss://traccar.example.test/api/socket');
    expect(loadBridgeConfig(env)).toMatchObject({ healthPort: 0, silenceTimeoutMs: 120_000, reconnectMaxMs: 30_000 });
    expect(() => loadBridgeConfig({ ...env, BRIDGE_RECONNECT_BASE_MS: '5000', BRIDGE_RECONNECT_MAX_MS: '1000' })).toThrow();
    expect(() => loadBridgeConfig({ ...env, BRIDGE_HEALTH_PORT: '70000' })).toThrow('BRIDGE_HEALTH_PORT');
    expect(() => loadBridgeConfig({ TRACCAR_BASE_URL: env.TRACCAR_BASE_URL })).toThrow('TRACCAR_EMAIL');
  });
});

describe('tracking bridge lifecycle', () => {
  it('upgrades with the private session cookie and deduplicates REST reconciliation against the cached on-open push (B-S01)', async () => {
    const f = setup();
    f.client.positions.mockResolvedValue([pos(101)]);
    await running(f);
    expect(f.last().url).toBe('ws://127.0.0.1:8082/api/socket');
    expect(f.last().url).not.toContain('JSESSIONID');
    expect(f.last().cookie).toBe('JSESSIONID=s1');
    f.last().send({ positions: [pos(101)] });
    await flush();
    expect(f.accepted()).toEqual([101]);
    expect(f.bridge.health().counters).toMatchObject({ positionsAccepted: 1, positionsDuplicate: 1 });
    expect(JSON.stringify(f.bridge.health())).not.toMatch(/JSESSIONID|test-secret|VALRYDE-SIM/);
  });

  it('applies live frames only after reconciliation, in arrival order', async () => {
    const f = setup();
    let release!: (value: TraccarPosition[]) => void;
    f.client.positions.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    f.bridge.start();
    await flush();
    f.last().open();
    f.last().send({ positions: [pos(103, -10_000)] });
    f.last().send({ positions: [pos(102, -20_000)] });
    await flush();
    expect(f.bridge.state).toBe('RECONCILING');
    release([pos(101, -30_000)]);
    await flush();
    expect(f.accepted()).toEqual([101, 103]);
    expect(f.bridge.health().counters.positionsOutOfOrder).toBe(1);
  });

  it('ignores keepalives and unknown keys, keeps valid siblings of invalid items and skips unmapped devices (B-S02)', async () => {
    const f = setup();
    await running(f);
    f.last().send({});
    f.last().send({ logs: [{ message: 'not requested' }] });
    f.last().send({ positions: [pos(201, 1_000), { id: 'bad' }, pos(202, 2_000, { deviceId: 99 })], extra: true });
    await flush();
    expect(f.bridge.state).toBe('RUNNING');
    expect(f.accepted()).toEqual([201]);
    expect(f.bridge.health().counters).toMatchObject({ keepalives: 2, invalidItems: 1, unknownDevice: 1 });
  });

  it('treats malformed, oversized or wrongly shaped frames as lost continuity and reconnects with a fresh session', async () => {
    for (const frame of ['{not json', JSON.stringify({ positions: {} }), JSON.stringify({ positions: Array(3).fill(pos(1)) })]) {
      const f = setup({ env: { BRIDGE_MAX_FRAME_ITEMS: '2' } });
      await running(f);
      const first = f.last();
      first.send(frame);
      await flush();
      expect(first.closed).toBe(true);
      expect(first.onmessage).toBeNull();
      expect(f.client.invalidateSession).toHaveBeenCalledWith('JSESSIONID=s1');
      expect(f.bridge.health().lastError).toBe('INVALID_FRAME');
      await vi.advanceTimersByTimeAsync(500);
      expect(f.sockets).toHaveLength(2);
      expect(f.last().cookie).toBe('JSESSIONID=s2');
      await f.bridge.stop();
    }
  });

  it('schedules exactly one reconnect when error and close fire together, with capped jittered backoff (B-S03)', async () => {
    const f = setup();
    f.bridge.start();
    for (let attempt = 0; attempt < 7; attempt++) {
      await flush();
      const socket = f.last();
      socket.onerror?.();
      socket.onclose?.();
      await flush();
      await vi.advanceTimersByTimeAsync(f.sleeps[f.sleeps.length - 1]!);
    }
    // random() = 0 gives half of each capped exponential step.
    expect(f.sleeps).toEqual([500, 1_000, 2_000, 4_000, 8_000, 15_000, 15_000]);
    expect(f.sockets).toHaveLength(8);
    expect(f.bridge.health()).toMatchObject({ reconnects: 7, lastError: 'SOCKET_ERROR' });
    await f.bridge.stop();
  });

  it('keeps backing off for short-lived connections and resets only after a stable RUNNING period', async () => {
    const f = setup();
    await running(f);
    for (let i = 0; i < 3; i++) {
      f.last().onclose?.();
      await flush();
      await vi.advanceTimersByTimeAsync(f.sleeps[f.sleeps.length - 1]!);
      f.last().open();
      await flush();
    }
    expect(f.sleeps).toEqual([500, 1_000, 2_000]);
    for (let elapsed = 0; elapsed < 60_000; elapsed += 50_000) {
      await vi.advanceTimersByTimeAsync(50_000);
      f.last().send({});
    }
    f.last().onclose?.();
    await flush();
    expect(f.sleeps[f.sleeps.length - 1]).toBe(500);
    await f.bridge.stop();
  });

  it('stays connected through 55 s provider keepalives and reconnects after silence or a stalled handshake', async () => {
    const f = setup();
    await running(f);
    for (let i = 0; i < 4; i++) { await vi.advanceTimersByTimeAsync(55_000); f.last().send({}); }
    expect(f.bridge.state).toBe('RUNNING');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(f.bridge.health().lastError).toBe('SILENCE_TIMEOUT');
    await vi.advanceTimersByTimeAsync(500);
    expect(f.sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.bridge.health().lastError).toBe('CONNECT_TIMEOUT');
    await f.bridge.stop();
  });

  it('recovers from provider outage without fabricating telemetry (B-S04)', async () => {
    const f = setup();
    f.client.sessionCookie
      .mockRejectedValueOnce(new TraccarError('UNAVAILABLE', true))
      .mockRejectedValueOnce(new TraccarError('TIMEOUT', true));
    f.client.positions.mockResolvedValue([pos(301)]);
    f.bridge.start();
    await flush();
    expect(f.bridge.health()).toMatchObject({ state: 'BACKOFF', lastError: 'UNAVAILABLE' });
    expect(f.sockets).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1_000);
    f.last().open();
    await flush();
    expect(f.bridge.state).toBe('RUNNING');
    expect(f.accepted()).toEqual([301]);
    await f.bridge.stop();
  });

  it('redelivers after a sink failure instead of advancing past unstored telemetry', async () => {
    let fail = true;
    const stored: number[] = [];
    const f = setup({ sink: (batch) => {
      if (fail && batch.positions.length > 0) throw new Error('db down');
      stored.push(...batch.positions.map((p) => p.positionId));
    } });
    f.client.positions.mockResolvedValue([pos(401)]);
    f.bridge.start();
    await flush();
    f.last().open();
    await flush();
    expect(f.bridge.health().lastError).toBe('SINK_FAILURE');
    fail = false;
    await vi.advanceTimersByTimeAsync(500);
    f.last().open();
    await flush();
    expect(stored).toEqual([401]);
    await f.bridge.stop();
  });

  it('drops ordering history when a provider ID changes identity or disappears (B-S09, in-memory part)', async () => {
    const f = setup();
    f.client.positions.mockResolvedValue([pos(501, 10_000)]);
    await running(f);
    f.last().send({ devices: [{ id: 1, uniqueId: 'REPLACEMENT', status: 'online' }], positions: [pos(502, 5_000)] });
    await flush();
    expect(f.batches.at(-1)?.positions.map((p) => [p.positionId, p.uniqueId])).toEqual([[502, 'REPLACEMENT']]);
    f.client.devices.mockResolvedValue([]);
    f.last().onclose?.();
    await vi.advanceTimersByTimeAsync(500);
    f.last().open();
    await flush();
    expect(f.bridge.health().knownDevices).toBe(0);
    await f.bridge.stop();
  });

  it('deduplicates native events within and across frames', async () => {
    const f = setup();
    await running(f);
    const event = { id: 9, deviceId: 1, type: 'deviceMoving', eventTime: new Date(T).toISOString() };
    f.last().send({ events: [event, event] });
    f.last().send({ events: [event, { ...event, id: 10 }, { ...event, id: 11, deviceId: 77 }] });
    await flush();
    expect(f.batches.flatMap((b) => b.events.map((e) => e.id))).toEqual([9, 10]);
    expect(f.bridge.health().counters).toMatchObject({ eventsAccepted: 2, eventsDuplicate: 2, unknownDevice: 1 });
  });

  it('bounds queued frames while the sink is slow', async () => {
    let unblock!: () => void;
    const f = setup({ env: { BRIDGE_MAX_QUEUED_FRAMES: '2' }, sink: () => new Promise<void>((resolve) => { unblock = resolve; }) });
    f.bridge.start();
    await flush();
    f.last().open();
    await flush();
    for (let i = 0; i < 3; i++) f.last().send({ positions: [pos(600 + i, i * 1_000)] });
    unblock();
    await flush();
    expect(f.bridge.health().lastError).toBe('QUEUE_OVERFLOW');
    await f.bridge.stop();
  });
});

describe('tracking bridge shutdown (B-S12)', () => {
  it('stops during backoff without opening another socket, and is idempotent', async () => {
    const f = setup();
    await running(f);
    f.last().onclose?.();
    await flush();
    expect(f.bridge.state).toBe('BACKOFF');
    await f.bridge.stop();
    await f.bridge.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.sockets).toHaveLength(1);
    expect(f.bridge.state).toBe('STOPPED');
  });

  it('stops during connect and ignores late callbacks from the replaced socket', async () => {
    const f = setup();
    f.bridge.start();
    await flush();
    const socket = f.last();
    const lateOpen = socket.onopen;
    await f.bridge.stop();
    expect(socket.closed).toBe(true);
    lateOpen?.();
    socket.onclose?.();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.bridge.state).toBe('STOPPED');
    expect(f.sockets).toHaveLength(1);
    expect(f.client.devices).not.toHaveBeenCalled();
  });

  it('stops while authentication is in flight without connecting afterwards', async () => {
    const f = setup();
    let login!: (cookie: string) => void;
    f.client.sessionCookie.mockReturnValueOnce(new Promise((resolve) => { login = resolve; }));
    f.bridge.start();
    await flush();
    const stopped = f.bridge.stop();
    login('JSESSIONID=late');
    await stopped;
    expect(f.sockets).toHaveLength(0);
    expect(f.bridge.state).toBe('STOPPED');
  });

  it('drains an in-flight sink write before resolving stop', async () => {
    let finish!: () => void;
    let written = false;
    const f = setup({ sink: (batch) => batch.positions.length === 0 ? undefined
      : new Promise<void>((resolve) => { finish = () => { written = true; resolve(); }; }) });
    await running(f);
    f.last().send({ positions: [pos(701, 1_000)] });
    await flush();
    let resolved = false;
    const stopped = f.bridge.stop().then(() => { resolved = true; });
    await flush();
    expect(resolved).toBe(false);
    finish();
    await stopped;
    expect(written).toBe(true);
    expect(f.bridge.state).toBe('STOPPED');
  });
});

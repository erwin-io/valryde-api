import { setTimeout as delay } from 'node:timers/promises';

import type { BridgeConfig } from './bridge-config.js';
import { normalizePosition, TelemetryGate, type NormalizedPosition, type Verdict } from './telemetry.js';
import {
  parseDevice, parseEvent, parsePosition, TraccarError,
  type TraccarClient, type TraccarDevice, type TraccarEvent, type TraccarPosition,
} from './traccar-client.js';

export type BridgeState = 'STOPPED' | 'AUTHENTICATING' | 'CONNECTING' | 'RECONCILING' | 'RUNNING' | 'BACKOFF' | 'STOPPING';

// Minimal surface of Node's built-in WebSocket used by the bridge; injectable for tests.
export interface BridgeSocket {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  close(): void;
}
export type SocketFactory = (url: string, cookie: string) => BridgeSocket;

export interface TelemetryBatch {
  devices: TraccarDevice[];
  positions: NormalizedPosition[];
  /** Parseable fixes Traccar flags invalid; durable mode records them as observations (13b). */
  invalidPositions: NormalizedPosition[];
  events: TraccarEvent[];
  /** True for the REST snapshot taken while (re)connecting; false for live socket frames. */
  reconciliation: boolean;
}
/** 13a delivers to an injected sink; 13b plugs latest-state persistence in here. */
export type TelemetrySink = (batch: TelemetryBatch) => void | Promise<void>;
export type BridgeLogger = (message: string, fields?: Record<string, unknown>) => void;

interface Frame {
  devices: TraccarDevice[]; positions: TraccarPosition[]; events: TraccarEvent[]; invalidItems: number;
  reconciliation?: boolean;
}

export interface BridgeDependencies {
  client: Pick<TraccarClient, 'sessionCookie' | 'invalidateSession' | 'devices' | 'positions'>;
  sink?: TelemetrySink;
  socket?: SocketFactory;
  log?: BridgeLogger;
  now?: () => number;
  random?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<unknown>;
}

const counterNames = [
  'framesReceived', 'keepalives', 'invalidItems', 'unknownDevice', 'positionsAccepted',
  'positionsInvalid', 'positionsFuture', 'positionsDuplicate', 'positionsOutOfOrder', 'eventsAccepted', 'eventsDuplicate',
] as const;
type Counters = Record<(typeof counterNames)[number], number>;
const verdictCounter: Record<Exclude<Verdict, 'ACCEPT'>, keyof Counters> = {
  INVALID: 'positionsInvalid', FUTURE: 'positionsFuture', DUPLICATE: 'positionsDuplicate', OUT_OF_ORDER: 'positionsOutOfOrder',
};
const EVENT_MEMORY = 10_000;

class FrameError extends Error {}

export class TrackingBridge {
  readonly #config: BridgeConfig;
  readonly #client: BridgeDependencies['client'];
  readonly #sink: TelemetrySink;
  readonly #socket: SocketFactory;
  readonly #log: BridgeLogger;
  readonly #now: () => number;
  readonly #random: () => number;
  readonly #sleep: (ms: number, signal: AbortSignal) => Promise<unknown>;
  readonly #gate: TelemetryGate;
  readonly #registry = new Map<number, string>();
  readonly #seenEvents = new Set<number>();
  #abort: AbortController | undefined;
  #loop: Promise<void> | undefined;
  #state: BridgeState = 'STOPPED';
  #stateSince: number;
  #runningSince: number | undefined;
  #lastMessageAt: number | undefined;
  #lastPositionAt: number | undefined;
  #lastError: string | undefined;
  #reconnects = 0;
  #failures = 0;
  #counters: Counters = Object.fromEntries(counterNames.map((name) => [name, 0])) as Counters;

  constructor(config: BridgeConfig, dependencies: BridgeDependencies) {
    this.#config = config;
    this.#client = dependencies.client;
    this.#sink = dependencies.sink ?? (() => undefined);
    // Node 22 built-in WebSocket: cookie travels in upgrade headers, never in the URL; no Origin is sent.
    this.#socket = dependencies.socket ?? ((url, cookie) => new WebSocket(url, { headers: { Cookie: cookie } }) as unknown as BridgeSocket);
    this.#log = dependencies.log ?? (() => undefined);
    this.#now = dependencies.now ?? Date.now;
    this.#random = dependencies.random ?? Math.random;
    this.#sleep = dependencies.sleep ?? ((ms, signal) => delay(ms, undefined, { signal }));
    this.#gate = new TelemetryGate(config.futureToleranceMs);
    this.#stateSince = this.#now();
  }

  get state(): BridgeState { return this.#state; }

  start(): void {
    if (this.#loop !== undefined) throw new Error('Tracking bridge already started');
    this.#abort = new AbortController();
    this.#loop = this.#run(this.#abort.signal);
  }

  /** Idempotent. Resolves after the socket is closed and in-flight sink work has drained. */
  async stop(): Promise<void> {
    if (this.#loop === undefined || this.#abort === undefined) return;
    if (!this.#abort.signal.aborted) {
      this.#setState('STOPPING');
      this.#abort.abort();
    }
    await this.#loop;
  }

  health() {
    const iso = (ms: number | undefined) => ms === undefined ? null : new Date(ms).toISOString();
    return {
      state: this.#state,
      stateSince: iso(this.#stateSince),
      runningSince: iso(this.#runningSince),
      lastMessageAt: iso(this.#lastMessageAt),
      lastAcceptedPositionAt: iso(this.#lastPositionAt),
      lastError: this.#lastError ?? null,
      reconnects: this.#reconnects,
      consecutiveFailures: this.#failures,
      knownDevices: this.#registry.size,
      counters: { ...this.#counters },
    };
  }

  async #run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      this.#runningSince = undefined;
      let reason: string;
      try { reason = await this.#connectOnce(signal); } catch (error) { reason = reasonOf(error); }
      if (signal.aborted) break;
      // Only a connection that stayed up resets the budget; short flapping connections keep backing off.
      if (this.#runningSince !== undefined && this.#now() - this.#runningSince >= this.#config.stableResetMs) this.#failures = 0;
      const wait = this.#backoff(this.#failures);
      this.#failures++;
      this.#reconnects++;
      this.#lastError = reason;
      this.#setState('BACKOFF');
      this.#log('Traccar connection ended; reconnecting', { reason, retryInMs: wait, consecutiveFailures: this.#failures });
      try { await this.#sleep(wait, signal); } catch { break; }
    }
    this.#runningSince = undefined;
    this.#setState('STOPPED');
  }

  #backoff(failures: number): number {
    const cap = Math.min(this.#config.reconnectMaxMs, this.#config.reconnectBaseMs * 2 ** Math.min(failures, 30));
    return Math.floor(cap * (0.5 + this.#random() * 0.5));
  }

  async #connectOnce(signal: AbortSignal): Promise<string> {
    this.#setState('AUTHENTICATING');
    const cookie = await this.#client.sessionCookie();
    if (signal.aborted) return 'STOPPED';
    this.#setState('CONNECTING');
    const socket = this.#socket(this.#config.socketUrl, cookie);

    return new Promise<string>((resolve) => {
      let ended = false;
      let pending = 0;
      let chain: Promise<void> = Promise.resolve();
      let timer = setTimeout(() => end('CONNECT_TIMEOUT'), this.#config.connectTimeoutMs);
      const onAbort = () => end('STOPPED');

      const end = (reason: string) => {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        // Detach first so late callbacks from this replaced socket are ignored.
        socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
        try { socket.close(); } catch { /* already closed */ }
        // Native WebSocket hides the handshake status, so any failure may be an expired session.
        this.#client.invalidateSession(cookie);
        resolve(chain.then(() => reason));
      };
      const enqueue = (task: () => Promise<void>) => {
        chain = chain.then(async () => { if (!ended) await task(); }).catch((error: unknown) => end(reasonOf(error)));
      };

      signal.addEventListener('abort', onAbort, { once: true });
      socket.onopen = () => {
        if (ended) return;
        clearTimeout(timer);
        timer = setTimeout(() => end('SILENCE_TIMEOUT'), this.#config.silenceTimeoutMs);
        this.#setState('RECONCILING');
        // Socket frames queue behind REST reconciliation so they are applied in arrival order afterwards.
        enqueue(async () => {
          await this.#reconcile();
          if (ended) return;
          this.#runningSince = this.#now();
          this.#setState('RUNNING');
        });
      };
      socket.onmessage = (event) => {
        if (ended) return;
        timer.refresh();
        this.#lastMessageAt = this.#now();
        this.#counters.framesReceived++;
        let frame: Frame | undefined;
        try { frame = this.#parseFrame(event.data); } catch { end('INVALID_FRAME'); return; }
        if (frame === undefined) { this.#counters.keepalives++; return; }
        if (++pending > this.#config.maxQueuedFrames) { end('QUEUE_OVERFLOW'); return; }
        const parsed = frame;
        enqueue(async () => { try { await this.#process(parsed); } finally { pending--; } });
      };
      socket.onclose = () => end('SOCKET_CLOSED');
      socket.onerror = () => end('SOCKET_ERROR');
    });
  }

  async #reconcile(): Promise<void> {
    const devices = await this.#client.devices();
    const current = new Set(devices.map((device) => device.id));
    for (const id of this.#registry.keys()) {
      if (!current.has(id)) { this.#registry.delete(id); this.#gate.forget(id); }
    }
    // REST latest positions and Traccar's cached on-open push overlap; the gate deduplicates them.
    await this.#process({
      devices, positions: await this.#client.positions(), events: [], invalidItems: 0, reconciliation: true,
    });
  }

  async #process(frame: Frame): Promise<void> {
    this.#counters.invalidItems += frame.invalidItems;
    for (const device of frame.devices) {
      const prior = this.#registry.get(device.id);
      // A provider ID that now reports a different uniqueId is a new identity; drop its ordering history.
      if (prior !== undefined && prior !== device.uniqueId) this.#gate.forget(device.id);
      this.#registry.set(device.id, device.uniqueId);
    }
    const now = this.#now();
    const positions: NormalizedPosition[] = [];
    const invalidPositions: NormalizedPosition[] = [];
    for (const position of frame.positions) {
      const uniqueId = this.#registry.get(position.deviceId);
      if (uniqueId === undefined) { this.#counters.unknownDevice++; continue; }
      const verdict = this.#gate.admit(position, now);
      if (verdict === 'INVALID') invalidPositions.push(normalizePosition(position, uniqueId));
      if (verdict !== 'ACCEPT') { this.#counters[verdictCounter[verdict]]++; continue; }
      positions.push(normalizePosition(position, uniqueId));
    }
    const events: TraccarEvent[] = [];
    for (const event of frame.events) {
      if (!this.#registry.has(event.deviceId)) { this.#counters.unknownDevice++; continue; }
      if (this.#seenEvents.has(event.id) || events.some((seen) => seen.id === event.id)) {
        this.#counters.eventsDuplicate++;
        continue;
      }
      events.push(event);
    }
    if (frame.devices.length === 0 && positions.length === 0 && invalidPositions.length === 0 && events.length === 0) return;
    try {
      await this.#sink({
        devices: frame.devices, positions, invalidPositions, events, reconciliation: frame.reconciliation === true,
      });
    } catch (error) {
      // Forget watermarks so reconnect reconciliation redelivers what the sink failed to store.
      this.#gate.clear();
      throw new Error('SINK_FAILURE', { cause: error });
    }
    for (const event of events) this.#rememberEvent(event.id);
    this.#counters.positionsAccepted += positions.length;
    this.#counters.eventsAccepted += events.length;
    if (positions.length > 0) this.#lastPositionAt = now;
  }

  #rememberEvent(id: number): void {
    this.#seenEvents.add(id);
    if (this.#seenEvents.size > EVENT_MEMORY) {
      const oldest = this.#seenEvents.values().next().value;
      if (oldest !== undefined) this.#seenEvents.delete(oldest);
    }
  }

  /** Returns undefined for a keepalive. Throws FrameError when continuity can no longer be trusted. */
  #parseFrame(data: unknown): Frame | undefined {
    if (typeof data !== 'string' || Buffer.byteLength(data, 'utf8') > this.#config.maxFrameBytes) throw new FrameError();
    let value: unknown;
    try { value = JSON.parse(data); } catch { throw new FrameError(); }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new FrameError();
    const row = value as Record<string, unknown>;
    // Unknown keys (including `logs`, which the bridge never requests) are ignored.
    const lists = [row.devices, row.positions, row.events];
    if (lists.every((list) => list === undefined)) return undefined;
    if (lists.some((list) => list !== undefined && !Array.isArray(list))) throw new FrameError();
    const total = lists.reduce<number>((sum, list) => sum + ((list as unknown[] | undefined)?.length ?? 0), 0);
    if (total > this.#config.maxFrameItems) throw new FrameError();
    const frame: Frame = { devices: [], positions: [], events: [], invalidItems: 0 };
    const collect = <T>(list: unknown, parse: (item: unknown) => T, into: T[]) => {
      for (const item of (list as unknown[] | undefined) ?? []) {
        try { into.push(parse(item)); } catch { frame.invalidItems++; }
      }
    };
    collect(row.devices, parseDevice, frame.devices);
    collect(row.positions, parsePosition, frame.positions);
    collect(row.events, parseEvent, frame.events);
    return frame;
  }

  #setState(state: BridgeState): void {
    if (this.#state === state) return;
    // Once stopping, only the final STOPPED transition is allowed.
    if (this.#state === 'STOPPING' && state !== 'STOPPED') return;
    this.#state = state;
    this.#stateSince = this.#now();
    this.#log('Tracking bridge state', { state });
  }
}

function reasonOf(error: unknown): string {
  if (error instanceof TraccarError) return error.code;
  if (error instanceof Error && error.message === 'SINK_FAILURE') return 'SINK_FAILURE';
  return 'UNEXPECTED_ERROR';
}

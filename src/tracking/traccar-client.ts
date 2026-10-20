import { setTimeout as delay } from 'node:timers/promises';

import type { TraccarConfig } from './traccar-config.js';

export type TraccarFailure = 'AUTHENTICATION' | 'FORBIDDEN' | 'NOT_FOUND' | 'RATE_LIMITED' |
  'TIMEOUT' | 'NETWORK' | 'UNAVAILABLE' | 'INVALID_RESPONSE' | 'REQUEST_REJECTED';

export class TraccarError extends Error {
  constructor(public readonly code: TraccarFailure, public readonly retryable = false) {
    super(`Traccar request failed: ${code}`);
    this.name = 'TraccarError';
  }
}

// Provider-only records. Never serialize these directly to a client.
export interface TraccarDevice { id: number; uniqueId: string; status: string; }
export interface TraccarPosition {
  id: number; deviceId: number; valid: boolean; latitude: number; longitude: number;
  fixTime: string; deviceTime: string; serverTime: string; speed: number; course: number;
}
export interface TraccarEvent { id: number; deviceId: number; type: string; eventTime: string; }
export interface HistoryRange { from: string; to: string; }

interface Dependencies {
  fetch: typeof globalThis.fetch;
  sleep: (ms: number) => Promise<unknown>;
  random: () => number;
}

export class TraccarClient {
  #config: TraccarConfig;
  #dependencies: Dependencies;
  #cookie: string | undefined;
  #login: Promise<string> | undefined;

  constructor(config: TraccarConfig, dependencies: Partial<Dependencies> = {}) {
    this.#config = config;
    this.#dependencies = { fetch: globalThis.fetch, sleep: delay, random: Math.random, ...dependencies };
  }

  async devices(uniqueId?: string): Promise<TraccarDevice[]> {
    const query = uniqueId === undefined ? {} : { uniqueId };
    return this.records(await this.get('/api/devices', query), parseDevice);
  }

  async positions(): Promise<TraccarPosition[]> {
    return this.records(await this.get('/api/positions'), parsePosition);
  }

  async history(deviceId: number, range: HistoryRange): Promise<TraccarPosition[]> {
    validateDeviceId(deviceId);
    validateHistoryRange(range);
    return this.records(await this.get('/api/positions', { deviceId: String(deviceId), ...range }), parsePosition);
  }

  async events(deviceId: number, range: HistoryRange): Promise<TraccarEvent[]> {
    validateDeviceId(deviceId);
    validateHistoryRange(range);
    return this.records(await this.get('/api/reports/events', { deviceId: String(deviceId), ...range }), parseEvent);
  }

  // Server-only session lease for the Tracking Bridge socket upgrade; never expose the cookie.
  async sessionCookie(): Promise<string> {
    return this.session();
  }

  // Drops only the given cookie so a stale failure cannot discard a newer login.
  invalidateSession(cookie: string): void {
    if (this.#cookie === cookie) this.#cookie = undefined;
  }

  private records<T>(value: unknown, parse: (row: unknown) => T): T[] {
    if (!Array.isArray(value)) throw new TraccarError('INVALID_RESPONSE');
    return value.map(parse);
  }

  private async session(): Promise<string> {
    if (this.#cookie !== undefined) return this.#cookie;
    if (this.#login !== undefined) return this.#login;
    this.#login = this.authenticate();
    try { return await this.#login; } finally { this.#login = undefined; }
  }

  private async authenticate(): Promise<string> {
    const cookie = await this.retry(async () => {
      return this.exchange('/api/session', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email: this.#config.email, password: this.#config.password }).toString(),
      }, true);
    });
    if (typeof cookie !== 'string') throw new TraccarError('INVALID_RESPONSE');
    this.#cookie = cookie;
    return cookie;
  }

  private async get(path: string, query: Record<string, string> = {}): Promise<unknown> {
    const params = new URLSearchParams(query).toString();
    const target = params ? `${path}?${params}` : path;
    for (let refresh = 0; ; refresh++) {
      const cookie = await this.session();
      try {
        return await this.retry(() => this.exchange(target, {
          headers: { Accept: 'application/json', Cookie: cookie },
        }));
      } catch (error) {
        if (!(error instanceof TraccarError) || error.code !== 'AUTHENTICATION') throw error;
        // A late 401 for an old cookie must not invalidate a newer login.
        if (this.#cookie === cookie) this.#cookie = undefined;
        if (refresh >= 1) throw error;
      }
    }
  }

  private async retry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await operation(); } catch (error) {
        if (!(error instanceof TraccarError) || !error.retryable || attempt >= this.#config.maxRetries) throw error;
        const cap = Math.min(this.#config.retryMaxMs, this.#config.retryBaseMs * 2 ** attempt);
        await this.#dependencies.sleep(Math.floor(cap * (0.5 + this.#dependencies.random() * 0.5)));
      }
    }
  }

  private async exchange(path: string, init: RequestInit, login = false): Promise<unknown> {
    const signal = AbortSignal.timeout(this.#config.timeoutMs);
    try {
      const response = await this.#dependencies.fetch(`${this.#config.baseUrl}${path}`, {
        ...init, signal, redirect: 'error',
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw classify(response.status);
      }
      if (login) {
        const cookie = response.headers.getSetCookie().map((entry) => entry.split(';')[0])
          .find((entry) => entry?.startsWith('JSESSIONID='));
        await response.body?.cancel();
        if (!cookie || cookie === 'JSESSIONID=') throw new TraccarError('INVALID_RESPONSE');
        return cookie;
      }
      const value: unknown = await response.json();
      return value;
    } catch (error) {
      if (error instanceof TraccarError) throw error;
      if (signal.aborted) throw new TraccarError('TIMEOUT', true);
      if (error instanceof SyntaxError) throw new TraccarError('INVALID_RESPONSE');
      // Deliberately omit upstream body, URL, credentials and network error cause.
      throw new TraccarError('NETWORK', true);
    }
  }
}

export function validateHistoryRange(range: HistoryRange): void {
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
  const from = Date.parse(range.from), to = Date.parse(range.to);
  if (!iso.test(range.from) || !iso.test(range.to) || !Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
    throw new Error('History range must contain ordered ISO timestamps with time zones');
  }
  // Request-size guard, not a change to Traccar retention policy.
  if (to - from > 30 * 86_400_000) throw new Error('History range must not exceed 30 days');
}

function classify(status: number): TraccarError {
  if (status === 401) return new TraccarError('AUTHENTICATION');
  if (status === 403) return new TraccarError('FORBIDDEN');
  if (status === 404) return new TraccarError('NOT_FOUND');
  if (status === 429) return new TraccarError('RATE_LIMITED', true);
  if (status >= 500) return new TraccarError('UNAVAILABLE', true);
  return new TraccarError('REQUEST_REJECTED');
}

function validateDeviceId(id: number): void {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('A positive Traccar device ID is required');
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TraccarError('INVALID_RESPONSE');
  return value as Record<string, unknown>;
}
function id(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new TraccarError('INVALID_RESPONSE');
  return value;
}
function number(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new TraccarError('INVALID_RESPONSE');
  return value;
}
function string(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new TraccarError('INVALID_RESPONSE');
  return value;
}
function timestamp(value: unknown): string {
  const text = string(value);
  if (!Number.isFinite(Date.parse(text))) throw new TraccarError('INVALID_RESPONSE');
  return new Date(text).toISOString();
}
export function parseDevice(value: unknown): TraccarDevice {
  const row = object(value);
  return { id: id(row.id), uniqueId: string(row.uniqueId), status: string(row.status) };
}
export function parsePosition(value: unknown): TraccarPosition {
  const row = object(value);
  if (typeof row.valid !== 'boolean') throw new TraccarError('INVALID_RESPONSE');
  return {
    id: id(row.id), deviceId: id(row.deviceId), valid: row.valid,
    latitude: number(row.latitude, -90, 90), longitude: number(row.longitude, -180, 180),
    fixTime: timestamp(row.fixTime), deviceTime: timestamp(row.deviceTime), serverTime: timestamp(row.serverTime),
    speed: number(row.speed, 0, Number.MAX_VALUE), course: number(row.course, 0, 360),
  };
}
export function parseEvent(value: unknown): TraccarEvent {
  const row = object(value);
  return { id: id(row.id), deviceId: id(row.deviceId), type: string(row.type), eventTime: timestamp(row.eventTime) };
}

import type { TraccarPosition } from './traccar-client.js';

// Internal bridge record. Contains private provider identifiers: never a client DTO.
export interface NormalizedPosition {
  deviceId: number;
  uniqueId: string;
  positionId: number;
  latitude: number;
  longitude: number;
  fixTime: string;
  deviceTime: string;
  serverTime: string;
  speedKph: number;
  heading: number;
  /** Provider-reported motion; null when not reported. */
  motion: boolean | null;
}

export type Verdict = 'ACCEPT' | 'INVALID' | 'FUTURE' | 'DUPLICATE' | 'OUT_OF_ORDER';

export function normalizePosition(position: TraccarPosition, uniqueId: string): NormalizedPosition {
  return {
    deviceId: position.deviceId, uniqueId, positionId: position.id,
    latitude: position.latitude, longitude: position.longitude,
    fixTime: position.fixTime, deviceTime: position.deviceTime, serverTime: position.serverTime,
    speedKph: position.speed * 1.852,
    heading: position.course === 360 ? 0 : position.course,
    motion: position.motion ?? null,
  };
}

/**
 * Per-device in-memory ordering by GPS fix time. Receipt/server time never makes an older fix newer.
 * shortcut: watermarks reset on restart, so 13b's guarded DB upsert must remain the durable ordering authority.
 */
export class TelemetryGate {
  #last = new Map<number, { id: number; fixMs: number }>();

  constructor(private readonly futureToleranceMs: number) {}

  admit(position: TraccarPosition, nowMs: number): Verdict {
    if (!position.valid) return 'INVALID';
    const fixMs = Date.parse(position.fixTime);
    if (fixMs > nowMs + this.futureToleranceMs) return 'FUTURE';
    const last = this.#last.get(position.deviceId);
    if (last !== undefined) {
      if (position.id === last.id || fixMs === last.fixMs) return 'DUPLICATE';
      if (fixMs < last.fixMs) return 'OUT_OF_ORDER';
    }
    this.#last.set(position.deviceId, { id: position.id, fixMs });
    return 'ACCEPT';
  }

  forget(deviceId: number): void {
    this.#last.delete(deviceId);
  }

  clear(): void {
    this.#last.clear();
  }
}

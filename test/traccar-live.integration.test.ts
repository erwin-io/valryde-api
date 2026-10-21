import { setTimeout as delay } from 'node:timers/promises';

import { describe, expect, it } from 'vitest';

import { loadBridgeConfig } from '../src/tracking/bridge-config.js';
import { TraccarClient } from '../src/tracking/traccar-client.js';
import { TrackingBridge, type TelemetryBatch } from '../src/tracking/tracking-bridge.js';

// Opt-in, read-only check against the real Windows development Traccar. Requires TRACCAR_LIVE_TEST=1
// plus the read-only service credentials in the private environment. Never sends telemetry.
const live = process.env.TRACCAR_LIVE_TEST === '1';

describe.skipIf(!live)('tracking bridge against live Traccar (read-only)', () => {
  it('authenticates the native WebSocket with the session cookie, reconciles and stops cleanly', async () => {
    const config = loadBridgeConfig();
    const batches: TelemetryBatch[] = [];
    const bridge = new TrackingBridge(config, { client: new TraccarClient(config.traccar), sink: (batch) => { batches.push(batch); } });
    bridge.start();
    try {
      const deadline = Date.now() + 15_000;
      while (bridge.state !== 'RUNNING' && Date.now() < deadline) await delay(50);
      expect(bridge.health()).toMatchObject({ state: 'RUNNING', reconnects: 0 });
      // Stay up long enough to receive at least one 55 s provider keepalive on the authenticated socket.
      if (process.env.TRACCAR_LIVE_KEEPALIVE === '1') {
        await delay(60_000);
        expect(bridge.health().counters.keepalives).toBeGreaterThan(0);
        expect(bridge.state).toBe('RUNNING');
      }
      expect(bridge.health().knownDevices).toBeGreaterThan(0);
      expect(batches.length).toBeGreaterThan(0);
    } finally {
      await bridge.stop();
    }
    expect(bridge.state).toBe('STOPPED');
  }, 90_000);
});

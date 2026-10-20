import 'dotenv/config';

import { setTimeout as delay } from 'node:timers/promises';

import { loadBridgeConfig } from './tracking/bridge-config.js';
import { startHealthServer } from './tracking/bridge-health.js';
import { TraccarClient } from './tracking/traccar-client.js';
import { TrackingBridge } from './tracking/tracking-bridge.js';

// Persistent Tracking Bridge entry point. Runs beside Traccar; never imported by the Fastify/serverless API.
function log(message: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), component: 'tracking-bridge', message, ...fields })}\n`);
}

async function main(): Promise<void> {
  const config = loadBridgeConfig();
  const bridge = new TrackingBridge(config, {
    client: new TraccarClient(config.traccar),
    log,
    // Stage 13a: no persistence yet (13b). Summaries only; coordinates and device identities are not logged.
    sink: (batch) => log('Telemetry accepted', {
      devices: batch.devices.length, positions: batch.positions.length, events: batch.events.length,
    }),
  });
  const health = config.healthPort === 0 ? undefined : await startHealthServer(bridge, config.healthPort);

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log('Shutting down', { signal });
    const drained = await Promise.race([bridge.stop().then(() => true), delay(config.shutdownTimeoutMs, false)]);
    health?.close();
    if (!drained) log('Shutdown deadline exceeded; exiting with in-flight work abandoned');
    process.exit(drained ? 0 : 1);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  bridge.start();
  log('Tracking bridge started', { socketUrl: config.socketUrl, healthPort: config.healthPort || null });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown startup error';
  process.stderr.write(`Valryde Tracking Bridge failed to start: ${message}\n`);
  process.exitCode = 1;
});

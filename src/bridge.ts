import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import pg from 'pg';

import { TrackingContextService } from './services/tracking-context-service.js';
import { TransitService } from './services/transit-service.js';

import { loadBridgeConfig } from './tracking/bridge-config.js';
import { startHealthServer } from './tracking/bridge-health.js';
import { TraccarClient } from './tracking/traccar-client.js';
import { TrackingBridge, type TelemetrySink } from './tracking/tracking-bridge.js';
import { TrackingLeaseService } from './tracking/tracking-lease.js';
import { TrackingPersistence } from './tracking/tracking-persistence.js';
import { TrackingStateWriter } from './tracking/tracking-state-writer.js';

// Persistent Tracking Bridge entry point. Runs beside Traccar; never imported by the Fastify/serverless API.
function log(message: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), component: 'tracking-bridge', message, ...fields })}\n`);
}

async function main(): Promise<void> {
  const config = loadBridgeConfig();
  // Default: log-only (13a). Summaries only; coordinates and device identities are not logged.
  let sink: TelemetrySink = (batch) => log('Telemetry accepted', {
    devices: batch.devices.length, positions: batch.positions.length, events: batch.events.length,
  });
  let pool: pg.Pool | undefined;
  let persistence: TrackingPersistence | undefined;
  if (config.persistence !== null) {
    pool = new pg.Pool({
      connectionString: config.persistence.databaseUrl,
      ssl: config.persistence.databaseSsl ? { rejectUnauthorized: true } : false,
      max: 4,
      application_name: 'valryde-tracking-bridge',
      options: `-c search_path=${config.persistence.databaseSchema},public`,
    });
    const writer = new TrackingStateWriter(pool, new TrackingContextService(new TransitService(pool)));
    persistence = new TrackingPersistence(writer, new TrackingLeaseService(pool), {
      ownerId: randomUUID(), log, phase: () => bridge.state,
    });
    sink = persistence.sink;
  }
  const bridge = new TrackingBridge(config, { client: new TraccarClient(config.traccar), log, sink });
  if (persistence !== undefined) log('Durable tracking persistence enabled', { leaseHeld: await persistence.start() });
  const health = config.healthPort === 0 ? undefined : await startHealthServer(bridge, config.healthPort, persistence);

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log('Shutting down', { signal });
    const drained = await Promise.race([
      bridge.stop().then(async () => { await persistence?.stop(); await pool?.end(); return true; }),
      delay(config.shutdownTimeoutMs, false),
    ]);
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

import { createServer, type Server } from 'node:http';

import type { TrackingBridge } from './tracking-bridge.js';
import type { TrackingPersistence } from './tracking-persistence.js';

/**
 * Loopback-only operational health: 200 when RUNNING and, in durable mode, the writer lease
 * is held; otherwise 503. Counters and states only;
 * no credentials, cookies, uniqueIds or coordinates. Binding the port also prevents a second
 * bridge instance from starting on the same host while it is enabled.
 */
export async function startHealthServer(
  bridge: Pick<TrackingBridge, 'health'>,
  port: number,
  persistence?: Pick<TrackingPersistence, 'health'>,
): Promise<Server> {
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/health') {
      response.writeHead(404).end();
      return;
    }
    const health = bridge.health();
    const persistenceHealth = persistence?.health();
    const ready = health.state === 'RUNNING' && (persistenceHealth?.leaseHeld ?? true);
    response.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      .end(JSON.stringify(persistenceHealth === undefined ? health : { ...health, persistence: persistenceHealth }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  return server;
}

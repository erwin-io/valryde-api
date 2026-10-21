import { createServer, type Server } from 'node:http';

import type { TrackingBridge } from './tracking-bridge.js';

/**
 * Loopback-only operational health: 200 when RUNNING, otherwise 503. Counters and states only;
 * no credentials, cookies, uniqueIds or coordinates. Binding the port also prevents a second
 * bridge instance from starting on the same host while it is enabled.
 */
export async function startHealthServer(bridge: Pick<TrackingBridge, 'health'>, port: number): Promise<Server> {
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/health') {
      response.writeHead(404).end();
      return;
    }
    const health = bridge.health();
    response.writeHead(health.state === 'RUNNING' ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      .end(JSON.stringify(health));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  return server;
}

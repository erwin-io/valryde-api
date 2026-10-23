import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

import { afterEach, describe, expect, it } from 'vitest';

import { loadBridgeConfig } from '../src/tracking/bridge-config.js';
import { startHealthServer } from '../src/tracking/bridge-health.js';
import { TraccarClient } from '../src/tracking/traccar-client.js';
import { TrackingBridge, type TelemetryBatch } from '../src/tracking/tracking-bridge.js';

// Local stand-in that mimics Traccar 6.16 session, REST and /api/socket behavior over real HTTP/WebSocket.
function wsFrame(text: string): Buffer {
  const payload = Buffer.from(text);
  if (payload.length < 126) return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  const header = Buffer.from([0x81, 126, 0, 0]);
  header.writeUInt16BE(payload.length, 2);
  return Buffer.concat([header, payload]);
}

function position(id: number) {
  const time = new Date(Date.now() - 1_000 + id).toISOString();
  return { id, deviceId: 1, valid: true, latitude: 10.3157, longitude: 123.8854, fixTime: time, deviceTime: time, serverTime: time, speed: 10, course: 90 };
}

async function fakeTraccar() {
  const state = { logins: 0, upgrades: [] as Array<{ cookie: string | undefined; origin: string | undefined; url: string | undefined }>, sockets: [] as Socket[] };
  const server: Server = createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/api/session') {
      state.logins++;
      response.writeHead(200, { 'Set-Cookie': `JSESSIONID=session-${state.logins}; Path=/; HttpOnly`, 'Content-Type': 'application/json' }).end('{}');
      return;
    }
    if (request.headers.cookie !== `JSESSIONID=session-${state.logins}`) { response.writeHead(401).end('stack trace'); return; }
    if (request.url === '/api/devices') { response.end(JSON.stringify([{ id: 1, uniqueId: 'VALRYDE-SIM-0001', status: 'online' }])); return; }
    if (request.url === '/api/positions') { response.end(JSON.stringify([position(11)])); return; }
    response.writeHead(404).end();
  });
  server.on('upgrade', (request: IncomingMessage, socket: Socket) => {
    state.upgrades.push({ cookie: request.headers.cookie, origin: request.headers.origin, url: request.url });
    if (request.headers.cookie !== `JSESSIONID=session-${state.logins}`) { socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n'); return; }
    const accept = createHash('sha1').update(`${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.on('error', () => undefined);
    state.sockets.push(socket);
    // Like Traccar's AsyncSocket: cached latest positions immediately on open.
    socket.write(wsFrame(JSON.stringify({ positions: [position(11)] })));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, state, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

async function until(condition: () => boolean, ms = 5_000) {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not reached');
    await delay(10);
  }
}

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const step of cleanup.splice(0).reverse()) await step(); });

describe('tracking bridge over real HTTP/WebSocket transport', () => {
  it('authenticates, upgrades with the cookie and no Origin, reconciles, receives live frames and recovers from a dropped socket', async () => {
    const provider = await fakeTraccar();
    cleanup.push(() => new Promise<void>((resolve) => { provider.state.sockets.forEach((s) => s.destroy()); provider.server.close(() => resolve()); }));
    const config = loadBridgeConfig({
      TRACCAR_BASE_URL: provider.origin, TRACCAR_EMAIL: 'bridge@example.test', TRACCAR_PASSWORD: 'test-secret',
      BRIDGE_RECONNECT_BASE_MS: '10', BRIDGE_RECONNECT_MAX_MS: '20',
    });
    const batches: TelemetryBatch[] = [];
    const bridge = new TrackingBridge(config, { client: new TraccarClient(config.traccar), sink: (batch) => { batches.push(batch); } });
    bridge.start();
    cleanup.push(() => bridge.stop());
    let leaseHeld = true;
    const persistenceHealth = { health: () => ({
      leaseHeld, fence: leaseHeld ? '1' : null, lastCommitAt: null,
      lastError: leaseHeld ? null : 'LEASE_LOST', dispositions: {},
    }) };
    const health = await startHealthServer(bridge, 0, persistenceHealth);
    cleanup.push(() => new Promise<void>((resolve) => health.close(() => resolve())));
    const healthUrl = `http://127.0.0.1:${(health.address() as AddressInfo).port}/health`;

    await until(() => bridge.state === 'RUNNING');
    expect(provider.state.upgrades[0]).toEqual({ cookie: 'JSESSIONID=session-1', origin: undefined, url: '/api/socket' });
    const healthy = await fetch(healthUrl);
    expect(healthy.status).toBe(200);
    const body = await healthy.text();
    expect(body).toContain('"leaseHeld":true');
    expect(body).not.toMatch(/JSESSIONID|test-secret|VALRYDE-SIM|10\.3157/);
    leaseHeld = false;
    const unavailable = await fetch(healthUrl);
    expect(unavailable.status).toBe(503);
    const unavailableBody = await unavailable.text();
    expect(unavailableBody).toContain('"leaseHeld":false');
    expect(unavailableBody).toContain('"lastError":"LEASE_LOST"');
    leaseHeld = true;
    expect((await fetch(healthUrl)).status).toBe(200);

    provider.state.sockets[0]!.write(wsFrame('{}'));
    provider.state.sockets[0]!.write(wsFrame(JSON.stringify({ positions: [position(12)] })));
    await until(() => batches.flatMap((b) => b.positions).length === 2);
    expect(batches.flatMap((b) => b.positions.map((p) => p.positionId))).toEqual([11, 12]);
    expect(bridge.health().counters).toMatchObject({ keepalives: 1, positionsDuplicate: 1 });

    provider.state.sockets[0]!.destroy();
    await until(() => provider.state.upgrades.length === 2 && bridge.state === 'RUNNING');
    // Native WebSocket hides handshake status, so every reconnect uses a fresh login.
    expect(provider.state.upgrades[1]?.cookie).toBe('JSESSIONID=session-2');
    expect(bridge.health().reconnects).toBe(1);
    // An abrupt TCP loss can emit error before close (including on supported Node 24).
    expect(['SOCKET_CLOSED', 'SOCKET_ERROR']).toContain(bridge.health().lastError);

    await bridge.stop();
    expect(bridge.state).toBe('STOPPED');
    expect((await fetch(healthUrl)).status).toBe(503);
    expect((await fetch(`${healthUrl}x`)).status).toBe(404);
  });

  it('keeps retrying with backoff when the provider rejects the upgrade', async () => {
    const provider = await fakeTraccar();
    cleanup.push(() => new Promise<void>((resolve) => provider.server.close(() => resolve())));
    provider.server.removeAllListeners('upgrade');
    provider.server.on('upgrade', (_request: IncomingMessage, socket: Socket) => { socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n'); });
    const config = loadBridgeConfig({
      TRACCAR_BASE_URL: provider.origin, TRACCAR_EMAIL: 'bridge@example.test', TRACCAR_PASSWORD: 'test-secret',
      BRIDGE_RECONNECT_BASE_MS: '10', BRIDGE_RECONNECT_MAX_MS: '20',
    });
    const bridge = new TrackingBridge(config, { client: new TraccarClient(config.traccar) });
    bridge.start();
    cleanup.push(() => bridge.stop());
    await until(() => bridge.health().reconnects >= 2);
    expect(provider.state.logins).toBeGreaterThanOrEqual(2);
    expect(bridge.health().state).not.toBe('RUNNING');
  });
});

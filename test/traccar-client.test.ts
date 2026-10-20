import { describe, expect, it, vi } from 'vitest';

import { TraccarClient, TraccarError } from '../src/tracking/traccar-client.js';
import { loadTraccarConfig } from '../src/tracking/traccar-config.js';

const source = { TRACCAR_BASE_URL: 'http://127.0.0.1:8082', TRACCAR_EMAIL: 'service@example.test', TRACCAR_PASSWORD: 'test-secret' };
const config = loadTraccarConfig(source);
const range = { from: '2026-10-19T00:00:00Z', to: '2026-10-19T01:00:00Z' };
const device = { id: 7, uniqueId: 'tracker-7', status: 'online' };
const position = {
  id: 10, deviceId: 7, valid: true, latitude: 10.3, longitude: 123.9,
  fixTime: range.from, deviceTime: range.from, serverTime: range.from, speed: 10, course: 90,
};
function login(cookie = 'session-one') {
  return new Response('{}', { headers: { 'Set-Cookie': `JSESSIONID=${cookie}; Path=/api; HttpOnly` } });
}
function fixture() {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue();
  return { fetch, sleep, client: new TraccarClient(config, { fetch, sleep, random: () => 0 }) };
}

describe('Traccar REST/session adapter', () => {
  it('shares one login across concurrent reads and keeps credentials out of URLs/results', async () => {
    const { fetch, client } = fixture();
    fetch.mockResolvedValueOnce(login()).mockImplementation(async () => Response.json([device]));
    const results = await Promise.all([client.devices(), client.devices()]);
    expect(results).toEqual([[device], [device]]);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[0]?.[0]).toBe(`${config.baseUrl}/api/session`);
    expect(fetch.mock.calls[0]?.[1]?.body).toBe(new URLSearchParams({ email: config.email, password: config.password }).toString());
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ redirect: 'error', headers: { Cookie: 'JSESSIONID=session-one' } });
    expect(JSON.stringify(client)).not.toContain(config.password);
  });

  it('reauthenticates once on session expiry and replaces the cookie', async () => {
    const { fetch, client } = fixture();
    fetch.mockResolvedValueOnce(login()).mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(login('new-session')).mockResolvedValueOnce(Response.json([device]));
    expect(await client.devices()).toEqual([device]);
    expect(fetch.mock.calls[3]?.[1]).toMatchObject({ headers: { Cookie: 'JSESSIONID=new-session' } });
  });

  it('does not loop indefinitely on invalid credentials or persistent 401', async () => {
    const first = fixture();
    first.fetch.mockResolvedValue(new Response('', { status: 401 }));
    await expect(first.client.devices()).rejects.toMatchObject({ code: 'AUTHENTICATION' });
    expect(first.fetch).toHaveBeenCalledTimes(1);
    const second = fixture();
    second.fetch.mockImplementation(async (_url, init) => init?.method === 'POST' ? login() : new Response('', { status: 401 }));
    await expect(second.client.devices()).rejects.toMatchObject({ code: 'AUTHENTICATION' });
    expect(second.fetch).toHaveBeenCalledTimes(4);
  });

  it('shares reauthentication when simultaneous reads lose the same session', async () => {
    const { fetch, client } = fixture();
    let logins = 0;
    fetch.mockImplementation(async (_url, init) => {
      if (init?.method === 'POST') return login(`session-${++logins}`);
      const cookie = new Headers(init?.headers).get('Cookie');
      return cookie === 'JSESSIONID=session-1'
        ? new Response('', { status: 401 }) : Response.json([device]);
    });
    const results = await Promise.all([client.devices(), client.devices(), client.devices()]);
    expect(results).toEqual([[device], [device], [device]]);
    expect(logins).toBe(2);
  });

  it('exhausts the configured retry budget on persistent upstream failure', async () => {
    const { fetch, client, sleep } = fixture();
    fetch.mockResolvedValueOnce(login()).mockImplementation(async () => new Response('', { status: 503 }));
    await expect(client.devices()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('caps exponential backoff at the configured maximum', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => new Response('', { status: 503 }));
    const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue();
    const client = new TraccarClient({ ...config, maxRetries: 5, retryBaseMs: 100, retryMaxMs: 200 },
      { fetch, sleep, random: () => 1 });
    await expect(client.devices()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(sleep.mock.calls).toEqual([[100], [200], [200], [200], [200]]);
  });

  it.each([403, 404, 400])('does not retry permanent HTTP %s', async (status) => {
    const { fetch, client, sleep } = fixture();
    fetch.mockResolvedValueOnce(login()).mockResolvedValueOnce(new Response('secret upstream response', { status }));
    await expect(client.devices()).rejects.toBeInstanceOf(TraccarError);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleep).not.toHaveBeenCalled();
  });

  it.each([429, 503])('retries HTTP %s with bounded backoff and recovers', async (status) => {
    const { fetch, client, sleep } = fixture();
    fetch.mockResolvedValueOnce(login()).mockResolvedValueOnce(new Response('', { status }))
      .mockResolvedValueOnce(new Response('', { status })).mockResolvedValueOnce(Response.json([]));
    expect(await client.devices()).toEqual([]);
    expect(sleep.mock.calls).toEqual([[125], [250]]);
  });

  it('bounds network retries and strips sensitive causes', async () => {
    const { fetch, client } = fixture();
    fetch.mockRejectedValue(new Error(config.password));
    await expect(client.devices()).rejects.toMatchObject({ code: 'NETWORK', message: 'Traccar request failed: NETWORK' });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('times out a stalled request', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    });
    const client = new TraccarClient({ ...config, timeoutMs: 5, maxRetries: 0 }, { fetch });
    await expect(client.devices()).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('retrieves latest positions, history and native events through official paths', async () => {
    const { fetch, client } = fixture();
    const event = { id: 11, deviceId: 7, type: 'deviceMoving', eventTime: range.from };
    fetch.mockResolvedValueOnce(login()).mockResolvedValueOnce(Response.json([position]))
      .mockResolvedValueOnce(Response.json([position])).mockResolvedValueOnce(Response.json([event]));
    expect(await client.positions()).toMatchObject([{ id: 10 }]);
    expect(await client.history(7, range)).toMatchObject([{ id: 10 }]);
    expect(await client.events(7, range)).toMatchObject([{ type: 'deviceMoving' }]);
    const historyTarget = fetch.mock.calls[2]?.[0];
    if (typeof historyTarget !== 'string') throw new Error('Expected URL string');
    const historyUrl = new URL(historyTarget);
    expect(historyUrl.pathname).toBe('/api/positions');
    expect(historyUrl.searchParams.get('deviceId')).toBe('7');
    expect(historyUrl.searchParams.get('from')).toBe(range.from);
    const eventTarget = fetch.mock.calls[3]?.[0];
    if (typeof eventTarget !== 'string') throw new Error('Expected URL string');
    expect(new URL(eventTarget).pathname).toBe('/api/reports/events');
  });

  it.each([{}, [{ ...position, latitude: 91 }], [{ ...position, deviceId: '7' }]])('rejects malformed provider records', async (body) => {
    const { fetch, client } = fixture();
    fetch.mockResolvedValueOnce(login()).mockResolvedValueOnce(Response.json(body));
    await expect(client.positions()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('rejects malformed JSON and missing session cookies without retry', async () => {
    const { fetch, client } = fixture();
    fetch.mockResolvedValueOnce(login()).mockResolvedValueOnce(new Response('<html>login</html>'));
    await expect(client.devices()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    const missing = fixture();
    missing.fetch.mockResolvedValue(Response.json({}));
    await expect(missing.client.devices()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('validates history bounds before contacting Traccar', async () => {
    const { client, fetch } = fixture();
    await expect(client.history(7, { from: range.to, to: range.from })).rejects.toThrow('ordered');
    await expect(client.history(7, { from: '2026-01-01T00:00:00Z', to: range.to })).rejects.toThrow('30 days');
    await expect(client.history(0, range)).rejects.toThrow('positive');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('server-only Traccar configuration', () => {
  it.each([
    { TRACCAR_BASE_URL: 'https://user:pass@example.test' },
    { TRACCAR_BASE_URL: 'http://example.test' },
    { TRACCAR_BASE_URL: 'https://example.test/api' },
    { TRACCAR_BASE_URL: 'https://example.test/?token=secret' },
    { TRACCAR_PASSWORD: '' }, { TRACCAR_MAX_RETRIES: '100' },
    { TRACCAR_TIMEOUT_MS: '-1' }, { TRACCAR_RETRY_MAX_MS: '1' },
  ])('rejects unsafe or unbounded settings', (override) => {
    expect(() => loadTraccarConfig({ ...source, ...override })).toThrow();
  });
});

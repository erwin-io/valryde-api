import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp, requestLogSerializer } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import { ApiError } from '../src/lib/api-error.js';
import {
  DisabledGeocoderService,
  PhotonGeocoderService,
  type GeoPoint,
  type GeocoderService,
  type Place,
} from '../src/services/geocoder-service.js';
import { MemoryIdentityRepository } from './support/memory-identity-repository.js';

const config: AppConfig = {
  environment: 'test',
  host: '127.0.0.1',
  port: 3000,
  logLevel: 'silent',
  corsOrigins: [],
  databaseUrl: 'postgresql://unused',
  databaseSsl: false,
  databaseSchema: 'dbo',
  jwtSecret: 'place-search-secret-with-at-least-32-characters',
  jwtIssuer: 'valryde-api-test',
  jwtAudience: 'valryde-test-clients',
  accessTokenTtlSeconds: 900,
  refreshTokenTtlDays: 30,
  authChallengeTtlMinutes: 30,
  authResendCooldownSeconds: 60,
  googleClientIds: [],
  email: { deliveryMode: 'disabled' },
};

function photonFeature(overrides: Record<string, unknown> = {}, coordinates = [123.905, 10.3181]) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates },
    properties: {
      osm_type: 'N',
      osm_id: 123456,
      name: 'Ayala Center Cebu',
      street: 'Cebu Business Park',
      city: 'Cebu City',
      state: 'Central Visayas',
      countrycode: 'PH',
      extent: [1, 2, 3, 4],
      ...overrides,
    },
  };
}

function fakeFetch(respond: () => Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: url instanceof Request ? url.url : url.toString(), init });
    return respond();
  }) as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('Photon geocoder adapter', () => {
  it('sends a Philippines-bounded biased query and normalizes to the five public fields', async () => {
    const fetch = fakeFetch(() =>
      json({
        features: [
          photonFeature(),
          photonFeature({ countrycode: 'ID', osm_id: 2 }),
          photonFeature({ osm_id: 3 }, [140.0, 35.0]),
          photonFeature({ osm_id: 4, name: undefined, street: undefined }),
          photonFeature({ osm_type: 'W', osm_id: 5, name: 'Colon Street', street: 'Colon Street' }),
        ],
      }),
    );
    const places = await new PhotonGeocoderService('https://photon.test/', fetch.impl).search(
      'ayala',
      { lat: 10.3, lng: 123.9 },
      5,
    );

    expect(places).toEqual([
      {
        id: 'osm:N:123456',
        name: 'Ayala Center Cebu',
        label: 'Ayala Center Cebu, Cebu Business Park, Cebu City, Central Visayas',
        lat: 10.3181,
        lng: 123.905,
      },
      {
        id: 'osm:W:5',
        name: 'Colon Street',
        label: 'Colon Street, Cebu City, Central Visayas',
        lat: 10.3181,
        lng: 123.905,
      },
    ]);
    const url = new URL(fetch.calls[0]?.url ?? '');
    expect(url.origin + url.pathname).toBe('https://photon.test/api');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: 'ayala',
      limit: '5',
      lat: '10.3',
      lon: '123.9',
      lang: 'en',
      bbox: '116,4,127,21.5',
    });
    expect(fetch.calls[0]?.init?.redirect).toBe('error');
  });

  it.each([
    ['non-2xx', () => json({ message: 'down' }, 502)],
    ['malformed JSON', () => Promise.resolve(new Response('<html>', { status: 200 }))],
    ['missing features', () => json({ type: 'FeatureCollection' })],
    ['network failure or timeout', () => Promise.reject(new DOMException('timed out', 'TimeoutError'))],
  ])('maps %s to 503 GEOCODER_UNAVAILABLE', async (_name, respond) => {
    const adapter = new PhotonGeocoderService('https://photon.test/', fakeFetch(respond).impl);
    await expect(adapter.search('cebu', { lat: 10.3, lng: 123.9 }, 5)).rejects.toMatchObject({
      statusCode: 503,
      code: 'GEOCODER_UNAVAILABLE',
    });
  });

  it('keeps the disabled adapter as a 503, never a fabricated result', async () => {
    await expect(new DisabledGeocoderService().search()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('geocoder configuration', () => {
  const base = { JWT_SECRET: 'x'.repeat(32), DATABASE_URL: 'postgresql://unused' };

  it('defaults to disabled', () => {
    expect(loadConfig(base).geocoder).toEqual({ provider: 'disabled' });
  });

  it('requires a credential-free https Photon URL in production', () => {
    expect(() => loadConfig({ ...base, GEOCODER_PROVIDER: 'photon' })).toThrow(/PHOTON_BASE_URL/);
    expect(() =>
      loadConfig({ ...base, NODE_ENV: 'production', GEOCODER_PROVIDER: 'photon', PHOTON_BASE_URL: 'http://p.test' }),
    ).toThrow(/https/);
    expect(() =>
      loadConfig({ ...base, GEOCODER_PROVIDER: 'photon', PHOTON_BASE_URL: 'https://u:p@p.test' }),
    ).toThrow(/credentials/);
    expect(loadConfig({ ...base, GEOCODER_PROVIDER: 'photon', PHOTON_BASE_URL: 'https://p.test' }).geocoder)
      .toEqual({ provider: 'photon', photonBaseUrl: 'https://p.test/' });
  });

  it('rejects unknown providers and non-PH country bias', () => {
    expect(() => loadConfig({ ...base, GEOCODER_PROVIDER: 'google' })).toThrow(/GEOCODER_PROVIDER/);
    expect(() => loadConfig({ ...base, GEOCODER_COUNTRY_BIAS: 'us' })).toThrow(/GEOCODER_COUNTRY_BIAS/);
  });
});

describe('GET /api/places/search', () => {
  class RecordingGeocoder implements GeocoderService {
    readonly calls: Array<{ query: string; bias: GeoPoint; limit: number }> = [];
    async search(query: string, bias: GeoPoint, limit: number): Promise<Place[]> {
      this.calls.push({ query, bias, limit });
      return [{ id: 'osm:N:1', name: 'Fuente Osmeña', label: 'Fuente Osmeña, Cebu City', lat: 10.31, lng: 123.89 }];
    }
  }

  let repository: MemoryIdentityRepository;
  let geocoder: RecordingGeocoder;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token: string;

  beforeEach(async () => {
    repository = new MemoryIdentityRepository();
    geocoder = new RecordingGeocoder();
    app = await buildApp({ config, repository, geocoderService: geocoder, logger: false });
    const user = await repository.createUser({
      email: 'commuter@example.com',
      passwordHash: 'unused',
      displayName: 'Commuter',
      role: 'COMMUTER',
      emailVerifiedAt: new Date(),
    });
    token = app.jwt.sign({ sub: user.id, roles: user.roles, ver: user.credentialsVersion, type: 'access' });
  });

  afterEach(async () => {
    await app.close();
  });

  const search = (url: string, auth = true) =>
    app.inject({ method: 'GET', url, headers: auth ? { authorization: `Bearer ${token}` } : {} });

  it('requires authentication', async () => {
    const response = await search('/api/places/search?q=fuente', false);
    expect(response.statusCode).toBe(401);
    expect(geocoder.calls).toHaveLength(0);
  });

  it('returns normalized places with attribution and applies the Cebu default bias', async () => {
    const response = await search('/api/places/search?q=%20fuente%20');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      places: [{ id: 'osm:N:1', name: 'Fuente Osmeña', label: 'Fuente Osmeña, Cebu City', lat: 10.31, lng: 123.89 }],
      attribution: '© OpenStreetMap contributors',
    });
    expect(geocoder.calls).toEqual([{ query: 'fuente', bias: { lat: 10.3157, lng: 123.8854 }, limit: 5 }]);
  });

  it.each([
    ['/api/places/search?q=a'],
    ['/api/places/search?q=%20a%20'],
    ['/api/places/search?q=cebu&lat=10.3'],
    ['/api/places/search?q=cebu&lat=35&lng=139'],
    ['/api/places/search?q=cebu&limit=11'],
  ])('rejects %s with 400 VALIDATION_ERROR', async (url) => {
    const response = await search(url);
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR');
    expect(geocoder.calls).toHaveLength(0);
  });

  it('returns 503 GEOCODER_UNAVAILABLE when the provider is disabled', async () => {
    await app.close();
    app = await buildApp({ config, repository, logger: false });
    const response = await search('/api/places/search?q=fuente');
    expect(response.statusCode).toBe(503);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('GEOCODER_UNAVAILABLE');
  });

  it('rate limits each user to 20 searches per minute', async () => {
    for (let i = 0; i < 20; i += 1) {
      expect((await search('/api/places/search?q=fuente')).statusCode).toBe(200);
    }
    const limited = await search('/api/places/search?q=fuente');
    expect(limited.statusCode).toBe(429);
    expect(limited.json<{ error: { code: string } }>().error.code).toBe('RATE_LIMITED');
  });

  it('logs location-query paths without their query string', () => {
    const base = { method: 'GET', hostname: 'api.test', ip: '127.0.0.1' };
    expect(requestLogSerializer({ ...base, url: '/api/places/search?q=home&lat=10.3&lng=123.9' }).url)
      .toBe('/api/places/search');
    expect(requestLogSerializer({ ...base, url: '/api/transit-routes/discover?lat=10.3&lng=123.9' }).url)
      .toBe('/api/transit-routes/discover');
    expect(requestLogSerializer({ ...base, url: '/api/transit-routes?q=colon' }).url)
      .toBe('/api/transit-routes?q=colon');
  });
});

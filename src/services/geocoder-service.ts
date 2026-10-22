import { ApiError } from '../lib/api-error.js';

export interface Place {
  id: string;
  name: string;
  label: string;
  lat: number;
  lng: number;
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Replaceable place-search adapter; the API never exposes a raw provider response. */
export interface GeocoderService {
  search(query: string, bias: GeoPoint, limit: number): Promise<Place[]>;
}

// Philippines envelope shared with the request validation (G6 proposal §2).
export const philippinesBounds = { minLat: 4.0, maxLat: 21.5, minLng: 116.0, maxLng: 127.0 } as const;
export const cebuCityCenter: GeoPoint = { lat: 10.3157, lng: 123.8854 };

export function insidePhilippines(lat: number, lng: number): boolean {
  return (
    lat >= philippinesBounds.minLat && lat <= philippinesBounds.maxLat &&
    lng >= philippinesBounds.minLng && lng <= philippinesBounds.maxLng
  );
}

function unavailable(): ApiError {
  return new ApiError(503, 'GEOCODER_UNAVAILABLE', 'Place search is temporarily unavailable');
}

export class DisabledGeocoderService implements GeocoderService {
  async search(): Promise<Place[]> {
    throw unavailable();
  }
}

interface PhotonFeature {
  geometry?: { type?: unknown; coordinates?: unknown };
  properties?: Record<string, unknown>;
}

export class PhotonGeocoderService implements GeocoderService {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 3000,
  ) {}

  async search(query: string, bias: GeoPoint, limit: number): Promise<Place[]> {
    const url = new URL('api', this.baseUrl);
    url.search = new URLSearchParams({
      q: query,
      limit: String(limit),
      lat: String(bias.lat),
      lon: String(bias.lng),
      lang: 'en',
      bbox: [
        philippinesBounds.minLng,
        philippinesBounds.minLat,
        philippinesBounds.maxLng,
        philippinesBounds.maxLat,
      ].join(','),
    }).toString();

    let body: unknown;
    try {
      const response = await this.fetchImpl(url, {
        headers: { accept: 'application/json', 'user-agent': 'Valryde-API/0.1' },
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) throw unavailable();
      body = await response.json();
    } catch {
      throw unavailable();
    }

    const features = (body as { features?: unknown } | null)?.features;
    if (!Array.isArray(features)) throw unavailable();
    return features
      .map((feature) => toPlace(feature as PhotonFeature))
      .filter((place): place is Place => place !== null)
      .slice(0, limit);
  }
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

// Copies only the five public fields; anything else the provider returns is discarded.
function toPlace(feature: PhotonFeature): Place | null {
  const props = feature.properties ?? {};
  const coordinates = feature.geometry?.coordinates;
  if (feature.geometry?.type !== 'Point' || !Array.isArray(coordinates)) return null;
  const [lng, lat] = coordinates as unknown[];
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !insidePhilippines(lat, lng)) return null;
  if (text(props.countrycode)?.toUpperCase() !== 'PH') return null;

  const osmType = text(props.osm_type);
  const osmId = props.osm_id;
  if (osmType === undefined || !/^[NWR]$/.test(osmType)) return null;
  if (typeof osmId !== 'number' || !Number.isSafeInteger(osmId)) return null;

  const street = [text(props.housenumber), text(props.street)].filter(Boolean).join(' ');
  const name = text(props.name) ?? text(street);
  if (name === undefined) return null;
  const label = [name, text(street), text(props.district), text(props.city), text(props.state)]
    .filter((part, index, parts): part is string => part !== undefined && parts.indexOf(part) === index)
    .join(', ');

  return { id: `osm:${osmType}:${osmId}`, name, label, lat, lng };
}

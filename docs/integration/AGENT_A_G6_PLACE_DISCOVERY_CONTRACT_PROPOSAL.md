# Agent A — G6 Place Search & Direct Transit Discovery: Contract Proposal

**Status:** PROPOSED — review only. Nothing here is implemented, and no client may build against it until Agent G approves.
**Checklist:** ID 37 (Agent C consumer), backend gap G6 · **Base:** `main` `827738c0f2c33ad3082f6a4a38a8e35669d4b0ea` · **Date:** 2026-10-22

## 1. Approved sources this proposal follows

- System documentation V1 §4.5, Appendix C.3, D.5, §14.3, failure case 25: Photon resolves places through a **replaceable Fastify adapter** with **Philippines/Cebu bias**, **rate limit and cache**. PostGIS ranks route directions near both the current point and the destination. **No multi-transfer planner**. If nothing matches, the UI says "No direct route found". If Photon fails, route code/name search still works.
- C.3 DTO: place candidates are normalized to `id/name/label/lat/lng`; the raw provider response is never exposed.
- Configuration names from the system doc: `GEOCODER_PROVIDER=photon`, `PHOTON_BASE_URL`, `GEOCODER_COUNTRY_BIAS=ph`.
- Agent C handoff: clients never call Photon directly.

## 2. Endpoints

The system doc uses `/places/search` and `/transits/discover`. The repository's established prefix is `/api/transit-routes`, so this proposal keeps `places/search` and uses `transit-routes/discover` (**decision G6-D1**). The static path takes precedence over `/transit-routes/:routeId` in Fastify.

### 2.1 `GET /api/places/search`

| Query | Rule |
|---|---|
| `q` | required; trimmed; 2–120 characters |
| `lat`, `lng` | optional; both or neither; inside the Philippines envelope (lat 4.0–21.5, lng 116.0–127.0). Used only as provider location bias; the Cebu City default (10.3157, 123.8854) applies when absent |
| `limit` | optional integer 1–10, default 5 |

`200`:

```json
{
  "places": [
    { "id": "osm:N:123456", "name": "Ayala Center Cebu", "label": "Ayala Center Cebu, Cebu Business Park, Cebu City, Central Visayas", "lat": 10.3181, "lng": 123.9050 }
  ],
  "attribution": "© OpenStreetMap contributors"
}
```

- `id` = `osm:{osm_type}:{osm_id}`; it is stable while OSM keeps the object, and clients treat it as opaque.
- Results whose `countrycode` is not `PH` are dropped server-side. Only the five fields are copied from the provider; everything else is discarded.
- An empty `places` array is a normal `200`.

### 2.2 `GET /api/transit-routes/discover`

| Query | Rule |
|---|---|
| `lat`, `lng` | required origin (current location or chosen origin); Philippines envelope |
| `destinationLat`, `destinationLng` | required; Philippines envelope |
| `maxWalkM` | optional integer 50–1000, default 500 (**decision G6-D3**) |
| `limit` | optional integer 1–10, default 5 |

`200`:

```json
{
  "candidates": [
    {
      "route": { "id": "uuid", "routeCode": "04C", "publicName": "Lahug – Carbon", "routeColorHex": "#1F77B4" },
      "direction": { "id": "uuid", "directionLabel": "Northbound", "originName": "Carbon", "destinationName": "Lahug" },
      "originDistanceM": 120,
      "destinationDistanceM": 340
    }
  ],
  "directRouteFound": true
}
```

Geometry is not repeated here; clients load it through the existing `GET /api/transit-routes/:routeId`.

**Matching rule (PostGIS, single query, no migration):**

1. Only `transit_routes.status = 'ACTIVE'` and `route_directions.status = 'ACTIVE'`, the same visibility as the public route list.
2. The origin and the destination are each within `maxWalkM` of the direction's LineString (`ST_DWithin` on `geography`, with a `geometry` bounding-box prefilter so the existing GiST index is used).
3. **Travel order:** `ST_LineLocatePoint(geometry, origin) < ST_LineLocatePoint(geometry, destination)`. This excludes the opposite direction of the same route.
4. Order by `originDistanceM + destinationDistanceM`, then `routeCode`, then `directionLabel`; then apply `limit`.
5. No candidate → `200 { "candidates": [], "directRouteFound": false }`.

Known limit: for loop or self-overlapping LineStrings, `ST_LineLocatePoint` uses the nearest point and can misjudge order. This is acceptable for MVP data; Admin route geometry is expected to be one-way per direction.

## 3. Access, abuse and privacy

| Concern | Proposal |
|---|---|
| Who may call | **Decision G6-D2.** Recommended: discovery is public like `GET /api/transit-routes`; place search requires any authenticated role, because each call spends third-party provider capacity. |
| Rate limit | Place search: 20/minute per user. Discovery: 30/minute per IP. Both use the existing `@fastify/rate-limit` `RATE_LIMITED` response. |
| Cache | In-memory LRU, 500 entries, 10-minute TTL, keyed on normalized `q` + bias cell (lat/lng rounded to 2 decimals) + limit. Only if the provider's terms permit caching (**G6-D4**). |
| Logging | Fastify's default request log records the full URL, which would put `q` and coordinates in the logs. Both routes must log only the path (custom `req` serializer that strips the query string). Provider errors log status and latency only. |
| Data stored | Nothing. Queries and coordinates are not persisted or written to `audit_logs`. |
| Provider call | Server-side `fetch` to `{PHOTON_BASE_URL}/api?q=…&limit=…&lat=…&lon=…&lang=en`, 3-second timeout, `redirect: 'error'`, no retry on the request path, and a `User-Agent` that identifies VALRYDE. |
| Attribution | OSM data is ODbL; the response carries `attribution` and clients must display it. |

## 4. Errors

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Schema or envelope violations; only one of `lat`/`lng` given |
| 401 | `AUTH_REQUIRED` | Place search without a session (if G6-D2 is accepted) |
| 429 | `RATE_LIMITED` | Rate limit hit |
| 503 | `GEOCODER_UNAVAILABLE` (**new code, decision G6-D5**) | Provider disabled, timed out, returned non-2xx or invalid JSON. Discovery and route search are unaffected (failure case 25). |

## 5. Configuration

| Variable | Default | Rule |
|---|---|---|
| `GEOCODER_PROVIDER` | `disabled` | `disabled` or `photon`. When `disabled`, place search returns `503 GEOCODER_UNAVAILABLE`. |
| `PHOTON_BASE_URL` | — | Required when `photon`; `https:` in production; no credentials in the URL (same rule as G5). |
| `GEOCODER_COUNTRY_BIAS` | `ph` | Only `ph` is accepted in MVP. |

The adapter is an interface (`GeocoderService.search(query, bias, limit) → Place[]`), so a self-hosted Photon or another provider can replace it without changing the API.

## 6. Tests and fixtures (when approved)

- **Unit, no network:** the Photon adapter with an injected `fetch` covering normalization, the non-PH filter, the timeout → 503, non-2xx → 503, malformed JSON → 503, cache hit/expiry, and the five-field allowlist (unknown provider fields are not passed through).
- **Route tests (`inject`):** validation boundaries, the lone-`lat` rejection, the 401 for place search, the 429, and that log output for these paths contains no query string.
- **PostgreSQL/PostGIS (disposable database only):** create one ACTIVE route with forward and reverse directions through Cebu sample points, one DRAFT route on the same street, and one ACTIVE route passing only the origin. Assert:
  - only the forward direction matches;
  - the reverse direction is excluded by travel order;
  - the DRAFT route is excluded;
  - the origin-only route is excluded;
  - the `maxWalkM` boundary is respected;
  - an empty result returns `directRouteFound: false`.

  All created rows are removed by id.
- **CI never calls the public Photon service.**

## 7. Decisions required from Agent G / owner

| ID | Decision | Recommendation |
|---|---|---|
| G6-D1 | Paths `/api/places/search` and `/api/transit-routes/discover` vs the doc's `/transits/discover` | Use the repository prefix as proposed |
| G6-D2 | Access: public vs authenticated for each endpoint | Place search authenticated; discovery public |
| G6-D3 | Walking radius default/max | 500 m / 1000 m |
| G6-D4 | Provider for each environment: the public `photon.komoot.io` demo service only for local demo, under its fair-use terms; owner confirms terms, caching permission and the preview/production provider (self-hosted or paid) | Owner decision; default `disabled` until confirmed |
| G6-D5 | New error code `GEOCODER_UNAVAILABLE` (503) | Accept |
| G6-D6 | Primary module ownership: the frontend handoff lists the backend owner of G6 as unassigned | Assign to Agent A |

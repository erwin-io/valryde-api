# Agent B initial REST integration — IDs 12, 14, 17, 18

This slice supplies server-side composition primitives, not public HTTP endpoints. The Fastify startup path is unchanged and does not require Traccar settings. Import `loadTraccarConfig`, `TraccarClient`, `PgTrackingMappingRepository` and `TrackingHistoryService` from `src/tracking/` in trusted server composition. Inject Agent A's existing `FleetService` and application database pool into the history service.

## Baseline and boundaries

Baseline: accepted Agent A PR #1, merge `711f4c45967e192be155e05e72714b99645ecc7d`. Existing auth, fleet, route, GPS workflow, migrations 001–005, TypeScript/Fastify/Vitest and `pg` remain authoritative. Node 22 built-in fetch supplies connectivity; no additional npm dependency is required.

The approved complete Version 1.0 DOCX and standalone checklist were not found in the workspace. The repository B/G handoffs contain the assigned checklist definitions and locked architecture. Obtain the complete references from the owner for later integration review.

No Agent B bridge/state implementation existed at baseline. This first focused slice deliberately has no migration, public route/DTO, Pusher contract, latest-state storage, socket ownership or compliance implementation. Those follow in separately reviewed phases. `TransitService.resolveEffectiveRouteDirection()` remains the sole route-precedence authority for bridge processing; no route logic is duplicated here. History authorization does not depend on having a resolvable route.

## Provider contract and recovery

Based on the official [Traccar API authentication documentation](https://www.traccar.org/traccar-api/) and [OpenAPI specification](https://raw.githubusercontent.com/traccar/traccar/master/openapi.yaml), inspected 2026-10-19 (upstream version 6.16.0; installed host version unverified):

- `POST /api/session`: URL-encoded email/password; capture only the `JSESSIONID` cookie in private process memory.
- `GET /api/devices`: all service-visible devices or filtered by uniqueId.
- `GET /api/positions`: latest positions; with deviceId/from/to, historical positions.
- `GET /api/reports/events`: native device events for deviceId/from/to, requesting JSON.

Session login is shared across concurrent calls. A 401 invalidates only the cookie used by that request and allows one session refresh per logical read. Transient network errors, timeout, 429 and 5xx use bounded exponential delay with jitter. Login and GET each have their own retry budget (default two retries); budgets do not nest. A refreshed GET has a fresh retry budget. Authentication, forbidden, missing, other request failures and invalid payloads are classified separately. Provider errors expose no raw response, credential, URL or network cause. Redirects are rejected.

The timeout covers fetch and body decoding. Requests are bounded by retries and timeout; this is not a streaming/paginated history implementation. Maximum history request span is 30 days as an internal request-size guard; Traccar retention remains an operational policy. Empty results indicate no eligible mapping, no provider device or no history. Authentication/service failures remain errors, never fabricated empty history.

## Mapping, authorization and privacy

Mapping follows the existing uniqueId contract: active jeepney → approved application → installed/verified GPS request → active GPS device → mapped Traccar uniqueId → provider numeric device ID. Numeric IDs are resolved for each read and never persisted as a competing mapping.

`TrackingHistoryService` requires an active ADMIN, OPERATOR or DRIVER, then uses `FleetService.listJeepneys()` to check visibility before any mapping/provider access. This preserves Agent A's fleet scoping and multi-group behavior. COMMUTER cannot retrieve private history/events. The approved auth plugin must still establish the actor when HTTP integration is added.

Returned records allowlist jeepney/location/timestamps/speed in km/h/heading or native event source/type/time. They exclude credentials, internal provider IDs, uniqueId, attributes, driver and operator details. Wrong-device or ambiguous provider results fail closed. Invalid fixes and results outside the requested interval are omitted. Native events are marked `source: TRACCAR`, distinct from later Valryde-owned compliance events.

For this initial slice only currently active, installed and verified mappings are eligible. Remapping/retired-device history needs an explicit temporal mapping contract before historical devices can be supported. No complete raw-history table is added.

## Verification and follow-up

Deterministic fetch mocks cover connectivity/session reuse/expiry, retry/error handling, decoding, range validation and server-only configuration. Service mocks cover authorization before provider access, mapping gaps, normalization, privacy and wrong-device rejection. Database integration verifies eligibility gates against real SQL in a rolled-back fixture.

Next: Tech Lead review of this foundation, then a separate persistent bridge slice with trusted shared effective-route resolution, concurrency-safe latest state, deterministic PostGIS compliance and approved realtime contracts. Real host version/configuration, session compatibility, service-account permissions, TLS, GPS and Pusher operation need owner/operator evidence; none is claimed by mock tests.

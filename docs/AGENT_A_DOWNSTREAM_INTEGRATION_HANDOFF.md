# VALRYDE — Agent A downstream integration handoff

**Accepted scope:** Checklist IDs 1–11

**Canonical merge:** PR [#1](https://github.com/erwin-io/valryde-api/pull/1), merge SHA `711f4c45967e192be155e05e72714b99645ecc7d`

**API base path:** `/api`

**Interactive contract:** `/documentation`; machine-readable OpenAPI: `/documentation/json`

This document summarizes the accepted contracts consumed by Agents B–E. The TypeBox route schemas,
OpenAPI output, SQL migrations, and merged source on `main` remain authoritative.

## Authentication and errors

- Self-registration roles: `COMMUTER`, `DRIVER`, `OPERATOR`. `ADMIN` is internal and created through
  the approved bootstrap command.
- Email/password authentication requires verified email. Passwords use Argon2id.
- Google sign-in verifies a server-side ID token against configured `GOOGLE_CLIENT_IDS`, then links or
  creates the local Valryde identity. Production client IDs remain owner-supplied.
- Access tokens are bearer JWTs containing the user ID, roles, credential version, and access-token type.
  Protected requests re-read the active user and reject disabled, unverified, or credential-version-stale
  sessions.
- Refresh tokens are opaque, stored hashed, rotated on refresh, and revoked on logout. Verification,
  recovery, and email-change tokens are hashed, expiring, single-use, and superseded on resend.
- Public resend/recovery operations are enumeration-resistant and rate limited.
- Errors use `{ "error": { "code", "message", "requestId", "details"? } }`.

Authentication/profile endpoints include registration, verification/resend, login, Google sign-in,
refresh, logout, password recovery/reset, `GET/PATCH /auth/me`, password/email change, and Admin user
status management. See `docs/OPENAPI_ENDPOINT_TAGS.md` for the complete endpoint/operation ID map.

## RBAC and ownership

- `COMMUTER`: public-safe transit data and own account only.
- `DRIVER`: own-created permitted draft vehicle, active driver assignment, and explicitly permitted
  fleet-group resources. Multiple matching group paths authorize by existence; they do not cause denial.
- `OPERATOR`: only its own drivers, jeepneys, groups, applications, GPS requests, and assignments.
- `ADMIN`: platform-wide monitoring and canonical route, user-status, approval, device-mapping, and
  installation-verification mutations.
- Driver association is initiated by an Operator using a verified DRIVER email. Cross-Operator claims
  are rejected. Clients must never infer ownership from a client-supplied identifier.

## Database and migration dependencies

- PostgreSQL 16-compatible server with `citext`, `pgcrypto`, and PostGIS available.
- Application tables are in `dbo`; runtime search path is `dbo,public`. Extensions and PostGIS
  functions/types remain available through `public`.
- Apply migrations in filename order:
  1. `001_identity_and_access.sql`
  2. `002_transit_postgis_foundation.sql`
  3. `003_fleet_groups_and_assignments.sql`
  4. `004_transit_route_assignments.sql`
  5. `005_vehicle_application_and_gps_workflow.sql`
- Business tables include identity/session/challenge/audit records, Operators/Drivers, jeepneys,
  groups/memberships, driver and route assignments, routes/directions, vehicle applications, GPS setup
  requests/devices, and Traccar device mappings.
- Route geometry is `geometry(LineString,4326)` with a GiST index. GeoJSON coordinate order is
  longitude, latitude.
- Do not apply these migrations to the Traccar database. Traccar remains authoritative for raw device
  telemetry and position history.

## Transit route and pagination contracts

`GET /transit-routes?q=&page=&pageSize=` is public and returns only active routes/directions:

```json
{
  "routes": [],
  "pagination": { "page": 1, "pageSize": 20, "total": 0, "totalPages": 0 }
}
```

`page` defaults to `1`; `pageSize` defaults to `20` and is capped at `100`. Search covers route code,
public name, description, origin, and destination. `GET /transit-routes/{routeId}` returns one active
route with active directions.

Core DTOs:

- `TransitRoute`: `id`, `routeCode`, `publicName`, nullable `description`, `routeColorHex`, `status`,
  timestamps, and `directions` on public read envelopes.
- `RouteDirection`: `id`, `routeId`, `directionLabel`, `originName`, `destinationName`, GeoJSON
  `LineString` geometry, integer `corridorM`, `status`, and timestamps.
- Route/direction lifecycle: `DRAFT`, `ACTIVE`, `INACTIVE`, `ARCHIVED`.
- Canonical route metadata, color, direction geometry, and corridor are Admin-owned. Operators may assign
  only active route directions; consumers must not mutate or replace canonical geometry locally.

## Frozen effective-route contract

Consumers must call `GET /jeepneys/{jeepneyId}/effective-route` or, inside this service,
`TransitService.resolveEffectiveRouteDirection(jeepneyId)`. Do not reimplement precedence.

1. If an active direct jeepney assignment exists, it is the effective route and overrides every group
   assignment.
2. Otherwise resolve active assignments inherited through fleet-group membership:
   - zero inherited assignments: `effectiveRouteDirection` is `null`;
   - exactly one: return it with `source: "GROUP"`;
   - more than one: return `409 ROUTE_ASSIGNMENT_CONFLICT`.
3. New ambiguity is rejected transactionally when assigning a route to a group or adding a jeepney to
   an already-routed group.

The non-null response contains `source` (`DIRECT` or `GROUP`), `assignmentId`, nullable `groupId`,
`activeFrom`, and the complete `RouteDirection` as `direction`.

Agent B must resolve this contract before route-compliance evaluation. A missing effective route means
there is no active selected route direction and the vehicle is not commuter-available.

## Vehicle application and GPS workflow

- Vehicle application states: `PENDING`, `APPROVED`, `REJECTED`.
- GPS setup states and permitted forward transitions:
  `PENDING → APPROVED → SCHEDULED → INSTALLED`; rejection is allowed from `PENDING`, `APPROVED`, or
  `SCHEDULED`. `scheduledAt` is required for `SCHEDULED`; `rejectedReason` is required for rejection.
- Verification states: `NOT_STARTED`, `PENDING`, `VERIFIED`, `FAILED`.
- A GPS request requires an approved vehicle application.
- Device mapping is Admin-only and uniquely binds IMEI, serial number, Traccar `uniqueId`, GPS request,
  and jeepney. Mapping conflicts return `DEVICE_MAPPING_CONFLICT`.
- Installation verification requires `INSTALLED`, an existing mapping, and explicit power/SIM/server/GPS
  checks. A jeepney becomes `ACTIVE` only when all checks pass.
- Physical tracker connectivity, real Traccar mapping, and real GPS-fix evidence remain operator-gated;
  clients must not fake activation.

## Downstream integration requirements

- **Agent B:** consume the effective-route resolver and `traccar_device_mappings`; keep raw Traccar
  history in Traccar, add only the approved latest-state/compliance layer, and preserve the frozen
  100 m / 30-second-or-3-fix / 2-fix re-entry rules.
- **Agent C:** use public paginated route/detail endpoints and canonical GeoJSON/color. Public tracking
  must exclude private Driver/Operator information and later apply Agent B availability rules.
- **Agent D:** use verified authentication, server-enforced Driver/Operator scope, driver association,
  fleet/assignment endpoints, effective-route reads, and application/GPS request states. Do not infer
  scope client-side.
- **Agent E:** use ADMIN endpoints for users, canonical routes/directions, application review, GPS state
  transitions, mapping, and verification. Preserve state ordering and display machine-readable API errors.
- All clients should generate or validate contracts against the merged OpenAPI document and perform REST
  reconciliation after future realtime updates.

## Remaining owner/operator gates

- Production SMTP provider credentials, verified sender/from-domain, and production link origins.
- Approved production Google OAuth client IDs and a real ID-token smoke test.
- Owner-supplied permanent Admin credentials.
- Physical GPS tracker installation, SIM/APN, Traccar connectivity, uniqueId mapping, GPS fix, and
  activation evidence.

These gates do not invalidate the accepted Agent A source implementation, but they remain required before
production or physical-device acceptance.

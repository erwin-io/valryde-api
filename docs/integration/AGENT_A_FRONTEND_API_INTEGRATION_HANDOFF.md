# Agent A frontend API integration handoff — Agents C, D and E

**Audited backend:** `main` at `711f4c45967e192be155e05e72714b99645ecc7d` (PR [#1](https://github.com/erwin-io/valryde-api/pull/1) merge). Verified again on 2026-10-21.
**Owner:** Agent A — Core Platform / Fastify API (checklist IDs 1–11).
**Status:** audit of merged contracts only. This document does not add, change or approve any endpoint.

Companion files in this folder:

| File | Purpose |
|---|---|
| [AGENT_A_FRONTEND_ENDPOINT_MATRIX.md](AGENT_A_FRONTEND_ENDPOINT_MATRIX.md) | Every one of the 44 business operations: method/path, consumer, route guard, request fields, declared statuses, source line. |
| [AGENT_A_FRONTEND_ENDPOINT_INDEX.json](AGENT_A_FRONTEND_ENDPOINT_INDEX.json) | Same inventory, machine-readable. |
| [AGENT_A_OPENAPI_AUDIT.json](AGENT_A_OPENAPI_AUDIT.json) | Exact OpenAPI 3.0.3 snapshot of `/documentation/json` at the audited SHA. Server is `/api`; paths are unprefixed. Use it for typed client generation or contract tests. |
| [AGENT_A_OFFLINE_AUDIT_RESULTS.json](AGENT_A_OFFLINE_AUDIT_RESULTS.json) | Fastify `inject()` probe results (no database, no listener). |

Related accepted context: `docs/AGENT_A_DOWNSTREAM_INTEGRATION_HANDOFF.md` (PR [#2](https://github.com/erwin-io/valryde-api/pull/2), accepted, not yet merged) holds the frozen effective-route, RBAC and GPS-workflow rules. This handoff does not restate them beyond what a client needs.

## 1. Rules every client must follow

1. **Base URL is configurable origin + `/api`.** Never hard-code `localhost`, `10.0.2.2` or a LAN IP inside services. Swagger UI is `/documentation`, the spec is `/documentation/json` (outside `/api`).
2. **The server is the only authority** for roles, ownership, effective route, approval eligibility and tracking state. Client guards are UX only.
3. **Error envelope:** `{ "error": { "code", "message", "requestId", "details"? } }`. Branch on `code`, never on `message`. Show `requestId` in support/diagnostic UI.
4. **No endpoint, no feature.** Missing capabilities in §5 stay blocked/hidden. Do not synthesize them from other calls unless §4 says "requires composition".
5. **After a mutation, re-read** the list endpoint before showing durable success. There are no detail `GET`s for fleet, application or GPS records (§5).
6. **Collections other than `GET /transit-routes` are unpaginated, unfiltered and unsorted by contract** (current SQL orders by `created_at DESC`; do not rely on it). Filter/search client-side and expect full payloads.

### 1.1 Session lifecycle

| Step | Call | Notes |
|---|---|---|
| Sign in | `POST /api/auth/login` or `POST /api/auth/google` | Returns `accessToken`, `refreshToken`, `accessTokenExpiresIn` (seconds, default 900), `refreshTokenExpiresAt`, `user`. Login requires a verified email (`403 EMAIL_NOT_VERIFIED`). |
| Authorize requests | `Authorization: Bearer <accessToken>` | No cookies; CORS `credentials` is `false`. |
| Restore session | `POST /api/auth/refresh` then `GET /api/auth/me` | Refresh **rotates**: the old refresh token is revoked. Serialize refresh across concurrent requests; a reused/revoked token returns `401 SESSION_REVOKED`, which means "sign out locally". |
| Role context | `user.roles[]` | Users may hold more than one role. Admin web must reject sign-in client-side when `ADMIN` is absent (server still enforces). |
| Sign out | `POST /api/auth/logout` `{refreshToken}` | Revokes that one refresh session only (current device). Clear local tokens regardless of network result. |
| Password change | `POST /api/auth/me/change-password` | Bumps credential version: existing access tokens become invalid. Re-authenticate after `204`. |
| Disabled / unverified user | any protected call | Server re-reads the user each request and rejects disabled, unverified or stale-credential sessions. |

Storage: mobile apps (C, D) must keep the refresh token in OS-backed secure storage, not `localStorage`. The storage plugin choice is the client owner's; the API has no requirement beyond "bearer token in header".

Email links: verification, password-reset and email-change emails link to `APP_VERIFICATION_URL`, `APP_PASSWORD_RESET_URL`, `APP_EMAIL_CHANGE_URL` with a `token`. The client page posts that token to the matching `/api/auth/...` endpoint. Locally these default to the Angular dev origin `http://localhost:4200`; deep links into the mobile apps are not configured (§5, item G5).

### 1.2 Error codes clients must handle

| HTTP | `code` | Meaning for the UI |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Field-level problem; `details` holds AJV errors. |
| 401 | `AUTH_REQUIRED` | Missing/invalid/expired access token → refresh once, then sign in. |
| 401 | `SESSION_REVOKED` | Refresh token dead → sign out locally. |
| 401 | `INVALID_CREDENTIALS` | Wrong email/password (generic by design). |
| 400 | `INVALID_CHALLENGE` | Expired/used verification, reset or email-change token. |
| 403 | `EMAIL_NOT_VERIFIED` | Offer resend-verification. |
| 403 | `FORBIDDEN` | Role or ownership denied. Do not retry. |
| 404 | `NOT_FOUND` | Missing **or** not visible to this user. |
| 409 | `CONFLICT` | Generic state conflict (duplicate plate, route code, wrong state). |
| 409 | `DRIVER_NOT_READY` / `DRIVER_ALREADY_ASSOCIATED` | Driver association rejected. |
| 409 | `ROUTE_NOT_APPROVED` | Direction is not `ACTIVE`. |
| 409 | `ROUTE_ASSIGNMENT_CONFLICT` | More than one inherited group route (see effective route). |
| 409 | `VEHICLE_NOT_APPROVED` / `GPS_NOT_INSTALLED` / `DEVICE_MAPPING_CONFLICT` | GPS workflow ordering. |
| 503 | `GOOGLE_SIGN_IN_UNAVAILABLE` / `EMAIL_DELIVERY_UNAVAILABLE` | Provider not configured or down. Show "try later". |
| 500 | `INTERNAL_ERROR` | Unexpected. **Also currently returned for rate limits and malformed JSON — see defect D1.** |

`STALE_POSITION` and `TRACCAR_UNAVAILABLE` are named in the Agent A handoff but are **not emitted** by merged code; they belong to Agent B's future contracts.

### 1.3 Rate limits (per client IP)

Global 100 req/min. Auth overrides: register 10/min, resend-verification 5/15 min, login 10/min, Google 10/min, refresh 30/min, forgot-password 5/15 min. Responses include `retry-after`. Because of defect D1 the status is `500 INTERNAL_ERROR`, not `429`; until fixed, treat a `500` that carries a `retry-after` header as "rate limited".

### 1.4 Effective route (frozen — do not re-implement)

Call `GET /api/jeepneys/{jeepneyId}/effective-route`.
- `200 { effectiveRouteDirection: null }` → no active route; vehicle is not commuter-available. Show "No route assigned".
- `200` non-null → `source` is `DIRECT` or `GROUP`; render `direction` (GeoJSON `LineString`, `[longitude, latitude]`).
- `409 ROUTE_ASSIGNMENT_CONFLICT` → misconfiguration (multiple group routes, no direct). Operator UX: prompt to set a direct assignment. Driver UX: "Route unavailable, contact operator".

Precedence: direct active assignment wins → zero inherited = none → exactly one inherited group route → multiple inherited = conflict. Assigning a route (`POST /api/route-assignments`) **replaces** any active assignment for that same jeepney or group; there is no separate "unassign".

## 2. Verified backend defects that affect clients

| ID | Defect | Evidence | Client impact | Proposed fix (not applied) |
|---|---|---|---|---|
| D1 | Global error handler maps every non-`ApiError`, non-validation error to `500 INTERNAL_ERROR`. Rate-limit rejections (should be `429`) and malformed JSON bodies (should be `400`) are returned as `500`. | `src/app.ts:123-152`. Offline inject on 2026-10-21: 11th login in a minute → `500 INTERNAL_ERROR`, `retry-after: 60`; body `{bad` → `500 INTERNAL_ERROR`. Codex probe in `AGENT_A_OFFLINE_AUDIT_RESULTS.json` shows the same. | Clients cannot distinguish throttling or client bugs from server failure; error telemetry is polluted. | In the handler, pass through Fastify errors with `statusCode < 500` using a mapped code (`429` → new `RATE_LIMITED`, `400` → `VALIDATION_ERROR`). Adding `RATE_LIMITED` is an error-code contract addition → needs Tech Lead approval. Small fix + inject test. |
| D2 | Default `CORS_ORIGINS` (`http://localhost:4200,http://localhost:8100`) does not include Capacitor WebView origins. | Inject preflight 2026-10-21: `http://localhost`, `https://localhost`, `capacitor://localhost` get no `access-control-allow-origin`. Agent D's `capacitor.config.ts` sets `androidScheme: 'https'` → origin `https://localhost`. | Native Android builds of C and D fail every API call with a CORS error even when the network path works. | Configuration only: add `https://localhost` (and `http://localhost` if a client uses the `http` scheme) to the developer's `.env` `CORS_ORIGINS`. Updating `.env.example` is a one-line doc/config PR. No code change. |

## 3. Development connectivity

### 3.1 Start the API locally

Prerequisites: Node.js ≥ 22.12, PostgreSQL 16 with `postgis`, `citext`, `pgcrypto` available, and Mailpit for email (`compose.mailpit.yaml`, SMTP `127.0.0.1:1025`, UI `http://127.0.0.1:8025`).

```bash
cp .env.example .env
```

Edit `.env` locally only: set `DATABASE_URL` to your own PostgreSQL user/database and a random `JWT_SECRET` (≥ 32 chars). Never commit `.env`.

```bash
npm ci
```

```bash
npm run db:migrate
```

```bash
npm run dev
```

Check `http://127.0.0.1:3000/api/health` → `{"status":"ok","database":"ok"}` and `http://127.0.0.1:3000/documentation`.

Migrations `001`–`005` apply to the Valryde application database only (`dbo` schema, search path `dbo,public`). Never point them at the Traccar database.

### 3.2 Test accounts

There are no shared or seeded accounts, and none must be committed.
- Commuter / Driver / Operator: self-register through `POST /api/auth/register`, then open the verification email in Mailpit and post the token to `/api/auth/verify-email`.
- Operator → Driver link: the Operator calls `POST /api/driver-associations` with the verified Driver's email. Keep the returned `driverId`; there is no endpoint to list it again (gap G1).
- Admin: run `npm run admin:bootstrap` with `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_DISPLAY_NAME`, `ADMIN_BOOTSTRAP_PASSWORD` and `ADMIN_BOOTSTRAP_CONFIRM=CREATE_FIRST_ADMIN` set as **temporary shell variables** (never in `.env`). Only the first Admin can be created this way; the permanent Admin is owner-supplied.
- Google sign-in requires owner-supplied `GOOGLE_CLIENT_IDS`; without it the endpoint returns `503 GOOGLE_SIGN_IN_UNAVAILABLE`.
- Postman: `postman/Valryde-Agent-A.postman_collection.json` with the blank-valued local environment; `npm run postman:smoke` runs the safe, credential-free folder.

### 3.3 Reaching the API from each client

The API binds to `HOST=127.0.0.1` by default: reachable only from this computer.

| Client runtime | API origin to configure in the client | Backend requirement |
|---|---|---|
| Angular in browser (E, and C/D in `ng serve`) | Use a dev proxy: `/api` → `http://localhost:3000` (Agent E already has `proxy.conf.json`). Same-origin, so CORS does not apply. | None. |
| Angular in browser without proxy | `http://localhost:3000` | Page origin (e.g. `http://localhost:4200`, `http://localhost:8100`) must be in `CORS_ORIGINS`. Already in the defaults. |
| Android emulator (Capacitor build) | `http://10.0.2.2:3000` | `10.0.2.2` maps to the host's loopback, so `HOST=127.0.0.1` works. Add the WebView origin (`https://localhost` for `androidScheme: 'https'`) to `CORS_ORIGINS` (D2). Android blocks cleartext HTTP by default: the client must allow cleartext for the dev host in its debug network-security config, or use `adb reverse tcp:3000 tcp:3000` and `http://localhost:3000`. |
| Physical Android device over USB | `http://localhost:3000` after `adb reverse tcp:3000 tcp:3000` | Same CORS/cleartext notes. No firewall or binding change needed. **Recommended for devices.** |
| Physical Android device over Wi-Fi/LAN | `http://<host-LAN-IP>:3000` | Requires `HOST=0.0.0.0` (or the LAN IP) and an inbound firewall rule. **This exposes the API to the local network and needs owner authorization.** Not performed by Agent A. |

A relative `apiBaseUrl: '/api'` (Agent D's current `environment.ts`) works only behind the browser dev proxy. Inside a Capacitor WebView it resolves to the WebView's own origin, so native builds need an absolute API origin per environment.

### 3.4 Troubleshooting

| Symptom | Likely cause |
|---|---|
| Browser console "blocked by CORS policy", no response status | Page origin not in `CORS_ORIGINS` (restart API after editing `.env`). |
| `net::ERR_CONNECTION_REFUSED` from emulator/device | Using `localhost` without `adb reverse`, or API bound to `127.0.0.1` while using a LAN IP. |
| `net::ERR_CLEARTEXT_NOT_PERMITTED` | Android cleartext policy in the client; not an API issue. |
| `/api/health` → `503 degraded` | PostgreSQL unreachable or wrong `DATABASE_URL`. |
| `500 INTERNAL_ERROR` with `retry-after` header | Rate limited (D1). Wait, do not retry in a loop. |
| `403 EMAIL_NOT_VERIFIED` on login | Verify via Mailpit first. |
| Every protected call `401` right after password change | Expected: credential version changed. |

## 4. Integration matrix per frontend

Classification (as instructed by the Tech Lead):
1 = available in merged `main` · 2 = available but requires frontend composition · 3 = implemented in an unmerged PR · 4 = approved MVP requirement missing an implementation · 5 = Agent B-owned tracking dependency · 6 = new or unsupported proposed functionality.

### 4.1 Agent C — Commuter Mobile (IDs 22–37)

| Capability | Endpoint(s) | Class | Notes |
|---|---|---|---|
| Register / verify / resend / login / refresh / logout / recovery / profile / email & password change | `/api/auth/*` (14 ops) | 1 | `role: "COMMUTER"`. Google gated on owner client ID. |
| Route list, search, pagination | `GET /api/transit-routes?q&page&pageSize` | 1 | Only `ACTIVE` routes/directions. `pageSize` ≤ 100. |
| Route detail with direction geometry and color | `GET /api/transit-routes/{routeId}` | 1 | GeoJSON `[lon, lat]`. |
| Draw route on MapLibre | route detail + client rendering | 2 | Convert `direction.geometry` to a GeoJSON source; use `routeColorHex`. |
| Live jeepneys on route, availability, counts, vehicle snapshot | — | 5 | Agent B (latest state, compliance, Pusher). No client stub data. |
| Pusher channel auth / events | — | 5 | Agent B + Tech Lead contract pending. |
| Place / destination search (ID 37) | — | 4 | Approved: Fastify-side replaceable geocoding adapter (Photon). Not implemented. Backend owner not yet assigned (G6). |
| Direct transit discovery near origin/destination (ID 37) | — | 4 | Approved: direct routes only. Needs PostGIS proximity query over route directions. Not implemented (G6). |
| Favorite routes | — | 6 | No approved backend contract; keep device-local or escalate. |
| Stops, fares, ETA, schedules, multi-transfer journeys, share links | — | 6 | Outside MVP. |

### 4.2 Agent D — Driver/Operator Mobile (IDs 38–55)

| Capability | Endpoint(s) | Class | Notes |
|---|---|---|---|
| Auth / session / profile | `/api/auth/*` | 1 | `role: "DRIVER"` or `"OPERATOR"`. |
| Driver: my jeepney(s) | `GET /api/jeepneys` | 2 | Returns every jeepney the Driver may see: created drafts, active assignment, and jeepneys in the Driver's groups. The response has **no field saying which one is the Driver's active assignment** (G3). |
| Driver: my groups | `GET /api/fleet-groups` | 1 | Groups the Driver belongs to. |
| Driver: groupmates / group members | — | 4 | ID 7 ("drivers only see permitted groupmates"). No membership read endpoint (G2). |
| Driver/Operator: effective route | `GET /api/jeepneys/{id}/effective-route` | 1 | §1.4. |
| Route browse/detail | `GET /api/transit-routes[/{id}]` | 1 | |
| Operator: list/create/update own jeepneys | `GET/POST /api/jeepneys`, `PATCH /api/jeepneys/{id}` | 1 | Non-Admin cannot change `status` (`403`). No jeepney detail `GET`; select from list. |
| Operator: associate a Driver | `POST /api/driver-associations` `{email}` | 1 | Driver must be registered and verified. Response returns `driverId`. |
| Operator: list associated Drivers | — | 4 | Needed to pick `driverId` for assignment and group membership (G1). Blocks O08–O11 except right after association. |
| Operator: assign / change Driver on jeepney | `POST /api/jeepneys/{id}/driver-assignment` | 1 | Replaces the jeepney's active driver and ends the driver's other active assignment. |
| Operator: unassign Driver | — | 4 | ID 5 "assign or change" — no unassign (G4). |
| Operator: list/create/update groups | `GET/POST /api/fleet-groups`, `PATCH /api/fleet-groups/{id}` | 1 | |
| Operator: add Driver / jeepney to group | `POST /api/fleet-groups/{id}/drivers`, `.../jeepneys` | 1 | Adding a jeepney that would cause two inherited routes → `409 ROUTE_ASSIGNMENT_CONFLICT`. |
| Operator: list group members / remove member | — | 4 | ID 7 (G2). |
| Operator: assign route direction to jeepney or group | `POST /api/route-assignments` | 1 | OPERATOR only (not Admin). Replaces the target's active assignment. |
| Operator: route add/change request | — | 4 | Approved in Agent A handoff §5 (`RouteChangeRequests`). Not implemented (G7). |
| Vehicle application list/submit | `GET/POST /api/vehicle-applications` | 1 | Operator sees applications for own jeepneys; Driver sees those for accessible jeepneys. |
| GPS setup request list/submit | `GET/POST /api/gps-setup-requests` | 1 | Needs an `APPROVED` application. Read lifecycle from the list; no detail/timeline endpoint. |
| Operator dashboard aggregates, live fleet map, compliance, deviations, online/offline | — | 5 | Agent B. |
| Driver tracking status / location | — | 5 | GPS hardware is the source; the app does not submit location. |

### 4.3 Agent E — Admin Web (IDs 56–67)

| Capability | Endpoint(s) | Class | Notes |
|---|---|---|---|
| Admin sign-in, refresh, logout, me | `/api/auth/*` | 1 | Reject non-`ADMIN` in the client. |
| User list | `GET /api/admin/users/` | 2 | Unpaginated; filter/search client-side. |
| Enable/disable user | `PATCH /api/admin/users/{id}/status` | 1 | Self-disable → `400`. |
| User detail, role change, create Admin, delete user, server-side search | — | 4 / 6 | ID 3 asks for view/update/enable/disable; a detail view can be composed from the list (class 2). Role mutation, Admin creation via API and deletion are not approved (6). |
| Jeepneys / groups (all operators) | `GET /api/jeepneys`, `GET /api/fleet-groups` | 1 | Admin sees everything. |
| Create jeepney/group for an Operator | `POST /api/jeepneys`, `POST /api/fleet-groups` with `operatorId` | 2 | Admin must already know the `operatorId`; there is no operator list (G1). |
| Change jeepney status | `PATCH /api/jeepneys/{id}` `{status}` | 1 | Admin only. |
| Operators / Drivers directory | — | 4 | G1. |
| Transit routes (all statuses) CRUD + directions | `/api/admin/transit-routes*`, `PATCH /api/admin/route-directions/{id}` | 1 | Geometry 2–10,000 points, corridor 1–5,000 m (default 100). No delete; archive via `status`. |
| GeoJSON import | route-direction create/update | 2 | Parse the file client-side, send one `LineString` per direction. |
| Route assignment by Admin | — | 6 | Merged contract is OPERATOR only. Changing it needs Tech Lead approval. |
| Effective route for any jeepney | `GET /api/jeepneys/{id}/effective-route` | 1 | |
| Vehicle application review | `GET /api/vehicle-applications`, `PATCH /api/admin/vehicle-applications/{id}/review` | 1 | |
| GPS request transitions / device mapping / verification | `PATCH .../status`, `POST .../device-mapping`, `POST .../verification` | 1 | Mapping uniqueness → `409 DEVICE_MAPPING_CONFLICT`. Activation only when all four checks pass. |
| Route change request review | — | 4 | G7. |
| Audit log viewer | — | 4 | Mutations write `audit_logs`, but there is no read endpoint (G8). |
| System settings (e.g. corridor default, thresholds) | — | 4 | `SystemSettings` named in handoff; not implemented. Thresholds are frozen; low priority. |
| Dashboard, live map, latest state, deviations, Traccar health | — | 5 | Agent B. |
| Reports/exports, historical route views | — | 5 / 6 | History is Traccar-owned (Agent B); exports are not in the approved Agent A scope. |

### 4.4 Class 3 — unmerged PRs

| PR | Owner | Frontend relevance |
|---|---|---|
| [#2](https://github.com/erwin-io/valryde-api/pull/2) Agent A downstream handoff | A | Documentation only; Tech Lead `ACCEPTED`, open. No new endpoints. |
| [#4](https://github.com/erwin-io/valryde-api/pull/4) Traccar REST + scoped history foundation | B | Internal services (`src/tracking/*`) only. **Registers no HTTP route**, so nothing is callable by C/D/E yet. Tech Lead `ACCEPTED`, open. |
| [#5](https://github.com/erwin-io/valryde-api/pull/5) Agent D repository identity correction | Governance | Docs only. Open, no review comment yet. |

No frontend capability is currently class 3.

## 5. Missing-capability assessment (Agent A scope, class 4)

| Gap | Approved basis | Blocks | Suggested contract shape (for Tech Lead decision, not implemented) |
|---|---|---|---|
| **G1** Operator's drivers list; Admin operators/drivers directory | IDs 3, 5, 7 (assignment and membership need a `driverId`/`operatorId` the client cannot otherwise obtain) | D O08–O11, O14/O16; E jeepney/group creation for an operator | `GET /api/drivers` (OPERATOR: own associated; ADMIN: all) and `GET /api/operators` (ADMIN). Read-only, existing tables. |
| **G2** Group membership read and removal | ID 7 | D D07–D08, O14/O16; E group detail | `GET /api/fleet-groups/{id}/members`; `DELETE .../drivers/{driverId}`, `DELETE .../jeepneys/{jeepneyId}`. Driver sees member-safe fields only. |
| **G3** Driver's active assignment marker | ID 5 | D D01–D02, D11 | Add `activeDriverAssignment` (or `GET /api/me/assignment`). DTO addition → Tech Lead. |
| **G4** Unassign driver | ID 5 | D O11 | `DELETE /api/jeepneys/{id}/driver-assignment` (sets `active_to`). |
| **G5** Mobile deep links for email challenges | ID 1 | C, D verification/reset from a phone | Configuration of `APP_*_URL` per client; possibly per-role link origins. Owner decision. |
| **G6** Place search + direct transit discovery (ID 37) | Locked architecture: Fastify geocoding adapter (Photon); direct routes only | C ID 37 | `GET /api/places?q` and `GET /api/transit-discovery?originLon&originLat&destLon&destLat`. ID 37 is Agent C's checklist; backend owner must be assigned by the Tech Lead. |
| **G7** Route add/change requests | Agent A handoff §5 (`RouteChangeRequests`) | D O29–O30; E review queue | Submit/list (OPERATOR), review (ADMIN). Needs a new migration → Tech Lead approval. |
| **G8** Audit log read | Agent A handoff §5 (`AuditLogs`) | E audit screen | `GET /api/admin/audit-logs?entityType&entityId&page`. Read-only, existing table. |
| **G9** Pagination/filter on Admin lists | IDs 3, 8 (scale) | E users/jeepneys/applications | Same `page/pageSize/q` envelope as public routes. Contract change → Tech Lead. |

## 6. Ownership and dependency matrix

| Capability area | Backend owner | Repo | Frontend consumers | Status |
|---|---|---|---|---|
| Auth, sessions, RBAC, profiles, Admin user status | A | valryde-api | C, D, E | Merged |
| Operators, drivers, jeepneys, groups, assignments | A | valryde-api | D, E | Merged; G1–G4 open |
| Transit routes, directions, route assignment, effective route | A | valryde-api | C, D, E | Merged (frozen precedence) |
| Vehicle application, GPS setup, device mapping, verification | A | valryde-api | D, E | Merged; physical activation operator-gated |
| Route change requests, audit read, settings | A | valryde-api | D, E | Not implemented (G7, G8) |
| Geocoding adapter, direct discovery | Unassigned (Tech Lead) | valryde-api | C | Not implemented (G6) |
| Traccar REST, history, latest state, compliance, availability | B | valryde-api | C, D, E | PR #4 open (no HTTP routes); rest not started |
| Tracking Bridge, Pusher channels/events | B | valryde-api / infra | C, D, E | Not started; contract proposal in progress |
| GPS install runbooks | F | — | E (ops) | Out of API scope |

## 7. Recommended implementation priorities (Agent A, pending Tech Lead approval)

1. **D1 error mapping** — small, unblocks correct client error handling for all three apps. Needs approval of a `RATE_LIMITED` code.
2. **D2 CORS example** — one-line `.env.example` update; unblocks native C/D builds. No code.
3. **G1 drivers/operators directory** — read-only on existing tables; unblocks Operator assignment and Admin fleet creation, the biggest D/E functional gap.
4. **G2 + G4 membership read/remove and driver unassign** — completes IDs 5 and 7.
5. **G3 Driver active-assignment marker** — completes the Driver home screen.
6. **G8 audit read, G9 Admin pagination** — Admin quality; read-only.
7. **G7 route change requests** — needs a migration; schedule after the above.
8. **G6 ID 37 backend** — after the Tech Lead assigns an owner.

Each item is a separate focused PR with tests; none is started without Tech Lead approval because each adds to the public contract.

## 8. Evidence

| Check | Environment | Result | Date |
|---|---|---|---|
| Route/DTO inventory regenerated from Fastify OpenAPI + route preHandlers | Offline, audited SHA | 44 operations / 38 paths, matches route files | 2026-10-21 (Codex), re-checked by Claude |
| `inject()` probes: auth required, 404, `/documentation/json` | Offline, no DB | As recorded in `AGENT_A_OFFLINE_AUDIT_RESULTS.json` | 2026-10-21 |
| `inject()` probes: malformed JSON, rate limit, CORS preflight for 5 origins | Offline, no DB, temporary test file removed after run | D1 and D2 confirmed | 2026-10-21 |
| Source review of list scoping, assignment replacement, update restrictions | `src/services/*.ts` | As described in §4 | 2026-10-21 |
| Frontend inventories (read-only) | C `feat/23-map-shell` `dcbe8ce`, D `feat/frontend-foundation` `194aa8d`, E `feat/56-59-admin-shell-user-accounts` `4778b49` | Compared in §4 | 2026-10-21 |
| `npm run lint`, `npm run typecheck`, `npm run build` at audited source | Local Node.js | PASSED | 2026-10-21 |
| `npm test` with `TEST_DATABASE_URL` set (PostgreSQL/PostGIS integration enabled) | Local PostgreSQL, `dbo` | PASSED — 12 files / 40 tests, 0 skipped | 2026-10-21 |
| `npm test` without `TEST_DATABASE_URL` | Local Node.js | PASSED — 5 files / 27 tests, 7 DB files skipped by design | 2026-10-21 |

# Agent A backend release — API handoff for Agents C, D and E

**Released backend:** `main` at `810c8a13356ddbf0e28a4faf5ad7f86ce0a30479`, which includes Agent A PRs #12, #15, #16, #17 (design document only), #19, #20, #21, #23, #24, #25, #26, #27 (proposals only) and #28 (G6), and Agent B PR #22.
**Owner:** Agent A — Core Platform / Fastify API (checklist IDs 1–11). Directive `VALRYDE-AGENT-A-FINAL-BACKEND-RELEASE-008`, Phase E.
**Status:** describes merged contracts only. Anything marked *pending* is not callable on `main`.

This document replaces §4–§7 of [AGENT_A_FRONTEND_API_INTEGRATION_HANDOFF.md](AGENT_A_FRONTEND_API_INTEGRATION_HANDOFF.md), whose capability tables were written at `711f4c4`. That document's §1–§3 (session lifecycle, connectivity, troubleshooting) still apply.

| File | Contents |
|---|---|
| [AGENT_A_FRONTEND_ENDPOINT_MATRIX.md](AGENT_A_FRONTEND_ENDPOINT_MATRIX.md) | All 56 operations / 47 paths with method, guard, consumers, path/query/body fields and limits, success envelope, pagination, declared statuses and source line |
| [AGENT_A_FRONTEND_ENDPOINT_INDEX.json](AGENT_A_FRONTEND_ENDPOINT_INDEX.json) | The same inventory, machine-readable |
| [AGENT_A_OPENAPI_AUDIT.json](AGENT_A_OPENAPI_AUDIT.json) | Exact OpenAPI 3 snapshot (server `/api`, unprefixed paths) for typed clients and contract tests |
| `scripts/generate-api-handoff.ts` | Regenerates the three files above offline: `npx tsx scripts/generate-api-handoff.ts` |

## 1. Rules for every call

1. **Base URL:** the configurable origin plus `/api`. Swagger UI is `/documentation`; the spec is `/documentation/json`.
2. **The server is authoritative** for roles, ownership, effective route, eligibility and visibility. Client guards are UX only.
3. **Error envelope:** `{ "error": { "code", "message", "requestId", "details"? } }`. Branch on `code`, never on `message`.
4. **`404 NOT_FOUND` means missing or not visible to you.** `403 FORBIDDEN` means a role or ownership denial; do not retry it.
5. **Unknown fields:** query and body schemas strip or reject properties that are not declared. Never rely on an undeclared field being accepted.
6. **Re-read after mutations.** Fleet, application and GPS records have no detail `GET`; refresh the list.

### 1.1 Pagination

Paginated responses always contain `pagination: { page, pageSize, total, totalPages }`. Every paginated query accepts `page` (≥ 1, default 1) and `pageSize` (1–100, default 20).

| Operation | Extra query filters |
|---|---|
| `GET /api/transit-routes` | `q` (1–160) |
| `GET /api/drivers` | `q` (1–100), `status`; ADMIN-only `operatorId`, `associated` (OPERATOR gets `403` when using them) |
| `GET /api/operators` (ADMIN) | `q` (1–100), `status` |
| `GET /api/fleet-groups/{groupId}/members` | `memberType` = `DRIVER` or `JEEPNEY` |
| `GET /api/route-assignments` | `routeDirectionId`, `jeepneyId`, `groupId`, `activeOnly` (default `true`) |
| `GET /api/admin/route-directions/{directionId}/assignment-impact` (ADMIN) | none |

All other collections are unpaginated and unfiltered by contract. Filter them client-side and do not rely on their order.

### 1.2 Error codes

| HTTP | `code` | Client action |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Field problem; `details` holds schema errors when present |
| 400 | `INVALID_CHALLENGE` | Verification, reset or email-change token is expired or used |
| 401 | `AUTH_REQUIRED` | Refresh once, then sign in |
| 401 | `SESSION_REVOKED` | Sign out locally |
| 401 | `INVALID_CREDENTIALS` | Generic sign-in failure |
| 403 | `EMAIL_NOT_VERIFIED` | Offer resend-verification |
| 403 | `FORBIDDEN` | Role or ownership denied |
| 404 | `NOT_FOUND` | Missing or not visible |
| 409 | `CONFLICT` | Duplicate or wrong state (duplicate plate, route code or direction label; unassign with no active assignment) |
| 409 | `DRIVER_NOT_READY`, `DRIVER_ALREADY_ASSOCIATED` | Driver association rejected |
| 409 | `ROUTE_NOT_APPROVED` | Direction is not `ACTIVE` |
| 409 | `ROUTE_ASSIGNMENT_CONFLICT` | More than one inherited group route |
| 409 | `VEHICLE_NOT_APPROVED`, `GPS_NOT_INSTALLED`, `DEVICE_MAPPING_CONFLICT` | GPS workflow ordering |
| 429 | `RATE_LIMITED` | Wait `retry-after` seconds |
| 503 | `GOOGLE_SIGN_IN_UNAVAILABLE`, `EMAIL_DELIVERY_UNAVAILABLE`, `GEOCODER_UNAVAILABLE` | Provider not configured or down. Place search returns `GEOCODER_UNAVAILABLE` while the provider is disabled (the default). |
| 500 | `INTERNAL_ERROR` | Unexpected; show `requestId` |

*Proposed, not implemented:* `422 TRACKING_CONTEXT_MUTATION_TOO_LARGE` and `503 TRACKING_CONTEXT_BUSY` (Stage 13b design, merged as a document in PR #17 and still marked proposed).

### 1.3 Rate limits (per client IP unless stated)

| Scope | Limit |
|---|---|
| Global | 100/min |
| Register, login, Google sign-in | 10/min each |
| Refresh | 30/min |
| Resend verification, forgot password | 5 per 15 min each |
| Place search | 20/min per user |
| Direct-route discovery | 30/min |

### 1.4 Frozen rules

- **Effective route** (`GET /api/jeepneys/{id}/effective-route`):
  - an active direct assignment wins;
  - otherwise exactly one active group assignment applies;
  - zero group assignments → `null`;
  - more than one → `409 ROUTE_ASSIGNMENT_CONFLICT`.

  Never re-implement this rule client-side.
- **Route assignment** (`POST /api/route-assignments`, OPERATOR only) replaces the target's active assignment. There is no separate route unassign.
- **Driver assignment:**
  - `POST /api/jeepneys/{id}/driver-assignment` replaces the jeepney's active Driver.
  - `DELETE` on the same path closes it and returns the closed assignment. Calling `DELETE` again returns `409 CONFLICT`.
- **Membership removals** (`DELETE /api/fleet-groups/{groupId}/drivers/{driverId}`, `.../jeepneys/{jeepneyId}`) return `204` and take effect on the next read.

## 2. Capability matrix

Classes:
- 1 = on `main`;
- 2 = on `main`, needs client composition;
- 3 = implemented in an open PR, pending approval;
- 4 = approved requirement, not implemented;
- 5 = Agent B tracking dependency;
- 6 = not approved.

### 2.1 Agent C — Commuter Mobile

| Capability | Endpoint | Class |
|---|---|---|
| Auth, session, profile, recovery | `/api/auth/*` (`role: "COMMUTER"`) | 1 |
| Route list/search/pagination, route detail with geometry | `GET /api/transit-routes`, `GET /api/transit-routes/{routeId}` | 1 |
| Draw routes on the map | route detail `direction.geometry` (GeoJSON `[lon, lat]`) and `routeColorHex` | 2 |
| Place search (ID 37) | `GET /api/places/search` | 3 — merged (#28); provider disabled by default (`503 GEOCODER_UNAVAILABLE`) until the owner approves one. Show a fallback to route search on 503. |
| Direct-route discovery (ID 37) | `GET /api/transit-routes/discover` | 3 — merged (#28); public; returns `directRouteFound:false` with no candidates when no single route serves both points |
| Live jeepneys, availability, freshness, Pusher | — | 5 |
| Favorites, stops, fares, ETA, transfers | — | 6 |

### 2.2 Agent D — Driver / Operator Mobile

| Capability | Endpoint | Class |
|---|---|---|
| Auth, session, profile | `/api/auth/*` | 1 |
| Driver: current assignment | `GET /api/me/assignment` (`{assignment}` or `null`) | 1 |
| Driver: visible jeepneys, groups, group members | `GET /api/jeepneys`, `GET /api/fleet-groups`, `GET /api/fleet-groups/{id}/members` | 1 |
| Effective route | `GET /api/jeepneys/{id}/effective-route` | 1 |
| Operator: jeepneys (list/create/update) | `GET/POST /api/jeepneys`, `PATCH /api/jeepneys/{id}` | 1 |
| Operator: Driver directory and association | `GET /api/drivers`, `POST /api/driver-associations` | 1 |
| Operator: assign / unassign Driver | `POST`/`DELETE /api/jeepneys/{id}/driver-assignment` | 1 |
| Operator: groups and membership add/list/remove | `/api/fleet-groups*` | 1 |
| Operator: route assignment and assignment history | `POST`/`GET /api/route-assignments` | 1 |
| Vehicle application, GPS setup request | `GET/POST /api/vehicle-applications`, `GET/POST /api/gps-setup-requests` | 1 |
| Operator: route add/change request (G7) | — | 4 — proposal in PR #27, awaiting G7-D1, D3–D7 |
| Groupmate Driver names on live views (U1) | — | 5 — Stage 13b option 3.4 |
| Live fleet map, compliance, online/offline | — | 5 |

### 2.3 Agent E — Admin Web

| Capability | Endpoint | Class |
|---|---|---|
| Admin sign-in and session | `/api/auth/*` (reject accounts without `ADMIN` client-side) | 1 |
| Users list, enable/disable | `GET /api/admin/users/`, `PATCH /api/admin/users/{id}/status` | 1 (list unpaginated: class 2 for search) |
| Operator and Driver directories | `GET /api/operators`, `GET /api/drivers` | 1 |
| Jeepneys/groups for any Operator | list endpoints plus `operatorId` on create | 1 / 2 |
| Route and direction CRUD | `/api/admin/transit-routes*`, `PATCH /api/admin/route-directions/{id}` | 1 |
| Assignment history and change-impact preview | `GET /api/route-assignments`, `GET /api/admin/route-directions/{id}/assignment-impact` | 1 |
| Application review, GPS transitions, mapping create/read, verification | `/api/admin/vehicle-applications/*`, `/api/admin/gps-setup-requests/*` | 1 |
| Device remap / unmap (G10 write) | — | 4 — blocked on Stage 13b approval (create-only mapping in the first release) |
| Route-change review queue (G7) | — | 4 — PR #27 proposal |
| Audit log viewer (G8), Admin list pagination (G9), settings | — | 4 — not started; no approved contract |
| Dashboard, live map, deviations, Traccar health, reports | — | 5 / 6 |

## 3. What is still blocked, and on whom

| Item | Blocked on | Owner |
|---|---|---|
| G6 contract record | #28 is merged; no explicit G6-D1, D2, D3, D5 decision is recorded. Clients may build against the merged contract. | Agent G (confirm) |
| G6 live provider and caching | Provider terms and usage approval (G6-D4) | Owner |
| G7 route-change requests | G7-D1, D3, D4, D5, D6, D7 (D2 resolved: migration 010 or later) | Agent G |
| A006 tracking context generation, G10 remap/unmap, every tracking dependency (class 5) | Agent G's formal approval of the Stage 13b design (X1–X8, §13 constants, D01–D12). #17 is merged as a document but still reads "PROPOSED FOR TECH LEAD REVIEW"; Agent B #14 is open; then the A006 PR, then Agent B 007/008 | Agent G, then A, then B |
| G8 audit read, G9 Admin pagination | No approved contract | Agent G |
| Email links on phones (G5 remainder) | Callback domain, App Links / Universal Links hosting | Owner |
| Google sign-in, real SMTP delivery, first Admin, physical GPS/Traccar | Owner credentials and hardware | Owner / Agent F |

## 4. Verification of this release

| Check | Environment | Result |
|---|---|---|
| All 11 PR heads are ancestors of `99f4cb1`; #17, #28, #27 heads are ancestors of `810c8a1` | `git merge-base --is-ancestor` | PASSED |
| API CI `verify` on `main` `99f4cb1` (migrate 001–005, lint, typecheck, full test, build) | GitHub, disposable `postgis/postgis:16-3.4`; run 39825022429 | PASSED — 24 files, 178 tests passed, 1 live-Traccar skipped |
| API CI `verify` on #28 head `aead06a`, then on `main` `0670bcb`, `08193b8`, `810c8a1` | Same; runs 39828704164, 39829442004, 39829465115, 39829599328 | PASSED — #28 head: 206 passed, 1 skipped |
| Lint, typecheck, build, unit tests, Postman JSON parse, `git diff --check` | Local, `TEST_DATABASE_URL` unset | PASSED — 165 tests; 42 PostgreSQL tests skipped locally by design |
| Duplicate `operationId` check | All route files | None |
| Matrix regeneration | `scripts/generate-api-handoff.ts` after merging `810c8a1` | 56 operations / 47 paths; every operation has a source guard |

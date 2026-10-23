# Agent A — G7 Route-change requests: final decision matrix

**Status:** PROPOSED — for Agent G decision. Nothing is implemented and no migration is applied.
**Builds on:** [AGENT_A_G7_ROUTE_CHANGE_REQUEST_CONTRACT_PROPOSAL.md](AGENT_A_G7_ROUTE_CHANGE_REQUEST_CONTRACT_PROPOSAL.md) (merged in #27). This matrix replaces that document's §9 and fixes two inconsistencies in it (§3 below).
**Settled:** G7-D2. The migration is numbered 010 or later, never 006–009 (directive 008).
**Accepted design directions (Agent G review checkpoint):** G7-D1 = A (approval is a decision record only, with no automatic canonical route mutation), G7-D6 = A (Operator-only submission), G7-D3 = A (cross-Operator non-disclosure, `404`). These remain directions until Agent G approves the implementation PR.
**Still open:** G7-D4, G7-D5, G7-D7, and the §3 corrections.
**Base:** `main` `810c8a13356ddbf0e28a4faf5ad7f86ce0a30479`

## 1. Decisions

Each row lists the options, Agent A's recommendation, and exactly what the choice changes in DTOs, RBAC, transitions, audit and tests.

### G7-D1 — What Admin approval does

| Option | Effect |
|---|---|
| **A (recommended)** Approval is a decision record only | `status → APPROVED`, `reviewedBy/At`, optional `reviewNotes`. No write to `transit_routes`, `route_directions` or `vehicle_route_assignments`. The Admin applies the change through the existing Admin route endpoints (one canonical write path, with existing geometry validation and Stage 13b context locking). |
| B Approval applies the proposed geometry automatically | Approval would become a context mutation across every assigned jeepney, needing the A006 lock protocol, the 250 cap and new failure modes inside an approval. It also conflicts with "do not silently change active route assignments". |

Test consequence of A: after approval, canonical `transit_routes` and `route_directions` rows and every jeepney `tracking_context_version` are unchanged.

### G7-D3 — Another Operator's request by id

| Option | Effect |
|---|---|
| **A (recommended)** `404 NOT_FOUND` | Does not reveal that the id exists, matching the tracking visibility rule's non-disclosure intent. |
| B `403 FORBIDDEN` | Matches fleet resources (`Resource belongs to another operator`) but confirms existence. |

Lists are always scoped server-side: Operator B's list never contains A's rows, whichever option is chosen.

### G7-D4 — Allowed target route status for `CHANGE_ROUTE`

| Option | Effect |
|---|---|
| **A (recommended)** ACTIVE or INACTIVE; DRAFT or unknown → `404 NOT_FOUND` | DRAFT routes are not visible to Operators anywhere else, so they are treated as nonexistent. |
| B ACTIVE only | Blocks requests to reinstate an INACTIVE route. |
| C Any status; DRAFT → `400 VALIDATION_ERROR` | Leaks DRAFT existence. |

When `targetDirectionId` is given, it must belong to `targetRouteId`; otherwise `400 VALIDATION_ERROR`. That direction's status is not checked.

### G7-D5 — Geometry envelope

| Option | Effect |
|---|---|
| **A (recommended)** Requests validate `proposedGeometry` against the Philippines envelope now (lat 4.0–21.5, lng 116.0–127.0). This is the same constant G6 already uses (`philippinesBounds` in `src/services/geocoder-service.ts`). The Admin route geometry adopts it in a separate, Agent G-approved change. | No change to existing Admin endpoints in G7. |
| B Both paths adopt it inside the G7 PR | Changes an existing Admin contract inside an unrelated PR. |
| C WGS84 only (today's Admin rule) | Accepts geometry outside the service area. |

Under A, G7 also enforces: at least 2 positions, at most 500 positions, finite coordinates, and no consecutive duplicate positions.

### G7-D6 — Who may submit

| Option | Effect |
|---|---|
| **A (recommended)** OPERATOR only, with an active operator profile | Matches the system documentation. DRIVER and COMMUTER get `403` on every G7 route. |
| B OPERATOR and associated DRIVER | Needs a Driver→Operator ownership rule and a new withdraw rule. |

### G7-D7 — Link an approved request to the resulting route

| Option | Effect |
|---|---|
| **A (recommended)** Defer past MVP | No `resulting_route_id` column. The Admin can reference the request id in `reviewNotes`. |
| B Add a nullable `resulting_route_id` set by a separate Admin action | One more column, one more endpoint and one more audit action. |

## 2. Contract under the recommended options

### RBAC

| Endpoint | OPERATOR | ADMIN | DRIVER / COMMUTER / none |
|---|---|---|---|
| `POST /api/route-change-requests` | own operator | 403 | 403 / 401 |
| `GET /api/route-change-requests` | own operator only | all; may filter `operatorId` | 403 / 401 |
| `GET /api/route-change-requests/:requestId` | own; others → 404 (D3) | any | 403 / 401 |
| `POST /api/route-change-requests/:requestId/withdraw` | own, if PENDING | 403 | 403 / 401 |
| `PATCH /api/admin/route-change-requests/:requestId/review` | 403 | PENDING only | 403 / 401 |

An OPERATOR that sends `operatorId` gets `403` (G1 precedent). ADMIN cannot submit or withdraw.

### State transitions

| From → To | Actor | Body | Errors |
|---|---|---|---|
| — → `PENDING` | OPERATOR | create body | 400 / 404 (D4) / 429 |
| `PENDING → WITHDRAWN` | submitting operator | none | 409 if not PENDING |
| `PENDING → APPROVED` | ADMIN | `{ decision: 'APPROVED', reviewNotes? }` | 409 if not PENDING |
| `PENDING → REJECTED` | ADMIN | `{ decision: 'REJECTED', reviewNotes }` (1–2000 chars, required) | 400 without notes; 409 if not PENDING |

`APPROVED`, `REJECTED` and `WITHDRAWN` are terminal. Each transition runs `SELECT … FOR UPDATE` on the request, checks the status, updates it and inserts the audit row in one transaction, so a concurrent second transition gets `409 CONFLICT`. No Stage 13b advisory lock is needed, because under D1 = A no tracking context changes.

### DTOs

- **Create:** `{ requestType: 'ADD_ROUTE' | 'CHANGE_ROUTE', targetRouteId?, targetDirectionId?, title (3–160), description (10–4000), proposedGeometry? }`, with `additionalProperties: false`. `targetRouteId` is required for `CHANGE_ROUTE` and forbidden for `ADD_ROUTE`. `targetDirectionId` requires `targetRouteId`.
- **Response `request`:** `id, operatorId, submittedByUserId, requestType, targetRouteId, targetDirectionId, title, description, proposedGeometry (GeoJSON LineString or null), status, reviewNotes, reviewedByUserId, reviewedAt, createdAt, updatedAt`.
- **List:**
  - Query: `status`, `requestType`, `targetRouteId`, `operatorId` (ADMIN only), `page`, `pageSize` (max 100).
  - Response: `{ requests, pagination }`, ordered `createdAt DESC, id DESC`.

### Audit

| Action | When | Metadata (no free text, no geometry) |
|---|---|---|
| `ROUTE_CHANGE_REQUEST_SUBMITTED` | create | `requestType`, `targetRouteId`, `targetDirectionId`, `operatorId` |
| `ROUTE_CHANGE_REQUEST_WITHDRAWN` | withdraw | `operatorId` |
| `ROUTE_CHANGE_REQUEST_APPROVED` | review | `operatorId` |
| `ROUTE_CHANGE_REQUEST_REJECTED` | review | `operatorId` |

`entity_type = 'ROUTE_CHANGE_REQUEST'`, `entity_id = request id`. These rows are readable through G8 (`GET /api/admin/audit-logs?entityType=ROUTE_CHANGE_REQUEST`).

### Migration (proposed, not applied)

The `route_change_requests` table and enums from the base proposal §3, numbered `010_route_change_requests.sql` (or the next free number at least 010 when approved), with two changes:

- `proposed_geometry` gets a CHECK, using the envelope constant mirrored in SQL: `ST_XMin ≥ 116, ST_XMax ≤ 127, ST_YMin ≥ 4, ST_YMax ≤ 21.5`.
- An index on `(target_route_id)` serves the `targetRouteId` filter.

## 3. Corrections to the merged base proposal

1. **§7 audit casing:** it says `entity_type = 'route_change_request'`. Every existing writer uses upper snake case (`JEEPNEY`, `GPS_SETUP_REQUEST`), and the G8 read API filters on `^[A-Z][A-Z0-9_]*$`. Use `ROUTE_CHANGE_REQUEST`.
2. **§8 DRAFT target:** it says "404 (or 400 per G7-D4)". D4 = A fixes this as `404`.

## 4. Test specification (when approved)

PostgreSQL/PostGIS CI only; isolated fixtures removed by id.

- **Fixtures:**
  - Operators A and B (active profiles), plus an inactive-profile Operator;
  - one Driver, one Commuter and one ADMIN;
  - an ACTIVE route with two directions;
  - an INACTIVE route;
  - a DRAFT route.
- **Transitions:**
  - submit `CHANGE_ROUTE` with geometry and `ADD_ROUTE` without it;
  - Admin approves one and rejects one with notes;
  - Operator withdraws one;
  - each produces exactly one audit row with the §2 metadata and no free text.
- **D1:** after approval, canonical route and direction rows (compared by hash) and every jeepney `tracking_context_version` are unchanged.
- **D3:** Operator B's list excludes A's rows (`total` too); B's read, withdraw or review of A's request → 404, 404 and 403.
- **D4:**
  - an INACTIVE target is accepted;
  - DRAFT and unknown targets → 404;
  - a direction from another route → 400;
  - `ADD_ROUTE` with a target → 400;
  - `targetDirectionId` without `targetRouteId` → 400.
- **D5:**
  - geometry outside the envelope → 400;
  - a single position → 400;
  - 501 positions → 400;
  - consecutive duplicate positions → 400.
- **D6:** Driver and Commuter → 403 on all five routes; an Operator with an inactive profile → 403.
- **Concurrency:** two concurrent Admin reviews of one request → exactly one 200 and one 409; review racing withdraw → exactly one wins, and the other gets 409.
- **Validation:**
  - reject without notes → 400;
  - notes over 2000 chars → 400;
  - title or description length bounds;
  - an unknown body property is stripped by the schema, as on every existing route, and never stored.
- **Pagination:** walking pages returns each request once, with a tie on `createdAt` included.
- **Rate limit:** the 11th create within an hour by one user → 429.
- **OpenAPI and Postman:**
  - operations tagged (07 Vehicle Applications & Approvals, or a new tag only if Agent G prefers);
  - listed in `docs/OPENAPI_ENDPOINT_TAGS.md`;
  - Postman additions in folder 90 only.

## 5. What Agent G needs to answer

D1, D3 and D6 are accepted as directions. Still needed: **G7-D4** (target route statuses), **G7-D5** (Philippines envelope on proposals now), **G7-D7** (defer `resulting_route_id`); recommended A for each. Also confirm the §3 corrections. Once those are decided, Agent A opens the G7 implementation PR with the migration numbered 010 or later, approval as a decision record only, and no automatic canonical route mutation.

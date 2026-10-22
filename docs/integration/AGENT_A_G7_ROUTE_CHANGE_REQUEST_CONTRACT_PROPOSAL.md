# Agent A — G7 Route-Change Requests: Contract Proposal

**Status:** PROPOSED — review only. Nothing here is implemented: no migration, no endpoint.
**Checklist:** ID 52 (Agent D submitter), Admin review (Agent E), backend gap G7 · **Base:** `main` `827738c0f2c33ad3082f6a4a38a8e35669d4b0ea` · **Date:** 2026-10-22

## 1. Approved sources this proposal follows

- System documentation V1: route family `POST /route-change-requests, GET scoped; admin approve/reject`. The entity is `RouteChangeRequests` in the Applications group. "Operators may request but not directly mutate public canonical geometry". "Route changes require request/Admin edit".
- Agent A handoff: implement the route-change request state machine; the Operator cannot mutate canonical geometry.
- Agent E handoff: Admin approval is required for canonical route-change/addition requests.
- Existing pattern to mirror: vehicle applications (migration 005, `PATCH /api/admin/vehicle-applications/:id/review`, `SELECT … FOR UPDATE` + `409 CONFLICT` on non-pending).

## 2. Core rule: approval does not change canonical data

Approving a request records the Admin decision only. It **does not** create or edit `transit_routes`/`route_directions`, and it **does not** touch `vehicle_route_assignments`. The Admin applies an approved change through the existing Admin route endpoints. Those already validate geometry and enforce the frozen effective-route rule. This satisfies "do not silently change active route assignments" and keeps one canonical write path (**decision G7-D1**).

## 3. Data model (proposed migration `010` or later — **G7-D2**)

```sql
CREATE TYPE route_change_request_type AS ENUM ('ADD_ROUTE', 'CHANGE_ROUTE');
CREATE TYPE route_change_request_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

CREATE TABLE route_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
  submitted_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_type route_change_request_type NOT NULL,
  target_route_id uuid REFERENCES transit_routes(id) ON DELETE RESTRICT,
  target_direction_id uuid REFERENCES route_directions(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 160),
  description text NOT NULL CHECK (char_length(description) BETWEEN 10 AND 4000),
  proposed_geometry geometry(LineString, 4326),
  status route_change_request_status NOT NULL DEFAULT 'PENDING',
  review_notes text,
  reviewed_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((request_type = 'ADD_ROUTE' AND target_route_id IS NULL AND target_direction_id IS NULL)
      OR (request_type = 'CHANGE_ROUTE' AND target_route_id IS NOT NULL)),
  CHECK ((status IN ('PENDING', 'WITHDRAWN') AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL)
      OR (status IN ('APPROVED', 'REJECTED') AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL)),
  CHECK (status <> 'REJECTED' OR char_length(coalesce(review_notes, '')) > 0)
);
CREATE INDEX route_change_requests_operator_idx ON route_change_requests(operator_id, created_at DESC);
CREATE INDEX route_change_requests_status_idx ON route_change_requests(status, created_at DESC);
```

- When `target_direction_id` is set, it must belong to `target_route_id`. The service checks this inside the insert transaction.
- `proposed_geometry` is optional, because an Operator may describe the change in text only. When present, it goes through the existing `validateLineString` checks. The system doc also asks for a Philippines bounds policy on geometry, which current Admin validation does not enforce (it checks WGS84 only); **G7-D5** decides whether both paths should adopt the Philippines envelope.

## 4. State machine

| From | To | Actor | Rule |
|---|---|---|---|
| — | `PENDING` | OPERATOR (active operator profile) | Create |
| `PENDING` | `WITHDRAWN` | The submitting Operator's account | Terminal |
| `PENDING` | `APPROVED` | ADMIN | Optional `reviewNotes`; terminal |
| `PENDING` | `REJECTED` | ADMIN | `reviewNotes` required; terminal |

Any other transition returns `409 CONFLICT`. Each transition is `SELECT … FOR UPDATE` → status check → `UPDATE` → `audit_logs` insert, all in one transaction. A concurrent second review therefore gets `409`.

## 5. Endpoints

| Method + path | Roles | Behavior |
|---|---|---|
| `POST /api/route-change-requests` | OPERATOR | Create. `201 { request }`. Rate limit 10/hour per user. |
| `GET /api/route-change-requests` | OPERATOR (own operator only), ADMIN (all) | Filters `status`, `requestType`, `targetRouteId`; `page`/`pageSize` (max 100); newest first; standard `pagination` envelope. ADMIN may also filter `operatorId`. |
| `GET /api/route-change-requests/:requestId` | OPERATOR (own), ADMIN | Another Operator's request returns `404 NOT_FOUND` (non-disclosure, **G7-D3**) |
| `POST /api/route-change-requests/:requestId/withdraw` | OPERATOR (own) | `PENDING → WITHDRAWN` |
| `PATCH /api/admin/route-change-requests/:requestId/review` | ADMIN | Body `{ decision: 'APPROVED' \| 'REJECTED', reviewNotes? }`, mirroring vehicle-application review |

DRIVER and COMMUTER get `403 FORBIDDEN` on every route.

### Create body

```json
{
  "requestType": "CHANGE_ROUTE",
  "targetRouteId": "uuid",
  "targetDirectionId": "uuid",
  "title": "Extend 04C to IT Park",
  "description": "Northbound terminal moved; vehicles now turn at …",
  "proposedGeometry": { "type": "LineString", "coordinates": [[123.90, 10.33], [123.91, 10.33]] }
}
```

`additionalProperties: false`. `targetRouteId` is required for `CHANGE_ROUTE` and forbidden for `ADD_ROUTE`. The target route may be ACTIVE or INACTIVE but not DRAFT (**G7-D4**).

### Response DTO `request`

`id, operatorId, submittedByUserId, requestType, targetRouteId, targetDirectionId, title, description, proposedGeometry (GeoJSON or null), status, reviewNotes, reviewedByUserId, reviewedAt, createdAt, updatedAt`.

## 6. Errors (existing codes only)

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Schema, type/target mismatch, direction not on route, invalid geometry |
| 401 | `AUTH_REQUIRED` / `SESSION_REVOKED` | No or revoked session |
| 403 | `FORBIDDEN` | Wrong role; OPERATOR without an active operator profile |
| 404 | `NOT_FOUND` | Unknown id, another Operator's request, or unknown target route/direction |
| 409 | `CONFLICT` | Transition from a non-`PENDING` state |
| 429 | `RATE_LIMITED` | Submit limit |

## 7. Audit

`audit_logs` actions: `ROUTE_CHANGE_REQUEST_SUBMITTED`, `_WITHDRAWN`, `_APPROVED`, `_REJECTED`; `entity_type = 'route_change_request'`. Metadata contains only `requestType`, `targetRouteId`, `targetDirectionId` and `operatorId`. It never contains free text or geometry.

## 8. Tests and fixtures (when approved)

PostgreSQL/PostGIS, disposable database only. All rows created are removed by id.

- **Fixtures:**
  - two Operators (A, B), each with an active operator profile;
  - one Driver and one Commuter;
  - one ADMIN;
  - one ACTIVE route with two directions;
  - one DRAFT route.
- **Happy path:**
  - Operator A submits `CHANGE_ROUTE` with geometry and `ADD_ROUTE` without it;
  - Admin approves one and rejects the other with notes;
  - Operator A withdraws a third request;
  - audit rows match each action;
  - canonical `transit_routes`, `route_directions` and `vehicle_route_assignments` row hashes are unchanged after approval.
- **Negative:**
  - Operator B cannot list, read or withdraw A's requests (empty list / 404);
  - Driver and Commuter receive 403 on all five routes;
  - Operator cannot call the Admin review;
  - review or withdraw of a non-pending request → 409;
  - two concurrent reviews → exactly one 200 and one 409;
  - reject without notes → 400;
  - `ADD_ROUTE` with a target → 400;
  - direction from a different route → 400;
  - DRAFT target → 404 (or 400 per G7-D4);
  - invalid LineString → 400.
- **OpenAPI:** the new operations are tagged and listed in `docs/OPENAPI_ENDPOINT_TAGS.md`; the Postman safe-smoke folder is untouched.

## 9. Decisions required from Agent G

| ID | Decision | Recommendation |
|---|---|---|
| G7-D1 | Approval is a decision record only; no automatic canonical or assignment change | Accept |
| G7-D2 | Migration number and ordering relative to Stage 13b | **Resolved by Tech Lead directive 008:** migrations 006–008 are reserved exclusively for Stage 13b (A006, B007, B008; 009 deferred). G7 uses `010` or later, never `006`, even if Stage 13b slips; no dependency between them |
| G7-D3 | Cross-Operator single read: `404` (non-disclosure) vs `403` | `404` |
| G7-D4 | Allowed target route statuses for `CHANGE_ROUTE` | ACTIVE or INACTIVE; reject DRAFT with `404` |
| G7-D5 | Philippines geometry envelope for both proposals and Admin geometry | Adopt lat 4.0–21.5, lng 116.0–127.0 in a separate Admin-route change |
| G7-D6 | Should DRIVER be able to submit? Docs name only the Operator | No |
| G7-D7 | Whether Admin can link an approved request to the route/direction they then created or edited (`resulting_route_id`) | Defer to post-MVP |

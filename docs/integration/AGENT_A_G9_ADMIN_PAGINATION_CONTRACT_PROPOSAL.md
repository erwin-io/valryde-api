# Agent A — G9 Admin list pagination and filters: contract proposal

**Status:** PROPOSED — review only. Nothing here is implemented. These lists already have clients (Agents D and E), so changing their response shape is a contract change that needs Agent G's approval first.
**Checklist:** IDs 3 and 8 at scale; Admin screens (Agent E), Operator lists (Agent D); backend gap G9 · **Base:** `main` `810c8a13356ddbf0e28a4faf5ad7f86ce0a30479`

## 1. Current state on `main`

| Operation | Path | Roles | Response today | Order today | Deterministic? |
|---|---|---|---|---|---|
| `listUsersAsAdmin` | `GET /api/admin/users/` | ADMIN | `{ users }`, unbounded | `created_at DESC` | No (ties) |
| `listJeepneys` | `GET /api/jeepneys` | DRIVER, OPERATOR, ADMIN (scoped) | `{ jeepneys }`, unbounded | `created_at DESC` | No |
| `listFleetGroups` | `GET /api/fleet-groups` | DRIVER, OPERATOR, ADMIN (scoped) | `{ groups }`, unbounded | `created_at DESC` | No |
| `listTransitRoutesAsAdmin` | `GET /api/admin/transit-routes` | ADMIN | `{ routes[] with directions }`, unbounded | `route_code` (unique) | Yes |
| `listVehicleApplications` | `GET /api/vehicle-applications` | DRIVER, OPERATOR, ADMIN (scoped) | `{ applications }`, unbounded | `created_at DESC` | No |
| `listGpsSetupRequests` | `GET /api/gps-setup-requests` | DRIVER, OPERATOR, ADMIN (scoped) | `{ requests }`, unbounded | `created_at DESC` | No |

These lists are already paginated and are out of scope: `listDrivers`, `listOperators` (G1), `listFleetGroupMembers` (G2), `listRouteAssignments` and `getRouteDirectionAssignmentImpact` (G11), `listPublicTransitRoutes`, and `listAuditLogsAsAdmin` (G8, PR #33).

## 2. Proposed shared envelope (same as G1)

- **Query:** `page` (integer ≥ 1, default 1) and `pageSize` (integer 1–100, default 20). `pageSize` above 100 or `page` below 1 returns `400 VALIDATION_ERROR`.
- **Response:** the existing array plus `pagination { page, pageSize, total, totalPages }`. `total` counts the filtered, role-scoped set. A page past the end returns an empty array with correct totals.
- **Order:** every list adds a unique tiebreak, so pages never repeat or skip rows:
  - `created_at DESC, id DESC`;
  - Admin routes keep `route_code` (already unique).
- **Count and page queries** use identical filters and scope.

## 3. Proposed filters

All filters are optional and exact-match unless stated. Scope filters stay server-authoritative, following the G1 precedent: an OPERATOR or DRIVER sending an Admin-only scope filter gets `403 FORBIDDEN`. The filter cannot widen or narrow their scope.

| Operation | Filters | Admin-only |
|---|---|---|
| `listUsersAsAdmin` | `q` (display name or email, contains, 1–100 chars), `status`, `role` | — (endpoint is Admin-only) |
| `listJeepneys` | `q` (plate contains), `status` (jeepney status) | `operatorId` |
| `listFleetGroups` | `q` (name contains), `status` | `operatorId` |
| `listTransitRoutesAsAdmin` | `q` (route code or public name contains), `status` | — |
| `listVehicleApplications` | `status`, `jeepneyId` | `operatorId` |
| `listGpsSetupRequests` | `status`, `verificationStatus`, `jeepneyId` | `operatorId` |

`listTransitRoutesAsAdmin` paginates routes; each route still carries all of its directions.

## 4. Decisions for Agent G

| ID | Decision | Options | Recommendation |
|---|---|---|---|
| G9-D1 | Scope | (a) the six operations in §1; (b) Admin-only paths first (`users`, `admin/transit-routes`), others later | (a), so every list follows one rule |
| G9-D2 | Compatibility | (a) **Opt-in now:** paginate only when `page` or `pageSize` is sent; `pagination` is always added (an additive field); unpaged calls behave exactly as today. (b) **Always on:** default `pageSize` 20 truncates today's full lists, a breaking change for D/E. (c) New `/v2` or `/admin/...` paths | (a) now. Then (b) in a coordinated release once Agents D and E have adopted it, so no client silently loses rows |
| G9-D3 | `pagination` when the call is unpaged under D2(a) | (a) `{ page: 1, pageSize: total, total, totalPages: 1 }` (`pageSize ≥ 1`); (b) omit the field | (a): one response shape for clients |
| G9-D4 | Unique ordering tiebreaks (§2) | Apply now as a standalone fix (it changes only the order of rows with equal timestamps) or with G9 | With G9, in the same PR |
| G9-D5 | Filter set (§3), including `role` on users and `verificationStatus` on GPS requests | Accept, trim or extend | Accept |
| G9-D6 | Admin-only scope filter sent by a non-Admin | `403` (G1 precedent) or ignore | `403` |

## 5. Test specification (when approved)

PostgreSQL/PostGIS CI only; isolated fixtures removed by id.

- **For each of the six operations:**
  - default and explicit `page`/`pageSize`;
  - `pageSize` 101 and `page` 0 → 400;
  - a page past the end → empty array with correct totals;
  - walking all pages returns every scoped row exactly once, including rows that share a `created_at` (fixtures insert equal timestamps);
  - `total` equals the unpaged count.
- **Role scope:**
  - an OPERATOR sees only its own rows in `total` and pages;
  - a DRIVER sees only rows it can reach through its assignment, group membership or as creator;
  - `operatorId` from a non-Admin → 403.
- **Filters:** each filter in §3 narrows `total` correctly; `q` is case-insensitive and treats `%` and `_` literally.
- **Compatibility (if D2(a)):** a call without `page`/`pageSize` returns the full list and the D3 `pagination` shape, byte-compatible with today's array.
- **OpenAPI:** query and response schemas updated; the handoff matrix is regenerated.

No migration is needed. If listing ever needs a new index, that needs a migration numbered 010 or later, approved separately.

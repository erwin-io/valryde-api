# Agent A — G9 Admin list pagination and filters: contract proposal

**Status:** PROPOSED — review only. Nothing here is implemented. **Agent G direction (review checkpoint): proceed with the opt-in compatibility design (G9-D2 option a); correct the zero-record envelope; unpaged clients must keep receiving every record.** The envelope in §2 below is corrected accordingly. These lists already have clients (Agents D and E), so changing their response shape is a contract change that needs Agent G's approval first.
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

## 2. Proposed shared envelope (opt-in, G1-compatible)

**Paged mode.** The call sends `page` or `pageSize` (or both); the one not sent takes its default.
- `page`: integer ≥ 1, default 1. `pageSize`: integer 1–100, default 20. `pageSize` above 100 or `page` below 1 returns `400 VALIDATION_ERROR`.
- Response: the existing array plus `pagination { page, pageSize, total, totalPages }`, with `totalPages = ceil(total / pageSize)`. These are exactly the G1 rules, so an empty result is `{ page, pageSize, total: 0, totalPages: 0 }`.
- A page past the end returns an empty array with correct totals.

**Unpaged mode.** The call sends neither `page` nor `pageSize`; every caller does this today.
- **The server returns every role-scoped, filtered row, exactly as today.** There is no implicit limit and no truncation.
- The response adds `pagination` describing the whole result as a single page: `{ page: 1, pageSize: total, total, totalPages: total === 0 ? 0 : 1 }`.
- With zero rows this is `{ page: 1, pageSize: 0, total: 0, totalPages: 0 }`.
- The response schema therefore declares `pageSize` with `minimum: 0` on these six operations. The request parameter `pageSize` keeps `minimum: 1`, so `pageSize: 0` can appear only in an unpaged response.
- This resolves the conflict in the earlier draft of G9-D3: `pageSize: total` with `pageSize ≥ 1` was impossible when `total` was 0.

**Both modes:**
- Every list adds a unique tiebreak, so paged walks never repeat or skip rows: `created_at DESC, id DESC`; Admin routes keep `route_code` (already unique).
- The count and the rows come from identical filters and scope.
- Filters (§3) apply in both modes. In unpaged mode `total` always equals the array length.

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
| G9-D2 | Compatibility | (a) opt-in; (b) always on; (c) new paths | **Agent G direction: (a).** Any later switch to (b) is a separate, coordinated decision with Agents D and E |
| G9-D3 | `pagination` in unpaged mode | (a) whole-result page per §2: `{ page: 1, pageSize: total, total, totalPages: total === 0 ? 0 : 1 }`, response `pageSize` minimum 0; (b) omit the field | (a), corrected for zero records; one response shape for clients |
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
- **Compatibility (D2(a)), for each operation:**
  - with more than 100 scoped rows (fixtures insert 101), a call without `page`/`pageSize` returns all 101, ordered as today plus the tiebreak, with `pagination { page: 1, pageSize: 101, total: 101, totalPages: 1 }`;
  - the array elements are unchanged from today's DTO;
  - with zero scoped rows the response is `[]` with `pagination { page: 1, pageSize: 0, total: 0, totalPages: 0 }`;
  - in paged mode, zero rows give `{ page: 1, pageSize: 20, total: 0, totalPages: 0 }`;
  - sending only `pageSize` or only `page` switches to paged mode, with the other parameter at its default.
- **OpenAPI:** query and response schemas updated; the handoff matrix is regenerated.

No migration is needed. If listing ever needs a new index, that needs a migration numbered 010 or later, approved separately.

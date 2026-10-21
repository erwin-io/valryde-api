# G1 — Driver and Operator directory: contract proposal

**Status:** PROPOSAL. Not implemented. Needs Tech Lead approval of the public contract before any code is written.
**Owner:** Agent A (checklist IDs 3, 5, 7).
**Base:** `main` at `4a9a152`.
**Gap reference:** G1 in [the frontend handoff](AGENT_A_FRONTEND_API_INTEGRATION_HANDOFF.md), section 5.

## 1. Problem

The merged API asks clients for a `driverId` or `operatorId` but gives them no way to list them:

| Merged call that needs an ID | Who calls it | How the client gets the ID today |
|---|---|---|
| `POST /api/jeepneys/{id}/driver-assignment` `{driverId}` | OPERATOR, ADMIN | Only from the `POST /api/driver-associations` response at the moment of association. |
| `POST /api/fleet-groups/{id}/drivers` `{driverId}` | OPERATOR, ADMIN | Same. |
| `POST /api/jeepneys` / `POST /api/fleet-groups` with `operatorId` | ADMIN | No way. |

This blocks Agent D screens O08–O11, O14 and O16, and the Admin fleet-creation flows in Agent E.

## 2. Proposed endpoints

Both endpoints are read-only and use existing tables (`drivers`, `operators`, `users`, `driver_jeepney_assignments`, `fleet_group_drivers`, `jeepneys`, `fleet_groups`). **No migration is required.**

### 2.1 `GET /api/drivers` — `listDrivers`

| | |
|---|---|
| Route guard | `OPERATOR`, `ADMIN` |
| OPERATOR scope | Drivers whose `drivers.operator_id` is the caller's own active operator. No query can widen this. |
| ADMIN scope | All drivers, including drivers not yet associated with any operator. |
| DRIVER, COMMUTER | `403 FORBIDDEN`. Driver groupmate visibility is G2 (group members), not this endpoint. |

Query (all optional):

| Param | Type | Rule |
|---|---|---|
| `q` | string, 1–100 chars | Case-insensitive match on display name or email. |
| `operatorId` | uuid | ADMIN only. OPERATOR sending it gets `403 FORBIDDEN`, so a client cannot believe it filtered by someone else's operator. |
| `associated` | boolean | ADMIN only. `false` lists drivers without an operator. Same `403` rule for OPERATOR. |
| `status` | `ACTIVE` \| `DISABLED` | Driver record status. |
| `page` | integer ≥ 1, default 1 | Same envelope as `GET /api/transit-routes`. |
| `pageSize` | integer 1–100, default 20 | |

Response `200`:

```json
{
  "drivers": [
    {
      "driverId": "uuid",
      "userId": "uuid",
      "email": "driver@example.com",
      "displayName": "Juan Dela Cruz",
      "status": "ACTIVE",
      "userStatus": "ACTIVE",
      "emailVerified": true,
      "operatorId": "uuid | null",
      "activeJeepneyId": "uuid | null",
      "groupIds": ["uuid"],
      "createdAt": "2026-10-21T00:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 }
}
```

- `status` is the `drivers` row status, `userStatus` the account status. A driver is assignable only when both are `ACTIVE` (the existing assignment rule). The client shows the status but does not decide eligibility.
- `activeJeepneyId` is the open `driver_jeepney_assignments` row (`active_to IS NULL`), or `null`. It lets the Operator see who already drives what before reassigning. Assignment itself keeps its server-side replacement rule.
- `groupIds` lists only groups of the driver's operator. For ADMIN that is all of the driver's groups.
- Sort: `displayName` ascending, then `driverId`, so pages are stable.
- Privacy: no phone number, password data, tokens, roles of other accounts or audit data. The email is already known to the Operator, because association is done by email.

### 2.2 `GET /api/operators` — `listOperators`

| | |
|---|---|
| Route guard | `ADMIN` only |
| OPERATOR, DRIVER, COMMUTER | `403 FORBIDDEN` |

Query: `q` (display name or email), `status` (`ACTIVE` \| `DISABLED`), `page`, `pageSize` with the same rules as above.

Response `200`:

```json
{
  "operators": [
    {
      "operatorId": "uuid",
      "ownerUserId": "uuid",
      "email": "operator@example.com",
      "displayName": "Cebu Jeep Co.",
      "status": "ACTIVE",
      "userStatus": "ACTIVE",
      "driverCount": 4,
      "jeepneyCount": 6,
      "groupCount": 2,
      "createdAt": "2026-10-21T00:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 }
}
```

The `operators` table has no business name; `displayName` is the owner account's display name. Adding a separate operator business name would need a migration and is **not** part of this proposal.

### 2.3 Errors

Only existing codes are used: `401 AUTH_REQUIRED`, `401 SESSION_REVOKED`, `403 FORBIDDEN`, `400 VALIDATION_ERROR`, `429 RATE_LIMITED` (once PR [#7](https://github.com/erwin-io/valryde-api/pull/7) is merged). An OPERATOR caller without an active operator profile gets `403 FORBIDDEN`, matching `requireActorOperator` today.

No `GET /api/drivers/{id}` or `GET /api/operators/{id}` detail endpoint is proposed. The list carries every field, and detail routes can be added later if the Tech Lead wants them.

## 3. What stays unchanged

- All existing paths, DTOs and status codes.
- RBAC semantics: Operator = own fleet; Admin = platform; Driver scope untouched.
- Driver association remains Operator-initiated by verified email (`POST /api/driver-associations`).
- Effective-route precedence and resolver.
- No new table, column or error code.

## 4. Implementation plan (after approval)

1. `FleetService.listDrivers(actor, query)` and `FleetService.listOperators(actor, query)` with one parameterized SQL query each, plus a `COUNT(*)` for pagination. Scope comes from `requireActorOperator`, never from the query string.
2. Routes in `src/routes/fleet-routes.ts` with TypeBox schemas, operation IDs `listDrivers` and `listOperators`, OpenAPI tag `05 — Fleet Groups & Membership` (or a new tag if the Tech Lead prefers).
3. Reuse the transit pagination envelope schema.
4. Update the frontend handoff (G1 → class 1) and the endpoint matrix and index.

Expected size: about 150 lines of source, 1 integration test file.

## 5. Test plan

PostgreSQL integration test `test/pg-directory.integration.test.ts`, which deletes only the rows it creates (existing pattern):

| Case | Expected |
|---|---|
| Operator A lists drivers | Only A's drivers; B's driver and unassociated drivers absent. |
| Operator A sends `operatorId` or `associated` | `403 FORBIDDEN`. |
| Admin lists drivers, with `operatorId`, with `associated=false` | All drivers / one operator's drivers / unassociated only. |
| Driver with an active jeepney assignment and two groups | `activeJeepneyId` set; `groupIds` has both. |
| Driver after reassignment | `activeJeepneyId` follows the new active assignment. |
| `q` match on name and email, case-insensitive | Matching rows only. |
| Pagination: `pageSize=1` over 3 rows | `total=3`, `totalPages=3`, stable order across pages. |
| `pageSize=101`, `page=0`, bad uuid | `400 VALIDATION_ERROR`. |
| DRIVER and COMMUTER callers on both endpoints, OPERATOR on `/operators` | `403 FORBIDDEN`. |
| No token | `401 AUTH_REQUIRED`. |
| Admin lists operators | Counts match created fixtures; disabled operator visible with `status=DISABLED`. |
| Response shape | No `passwordHash` or token fields (response schema serialization strips extras; assert explicitly). |
| OpenAPI | `test/openapi.test.ts` includes `listDrivers` and `listOperators`. |

## 6. Decisions requested

1. Approve both endpoints and DTOs as written, or name changes.
2. Should OPERATOR get `403` for Admin-only filters (proposed) or should the API silently ignore them?
3. Should `email` be visible to Operators? Proposed: yes, because association already uses it.
4. Is no index on `drivers(operator_id)` acceptable for MVP scale? Proposed: yes; add an index in a later reviewed migration if needed.

# Agent A consolidated G1 and development-fixture UI handoff

**Consumers:** Agents C, D, and E

**Status:** Integration preparation. G1 PR #12 is accepted at development-review level but unmerged. Fixture PR #15 is undergoing final Tech Lead boundary re-review. Consumers must pin the accepted/merged head before integration and must not assume an open PR is deployed.

**No client repository is modified by this handoff.** G2 membership read/removal, G3 Driver self-assignment, and Stage 13b tracking persistence remain separate work.

## 1. Authentication used by all UI workflows

Fixture accounts use the ordinary API contract:

```text
POST /api/auth/login
POST /api/auth/refresh
POST /api/auth/logout
```

Use the bearer access token returned by login/refresh. Do not mint tokens, bypass email/session state, or infer roles client-side. Refresh rotation invalidates the prior refresh token. Logout and disabled/revoked-account behavior remain server-authoritative.

Fixture accounts are active and pre-verified only because the fixture command writes the approved development identity representation. No verification email is sent. The caller supplies one temporary password at seed time; no password is committed or printed.

## 2. G1 directory endpoints

### `GET /api/drivers`

- OPERATOR: only Drivers associated with the caller's active Operator profile.
- ADMIN: global Driver directory, including unassociated Drivers.
- DRIVER/COMMUTER: `403 FORBIDDEN`.
- ADMIN+OPERATOR multi-role account: ADMIN semantics.

Query: `q`, `status`, `page`, `pageSize`; ADMIN additionally may use `operatorId` and `associated`. OPERATOR use of the ADMIN-only filters returns `403`.

Response envelope:

```json
{
  "drivers": [
    {
      "driverId": "uuid",
      "userId": "uuid",
      "email": "driver@example.com",
      "displayName": "Driver",
      "status": "ACTIVE",
      "userStatus": "ACTIVE",
      "emailVerified": true,
      "operatorId": "uuid-or-null",
      "activeJeepneyId": "uuid-or-null",
      "groupIds": ["uuid"],
      "createdAt": "ISO-8601"
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 }
}
```

Send `driverId`, never `userId`, to Driver assignment and fleet-group mutation APIs.

### `GET /api/operators`

ADMIN only. Query: `q`, `status`, `page`, `pageSize`.

```json
{
  "operators": [
    {
      "operatorId": "uuid",
      "ownerUserId": "uuid",
      "email": "operator@example.com",
      "displayName": "Operator",
      "status": "ACTIVE",
      "userStatus": "ACTIVE",
      "driverCount": 1,
      "jeepneyCount": 1,
      "groupCount": 1,
      "createdAt": "ISO-8601"
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 }
}
```

Keep `operatorId`, `ownerUserId`, `driverId`, and `userId` distinct in client stores and forms.

## 3. Fixture environment and commands

Fixtures may run only against a dedicated, isolated local Valryde application PostgreSQL/PostGIS database. Seed and cleanup refuse production mode, a non-loopback server, database-name mismatch, a non-`dbo` active schema, missing migrations/PostGIS, Traccar table markers, any non-fixture user, or a cross-boundary business/audit relationship.

The verified identity is:

```text
current_database() + inet_server_addr() + inet_server_port() + current_schema()
```

Use the commands introduced by fixture PR #15:

```text
npm run dev:fixtures:verify
npm run dev:fixtures:seed
npm run dev:fixtures:manifest
npm run dev:fixtures:cleanup
```

`DEV_FIXTURE_TARGET_DATABASE`, `DEV_FIXTURE_CONFIRM`, and the seed-only `DEV_FIXTURE_PASSWORD` are temporary shell values. Never put the password in `.env`, Postman, screenshots, source, or documentation. Re-seeding is idempotent and replaces fixture sessions, so clients log in again. Cleanup refuses unsafe ownership relationships and deletes only manifest IDs after every preflight passes.

## 4. Stable fixture identities

| Persona | Email | User ID | Roles |
|---|---|---|---|
| Commuter | `dev.commuter@valryde.test` | `d1000000-0000-4000-8000-000000000001` | COMMUTER |
| Driver A | `dev.driver-a@valryde.test` | `d1000000-0000-4000-8000-000000000002` | DRIVER |
| Operator A | `dev.operator-a@valryde.test` | `d1000000-0000-4000-8000-000000000003` | OPERATOR |
| Admin | `dev.admin@valryde.test` | `d1000000-0000-4000-8000-000000000004` | ADMIN |
| Dual-role | `dev.driver-operator@valryde.test` | `d1000000-0000-4000-8000-000000000005` | DRIVER, OPERATOR |
| Driver B | `dev.driver-b@valryde.test` | `d1000000-0000-4000-8000-000000000006` | DRIVER |
| Operator B | `dev.operator-b@valryde.test` | `d1000000-0000-4000-8000-000000000007` | OPERATOR |

Business IDs are stable and discoverable through `npm run dev:fixtures:manifest`. Important UI records include:

- `DEV-ACTIVE-01`: Operator A, Driver A, active direct route, approved application, installed/verified GPS request, synthetic application-DB mapping;
- `DEV-PENDING-01`: pending vehicle application;
- `DEV-NOASSIGN-01`: no Driver or effective route;
- `DEV-CONFLICT-01`: route-conflict mutation target; and
- `DEV-TENANT-B-01`: cross-operator denial target.

The synthetic device/mapping is not a Traccar device and is not physical GPS evidence.

## 5. UI workflow matrix

| Consumer | Workflow | API/data expectation |
|---|---|---|
| C | Login/session behavior | Use Commuter fixture; refresh/logout normally. |
| C | Public transit | Use public route list/detail for `DEV-10A` and `DEV-20B`; pagination envelope remains server-owned. |
| C | Live availability | Not supplied by Agent A fixtures alone; depends on accepted Stage 13b/Agent B state and public gateway. Do not fake availability from the synthetic mapping. |
| D Operator | Driver picker | `GET /api/drivers`; only Operator A Drivers returned. Use `driverId`. |
| D Operator | Fleet and route | List own jeepneys/groups; inspect effective route; exercise assignment/conflict APIs with fixture IDs. |
| D Driver | Own permitted fleet | Driver A sees permitted own/group vehicles; Driver B remains isolated. G3 `/me` assignment remains unavailable. |
| D | Applications/GPS | Inspect approved, pending, installed/verified, and rejected states; physical installation is owner-gated. |
| E | Operator directory | `GET /api/operators` as ADMIN; use `operatorId` for Admin fleet creation. |
| E | Global Driver directory | `GET /api/drivers` as ADMIN; filter by `operatorId`, association, status, and search. |
| E | Admin workflow | Inspect applications/GPS states and synthetic mapping; do not represent it as Traccar activation. |

## 6. Negative and conflict evidence

- Operator A assigning Driver B to an Operator A jeepney returns `403 FORBIDDEN`.
- Driver A cannot see Operator B's jeepney.
- Adding `DEV-CONFLICT-01` to the conflicting route group returns `409 ROUTE_ASSIGNMENT_CONFLICT`.
- `GET /api/jeepneys/{DEV-NOASSIGN-01}/effective-route` returns `effectiveRouteDirection: null`.
- DRIVER and COMMUTER receive `403` from both administrative directory surfaces as applicable; unauthenticated callers receive `401`.
- Disabled/revoked sessions follow the existing `SESSION_REVOKED` policy.

UI tests must assert these server responses. Hiding controls is not authorization.

## 7. Pagination and error handling

Directory pages use:

```json
{ "page": 1, "pageSize": 20, "total": 0, "totalPages": 0 }
```

Empty results are successful. Preserve `400 VALIDATION_ERROR`, `401 AUTH_REQUIRED`, `401 SESSION_REVOKED`, `403 FORBIDDEN`, `409 ROUTE_ASSIGNMENT_CONFLICT`, and `429 RATE_LIMITED`. Honor `retry-after` for rate limiting. Do not retry ownership failures with guessed identifiers.

## 8. Integration gates

- PR #12 must be merged/deployed before clients call the G1 directory endpoints.
- PR #15 must pass final Tech Lead review and be run only on an isolated development database before clients use the fixture identities.
- G2 group member read/removal and G3 Driver self-assignment remain missing by design.
- Agent B Stage 13b current-state/compliance and a public/private tracking gateway remain separate approval and implementation work.
- Production SMTP, Google client IDs, permanent Admin credentials, physical GPS/Traccar activation, and owner physical-device acceptance remain external gates.

## 9. Review heads used for this handoff

- G1 PR #12: `92ad34158e1c9fe840b7264b4c3912aec5eeb25b` (accepted for development-level review, open/unmerged at preparation time).
- Fixture PR #15: `aa989254f62a7d7dab899fd1b4eb78171598ccb5` (final environment/ownership boundary correction pushed; Tech Lead re-review pending at preparation time).
- Canonical main baseline: `827738c0f2c33ad3082f6a4a38a8e35669d4b0ea`.

Pin exact accepted/merge SHAs in downstream status before executing integration. Do not silently substitute an older open-PR head.


# VALRYDE development business fixtures

**Scope:** isolated local Valryde application development database only.

**Consumers:** Agents C, D, and E.

**Not affected:** Traccar database, production users, runtime authentication policy, email providers.

## Safety boundary

Every seed, verify, and cleanup operation inspects PostgreSQL before it writes. The command requires all of the following:

- `NODE_ENV=development`;
- the connected database name exactly matches `DEV_FIXTURE_TARGET_DATABASE`;
- the database name does not contain `prod`, `production`, or `live`;
- PostgreSQL reports a loopback server address (`127.0.0.1` or `::1`);
- the active schema is `dbo`;
- PostGIS and all required Valryde application tables exist;
- no `tc_users`, `tc_devices`, or `tc_positions` Traccar table markers exist; and
- the `users` table is empty or contains only the exact manifest identities. Any unrelated user makes the database shared and seed/cleanup refuses it.

The database identity is the complete verified tuple printed by `dev:fixtures:verify`:

```text
current_database() + inet_server_addr() + inet_server_port() + current_schema()
```

`DEV_FIXTURE_TARGET_DATABASE` must exactly equal `current_database()`. The reported server address must be loopback, and `current_schema()` must be `dbo` under `search_path=dbo,public`. A familiar database name or a loopback address by itself is not sufficient: every condition above must pass. Create a dedicated local application database if the normal development database contains any non-fixture account or shared business data.

Seed and cleanup run in one transaction under a PostgreSQL advisory lock. All ownership and relationship assertions execute before the first delete or insert; a failure rolls back the whole operation. The tool refuses fixture-ID/email/route-code/plate collisions instead of overwriting them. It also refuses unexpected roles or external identities on fixture users and any cross-boundary profile, route, fleet, assignment, application, GPS, mapping, membership, or audit relationship. Cleanup uses only manifest IDs after those checks pass; it never resets a schema, truncates a table, removes an unrelated row, or relies on a cascading foreign key to erase an unowned relationship.

The CLI exposes no override for the user-isolation or relationship checks. The service has one test-only shared-database option so PostgreSQL test files can coexist in CI; that option is honored only with `environment=test` and is not configurable through the CLI or environment variables.

## Commands

Keep the password and confirmation values in the current PowerShell process only. Replace `valrydedb` with the exact isolated development application database name when needed.

Seed or deterministically refresh the fixtures:

```powershell
$env:DEV_FIXTURE_TARGET_DATABASE = 'valrydedb'
$env:DEV_FIXTURE_PASSWORD = Read-Host 'Development fixture password' -MaskInput
$env:DEV_FIXTURE_CONFIRM = 'SEED_VALRYDE_DEVELOPMENT_FIXTURES'

try {
  npm run dev:fixtures:seed
  npm run dev:fixtures:verify
} finally {
  Remove-Item Env:DEV_FIXTURE_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:DEV_FIXTURE_CONFIRM -ErrorAction SilentlyContinue
}
```

Inspect the non-secret stable manifest:

```powershell
npm run dev:fixtures:manifest
```

Remove only manifest-owned records:

```powershell
$env:DEV_FIXTURE_TARGET_DATABASE = 'valrydedb'
$env:DEV_FIXTURE_CONFIRM = 'CLEAN_VALRYDE_DEVELOPMENT_FIXTURES'

try {
  npm run dev:fixtures:cleanup
  npm run dev:fixtures:verify
} finally {
  Remove-Item Env:DEV_FIXTURE_TARGET_DATABASE -ErrorAction SilentlyContinue
  Remove-Item Env:DEV_FIXTURE_CONFIRM -ErrorAction SilentlyContinue
}
```

`DATABASE_URL`, `DATABASE_SCHEMA=dbo`, and a valid development `JWT_SECRET` still come from the ignored local `.env`. Before running seed or cleanup, run `npm run dev:fixtures:verify` and compare the reported database, server address, port, and schema to the intended dedicated local database. Do not add `DEV_FIXTURE_PASSWORD` or either confirmation value to `.env`, source, Postman data, screenshots, or documentation.

## Test accounts

All accounts are active and email-verified at seed time. Their password is the value supplied through `DEV_FIXTURE_PASSWORD`; it is Argon2id-hashed once and never printed or stored by the fixture tooling. No authentication challenge or email is created.

| Purpose | Email | User ID | Roles |
|---|---|---|---|
| Commuter | `dev.commuter@valryde.test` | `d1000000-0000-4000-8000-000000000001` | `COMMUTER` |
| Driver A | `dev.driver-a@valryde.test` | `d1000000-0000-4000-8000-000000000002` | `DRIVER` |
| Operator A | `dev.operator-a@valryde.test` | `d1000000-0000-4000-8000-000000000003` | `OPERATOR` |
| Admin | `dev.admin@valryde.test` | `d1000000-0000-4000-8000-000000000004` | `ADMIN` |
| Driver + Operator | `dev.driver-operator@valryde.test` | `d1000000-0000-4000-8000-000000000005` | `DRIVER`, `OPERATOR` |
| Driver B | `dev.driver-b@valryde.test` | `d1000000-0000-4000-8000-000000000006` | `DRIVER` |
| Operator B | `dev.operator-b@valryde.test` | `d1000000-0000-4000-8000-000000000007` | `OPERATOR` |

Use normal `POST /api/auth/login`, refresh rotation, bearer authorization, and logout. Do not mint tokens manually or bypass RBAC. Re-running the seed replaces fixture accounts transactionally and therefore revokes their prior refresh sessions; clients should sign in again.

## Stable business manifest

### Profiles and ownership

| Record | Stable ID | Relationship |
|---|---|---|
| Operator A | `d2000000-0000-4000-8000-000000000001` | owned by Operator A user |
| Operator B | `d2000000-0000-4000-8000-000000000002` | owned by Operator B user |
| Dual-role Operator | `d2000000-0000-4000-8000-000000000003` | owned by dual-role user |
| Driver A | `d3000000-0000-4000-8000-000000000001` | associated with Operator A |
| Driver B | `d3000000-0000-4000-8000-000000000002` | associated with Operator B |
| Dual-role Driver | `d3000000-0000-4000-8000-000000000003` | associated with its own dual-role Operator |

### Routes and directions

| Record | Stable ID | State |
|---|---|---|
| `DEV-10A` route | `d4000000-0000-4000-8000-000000000001` | ACTIVE |
| `DEV-20B` route | `d4000000-0000-4000-8000-000000000002` | ACTIVE |
| 10A Outbound | `d5000000-0000-4000-8000-000000000001` | ACTIVE, Cebu LineString, 100 m corridor |
| 10A Inbound | `d5000000-0000-4000-8000-000000000002` | ACTIVE, reverse LineString |
| 20B Outbound | `d5000000-0000-4000-8000-000000000003` | ACTIVE |

### Fleet records

| Jeepney / plate | Stable ID | Owner / scenario |
|---|---|---|
| `DEV-ACTIVE-01` | `d6000000-0000-4000-8000-000000000001` | Operator A; Driver A; direct 10A Outbound; ACTIVE |
| `DEV-PENDING-01` | `d6000000-0000-4000-8000-000000000002` | Operator A; pending application |
| `DEV-NOASSIGN-01` | `d6000000-0000-4000-8000-000000000003` | Operator A; no Driver or route; approved application and pending GPS |
| `DEV-CONFLICT-01` | `d6000000-0000-4000-8000-000000000004` | Operator A; Primary group member used for route-conflict attempt |
| `DEV-TENANT-B-01` | `d6000000-0000-4000-8000-000000000005` | Operator B; Driver B; cross-tenant denial target |

| Group | Stable ID | Active route / members |
|---|---|---|
| DEV Primary Route Group | `d7000000-0000-4000-8000-000000000001` | 10A Inbound; Active A and Conflict A; Driver A |
| DEV Conflicting Route Group | `d7000000-0000-4000-8000-000000000002` | 20B Outbound; no jeepney initially |
| DEV Operator B Group | `d7000000-0000-4000-8000-000000000003` | 20B Outbound; tenant-B jeepney and Driver B |

Driver assignment IDs are `d8000000-0000-4000-8000-000000000001` and `...0002`. Route assignment IDs are `d8000000-0000-4000-8000-000000000101` through `...0104`.

### Applications and GPS

| Record | Stable ID | State |
|---|---|---|
| Active A application | `d9000000-0000-4000-8000-000000000001` | APPROVED |
| Pending A application | `d9000000-0000-4000-8000-000000000002` | PENDING |
| No-assignment A application | `d9000000-0000-4000-8000-000000000003` | APPROVED |
| Operator B application | `d9000000-0000-4000-8000-000000000004` | APPROVED |
| Installed A GPS request | `da000000-0000-4000-8000-000000000001` | INSTALLED / VERIFIED |
| Pending A GPS request | `da000000-0000-4000-8000-000000000002` | PENDING / NOT_STARTED |
| Rejected B GPS request | `da000000-0000-4000-8000-000000000003` | REJECTED |
| Synthetic GPS device | `db000000-0000-4000-8000-000000000001` | application DB only |
| Synthetic mapping | `dc000000-0000-4000-8000-000000000001` | application DB only; no Traccar write |

The synthetic device/mapping exercises Admin UI states only. It does not create or alter a device in Traccar and must not be treated as physical-device verification.

## Scenario expectations for Agents C, D, and E

- **Success:** login as Operator A or Admin and inspect Active A, its Driver, direct effective route, approved application, installed/verified GPS request, and synthetic mapping state.
- **Failure:** Admin can inspect the rejected Operator B GPS request.
- **No assignment:** `GET /api/jeepneys/{DEV-NOASSIGN-01}/effective-route` returns `null`; there is no Driver assignment.
- **Ownership denied:** Operator A attempts to assign Driver B to an Operator A jeepney and receives `403 FORBIDDEN`.
- **Route conflict:** Operator A attempts to add Conflict A to DEV Conflicting Route Group and receives `409 ROUTE_ASSIGNMENT_CONFLICT`.
- **Tenant isolation:** Operator A lists only its fleet/application/GPS records; Driver A does not see Operator B's jeepney.
- **Public route:** Commuter can use the public transit endpoints for active 10A/20B route DTOs.

G1 directory endpoints remain a separate PR. After G1 merges, Operator A uses `GET /api/drivers` for its own Drivers and Admin uses `GET /api/operators` plus global `GET /api/drivers`. G2 membership removal/read and G3 Driver self-assignment are not created by this fixture tooling.

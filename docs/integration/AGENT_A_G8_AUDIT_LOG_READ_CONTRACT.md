# Agent A — G8 Admin audit-log read: contract

**Status:** IMPLEMENTED IN THIS PR, CONTRACT PROPOSED, **NOT FOR MERGE** until Agent G approves metadata exposure (G8-D3, §5). Agent G accepts or adjusts G8-D1 to G8-D6 below before merge. No migration, no change to any writer, no retention or deletion behavior.
**Checklist:** Admin audit screen (Agent E); backend gap G8 · **Base:** `main` `810c8a13356ddbf0e28a4faf5ad7f86ce0a30479`

## 1. Sources

- Agent A handoff: every Admin/Operator mutation that changes ownership, routes, approval or device mapping creates an audit record. Records already exist in `audit_logs` (migration 001); there is no read path.
- Agent A frontend handoff gap table: G8 = `GET /api/admin/audit-logs?entityType&entityId&page`, read-only, existing table.
- Pagination convention already merged for G1 directories: `page` (default 1), `pageSize` (default 20, max 100), response `pagination { page, pageSize, total, totalPages }`.

## 2. Endpoint

`GET /api/admin/audit-logs` — operationId `listAuditLogsAsAdmin`, OpenAPI tag 15 (Administration & Reports), bearer JWT.

| Query | Type | Rule |
|---|---|---|
| `entityType` | string | `^[A-Z][A-Z0-9_]{0,63}$` (writers use upper snake case, e.g. `JEEPNEY`, `GPS_SETUP_REQUEST`) |
| `entityId` | string | 1–128 characters; exact match (ids are stored as text) |
| `actorUserId` | uuid | exact match |
| `action` | string | same pattern as `entityType`, e.g. `VEHICLE_ROUTE_ASSIGNED` |
| `from` | ISO 8601 date-time | inclusive lower bound on `createdAt` |
| `to` | ISO 8601 date-time | exclusive upper bound; `from < to` or 400 |
| `page` | integer ≥ 1 | default 1 |
| `pageSize` | integer 1–100 | default 20 |

Response `200`:

```json
{
  "auditLogs": [
    {
      "id": "uuid",
      "actorUserId": "uuid or null",
      "action": "JEEPNEY_UPDATED",
      "entityType": "JEEPNEY",
      "entityId": "uuid-as-text",
      "metadata": { "fields": ["status"] },
      "createdAt": "2026-10-23T08:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 }
}
```

Ordering is `createdAt DESC, id DESC`, so pages are stable when timestamps tie. `actorUserId` is null when the actor account was deleted (`ON DELETE SET NULL`).

Errors: `400 VALIDATION_ERROR` (schema, `from ≥ to`), `401 AUTH_REQUIRED` / `SESSION_REVOKED`, `403 FORBIDDEN` (any role other than ADMIN), `429 RATE_LIMITED` (global limit). There is no POST, PATCH, PUT or DELETE on the collection.

## 3. Decisions for Agent G

| ID | Decision | Implemented as | Alternatives |
|---|---|---|---|
| G8-D1 | Who may read | **ADMIN only**, platform-wide | Operator-scoped read of its own fleet's entries (needs per-entity ownership joins; not proposed for MVP) |
| G8-D2 | Path, filters, pagination envelope | As §2, G1 envelope | Cursor pagination (not used elsewhere in the API) |
| G8-D3 | Metadata exposure | **Not approved.** The code in this PR returns metadata verbatim; §5 gives the inventory and the conservative replacement | §5.2 allowlist (recommended), or verbatim |
| G8-D4 | Retention and deletion | **Not defined here.** Read-only; rows are never removed by the API. Retention is an owner/policy decision | — |
| G8-D5 | Actor display | `actorUserId` only; no name or email joined in | Join `displayName` (adds personal data to the response) |
| G8-D6 | Indexing | Existing `audit_logs_entity_idx (entity_type, entity_id, created_at DESC)` serves entity history. Actor, action and time filters scan without a dedicated index, which is acceptable at MVP volume | An additional index needs a migration numbered 010 or later, approved separately |

## 4. Tests

`test/pg-audit-log-read.integration.test.ts` (CI PostGIS only; isolated rows, removed by id):

- entity history newest first, with a same-timestamp tie ordered by id;
- pages of 2 cover all 4 rows with no gaps or repeats; page past the end returns an empty page with correct totals;
- actor, action and half-open time-window filters;
- OPERATOR and COMMUTER get 403; no token gets 401;
- 400 for `pageSize` 101, `page` 0, lower-case `entityType`, non-uuid actor, non-date `from`, and `from = to`;
- POST/PATCH/PUT/DELETE on the collection are not routed (404/405).

`test/openapi.test.ts` asserts the operation id, tag and bearer security.

## 5. Metadata exposure inventory and redaction proposal (G8-D3)

Source: every `audit_logs` insert on `main` `810c8a1`, found by searching `src/` for `audit(`, `writeAudit(` and `INSERT INTO audit_logs`. Agent B code (`src/tracking`, `src/bridge.ts`) writes no audit rows. No writer and no retention behavior changes in this PR.

### 5.1 Inventory

Every row also exposes `id`, `actorUserId`, `action`, `entityType`, `entityId` and `createdAt`. The table lists what `metadata` holds.

| Action | Writer | entityType / entityId | Actor | Metadata keys → value domain | Personal data in metadata |
|---|---|---|---|---|---|
| `ADMIN_BOOTSTRAPPED` | `admin-bootstrap-service.ts` | USER / new Admin id | that Admin | `source` → literal `INTERNAL_CLI` | none |
| `USER_REGISTERED` | `auth-service.ts` | USER / user id | the user | `role` → COMMUTER, DRIVER or OPERATOR | none (role only) |
| `EMAIL_VERIFIED` | `auth-service.ts` | USER / user id | the user | — | none |
| `GOOGLE_IDENTITY_LINKED` | `auth-service.ts` | USER / user id | the user | — | none (Google subject not stored here) |
| `PASSWORD_RESET` | `auth-service.ts` | USER / user id | the user | — | none |
| `PASSWORD_CHANGED` | `auth-service.ts` | USER / user id | the user | — | none |
| `EMAIL_CHANGED` | `auth-service.ts` | USER / user id | the user | — | none (old and new address not stored) |
| `AUTH_EMAIL_DELIVERY_FAILED` | `auth-service.ts` | AUTH_CHALLENGE / challenge id | the user | `type` → challenge type enum | none; the challenge id is not the token (tokens are stored hashed elsewhere) |
| `USER_STATUS_CHANGED` | `admin-user-routes.ts` | USER / target user id | Admin | `status` → ACTIVE or DISABLED | none |
| `DRIVER_ASSOCIATED` | `fleet-service.ts` | DRIVER / driver id | Operator | `operatorId` → uuid | none |
| `JEEPNEY_CREATED` | `fleet-service.ts` | JEEPNEY / jeepney id | creator | `operatorId` → uuid or null | none |
| `JEEPNEY_UPDATED` | `fleet-service.ts` | JEEPNEY / jeepney id | Admin, Operator or draft Driver | `fields` → names from {`colorHex`, `description`, `status`} | none (names only, never values) |
| `FLEET_GROUP_CREATED` | `fleet-service.ts` | FLEET_GROUP / group id | Operator or Admin | `operatorId` → uuid | none |
| `FLEET_GROUP_UPDATED` | `fleet-service.ts` | FLEET_GROUP / group id | Operator or Admin | `fields` → names from {`name`, `description`, `status`} | none |
| `FLEET_GROUP_DRIVER_ADDED` / `_REMOVED` | `fleet-service.ts` | FLEET_GROUP / group id | Operator or Admin | `driverId` → uuid | none |
| `FLEET_GROUP_JEEPNEY_ADDED` / `_REMOVED` | `fleet-service.ts` | FLEET_GROUP / group id | Operator or Admin | `jeepneyId` → uuid | none |
| `DRIVER_JEEPNEY_ASSIGNED` | `fleet-service.ts` | JEEPNEY / jeepney id | Operator or Admin | `driverId` → uuid | none |
| `DRIVER_JEEPNEY_UNASSIGNED` | `fleet-service.ts` | JEEPNEY / jeepney id | Operator or Admin | `driverId`, `assignmentId` → uuid | none |
| `TRANSIT_ROUTE_CREATED` | `transit-service.ts` | TRANSIT_ROUTE / route id | Admin | `{}` | none |
| `TRANSIT_ROUTE_UPDATED` | `transit-service.ts` | TRANSIT_ROUTE / route id | Admin | `fields` → names from {`publicName`, `description`, `routeColorHex`, `status`} | none |
| `ROUTE_DIRECTION_CREATED` | `transit-service.ts` | ROUTE_DIRECTION / direction id | Admin | `routeId` → uuid | none |
| `ROUTE_DIRECTION_UPDATED` | `transit-service.ts` | ROUTE_DIRECTION / direction id | Admin | `fields` → names from {`directionLabel`, `originName`, `destinationName`, `geometry`, `corridorM`, `status`} | none (geometry itself is never copied) |
| `VEHICLE_ROUTE_ASSIGNED` | `transit-service.ts` | JEEPNEY or FLEET_GROUP / target id | Operator | `routeDirectionId` → uuid | none |
| `VEHICLE_APPLICATION_SUBMITTED` | `vehicle-workflow-service.ts` | VEHICLE_APPLICATION / application id | submitter | `jeepneyId` → uuid | none (applicant notes not copied) |
| `VEHICLE_APPLICATION_REVIEWED` | `vehicle-workflow-service.ts` | VEHICLE_APPLICATION / application id | Admin | `decision` → APPROVED or REJECTED | none (review notes not copied) |
| `GPS_SETUP_REQUESTED` | `vehicle-workflow-service.ts` | GPS_SETUP_REQUEST / request id | requester | `jeepneyId` → uuid | none |
| `GPS_SETUP_STATUS_CHANGED` | `vehicle-workflow-service.ts` | GPS_SETUP_REQUEST / request id | Admin | `from`, `to` → GPS setup status enum | none (rejected reason not copied) |
| `GPS_DEVICE_MAPPED` | `vehicle-workflow-service.ts` | GPS_SETUP_REQUEST / request id | Admin | `jeepneyId`, `gpsDeviceId` → uuid | none (IMEI, serial number and Traccar unique id not copied) |
| `GPS_INSTALLATION_VERIFIED` | `vehicle-workflow-service.ts` | GPS_SETUP_REQUEST / request id | Admin | `result` → VERIFIED or FAILED | none (check notes not copied) |

**Findings**

1. No current writer stores an email address, name, password, token, IMEI, serial number, Traccar unique id, coordinate, geometry or free-text note in `metadata`.
2. The `fields` arrays are built from request-body key names. Each update body schema sets `additionalProperties: false`, so only the field names listed above can appear.
3. **Residual risk:** nothing stops a future writer from putting personal data in `metadata`. A verbatim read path would expose it to every Admin, which is why §5.2 adds a guard on the read side.
4. Account-security events (`PASSWORD_*`, `EMAIL_*`, `GOOGLE_IDENTITY_LINKED`) carry no metadata. The fact that the event happened, tied to a user id, is itself account activity that Admins would see. Showing them or not is part of G8-D1/D3.

### 5.2 Conservative redaction proposal (recommended)

This would be implemented only on the read path, after approval; writers stay unchanged.

1. **Allowlist per action.** The response `metadata` contains only the keys listed for that action in §5.1. Any other key is dropped.
2. **Value checks.** Each allowed key is returned only when its value matches the domain in §5.1: a uuid, a listed enum literal, or an array of listed field names. Anything else is dropped, so free text can never pass even under an allowed key.
3. **Unknown actions.** An action not in the allowlist (for example, a future writer that hasn't been registered yet) returns `metadata: {}`.
4. **`metadataRedacted` flag.** A boolean on each entry, `true` when anything was dropped, so Agent E can show that metadata was withheld without revealing it.
5. **Adding writers.** New writers (for example, the G7 `ROUTE_CHANGE_REQUEST_*` actions) must add their keys to the allowlist in the same PR. A unit test fails if any `audit(`/`writeAudit(` call site uses an action missing from the allowlist.
6. **No other change.** Identifiers (`actorUserId`, `entityId`) stay as they are; no names or emails are joined in (G8-D5). Retention stays undefined (G8-D4).

**Tests to add with it:**
- An inserted row with an extra key (`{"email":"x@example.com"}`) comes back redacted with `metadataRedacted: true`.
- So does a row with free text under an allowed key, and a row with an unknown action.
- Every §5.1 action round-trips its allowed keys unchanged.

**Decision needed:**
- Approve §5.2 (recommended), or approve the verbatim exposure as implemented now.
- Either way, also decide whether the account-security actions in finding 4 are excluded from the default listing.

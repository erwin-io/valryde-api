# Agent A — G8 Admin audit-log read: contract

**Status:** IMPLEMENTED IN THIS PR, CONTRACT PROPOSED. Agent G accepts or adjusts G8-D1 to G8-D6 below before merge. No migration, no change to any writer, no retention or deletion behavior.
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
| G8-D3 | Metadata exposure | Returned verbatim. Current writers store only ids, statuses, field names, decisions and types; no email, password, token, coordinate or free text | Per-action allowlist of metadata keys |
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

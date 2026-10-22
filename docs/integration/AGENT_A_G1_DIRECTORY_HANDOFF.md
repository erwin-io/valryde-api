# Agent A G1 directory integration handoff

**Owner:** Agent A — Core Platform / Fastify API (checklist IDs 3, 5, 7)  
**Consumers:** Agent D (Driver/Operator mobile), Agent E (Admin web)  
**Scope:** G1 only. This handoff does not authorize or implement G2 group-membership management or G3 Driver self-assignment APIs.

## Endpoints

All paths use the `/api` server prefix and require a verified, active bearer session.

### `GET /api/drivers`

- `OPERATOR`: lists only Drivers associated with the caller's active Operator profile. The server derives this scope from the session.
- `ADMIN`: lists all Drivers, including unassociated Drivers.
- `DRIVER`, `COMMUTER`: `403 FORBIDDEN`.
- A user holding both `ADMIN` and `OPERATOR` receives ADMIN semantics.

Query parameters:

| Name | Type | Access / behavior |
|---|---|---|
| `q` | string, 1–100 | Case-insensitive display-name or email search. |
| `operatorId` | UUID | ADMIN only. OPERATOR use returns `403`. |
| `associated` | boolean | ADMIN only. `false` selects Drivers with no Operator; OPERATOR use returns `403`. |
| `status` | `ACTIVE` or `DISABLED` | Filters the Driver business record, not the User account. |
| `page` | integer ≥ 1 | Default `1`. |
| `pageSize` | integer 1–100 | Default `20`. |

Response:

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
      "operatorId": "uuid-or-null",
      "activeJeepneyId": "uuid-or-null",
      "groupIds": ["uuid"],
      "createdAt": "2026-10-22T00:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 }
}
```

Rows are ordered by `displayName`, then `driverId`. `activeJeepneyId` is the current open Driver-to-jeepney assignment. `groupIds` contains the Driver's groups in the associated Operator scope. Clients may display these values but must not infer assignment eligibility; mutation endpoints still validate current account, Driver, ownership, and fleet state.

### `GET /api/operators`

- `ADMIN` only.
- `OPERATOR`, `DRIVER`, `COMMUTER`: `403 FORBIDDEN`.

Query parameters: `q` (display name or email, 1–100), `status` (`ACTIVE` or `DISABLED`), `page` (default 1), and `pageSize` (default 20, maximum 100).

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
      "createdAt": "2026-10-22T00:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 }
}
```

`status` is the Operator business-record state; `userStatus` is the owner account state. Counts include the Operator's current database records and are server-calculated. Rows are ordered by `displayName`, then `operatorId`.

## Agent D integration

Use `GET /api/drivers` for the Operator's Driver picker in assignment and fleet-group workflows. Send the selected `driverId`, never `userId`, to:

- `POST /api/jeepneys/{jeepneyId}/driver-assignment`
- `POST /api/fleet-groups/{groupId}/drivers`

Refresh the directory after association or reassignment. Treat `status`, `userStatus`, and `activeJeepneyId` as display and guidance fields; the mutation response remains authoritative.

Still dependent on later approved work:

- **G2:** read/remove group members. G1 returns Driver `groupIds` but does not return full group-member lists and adds no removal operation.
- **G3:** Driver-facing self-assignment/home contract. G1 is not accessible to a DRIVER and does not replace a `/me` assignment endpoint.

## Agent E integration

Use `GET /api/operators` to select `operatorId` for Admin fleet creation. Use the ADMIN form of `GET /api/drivers` for global Driver monitoring and association filters. Keep `operatorId`, `ownerUserId`, `driverId`, and `userId` as distinct identifiers.

The directories intentionally exclude password data, tokens, roles of other accounts, phone data, and audit records. Disabled records may be visible to ADMIN for monitoring, while the existing authentication policy rejects disabled-account sessions.

## Errors and pagination

- `400 VALIDATION_ERROR`: invalid query values.
- `401 AUTH_REQUIRED` or `SESSION_REVOKED`: missing/invalid or disabled/revoked session.
- `403 FORBIDDEN`: role, inactive Operator profile, or OPERATOR attempt to use ADMIN-only filters.
- `429 RATE_LIMITED`: global API limit; honor `retry-after`.

An empty page is successful and returns an empty array with `total: 0` and `totalPages: 0`. Do not derive cross-tenant results client-side or retry a `403` with different identifiers.

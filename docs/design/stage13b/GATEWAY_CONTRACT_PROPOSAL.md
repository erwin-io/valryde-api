# Tracking DTO, REST and Pusher proposal

Status: PROPOSED D09–D11; **no endpoint, schema, channel, credential or client integration implemented/approved here**. Existing A endpoints/auth/errors remain unchanged. [Index and dependencies](README.md).

## Projection, authorization and consistency

Authorize the active, verified Valryde user through A on every request/signature; roles/ownership never come from query parameters. Use the future transaction-aware A scope/resolver interfaces in one short REPEATABLE READ, READ ONLY snapshot transaction. A scope is existence-based (not matching-row count) and collections are DISTINCT jeepneys, preserving multi-group Driver access. A group/operator filter only narrows authorized rows. Membership, vehicle/workflow/device eligibility and effective assignment are revalidated at read time; a stale latest-state ownership/route snapshot is insufficient authority.

Commuter eligibility per row: current approved/ACTIVE jeepney+device and INSTALLED/VERIFIED mapping; coherent generation; current tracker ONLINE; valid accepted fix age **0<=snapshotAt-fixTime<=30s**; current ACTIVE selected effective route/direction; context matches canonical geometry/corridor/assignment; ON_ROUTE. Motion can be MOVING or STOPPED, no ACC prerequisite. Missing/conflicting/inactive route or invalid/stale/missing fix→unavailable/UNKNOWN. A missing/expired/non-RUNNING writer lease projects current tracking as UNKNOWN instead of asserting hardware OFFLINE; this conservative operational-quality rule needs D12 sign-off. It never widens30s.

The stale/context job may lag. REST/Pusher projection applies these checks without writing rows, masks stale compliance UNKNOWN and withholds public coordinates immediately. fresh_until is fix_time+30s; proposed availableUntil is the earlier of fresh_until and current valid lease expiry. Lease renewal can extend this safe display deadline through later snapshots, never beyond the GPS freshness deadline. A future-within-tolerance admitted fix is not public while snapshot age<0.

MVP snapshot proposal: one bounded collection in one request/transaction, max1000 rows (D09 capacity parameter). Query cap+1 and reject oversized scope with a safe error; **never truncate and call it complete**. No cross-request cursor or materialized position snapshot table is invented. A paginated/viewport design for larger fleets needs a separate atomicity/capacity contract. A's existing transit-route page/pageSize envelope remains unchanged. No long-lived transaction between HTTP requests.

Every complete tracking envelope has schemaVersion1, snapshotAt (DB UTC clock), scope echo, vehicles array and complete=true. No global revision implied. Per-vehicle stateRevision is a positive decimal string; revisions from different vehicles are incomparable. Read-time expiry/context masking can change visibility without immediately changing stored revision: complete REST snapshot replacement is authoritative at its snapshotAt, including equal row revisions. Do not retain missing markers merely because their old row revision equals the last seen value.

## DTO allowlists

| DTO | Fields / semantics |
|---|---|
| PublicVehicleV1 | jeepneyId UUID; plateNo; physicalColorHex (A vehicle color); routeId/directionId; stateRevision string; position{latitude,longitude,fixTime,speedKph,heading}; trackerStatus='ONLINE'; motionStatus; routeCompliance='ON_ROUTE'; lastSuccessfulUpdateAt; availableUntil |
| PrivateVehicleV1 | Same safe vehicle identity; stateRevision nullable if no row; tracking{trackerStatus,motionStatus,locationStatus,routeCompliance,routeResolution,reason,fixTime,lastSuccessfulUpdateAt,updatedAt,availableUntil}; position nullable; positionIsLastKnown boolean; optional canonical route/direction IDs |
| AdminTrackingDiagnosticsV1 | PrivateVehicleV1 plus bounded quality/lease/persistence readiness summaries and mapping/workflow booleans; no secret paths/credentials/provider IDs in this proposal |
| ComplianceEventV1 | eventId UUID; jeepneyId; routeDirectionId; source='VALRYDE'; type ROUTE_DEVIATION/ROUTE_REENTRY; occurredAt; recordedAt; stateRevision; distanceM/corridorM; fromState/toState |
| NativeTrackingEventV1 | jeepneyId; source='TRACCAR'; normalized native type/time, approved event identity if needed; never raw attributes/geofence/driver/provider IDs |

Only public eligible rows have PublicVehicleV1; there is no public last-known/stale/off-route coordinate marker. Private stale coordinates may be shown only through authorized PrivateVehicleV1 with positionIsLastKnown=true and reason, never as live. With no row, return tracking=null/reason NO_TRACKING_STATE for an otherwise authorized vehicle, not fabricated coordinates or an unexplained404. Vehicle draft/application UI remains A-owned, not a fake active tracker.

Public names/route geometry/route color remain A canonical DTOs; physicalColorHex must not be confused with routeColorHex. No driver name/phone, operator private details, IMEI/serial, Traccar uniqueId/deviceId/positionId, service credentials, cookies, raw attributes or writer fence in any mobile DTO. GPS device provenance remains server-internal; Admin identity requirements need a separate allowlist if operationally necessary. Do not expose new directory/person fields merely because G1 is documented.

Example shape, artificial identifiers omitted to avoid implying seeded data:

```json
{
  "schemaVersion": 1,
  "snapshotAt": "2026-10-22T00:00:10.000Z",
  "scope": {"kind": "ROUTE_DIRECTION", "id": "<uuid>"},
  "complete": true,
  "vehicles": []
}
```

UUID placeholders here are illustrative, not executable fixtures. All real schemas must be TypeBox-first with additionalProperties=false and generated OpenAPI/contract tests before consumer release. DTO numbers must be finite/WGS84 bounded; timestamp timezone explicit. Full internal row serialization is forbidden.

## Candidate HTTP operations — path freeze required

| Candidate operation | Audience / result |
|---|---|
| GET /api/tracking/route-directions/{directionId}/vehicles | Authenticated public-safe selected ACTIVE direction snapshot;0eligible→200 empty complete collection; no anonymous share links |
| GET /api/tracking/vehicles?groupId= | DRIVER permitted vehicles / OPERATOR own fleet / ADMIN platform; explicit audience mode, optional authorized group filter |
| GET /api/tracking/jeepneys/{jeepneyId}/latest | Same private scope;200 tracking=null when authorized vehicle lacks state; outside-scope403 consistent with A |
| GET /api/tracking/jeepneys/{jeepneyId}/history?from=&to= | Private only, accepted internal history adapter; strict timezone-bearing range<=30days, bounded response policy; no Valryde raw-position archive |
| GET /api/tracking/jeepneys/{jeepneyId}/events?from=&to=&source= | Private native/provider events versus application compliance source distinguished; no source=all ambiguity without pagination/merge-order contract |
| POST /api/realtime/auth | Current user JWT, validated socket_id/channel_name, signing allowlist below; never accept user/operator identity claims from body |
| Component health / fleet aggregates / reports | Separate A+B/E contracts, not silently added to generic /api/health or this proposal |

Native history authorization preserves the accepted service's current A visibility contract. Application-owned compliance-event history additionally needs an explicit temporal-ownership policy: recommended Operator access is intersection of current visibility and operator_id_at_event match; Driver history needs an A-derived authorized time/context window, not guessed historical group membership. Existing group join rows do not prove departed memberships. Until D09 resolves transfer/history privacy, expose no new private compliance-history endpoint. ADMIN platform historical access remains scoped to approved internal operations. Provenance operator ID alone is never an authorization grant.

Use A error envelope `{error:{code,message,requestId,details?}}`. Proposed new bounded codes for review: TRACKING_UNAVAILABLE (503 DB/persistence unready), TRACKING_PROVIDER_UNAVAILABLE (503 native history dependency), TRACKING_SCOPE_TOO_LARGE (422 narrow query), VALIDATION_ERROR400; existing AUTH_REQUIRED401/FORBIDDEN403/NOT_FOUND404 preserved. Service-side Traccar401 is not Valryde user's401. Do not return upstream body/URL/auth material. API read failure is not an empty healthy fleet.

Route conflicts inside a private tracking snapshot produce per-vehicle UNKNOWN/reason ROUTE_ASSIGNMENT_CONFLICT; do not fail an entire fleet. Existing A effective-route endpoint still returns frozen409 for that conflict. History access never requires having an effective route. Native history/events empty arrays are legitimate missing data, not service-outage substitutes. Cache-Control:no-store for dynamic/private tracking; no CDN/shared cache of role-specific results. Validate limits/time ranges before provider calls.

## Pusher v1: invalidation-first proposal

Recommended default: **no coordinates/private vehicle/event payload on any Pusher channel in this first gateway contract**. Channels carry a normalized snapshot invalidation; clients restore authorized current data through REST. This is a deliberate D10 choice, not an already approved contract or a promise of direct coordinate streaming. It avoids per-update private locations reaching stale subscribers after fleet/group/account changes.

| Channel proposal | Server-side authorization / publishing |
|---|---|
| private-valryde-v1-route-{directionUUID} | Active verified authenticated user, active public direction; client chooses currently viewed route. Invalidation only; no GPS or vehicle IDs |
| private-valryde-v1-user-{userUUID} | Exact current JWT subject and active verified user; publishers derive current authorized recipients from A role/fleet scope. Invalidation only; no private coordinates/event/person IDs |
| Operator/group/admin shared channels | Not needed in v1. Use authorized user channel and scoped REST; adding data-bearing shared mutable-membership channels requires separate revocation/security design |

One event name: `tracking.snapshot-invalidated.v1`; proposed allowlisted payload `{schemaVersion:1,eventId:<uuid>,kind:'SNAPSHOT_INVALIDATED',snapshotRequired:true,emittedAt:<UTC>}`. Event ID is opaque for best-effort dedupe, not a data revision/replay cursor. No client-triggered publishing or presence/member list. Signing requires configured server-side Pusher secret; clients receive only approved public key/cluster/auth signatures. This release configures none.

Sign only validated exact channel grammar and authorized scope; no arbitrary prefix wildcard. Reuse current A credential-version/disabled/verification checks. An auth signature authorizes subscription establishment, not perpetual membership freshness. Existing subscribers can outlive a role change; invalidation-only payload carries no new private GPS, and subsequent REST reauthorizes. Account-disable disconnection via Pusher authenticated-user termination can be a separate reviewed hardening step; do not assume signing alone revokes existing subscriptions. Provider authorization semantics: [official Pusher authorization docs](https://pusher.com/docs/channels/server_api/authorizing-users/).

If G requests direct public-safe coordinate events later: require exact PublicVehicleV1, current eligibility render at send time, no private fields, stable per-vehicle revision, bounded payloads and reliable route-removal handling. Also explicitly decide revocation/disabled-user confidentiality before adopting that mode. No existing channels/payloads are silently repurposed; version any incompatible change.

## Publishing, missed events and REST restoration

Later ID19 pointer-only coalescing intents are committed with state/events, then claimed/published after commit. Invalidation targets old and new public route scopes on route/eligibility change; current authorized user recipients only for private views. Do not store GPS-bearing messages as a second raw history. Backoff does not roll back GPS processing. At-least-once notification and duplicate/missed/out-of-order events are expected; no exactly-once end-to-end claim.

Client flow: authorize selected channel, load complete REST snapshot, coalesce invalidations and fetch again; after reconnect/foreground/auth or scope change always replace complete collection from REST. Subscribe-before-fetch plus a second fetch if invalidated during fetch avoids startup gaps; no need to replay Pusher messages. Use server snapshotAt for overlay freshness and stateRevision only per vehicle. Ignore expired/old data, but never ignore a later complete snapshot's removals simply for equal stateRevision. No independently calculated route precedence/compliance.

Proposed foreground recovery poll10s and debounce250ms (D11 operational/capacity decision), abort in-flight requests on scope/sign-out change, discard response belonging to old auth/scope generation, no infinite retry after401/403. Render public marker only until server availableUntil using conservative server-clock offset; hide on expiry even if network/Pusher lost. This is a deadline supplied by authority, not client violation computation. Private UI distinguishes historical marker from live state; stale data cannot be labeled online.

Complete snapshot time means "current at bounded DB snapshot," not proof of future availability or globally ordered event stream. No DB transaction retained during network publication or across mobile page requests. Partial/failed REST results do not replace a good authorized snapshot as a complete empty collection; expired public markers still hide.

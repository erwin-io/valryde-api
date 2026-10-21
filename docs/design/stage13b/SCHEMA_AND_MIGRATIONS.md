# Proposed schema and migration plan

Status: PROPOSED under D01/D06/D08/D11/D12. This is a specification, **not an executable migration**. All new objects use configured application schema (`dbo` today), never Traccar's database. Existing001–005 remain unchanged. Complete architecture/gates: [index](README.md), [D01–D12](DECISION_REGISTER.md) and [phase-specific release/rollback plan](IMPLEMENTATION_RELEASE_PLAN.md).

## 1. vehicle_latest_states

Exactly one row per jeepney. All identifiers/timestamps below are internal unless explicitly projected in [gateway DTOs](GATEWAY_CONTRACT_PROPOSAL.md). UUID references use ON DELETE RESTRICT unless noted. Hard deletion/archival needs an owner-approved policy; no cascading audit loss.

| Field(s) | Type / constraint / meaning |
|---|---|
| jeepney_id | uuid PK, FK jeepneys(id); permanent revision identity |
| revision | bigint NOT NULL DEFAULT1 CHECK>0; increment exactly once per committed material state mutation, never reset on remap/restart; decimal string at JS/API boundary |
| writer_fence | bigint NOT NULL CHECK>0; lease generation authorizing the write, not a public field |
| mapping_id | uuid NULL, **provenance snapshot, deliberately no FK to replaceable current mapping** |
| gps_device_id | uuid NULL FK gps_devices(id); active current device identity |
| mapping_mapped_at | timestamptz NULL; authoritative current mapping generation start |
| mapping_fingerprint | text NULL;64 lower-case hex SHA256 of mapping UUID/device/uniqueId/request/jeepney/mapped_at; no raw uniqueId persisted here |
| traccar_device_id | bigint NULL CHECK>0; provider-only identity, never mobile DTO |
| traccar_position_id | bigint NULL CHECK>0; last accepted valid source fix, not a history index |
| fix_time, device_time, server_time | timestamptz NULL; original normalized GPS/device/provider-server times, never replaced by receipt time |
| observed_at | timestamptz NULL; latest accepted orderable location observation's source fix_time (valid or invalid), separate from last valid fix watermark |
| received_at | timestamptz NULL; trusted Bridge envelope receipt time for provenance only, not fix ordering |
| latitude, longitude | double precision NULL, respectively BETWEEN -90 AND90 / -180 AND180; rejects NaN/infinities |
| position | geometry(Point,4326) GENERATED ALWAYS STORED from longitude/latitude; null when coordinates null; only one coordinate source |
| speed_kph, heading | double precision NULL; speed>=0 AND <Infinity; heading>=0 AND<360; knots×1.852 and360→0 normalization |
| last_successful_update_at | timestamptz NULL; DB clock after the newest valid fix's successful write, not latest attempt/status sweep |
| fresh_until | timestamptz NULL; fixed deadline fix_time+30s; stored explicitly/validated in writer, not volatile generated column |
| location_status | text NOT NULL DEFAULT'UNKNOWN', CHECK IN UNKNOWN/FRESH/STALE/INVALID |
| location_reason | text NOT NULL; bounded allowlist such as NO_FIX, VALID_FIX, INVALID_FIX, EXPIRED, INELIGIBLE, MAPPING_CHANGED, CLOCK_AHEAD, CONTEXT_CHANGED; no free provider text |
| tracker_status | text NOT NULL DEFAULT'UNKNOWN', CHECK IN UNKNOWN/ONLINE/OFFLINE; never derive OFFLINE solely from transport loss |
| status_source_time | timestamptz NULL; ordered provider device/event status watermark |
| status_observed_at | timestamptz NULL; DB observation time; does not replace missing source ordering |
| status_source | text NOT NULL DEFAULT'NONE', CHECK IN NONE/DEVICE/EVENT/REST_RECONCILIATION |
| status_epoch, status_sequence | bigint NULL; trusted fenced connection epoch/ingress sequence for source-time tie/provenance handling, not client values |
| motion_status | text NOT NULL DEFAULT'UNKNOWN', CHECK IN UNKNOWN/MOVING/STOPPED; fix-derived speed>0/zero only |
| route_direction_id | uuid NULL FK route_directions(id); current resolved snapshot, never a route assignment |
| route_assignment_id | uuid NULL; provenance of A resolver result; not a new assignment table/FK |
| route_resolution | text NOT NULL DEFAULT'UNASSIGNED', CHECK IN UNASSIGNED/RESOLVED/CONFLICT/INACTIVE |
| context_fingerprint | text NULL;64 hex hash of mapping generation, effective assignment/source/active_from, direction+route status, geometry hash/corridor and eligibility/ownership context |
| route_compliance | text NOT NULL DEFAULT'UNKNOWN', CHECK IN UNKNOWN/ON_ROUTE/OFF_ROUTE |
| distance_m | double precision NULL; nonnegative finite distance to current canonical direction; not historical coordinates |
| outside_since | timestamptz NULL; GPS fix_time starting current consecutive valid outside run |
| consecutive_outside, consecutive_inside | smallint NOT NULL DEFAULT0; saturated0–3 and0–2, mutually exclusive positive runs |
| reentry_required | boolean NOT NULL DEFAULTfalse; after OFF_ROUTE preserve two-inside requirement through UNKNOWN unless mapping/route context changes |
| compliance_changed_at | timestamptz NULL; source triggering fix_time, or DB time for operational UNKNOWN, with change reason retained |
| updated_at | timestamptz NOT NULL; DB clock on any material state mutation |

Mapping snapshot fields are all present or all absent. A revoked/missing mapping is represented by absent current mapping fields and UNKNOWN states; revision remains. On generation change clear all fix, observation/status and compliance fields before using new-device data; no old coordinate ownership carryover.

Fix ID/three source times/coordinates/point/speed/heading/fresh_until/last_successful_update_at are all null together before the first accepted valid fix or all present afterward. An invalid observation may set observed_at while all valid-fix fields remain null. Retained valid-fix coordinates on INVALID/STALE are historical diagnostics only and never publicly available. UNKNOWN/STALE/INVALID implies route_compliance=UNKNOWN; non-UNKNOWN compliance requires RESOLVED active context. Counter/time checks tie outside_since to outside count. Invalid/stale/context-loss transitions to UNKNOWN clear both runs, retaining only a same-context re-entry latch when appropriate. Initial UNKNOWN with a coherent fresh route may accumulate an outside run before the deviation threshold; UNKNOWN with a pending re-entry may accumulate its inside run. Do not add a blanket UNKNOWN-implies-zero-counters constraint that prevents these state-machine branches.

Do not use a CHECK with now() to represent freshness: time can expire without a row update. The trusted projection recalculates expiry on every read; sweeps materialize it and increment revision. A future-within-tolerance fix remains withheld from public projection until its fix_time is not ahead of snapshot time.

Indexes proposed: PK(jeepney_id), (fresh_until) WHERE location_status='FRESH', (route_direction_id,jeepney_id) for candidate snapshots. No latest-position GiST index until an approved query needs spatial search. Existing canonical route geometry index remains intact. Route membership/ownership queries still use A tables, not a denormalized operator ID trusted for authorization.

Illustrative expression only, not SQL executed or migration-ready DDL:

```sql
position geometry(Point,4326) GENERATED ALWAYS AS (
  CASE WHEN longitude IS NULL OR latitude IS NULL THEN NULL
       ELSE ST_SetSRID(ST_MakePoint(longitude,latitude),4326) END
) STORED
```

Validate generated-expression immutability against actual deployed PostgreSQL/PostGIS versions in isolated migration tests. Do not label speculative DDL verified by this metadata-only session.

## 2. tracking_bridge_leases

One operational row for the single MVP provider deployment, not multi-provider product scope. Fields: deployment_key text PK CHECK='primary'; fence bigint NOT NULL DEFAULT0 CHECK>=0; owner_id uuid NULL; expires_at timestamptz NULL; heartbeat_at timestamptz NULL; phase text NOT NULL DEFAULT'STOPPED' limited to accepted Bridge phases. Acquisition atomically increments fence; heartbeat/phase/release predicates require matching owner+fence. Heartbeat/start-write also require an unexpired DB-clock lease; an expired owner reacquires with a new fence rather than resurrecting the old one. Initial empty row is migration seed metadata, not telemetry.

Suggested operational settings requiring D12 approval: heartbeat5s, lease15s, sweep1s/batch100, statement timeout5s, lock timeout1s, whole transaction budget10s. Lock the lease row FOR SHARE inside each state transaction and verify DB-clock expiry/fence; acquisition FOR UPDATE prevents an old transaction straddling a new fence. Use a separate small heartbeat connection so long data work does not starve liveness. Loss of owner/lease/DB readiness stops sink writes; lease state and fresh-fix checks prevent stale public availability. No health-port lock is treated as durable singleton proof.

## 3. route_compliance_events

Append transitions only, never every GPS point/native event. Fields: id uuid PK; jeepney_id uuid FK; route_direction_id uuid FK; mapping_id uuid provenance (no FK to current mapping); context_fingerprint text64hex; state_revision bigint; event_type text in ROUTE_DEVIATION/ROUTE_REENTRY; from_state/to_state in allowed states; fix_time timestamptz; recorded_at timestamptz DB time; traccar_position_id bigint>0 internal; distance_m finite>=0; corridor_m integer1–5000; operator_id_at_event uuid NULL provenance only; source text CHECK='VALRYDE'. No driver PII, provider attributes, credential, raw telemetry blob or independent geometry.

UNIQUE(jeepney_id,state_revision) makes a retried transition idempotent. Index(jeepney_id,fix_time DESC,id); index(route_direction_id,fix_time DESC,id) only for approved reports. Initial UNKNOWN→ON_ROUTE is not ROUTE_REENTRY; any new entry to OFF_ROUTE emits deviation, and re-entry event requires an outstanding deviation. UNKNOWN transitions are state diagnostics, not a third event type in this proposal (D02 confirmation required).

Proposed retention30 days requires explicit D08 approval; never inherit it merely because Traccar has30-day raw retention. Event references can outlive raw-history retention only if G explicitly accepts unavailable raw detail. Expiration removes event rows only through a separately authorized bounded job; no purge runs now. Removing events never resets latest revision.

## 4. Optional later tracking_publication_intents (ID19 release only)

Pointer-only operational outbox, not serialized position history. One coalescing row per(jeepney_id,target_kind,target_id), target_kind in PUBLIC_ROUTE/PRIVATE_INVALIDATION. Fields: desired_revision bigint, action UPSERT_OR_RECONCILE/REMOVE/INVALIDATE, updated_at, next_attempt_at, attempt_count, lease_owner/lease_until, token uuid. Never coordinates, private payloads, user credentials or copied raw fixes.

The recommended first gateway in this package is invalidation-only: use action INVALIDATE for both public-route and private-refresh scopes; derive current user recipients at send time rather than storing a stale recipient/role grant. UPSERT/REMOVE handling below is reserved for a separately approved direct-public-payload extension, not a promise to implement it with13b.

Preserve pending removal for every prior public route independently until delivered; A→B→C route changes cannot coalesce away A's removal. Re-render current eligibility at send time: an outdated UPSERT target becomes REMOVE, never a delayed old coordinate payload. Publisher acknowledgement deletes only matching token AND desired_revision; a newer intent survives old acknowledgement. Successful delivery rows are deleted; retry backoff/expiry24h is proposed operational policy D11. Expiring undelivered intents requires an alert and REST recovery, never a guaranteed-delivery claim. This table belongs to a separately approved migration/gateway slice.

## Candidate migrations — no .sql files created

| Candidate | Contents | Gate |
|---|---|---|
|006_tracking_latest_state.sql | vehicle_latest_states + tracking_bridge_leases + checks/indexes/empty lease seed | D01/D03/D05/D06/D12 plus explicit implementation/migration release |
|007_route_compliance_events.sql | event table/constraints/indexes; no historical import or purge | D01/D02/D08 plus compliance release |
|008_tracking_publication_intents.sql | pointer-only delivery intents, no Pusher settings | D09–D11 plus ID19 release |

P1 is the dedicated exact application-schema PR for006/007, with no runtime enablement. P2 keeps compliance UNKNOWN; P3 adds approved compliance/event writes;008 remains a separate P5 release. Approved A context/cutover design may require a separately reviewed dependency, never guessed columns/helpers in006.

Numbers are reservations in this proposal only. Re-fetch main before implementation; renumber if occupied. Do not create runtime objects on import or add auto-migration to Bridge startup.

Forward plan after authorization: review exact SQL and privileges; backup/restore readiness for application DB (not Traccar dump); isolated empty-schema and001–005-upgrade tests; verify catalog/check/index/permission behavior and old API compatibility; apply through existing migration runner using migrator identity. Start no writer until matching schema version/feature flag checks pass. Transactions must fail loudly for unexpected existing structures, not silently accept incorrect IF NOT EXISTS objects.

No existing-table rewrite/backfill or Traccar history copy is needed. Core-table creation must be atomic; indexes on new empty tables can be transactional. Bridge business reads and B state/lease/event writes must be allowlisted; locking A rows additionally requires reviewed locking privileges/helper execution under D12 (SELECT alone does not authorize these row locks). Future publisher/purge grants remain separate. Existing API/migrator role capabilities are not assumed sufficient proof of least privilege. No GRANT/role creation executed now.

Rollback plan: stop only the authorized Bridge consumer gracefully, disable the proposed persistence/gateway feature flags, return to accepted13a summary-only mode and treat all durable snapshots as unavailable. Leave new tables/events intact for diagnosis; never present old rows as fresh. Schema/data DROP or restore is a separate owner-approved destructive operation after reader/writer dependency checks and recoverable backup. Do not delete schema_migrations records or edit already-applied migration SQL. No automatic down migration supplied/executed. Subsequent fix is a reviewed forward migration.

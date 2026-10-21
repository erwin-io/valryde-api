# Persistent Tracking Bridge — pre-implementation contract proposal

Status: PROPOSED; shared schema/interface decisions below require Tech Lead approval. No runtime source or migration implemented.

Clarification at Codex takeover, 2026-10-21: Stage13a lifecycle/normalization is implemented in PR10; the phrase above applies to Stage13b persistence and the proposed contracts below. No Stage13b implementation is authorized.

## Stage 13b bounded approval packet — Codex takeover

The existing latest-state column table and future compliance/event model below form one design packet, not migration authorization. Proposed scope:

- `vehicle_latest_states`: one authoritative current row per jeepney; mapping generation, normalized coordinates/PostGIS point, provider IDs/times, independent observation/status watermarks, motion/tracker/validity states, route resolution/compliance and revision. No raw telemetry archive.
- Durable ordering: transactional current-mapping check, strictly newer GPS fix guard, idempotent duplicate handling and per-jeepney revision. Older server/receipt time updates cannot supersede GPS ordering. In-memory Stage13a watermarks are disposable, not persistence evidence.
- Validity/freshness: keep raw last-known coordinate timestamps distinct from availability. Locked commuter age <=30s remains unchanged. Decide invalid-observation watermark and future tolerance/ingestion-age semantics before SQL; stationary reporting is F/hardware coordination, not authority to widen freshness.
- Mapping/concurrency: lock current jeepney and mapping/eligibility consistently; serialize first insert and later updates, guard upsert, bound deadlock/serialization retries. Reset coordinate/compliance state on confirmed device-generation change. Audit lock order with A installation and route-assignment transactions; no A-owned schema edit assumed.
- Effective route: A has approval to design backward-compatible transaction-aware resolution. Consume the resulting reviewed executor interface when integrated. Preserve direct override, zero/one/multiple inherited outcomes and DRIVER existence semantics; do not copy resolver SQL or implement A's change here.
- Compliance persistence: proposed debounce fields outside_since/consecutive_inside/consecutive_outside and direction identity must commit with state transition and revision. The engine remains a separately approved20–21 slice. Preserve100m configurable corridor,30s OR3 outside fixes and2 inside re-entry. UNKNOWN continuity/initial-entry/event semantics require G sign-off.
- Compliance events: proposed route_compliance_events stores transition type, jeepney/direction, triggering fix reference/time, distance and state revision, with unique(jeepney_id,state_revision) retry idempotency. No raw coordinate stream. Retention duration and deletion/archival operator remain UNDECIDED; Traccar30-day raw-history retention does not automatically apply to Valryde compliance events. No automatic purge job proposed for implementation without approval.
- Event visibility: propose ADMIN platform scope, OPERATOR own fleet, DRIVER permitted assignment/group scope through A authorization; COMMUTER receives only public-safe availability, not private event history. Reauthorize REST reads/channel signing; no private identifiers in public snapshots.
- API/Pusher: internal sink persistence first; public HTTP DTOs/endpoints, audience allowlists, channel scopes/removal semantics and publisher delivery policy require separate contracts. Commit GPS state independently of future publishing failures. No Vercel socket owner, Windows service installation, Neon connection or Linux/Vultr rollout in this stage.

Decisions outstanding: exact column names/nullability/constraints and migration number; freshness/invalid/tie/mapping semantics; debounce and UNKNOWN transition semantics; event retention/access; transaction resolver/lock integration; independent realtime/public API contract. No table, migration, retention job, public endpoint or Pusher contract is created by this document.

## Stage 13a decisions and implementation — 2026-10-21

Tech Lead released Stage 13a after PR #4 merged (`068da0c`) and the infrastructure cross-platform checkpoint was accepted. Decisions recorded:

- The 30 s commuter freshness rule is preserved unchanged. Stationary-interval compatibility (~60 s reports) is an Agent F/hardware dependency (M1), not a Bridge setting.
- `vehicle_latest_states` is the proposed table name for 13b design review; it is not authorization to create it (M2).
- The transaction-aware resolver change stays coordinated with Agent A (M6).
- Native WebSocket must be validated against authenticated Traccar before it is chosen over `ws` (M5).

Implemented in 13a (no schema, no public API, no Pusher): the `src/bridge.ts` entry point; a supervisor with bounded jittered reconnect, a stable-period budget reset, connect and 120 s silence watchdogs (Traccar 6.16 keepalive is a fixed 55 s, per `TaskWebSocketKeepalive`); REST reconciliation before queued frames; per-item frame validation with frame/queue bounds; in-memory fix-time ordering and event dedupe; an injected telemetry sink; drain-before-stop shutdown; and a loopback health listener. Operations: [TRACKING_BRIDGE_OPERATIONS.md](TRACKING_BRIDGE_OPERATIONS.md).

Deviations from the original proposal, for review:

- **Liveness:** the native WebSocket has no ping API, so a silence watchdog on provider keepalives replaces ping/pong.
- **Reauthentication:** the native WebSocket hides the HTTP status of a rejected upgrade, so every reconnect drops that connection's cookie and logs in again. Login rate is bounded by the reconnect backoff.
- **Retry layers:** the accepted REST adapter keeps its own small per-request retry budget inside each supervisor attempt. Both layers are bounded; they are not collapsed.
- **Single owner:** until 13b adds the database advisory lock, single-instance ownership relies on the bound health port (or the operator).
- **Sink failures:** a sink failure ends the connection and clears in-memory watermarks so reconciliation redelivers the data. 13b's guarded upsert must stay the durable ordering authority.

## Future persistent compliance state and event model (IDs 20–21) — PROPOSED, not authorized

Requested by the Tech Lead for design review. Nothing below is created in 13a or 13b without a separate approval.

Compliance state is evaluated inside the same transaction as the latest-state write (13b+), so its debounce state must survive a Bridge restart. Proposed additions to `vehicle_latest_states`:

| Column | Proposed type / semantics |
|---|---|
| compliance_route_direction_id | uuid NULL, FK route_directions(id): direction the counters belong to. A change resets the counters and sets compliance to UNKNOWN |
| outside_since | timestamptz NULL: fix_time of the first fix in the current consecutive-outside run |
| consecutive_outside | smallint NOT NULL DEFAULT 0 |
| consecutive_inside | smallint NOT NULL DEFAULT 0 |
| compliance_changed_at | timestamptz NULL: fix_time that caused the last state change |

Evaluation uses only valid, fresh, newly accepted fixes with a RESOLVED, active direction. Distance is `ST_Distance(position::geography, route_directions.geometry::geography)` against `route_directions.corridor_m` (existing column, default 100). Locked rules apply unchanged:

- OFF_ROUTE when the outside run reaches 3 fixes, or when `fix_time - outside_since >= 30 s`.
- ON_ROUTE re-entry after 2 consecutive inside fixes.
- Invalid, stale or missing fixes, or an UNASSIGNED/CONFLICT route, set UNKNOWN and reset both counters.

A newly proposed table `route_compliance_events` (application-owned, never Traccar-sourced):

| Column | Proposed type / semantics |
|---|---|
| id | uuid PRIMARY KEY |
| jeepney_id | uuid NOT NULL FK jeepneys |
| route_direction_id | uuid NOT NULL FK route_directions |
| event_type | text CHECK IN ('ROUTE_DEVIATION','ROUTE_REENTRY') |
| occurred_at | timestamptz NOT NULL: fix_time of the triggering fix |
| recorded_at | timestamptz NOT NULL DEFAULT now() |
| traccar_position_id | bigint NOT NULL: lets audits fetch the raw fix from Traccar without copying history |
| distance_m | double precision NOT NULL |
| state_revision | bigint NOT NULL; UNIQUE (jeepney_id, state_revision) for idempotent retries |

Decisions needed:

1. Does UNKNOWN → ON_ROUTE need 2 inside fixes, like re-entry, or one?
2. Are transitions to and from UNKNOWN recorded as events?
3. What retention applies to compliance events?
4. Which roles can read compliance events (proposed: Admin, plus Operator/Driver within the Agent A fleet scope)?

No coordinates are stored in events; Traccar remains the raw-history authority.

## Integration preparation checkpoint — 2026-10-21

See [TRACKING_INTEGRATION_PREPARED readiness and test report](TRACKING_INTEGRATION_PREPARATION.md) for current GitHub/infrastructure evidence, credential coordination, C/D/E API gaps and 18 synthetic scenarios. This checkpoint supersedes older unverified-host statements below, while preserving the original proposal and its approval requirements.

PR #4 remains accepted/unmerged at a4062c800944457f11f6f8e97848b15c18d507b4; main remains711f4c4. Actual local provider6.16.0/version and unauthenticated401 boundary were rechecked read-only. Infrastructure records authenticated REST/JSESSIONID/socket101/fresh synthetic push and restart persistence, but B runtime has not executed and Bridge-only service credentials are not delivered. Current handoff additionally defers B implementation pending Tech Lead cross-platform checkpoint acceptance; no evidence of that acceptance was found. No source implementation/deployment is authorized by this preparation checkpoint.

Compatibility additions to carry into implementation: accept empty keepalive objects, deduplicate initial cached position frames, use cookie-authenticated upgrades with compatible Origin handling, do not opt into logs, retain non-retryable400 handling for version-specific readonly denial, and test session expiry without assuming it terminates an established socket. Token-query support visible in versioned upstream source is deliberately not adopted.

Owner: Agent B. Primary IDs: 13, 14, 15, 16. Dependencies: accepted REST foundation (IDs 12/14/17/18), Agent A mapping/route contracts. Compliance (20–21), realtime (19), public endpoints and client integration remain separate slices.

## Dependency, acceptance and branch workflow

PR #4 is ACCEPTED at `a4062c800944457f11f6f8e97848b15c18d507b4`, per [Tech Lead comment 6267265303](https://github.com/erwin-io/valryde-api/pull/4#issuecomment-6267265303). API CI and GitGuardian passed at that head. It is still OPEN/unmerged as checked on 2026-10-19. Do not change that branch or merge it.

Preparation branch: `docs/13-tracking-bridge-contract`, created from canonical `origin/main` at `711f4c45967e192be155e05e72714b99645ecc7d`. Only local documentation is prepared here, including the canonical Agent B status with preserved accepted-slice history. No commit or status-only PR is created. Carry these documents into the next coherent milestone after the dependency merges; do not merge this preparation branch or let its copy of the status file overwrite newer upstream history.

Next implementation branch: `feat/13-tracking-bridge`. Create from freshly fetched `origin/main` only after PR #4 is merged and its accepted functionality is verified in main (allow merge/rebase/squash integration). Reconcile upstream migrations and status history first. Reserve migration filename `006_vehicle_latest_state.sql` only if 006 remains free; otherwise use the next free version. Do not cherry-pick unmerged PR #4 or start dependent runtime code on this preparation branch.

## Process and integration boundaries

- Separate Node entry point and `bridge:start` command; deploy beside Traccar. API/serverless startup never imports or starts the socket loop. Dedicated bridge configuration and database application name; no HTTP listener required.
- One lifecycle supervisor owns authentication, socket, reconnect timer, stale sweep and bounded work queue. Lifecycle: STOPPED → AUTHENTICATING → CONNECTING → RUNNING → BACKOFF; STOPPING cancels all transitions. Generation tokens ignore callbacks from replaced sockets. A host/process database advisory lock prevents two active bridge owners for one configured Traccar deployment; latest-state SQL remains safe under competing writers regardless.
- Reuse the accepted REST/session adapter through a narrow server-only session lease API proposed below. WebSocket gets the session cookie in its HTTP upgrade headers, never a credential query parameter. Use an injectable Node WebSocket transport with cookie-header support (proposed pinned `ws` plus typings; versions selected and audited at implementation). Browser WebSocket clients cannot own this connection.
- One retry supervisor controls reconnect attempts, not nested REST/socket retry loops. Proposed bridge delays: base 1 s, exponential cap 30 s, half-to-full jitter. Reset the counter only after 60 s stable RUNNING; connect/login deadline 5 s, heartbeat every 20 s with 10 s pong deadline. Every socket failure terminates the old socket before another is opened. Authorization rejection/expiry invalidates that exact session generation and reauthenticates; transient outages must not cause tight login loops. All timings are proposed operational settings, not route-compliance thresholds.
- Validate frame shape and each item independently; a bad item must not discard valid siblings. Proposed limits: 1 MiB frame, 1,000 items/frame and 1,000 queued items; overflow closes/reconciles the stream instead of growing memory indefinitely. On reconnect, rebuild provider devices and reconcile latest provider positions before consuming buffered live frames in order. Bounded queue overflow during reconciliation forces another controlled reconnect. Never declare continuity across a dropped frame.
- Process device/position/event updates. Devices identify provider ID → uniqueId and provide status observations; no phone location input exists. Events are normalized with a `TRACCAR` source for internal hooks; no raw event-history mirror or compliance event generation in this phase. Event IDs deduplicate within a bounded in-memory cache; that cache resets across restarts. Durable native-event side effects are out of scope; add a durable idempotency contract before enabling any later such consumer.
- SIGINT/SIGTERM: stop intake and timers, cancel authentication/connect/retry work, close socket, drain in-flight DB writes within a proposed 10 s deadline, then roll back remaining transactions, release advisory lock and close pool. All resource cleanup is idempotent; shutdown cannot schedule a reconnect.

## Proposed latest-state table and internal record

One row per jeepney, not a raw position log. Table: `vehicle_latest_states` in the configured application schema. New table only; migrations 001–005 stay unchanged. No public DTO, Pusher contract or client authorization endpoint is introduced.

| Column | Proposed SQL type / semantics |
|---|---|
| jeepney_id | uuid PRIMARY KEY, FK jeepneys(id), ON DELETE RESTRICT |
| mapping_id | uuid NOT NULL, FK traccar_device_mappings(id), ON DELETE RESTRICT; current mapping generation identity |
| mapping_mapped_at | timestamptz NOT NULL; snapshot of mapping generation timestamp |
| gps_device_id | uuid NOT NULL, FK gps_devices(id), ON DELETE RESTRICT |
| traccar_device_id | bigint NOT NULL CHECK > 0; internal provider ID only, not a new business mapping |
| traccar_position_id | bigint NULL CHECK > 0; latest accepted fix identifier |
| latitude / longitude | double precision NULL; finite WGS84 latitude [-90,90], longitude [-180,180] |
| position | geometry(Point,4326) NULL; generated from longitude then latitude; never independent editable coordinates |
| fix_time | timestamptz NULL; GPS observation time; primary fix ordering/freshness clock |
| device_time / server_time | timestamptz NULL; preserve normalized provider timestamps; receipt time never substitutes for fix time |
| speed_kph | double precision NULL CHECK >= 0 and finite; knots × 1.852 |
| heading | double precision NULL CHECK >= 0 AND < 360; provider 360 normalized to 0 |
| tracker_status | text NOT NULL CHECK IN ('UNKNOWN','ONLINE','OFFLINE'); default UNKNOWN |
| status_observed_at | timestamptz NULL; source-time watermark for independently ordered status observations |
| motion_status | text NOT NULL CHECK IN ('UNKNOWN','MOVING','STOPPED'); default UNKNOWN; valid fix speed > 0 means MOVING, zero STOPPED |
| location_status | text NOT NULL CHECK IN ('UNKNOWN','FRESH','STALE','INVALID'); default UNKNOWN |
| last_location_observation_at | timestamptz NULL; watermark of the newest accepted fresh valid fix or newer time-bounded invalid observation; prevents delayed valid fixes undoing newer invalid state |
| route_direction_id | uuid NULL, FK route_directions(id), ON DELETE RESTRICT; effective-route snapshot, not an assignment |
| route_resolution | text NOT NULL CHECK IN ('UNASSIGNED','RESOLVED','CONFLICT'); default UNASSIGNED |
| route_compliance | text NOT NULL CHECK IN ('UNKNOWN','ON_ROUTE','OFF_ROUTE'); default UNKNOWN; this phase writes only UNKNOWN |
| last_successful_update_at | timestamptz NULL; bridge clock when a newer valid fix was successfully committed |
| updated_at | timestamptz NOT NULL; bridge clock when the state row last changed |
| revision | bigint NOT NULL CHECK > 0; monotonically incremented per jeepney on material accepted state change |

Proposed CHECKs require all fix columns (ID, coordinates, point, three times, speed, heading, last_successful_update_at) to be null together before the first valid fix, or all present together afterward. Retained coordinates on STALE/INVALID state are diagnostic last-known coordinates, never an available live location. Geography is unnecessary until the subsequent compliance distance query; that query must use metre-accurate geography casts. No geometry GiST index proposed until a demonstrated spatial read requires it. Add an index on fix_time for the stale sweep.

Internal TypeScript record follows the same semantics in camelCase. Bigint IDs/revision cross the pg boundary as decimal strings, never unsafe JS numbers. Validate provider numeric identifiers as safe positive integers before conversion; fail closed if upstream exceeds safe-number representation. This record contains private service identifiers and must not become a client DTO. A later snapshot/publisher adapter must explicitly allowlist audience fields.

## Telemetry ordering, mapping and write contract

1. Resolve provider ID → uniqueId from the authenticated provider registry. Refresh registry on every connection and on device changes; unknown IDs trigger a targeted provider lookup. Never identify a device from an untrusted position attribute or mobile client. A provider identity refresh invalidates queued work for that provider ID; queued items carry the observed identity generation.
2. For every write, recheck the authoritative mapping and eligibility in the transaction: active jeepney/device, approved application, installed/verified GPS request, matching uniqueId. Acquire a jeepney row lock and mapping/eligibility row locks before deciding. Reject work whose provider identity, mapping UUID/timestamp or fix timestamp predates the current mapping. Recheck database mapping even if provider identity is cached. No migration to Agent A mapping tables is proposed.
   On confirmed mapping-generation change, atomically replace the row's mapping/provider identity, clear all fix fields and observation/status watermarks, set location/motion/tracker/compliance UNKNOWN, and increment revision without resetting it. Only a newly validated fix from the current generation can repopulate coordinates; retired-device coordinates cannot survive as the current device's location. If eligibility is revoked without replacement, invalidate the existing row to UNKNOWN without advancing fix watermarks; later readers must independently check eligibility until the public snapshot contract is approved.
3. Serialize updates per jeepney using `SELECT ... FOR UPDATE` on the jeepney row, including first-insert races. Lock ordering against existing installation/assignment transactions must be audited before coding; deadlock/serialization failure rolls back and retries with a bounded budget. Row locks protect mapping/eligibility changes during commit. Add conditional `ON CONFLICT ... DO UPDATE ... WHERE` guards for generation/ordering as a second line of defense. Competing workers must produce one newest state regardless of arrival order.
4. Valid fixes require provider valid=true, finite bounded coordinates, valid timezone-bearing fix/device/server timestamps, nonnegative finite speed, bounded heading and eligible mapping. Order valid fixes strictly by fix_time. Same position ID, same fix_time, or older fix_time is a no-op; later serverTime never makes an older/equal GPS fix newer. A missing fix creates no authoritative location. Do not use receipt time or latitude/longitude equality for ordering.
5. Proposed processing freshness: accept a valid fix as FRESH only when `now - fixTime <= 30 s` and fixTime is not more than 5 s in the future. These are approval-required ingestion settings; the locked commuter availability limit remains <=30 s regardless. A 30 s ingestion window means the approved ~60 s stationary reporting interval creates gaps in freshness; Tech Lead must approve this policy or choose a distinct ingestion window before implementation. Do not silently treat 60-second fixes as publicly available.
6. Stale/out-of-order/duplicate fixes never replace coordinates or advance last_successful_update_at/revision. A stale sweep changes a previously FRESH state to STALE and compliance UNKNOWN once its freshness deadline expires, including during provider outages. New invalid telemetry with a parseable fixTime within the same age/future bounds and strictly newer than last_location_observation_at may mark location INVALID/motion UNKNOWN/compliance UNKNOWN while retaining last-known coordinates; it advances the observation watermark and revision, but not fix_time/position ID/last_successful_update_at. Malformed, older or unordered invalid packets cannot invalidate a newer observation. A subsequent valid fix must be newer than both fix_time and last_location_observation_at to restore freshness. An initial ordered invalid observation may create an INVALID row with all fix fields null. UNKNOWN/INVALID/STALE must always be presented as unknown route compliance; no invalid coordinate is persisted.
7. Device status/event changes never synthesize GPS fixes or advance fix watermarks. ONLINE/OFFLINE observations use their own source timestamp ordering; provider 'unknown', missing timestamps and transport loss yield UNKNOWN rather than a claim of hardware OFFLINE. An offline event may downgrade availability but never revive stale coordinates. Equal-time duplicates are no-ops; conflicting equal-time status observations resolve conservatively to UNKNOWN. Motion comes from valid position speed; native movement events do not rewrite the fix-derived motion state.
8. Use `TransitService.resolveEffectiveRouteDirection()` for assignment precedence. Resolve via the same transaction executor (proposed minimal shared interface extension below); no copied precedence SQL. Missing assignment → UNASSIGNED/null, assignment conflict → CONFLICT/null, both compliance UNKNOWN. Inactive resolved direction/parent route must be treated as unusable using a separate eligibility check; do not change the resolver's accepted precedence. This slice does not evaluate corridor distances or emit route-deviation events. Effective-route snapshot refreshes on accepted fixes and reconciliation; consumers must revalidate current assignment until a later assignment-change invalidation contract is approved.
9. Commit state before running optional post-commit consumers. Pass an immutable internal snapshot plus revision to future compliance/publishing boundaries; subsequent compliance must be evaluated within the same state transaction once integrated. A future publisher failure must not roll back the successful GPS write. No Pusher implementation or pretend delivery guarantee in this milestone.

## Agent A/B interfaces and approval requests

- B REST adapter: add a narrow server-only session lease + generation-aware invalidation + cancellation interface so socket upgrade can use the same authenticated service session safely. Retain existing REST callers/tests and secret redaction; session material never enters public routes/logs.
- A TransitService: proposed optional query executor parameter on the shared resolver, defaulting to its existing pool, so B can resolve through a transaction without duplicating precedence. This is a requested A-owned integration task, not permission to edit it now. Direct override and DRIVER existence-based authorization tests must stay unchanged. Confirm locking/consistency for route/group assignment mutations before choosing isolation.
- A mapping/workflow: read existing schema under transaction locks; no change to activation/mapping ownership. Confirm remapping semantics, especially whether mapping ID/mapped_at can be mutated, and whether a late old-provider frame can ever be associated with a reused numeric device ID. If reuse cannot be excluded or generation changes cannot be verified, discard ambiguous frames and force provider reconciliation.
- B latest-state schema is a new shared contract affecting later C/D/E consumers, but those modules receive no new fields/API until contract acceptance. No edits to their modules.
- Approval required: table/field names, enum values/nullability, 30 s processing freshness/5 s future tolerance, fix ordering/tie policy, last_location_observation_at invalid-observation watermark, status ordering and transactional resolver integration. All decisions in this document are explicit proposals rather than established shared contracts.

## Deterministic verification plan

| Area | Required evidence |
|---|---|
| Authentication / session | Cookie in server upgrade headers; no credential URL/logs; session reuse; handshake 401/expiry; cancel during login; preserve accepted REST tests |
| Reconnection | Fake clock/socket/RNG; error+close+timeout races create one retry/socket; bounded jitter/cap; unstable connections do not reset budget; recovery from provider outage |
| Payloads / queue | malformed JSON/fields/IDs/times; invalid item among valid siblings; frame/queue limits; reconnect reconciliation versus concurrent live frame; no fabricated data |
| Device/mapping | unknown provider ID, removed/reassigned mapping, inactive device/vehicle, unverified install, numeric-ID reuse ambiguity and queued work from previous mapping generation |
| GPS normalization | longitude/latitude order; SRID 4326; knots→km/h; heading 360→0; provider/device/fix times retained; stationary fix behavior; no phone GPS path |
| Ordering / freshness | duplicate ID, equal fixTime/newer serverTime, older fix, future fix, stale fix, invalid observation ordering, stale sweep and provider outage |
| PostgreSQL concurrency | real separate connections released by barriers, both first-insert orders, newer/older races, duplicate delivery, remap/eligibility races, stale-sweep race; one row/newest watermark, monotonic revision, no stale rollback |
| Route boundary | invoke shared resolver; direct override, no assignment, one inherited route, multiple-group conflict; unchanged Agent A DRIVER multi-group tests; no compliance verdict produced |
| Shutdown | signals during login/connect/backoff/write, stale socket callback after close, drain deadline, rollback, all timers/sockets/pool/advisory lock released; second owner can start |
| Future hooks | state committed before hook; injected consumer failure cannot undo persisted fix; no Pusher or corridor evaluation implemented |

Run real PostgreSQL/PostGIS tests with isolated temporary fixture IDs and cleanup/rollback, not memory substitutes for concurrent SQL. Validate migration on an empty test schema and existing migrated schema; review SQL before applying. Run db:migrate, lint, typecheck, npm test with DB enabled, build, audit --audit-level=high and git diff --check. No new code tests were run for this preparation-only document.

## External gates and next action

Live Traccar version, endpoint/TLS/cookie compatibility, service-account scope, physical GPS and production Pusher evidence remain OPERATOR-GATED per Tech Lead. Full baseline DOCX/standalone checklist still unavailable locally. Deterministic mocks unblock implementation once the merge and shared-contract decisions are complete.

Next: owner authorizes/integrates PR #4; Tech Lead approves or revises this proposal (especially freshness, invalid observations, mapping generation and transactional resolver). Then create feat/13-tracking-bridge from updated main, reconcile this proposal/status with upstream history, implement the approved migration and bridge, and open a focused unmerged PR.

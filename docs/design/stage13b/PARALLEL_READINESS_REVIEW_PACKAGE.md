# Stage 13b parallel readiness — consolidated review package

Directive `VALRYDE-CLAUDE-B-PARALLEL-READINESS-004` under mission `VALRYDE-AGENT-B-TRACKING-COMPLETION-001`. Agent B, checklist IDs 12–21. Prepared 2026-10-23.

**Status: PROPOSED FOR AGENT G DECISION. Nothing in this document is implemented, approved or authorized.** No migration (A006/B007/B008/009), persistent runtime, gateway, publisher, Bridge deployment or production credential is created or used. The [decision register](DECISION_REGISTER.md) remains the source of the D01–D12 recommendations. This package consolidates them with Agent A [PR #17](https://github.com/erwin-io/valryde-api/pull/17), the currently open Agent A PRs and the C/D/E consumer needs, so G can decide them as one set.

## 1. Verified baseline (2026-10-23)

| Item | Full SHA | State |
|---|---|---|
| `origin/main` | `827738c0f2c33ad3082f6a4a38a8e35669d4b0ea` | Unchanged since the Stage 13b design began |
| B [PR #14](https://github.com/erwin-io/valryde-api/pull/14) design | `149cefc82d0ccea3c1efe06aebaf157a607c1d8e` before this package | OPEN, MERGEABLE, API CI + GitGuardian SUCCESS on that SHA, no reviews |
| B [PR #22](https://github.com/erwin-io/valryde-api/pull/22) verification/hardening | `259125f3b130d8927a4ab6054e31a735e6392e1a` | OPEN, MERGEABLE; check runs `verify` and GitGuardian SUCCESS, both with `head_sha` equal to this SHA (job 119867718941: 154 passed / 1 live skip, 21 files passed / 1 skipped, PostGIS probe ran, audit 0) |
| A [PR #17](https://github.com/erwin-io/valryde-api/pull/17) shared interfaces | `fd76cb54000ec47c383c6641359f3e3cf59e4340` | OPEN, CI + GitGuardian SUCCESS, no reviews |

### PR #22 final verification result

| Check | Result | Evidence |
|---|---|---|
| Frame size in UTF-8 bytes | CONFIRMED | `tracking-bridge.ts:273` uses `Buffer.byteLength(data, 'utf8')`. The test sends 600 × `漢` (600 UTF-16 units, 1,800+ bytes) against a 1,024 limit and expects rejection, plus an ASCII exact-limit/limit+1 pair |
| Speed normalization overflow | CONFIRMED | `parsePosition` rejects any finite `speed` whose `speed * 1.852` is non-finite. That is the same expression `normalizePosition` and `TrackingHistoryService` use, so every admitted speed normalizes finite. Tests cover `MAX_VALUE`, `MAX_VALUE/1.852`, `MAX_VALUE/2`, and an overflowing item next to a valid sibling in the same frame |
| Credential/telemetry log leakage | NONE FOUND | Bridge logs only state, reason **codes** (`TraccarError.code`, `SINK_FAILURE`, `UNEXPECTED_ERROR`), retry counters, batch counts, and `socketUrl`, which comes from an origin with userinfo rejected (`traccar-config.ts:15–16`). A canary test asserts no password, cookie, provider ID or coordinate in logs/health |
| Stage 13a preserved | CONFIRMED | Two-line source diff only. Local re-run: targeted bridge/client/history/independent suites 98/98 PASS; full local Vitest 139 PASS / 16 explicit DB+live skips; typecheck and ESLint clean |
| 42-case ledger truthful | CONFIRMED | `stage13b-acceptance-results.json`: 42 unique contiguous IDs B13B-01…42, every status `BLOCKED`, counts PASS 0 / FAIL 0 / BLOCKED 42. B13B-11 carries partial probe evidence without being upgraded |
| CI/security on submitted HEAD | CONFIRMED | See table above |

There are no new concrete defects, so this directive made no PR #22 code change. Two limits are recorded for decisions rather than fixed here:

- **R1 (D03): admission bound vs memory bound.** The byte check runs after the runtime has already delivered the whole message string. It bounds parsing and queueing, not socket receive buffering. The provider is a trusted loopback/TLS peer, so this is acceptable for MVP. A receive-side cap would need a WebSocket implementation with a max-payload option, which is a dependency decision.
- **R2 (D03/D01): plausibility.** Speeds up to about 9.7×10³⁰⁷ knots are now *finite*, but they are not *plausible*. Recommendation: the P2 writer classifies `speedKph > 300` as an INVALID observation (count-only, no coordinate advance) and B007 adds `CHECK (speed_kph >= 0 AND speed_kph <= 300)`. This is a new value that needs G approval. B must not clamp it silently.

## 2. Decision matrix — the 12 review topics

Legend for **Approvable now**: **YES** means it can be decided from source, SQL and isolated-CI evidence alone, with no owner hardware and no production credentials. Every row is still `APPROVAL_PENDING`.

### 2.1 Shared transaction executor and lock key — D05, A17 §2–4

- **Recommendation:** approve A17 as written. Agent B owns the `PoolClient`/transaction/retry boundary. A methods accept `QueryExecutor` and never `BEGIN`/`COMMIT`/`release`. The lock is a transaction-scoped `pg_advisory_xact_lock(hashtextextended('valryde:tracking-context:'||jeepneyId,0))`, acquired in ascending UUID order. B's order is lease row → advisory key(s) → B rows → A `SELECT`s. B takes no row locks on A tables. Session-level advisory locks are forbidden.
- **Tests:** A17 tests 1–6 and 15. B13B-12–14, 21, 25, 27–28, 31–34 and 42. Real two-connection barriers only.
- **Rollback condition:** any deadlock (`40P01`) observed in the A17 test 3/4/5/6 barrier suite, or any A mutation found taking a business row lock before the advisory key. Either withholds P2 release. A's executor parameter stays optional, so reverting the B consumer leaves the A HTTP callers unchanged.
- **Affected code:** A `TransitService.resolveEffectiveRouteDirection` (`transit-service.ts:361`), new A `TrackingContextService.resolve` and `TrackingVisibilityService.assertCanReadPrivateTracking`, and a shared lock helper. B: new latest-state writer behind the `sink` in `src/bridge.ts`.
- **Approvable now:** YES.

### 2.2 Context generation and cutover — D07, A17 §8

- **Recommendation:** approve the A-owned `jeepneys.tracking_context_version bigint NOT NULL DEFAULT 1 CHECK (>0)` plus `tracking_context_changed_at timestamptz` captured with `clock_timestamp()` **after** the advisory and business locks. Bump it in the same transaction as every mutation in the A17 §8 table. Agent B stores the observed version and masks on mismatch at read time. The reconciler materializes UNKNOWN but never overwrites a newer version.
- **Additional finding:** open A [PR #19](https://github.com/erwin-io/valryde-api/pull/19) adds `FleetService.removeGroupJeepney` (and `removeGroupDriver`). Jeepney removal changes inherited routes, so it must be added to the A17 §9 retrofit list by name (A17 §8 covers it generically). PR #19 already marks it for the A006 retrofit.
- **Tests:** A17 tests 11, 13 and 20. B13B-21–24, 30–32, 35 and 40–41.
- **Rollback condition:** an ABA test (A→B→A) that does not yield two increments, or a cutover timestamp earlier than lock acquisition. Either blocks A006 acceptance. After release, A006 is additive: stop B reading it and the A columns stay inert.
- **Affected code:** `FleetService.updateJeepney` (`fleet-service.ts:187`), `addGroupJeepney` (`:302`), PR #19 `removeGroupJeepney`; `TransitService.updateRoute` (`:149`), `updateDirection` (`:224`), `assignRoute` (`:267`); `VehicleWorkflowService.reviewApplication` (`:107`), `transitionGpsRequest` (`:195`), `mapDevice` (`:250`), `verifyInstallation` (`:307`).
- **Approvable now:** YES.

### 2.3 Affected-set limits and retries — D05/D12, A17 §4.2 and open decision 3

- **Recommendation:** set the maximum synchronous multi-jeepney context mutation to **250 jeepneys**. A larger affected set is rejected before locking with a new 422 `TRACKING_CONTEXT_MUTATION_TOO_LARGE` that tells the Admin to split the change. Rationale: each advisory key uses a shared lock-table slot, and with PostgreSQL defaults (`max_locks_per_transaction` 64 × about 100 connections ≈ 6,400) four concurrent 1,000-key mutations would risk exhausting the table. 250 keeps a wide margin and is far above MVP fleet sizes. Retries are the whole transaction only: 3 attempts, 50–200 ms jitter outside locks, `lock_timeout` 1 s, `statement_timeout` 5 s, 10 s total deadline (D12 values). Expansion is detected at revalidation, then the transaction rolls back and the complete sorted set is reacquired (A17 §4.2 step 6).
- **Reuse:** the affected set is computed by the same direct-over-group logic as A [PR #25](https://github.com/erwin-io/valryde-api/pull/25) `GET /api/admin/route-directions/{directionId}/assignment-impact`, so the Admin UI can show the count before submitting.
- **Tests:** A17 tests 7, 8, 15 and 16. Add a cap/cap+1 test (250 accepted, 251 rejected with zero locks taken) and a pressure test with N concurrent cap-sized mutations under the CI PostgreSQL defaults.
- **Rollback condition:** an `out of shared memory` / lock-table error in the pressure test lowers the cap. It does not raise `max_locks_per_transaction` without Infrastructure approval.
- **Approvable now:** YES. The value is tunable later without a schema change.

### 2.4 Mapping generation and invalidation — D06, A17 §7

- **Recommendation:** release 1 is **create-only**. The generation is `(mapping id, mapped_at)`. An observation is rejected when its trusted receipt/fix time predates `mapped_at` or its generation no longer matches. A remap or unmap returns a conflict until a separate atomic-replacement contract exists. [PR #24](https://github.com/erwin-io/valryde-api/pull/24) (G10 Admin read) is compatible because it adds no remap.
- **Tests:** A17 tests 9 and 10. B13B-21–24, 28, 31 and 35.
- **Rollback condition:** any path that updates a mapping row in place fails the release.
- **Affected code:** `VehicleWorkflowService.mapDevice`; the B writer mapping lookup (replacing the in-memory `uniqueId` join used by `TrackingHistoryService`).
- **Approvable now:** YES.

### 2.5 Durable latest-state persistence — D01/D04, schema B007

- **Recommendation:** approve one `vehicle_latest_states` row per jeepney with a monotonic `revision` and writer fence, plus the singleton `tracking_bridge_leases`, as specified in [SCHEMA_AND_MIGRATIONS.md](SCHEMA_AND_MIGRATIONS.md). Add the R2 speed CHECK. Do not archive raw history. The sink acknowledges only committed outcomes. Stage 13a's in-memory `TelemetryGate` stays an optimization, and the DB-guarded upsert becomes the ordering authority (the existing `shortcut:` comment in `telemetry.ts` already says so).
- **Tests:** B13B-01–03, 15–20, 27–28, 30, 33–37 and 42.
- **Rollback condition:** a stale lease resurrection, or a revision regression under the two-writer test. Runtime rollback = persistence flag off → accepted 13a summary-only sink. The tables stay (additive), and there is no down-migration.
- **Affected code:** `src/bridge.ts` sink, `src/tracking/tracking-bridge.ts` (sink acknowledgement already redelivers on failure), `src/tracking/bridge-health.ts` (adds persistence readiness separate from transport), and new `src/tracking/latest-state-writer.ts` and lease module.
- **Approvable now:** YES for the schema and semantics. Execution against a database other than the isolated CI one needs a separately named DB scope.

### 2.6 Compliance state and event durability — D02/D03/D08, schema B008

- **Recommendation:** confirm D02 exactly. Thresholds stay frozen at 100 m / 30 s OR 3 outside / 2 inside. A fresh inside fix bootstraps ON_ROUTE without an event. Deviation is evaluated on fix arrival, not a wall timer. A gap of more than 30 s breaks continuity, and exactly 30 s does not. UNKNOWN resets runs but keeps a same-context pending re-entry. Only transitions are stored (ROUTE_DEVIATION/ROUTE_REENTRY), and each commits in the same transaction as the state revision with `unique(jeepney_id, revision)`. Retention is **30 days** (D08). Purging is bounded-batch and owner-approved, and an empty table is not authorization to purge.
- **Tests:** B13B-04–14, 29 and 41. The B13B-11 geometry dependency is already partially evidenced (PR #22 PostGIS probe: 99/100/101 m and 100/150 m corridors).
- **Rollback condition:** any duplicate transition on replay, or a transition without a matching revision. Rollback = compliance flag off, project UNKNOWN, keep events for audit, never reinterpret OFF_ROUTE as ON_ROUTE.
- **Approvable now:** D02/D03 YES. D08 retention needs an **owner** decision, a policy choice that needs no hardware.

### 2.7 Private telemetry vs public availability — D07 split, D09

- **Recommendation:** approve A17 §6. `telemetryEligible` (jeepney ACTIVE, device ACTIVE, application APPROVED, GPS INSTALLED+VERIFIED, coherent mapping) decides **persistence**. `routeUsability` (USABLE/UNASSIGNED/INACTIVE/CONFLICT) decides **compliance and public availability**. Valid private GPS with an unusable route persists with compliance UNKNOWN and never appears publicly. Public availability requires all of: telemetry eligible, `tracker_status = ONLINE`, valid fix with `0 ≤ snapshotAt − fixTime ≤ 30 s`, USABLE route equal to the requested direction, and `ON_ROUTE`. A missing or expired writer lease projects UNKNOWN, never OFFLINE.
- **Tests:** A17 test 19. B13B-17, 24–26, 39–40.
- **Rollback condition:** any public row in a fixture where `routeUsability ≠ USABLE` or the age is 30.001 s.
- **Approvable now:** YES.

### 2.8 Least-privilege database access — D12, A17 open decision 5

- **Recommendation:** use a dedicated Bridge role with `SELECT` only on allowlisted A tables (`jeepneys`, the GPS/application/mapping tables, assignment/route/direction tables), `EXECUTE` on the A lock helper only, and DML only on B007/B008 tables. There is no `UPDATE` on A tables, no `SECURITY DEFINER` helper by default, and no access to the Traccar database. The API's request-scoped role gets `SELECT` on B tables for REST snapshots.
- **Tests:** A17 tests 17 and 18 against the real role in isolated CI.
- **Rollback condition:** any successful A-table write by the Bridge role fails the release.
- **Approvable now:** the model is YES. Creating real roles in a non-CI database is an **Infrastructure/owner** gate.

### 2.9 Gateway REST/Pusher authorization — D09/D10

- **Recommendation:** authorization is per request, re-derived from current A tables with EXISTS semantics. Stored B provenance is never authorization. Private-channel signing accepts only the exact grammars `private-valryde-v1-route-{directionUUID}` (any active verified user, active direction) and `private-valryde-v1-user-{userUUID}` (UUID must equal the JWT subject). There are no wildcards, presence channels or client events, and no identity is taken from the request body. Payloads are invalidation-only (§2.11). Contract details are in section 4.
- **Tests:** B13B-26 and 38–41, plus a signer rejection matrix (wrong subject, unknown direction, inactive direction, disabled user, malformed `socket_id`).
- **Rollback condition:** a signature issued for another subject's channel fails the release. Disabling the signer route still leaves REST functional.
- **Approvable now:** the contract is YES. Pusher credentials are an **owner** gate.

### 2.10 Snapshot freshness, ordering and reconciliation — D03/D09/D11

- **Recommendation:** the DB UTC clock is authoritative (`snapshotAt`). Each snapshot is complete, unpaginated, from one REPEATABLE READ READ ONLY transaction, with a cap of 1,000 vehicles; cap+1 → 422 `TRACKING_SCOPE_TOO_LARGE`, never truncation. `stateRevision` is per vehicle (decimal string), and a complete snapshot always replaces the client collection, including equal-revision removals. `availableUntil = min(fixTime + 30 s, leaseExpiresAt)`. Clients subscribe before fetching, re-fetch after any invalidation during the fetch, and re-fetch on reconnect/foreground/auth change. They poll every 10 s while in the foreground and coalesce invalidations for 250 ms.
- **Tests:** B13B-17, 24–25, 29, 35–36, 38–42.
- **Rollback condition:** a snapshot that mixes two context versions for one vehicle, or a removed vehicle retained by a client after a complete snapshot.
- **Approvable now:** YES. The poll/debounce values are capacity parameters that can be tuned later.

### 2.11 Publication invalidation — D10/D11, later 009

- **Recommendation:** publish a single event, `tracking.snapshot-invalidated.v1`, with payload `{schemaVersion:1,eventId,kind:'SNAPSHOT_INVALIDATED',snapshotRequired:true,emittedAt}`. It carries no coordinates, jeepney IDs or person IDs. Delivery is at-least-once, and REST completeness repairs gaps. Durable pointer-only intents are keyed (target, desired revision) with token-CAS acknowledgement, so an old acknowledgement can never delete a newer intent. Route changes invalidate **both** the old and new route channels. Driver unassignment (A [PR #21](https://github.com/erwin-io/valryde-api/pull/21)) and membership removal (PR #19) must invalidate the *previous* recipient's user channel so their next REST fetch drops the vehicle.
- **MVP simplification option (recommended for decision):** until 009 is released, publish best-effort invalidations after commit from the writer with no durable intent, and rely on the 10 s foreground poll as the guaranteed repair. This removes 009 from the critical path for C/D/E without weakening correctness, because REST is the source of truth.
- **Tests:** B13B-29, 35–36, 38–40 and 42, with a fake publisher; publisher failure must not roll back GPS.
- **Rollback condition:** publisher errors that block or roll back a state write.
- **Approvable now:** YES (the model). Live Pusher is an **owner** gate.

### 2.12 Migration sequencing — D01, A17 open decision 2

- **Recommendation:** reserve the numbers **now**: `006_tracking_context_generation.sql` (A), `007_tracking_latest_state.sql` (B), `008_route_compliance_events.sql` (B) and `009_tracking_publication_intents.sql` (B, P5 only). **Every other pending A table, including the G7 route-change requests in A [PR #27](https://github.com/erwin-io/valryde-api/pull/27), takes 010 or later.** `src/db/migrate.ts` applies files in lexical filename order and records by filename, so two PRs that both add a `006_*.sql` would both apply in an order chosen by name, not by dependency. None of the open A PRs (#12, #15, #19–#21, #23–#27) adds a migration today, so reserving costs nothing.
- **Tests:** B13B-42 (an empty database and an upgrade from 001–005, atomic failure, catalog/constraint checks).
- **Rollback condition:** a failed migration rolls back atomically. After success, the tables stay and runtime flags stay off. There is no automatic DROP.
- **Approvable now:** YES.

### Summary

| Topic | Decision IDs | Approvable without owner hardware/production credentials | Residual non-G gate |
|---|---|---|---|
| Executor + lock key | D05 | YES | — |
| Context generation | D07 | YES | — |
| Affected-set/retries | D05/D12 | YES | — |
| Mapping generation | D06 | YES | — |
| Latest-state persistence | D01/D04 | YES | Named non-CI DB scope for writes |
| Compliance + events | D02/D03/D08 | D02/D03 YES; D08 policy | Owner retention choice |
| Private vs public | D07/D09 | YES | — |
| Least privilege | D12 | Model YES | Infrastructure role creation |
| Gateway authorization | D09/D10 | Contract YES | Owner Pusher credentials |
| Freshness/reconciliation | D03/D09/D11 | YES | — |
| Publication invalidation | D10/D11 | Model YES | Owner Pusher credentials |
| Migration sequencing | D01 | YES | — |

None of D01–D12 needs physical GPS hardware to approve. Hardware evidence (stationary reporting cadence vs the frozen 30 s) affects **observed availability**, not the correctness of any decision.

## 3. Dependencies on Agent A merges and proposed implementation sequence

| Agent A item | Needed by B for | Kind |
|---|---|---|
| PR #17 approved by G | Everything in P1+ | Decision |
| A006 migration + lock helper + `QueryExecutor` on resolver + `TrackingContextService` + `TrackingVisibilityService` (new A implementation PR) | P1 (schema references the context version), P2 writer | **Hard** |
| Retrofit of the advisory lock + version bump into the mutations in §2.2, **including PR #19 `removeGroupJeepney`** | P2 correctness (otherwise A→B→A goes undetected) | **Hard** |
| PR #19 / #20 / #21 merged | D44/D45/D51 group scope; the user-channel invalidation set | Soft (scope source) |
| PR #24 (G10 mapping read) | E63 view; no B dependency | None |
| PR #25 (G11 impact preview) | §2.3 cap pre-check in the Admin UI | Soft |
| PR #27 G7 migration number | §2.12 sequencing | Ordering only |
| PR #12 (G1 directories) | D45 driver display name source | Soft |

Recommended sequence (each step separately reviewed, none started):

1. **G decisions:** approve PR #17 and D01–D12 with this package's refinements (R2 speed cap, 250 affected-set cap, migration reservation, MVP invalidation option). *(No hardware.)*
2. **A implementation PR:** A006 + helper + executor/context/visibility services + mutation retrofit with A17 tests 1–20 in isolated CI. Agent A's merges of #19/#21 should land **before** the retrofit PR so it covers the removal paths.
3. **B P1:** B007/B008 schema-only PR from refreshed `main`, with B13B-42 in isolated CI.
4. **B P2:** writer + lease, compliance forced UNKNOWN, behind a persistence flag that is off by default.
5. **B P3:** compliance state machine + transitions.
6. **B P4:** reconciler, readiness and restart/outage tests.
7. **B P5:** gateway REST + signer + invalidation publisher (the MVP best-effort option first, then 009 if G requires durable intents).

P5's REST contract can be **frozen in parallel with steps 2–4**, so C/D/E can build against fixtures now.

## 4. UI consumer contracts — PROPOSED, NOT IMPLEMENTED

These are the minimum tracking APIs needed to resume C 29–36, D 42–45/51/53–54 and E 60/63/65–67. **No endpoint, DTO, channel or credential below exists.** Shapes extend [GATEWAY_CONTRACT_PROPOSAL.md](GATEWAY_CONTRACT_PROPOSAL.md) and must be TypeBox-first with `additionalProperties:false` before implementation. All responses use `Cache-Control: no-store` and A's error envelope `{error:{code,message,requestId,details?}}`.

### 4.1 Endpoints

| # | Proposed operation | Roles | Consumers |
|---|---|---|---|
| T1 | `GET /api/tracking/route-directions/{directionId}/vehicles` | Any active verified authenticated user | C29–C36 |
| T2 | `GET /api/tracking/vehicles?groupId=` | DRIVER (assigned + same-group), OPERATOR (own fleet), ADMIN (platform) | D42–D45, D51, D53–D54, E60, E65, E66 (current deviations) |
| T3 | `GET /api/tracking/jeepneys/{jeepneyId}/latest` | Same scope as T2 | D42 detail, D45 detail, E63 |
| T4 | `GET /api/tracking/compliance-events?from=&to=&routeDirectionId=&jeepneyId=` | OPERATOR (current scope AND operator-at-event), ADMIN | D53 history, E66 |
| T5 | `GET /api/admin/system-health/tracking` | ADMIN | E67 |
| T6 | `POST /api/realtime/auth` | Any active verified authenticated user | C, D, E realtime |

Not proposed: anonymous/share links (outside MVP), DRIVER compliance history (D09: no temporal authorization proof yet), raw position history HTTP (ID 18 internal service stays internal until D09 decides its window), and server-computed movement prediction.

### 4.2 DTOs

```ts
// T1 — public-safe; only eligible vehicles; count === vehicles.length (C36)
interface PublicTrackingSnapshotV1 {
  schemaVersion: 1;
  snapshotAt: string;                 // DB UTC, ISO-8601 Z
  scope: { kind: 'ROUTE_DIRECTION'; id: string };
  complete: true;
  count: number;
  vehicles: PublicVehicleV1[];
}
interface PublicVehicleV1 {
  jeepneyId: string;
  plateNo: string;                    // C33
  physicalColorHex: string;           // C34, A jeepney colorHex — not routeColorHex
  routeId: string; directionId: string; // C32 label from the A transit-route DTO `code` the client already loaded
  stateRevision: string;
  position: { latitude: number; longitude: number; fixTime: string; speedKph: number; heading: number }; // C30
  trackerStatus: 'ONLINE';
  motionStatus: 'MOVING' | 'STOPPED';
  routeCompliance: 'ON_ROUTE';
  lastSuccessfulUpdateAt: string;     // C35
  availableUntil: string;             // hide marker at this server instant
}

// T2 — private scope
interface PrivateTrackingSnapshotV1 {
  schemaVersion: 1;
  snapshotAt: string;
  scope: { kind: 'DRIVER' | 'OPERATOR' | 'ADMIN'; groupId: string | null };
  complete: true;
  summary: TrackingSummaryV1;         // D54/E67 — computed over exactly `vehicles`
  vehicles: PrivateVehicleV1[];
}
interface PrivateVehicleV1 {
  jeepneyId: string; plateNo: string; physicalColorHex: string;
  relation: Array<'ASSIGNED' | 'GROUP' | 'OWNED' | 'PLATFORM'>; // D42 own vehicle vs D44 groupmates
  currentDriver: { displayName: string } | null;                 // D45 — see decision U1
  routeId: string | null; directionId: string | null;
  stateRevision: string | null;
  tracking: null | {
    trackerStatus: 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
    motionStatus: 'MOVING' | 'STOPPED' | 'UNKNOWN';
    locationStatus: 'CURRENT' | 'LAST_KNOWN' | 'NONE';
    routeCompliance: 'ON_ROUTE' | 'OFF_ROUTE' | 'UNKNOWN';
    routeResolution: 'USABLE' | 'UNASSIGNED' | 'INACTIVE' | 'CONFLICT';
    reason: string | null;            // e.g. STALE_FIX, ROUTE_ASSIGNMENT_CONFLICT, CONTEXT_CHANGED, WRITER_UNAVAILABLE
    deviation: { since: string; distanceM: number; corridorM: number } | null; // D43/D53/E66 when OFF_ROUTE
    fixTime: string | null; lastSuccessfulUpdateAt: string | null; availableUntil: string | null;
  };
  position: { latitude: number; longitude: number; fixTime: string; speedKph: number; heading: number } | null;
  positionIsLastKnown: boolean;
}
interface TrackingSummaryV1 {
  total: number; online: number; moving: number; stopped: number; offline: number;
  unknown: number; onRoute: number; offRoute: number;
}

// T3 — { vehicle: PrivateVehicleV1 }; T2 with ADMIN audience adds diagnostics:
interface AdminTrackingDiagnosticsV1 extends PrivateVehicleV1 {
  diagnostics: { mappingPresent: boolean; gpsVerified: boolean; applicationApproved: boolean; contextCurrent: boolean };
}

// T4
interface ComplianceEventV1 {
  eventId: string; jeepneyId: string; routeDirectionId: string; source: 'VALRYDE';
  type: 'ROUTE_DEVIATION' | 'ROUTE_REENTRY'; occurredAt: string; recordedAt: string;
  stateRevision: string; distanceM: number; corridorM: number;
  fromState: 'ON_ROUTE' | 'OFF_ROUTE' | 'UNKNOWN'; toState: 'ON_ROUTE' | 'OFF_ROUTE';
}
// Envelope { items: ComplianceEventV1[], complete: true }; range must include a timezone, ≤ 30 days, within retention; cap 1,000 → 422 TRACKING_SCOPE_TOO_LARGE.

// T5 — derived from the lease row in PostgreSQL; the API never calls the Bridge's loopback health port
interface TrackingHealthV1 {
  checkedAt: string;
  writer: { status: 'RUNNING' | 'STALE' | 'ABSENT'; leaseExpiresAt: string | null; lastCommitAt: string | null };
  persistence: 'READY' | 'UNAVAILABLE';
  publisher: 'ENABLED' | 'DISABLED' | 'DEGRADED';
}
```

No DTO contains a Traccar device ID, uniqueId, positionId, IMEI/serial, operator private details, writer fence, credential, cookie or raw attribute. COMMUTER sees no driver/operator identity.

### 4.3 Authorization model

- Every request authenticates through the existing `fastify.authenticate` (JWT + credential version + disabled/verification checks), then re-derives scope from current A tables in the snapshot transaction. Scope is never taken from query parameters, and `groupId` only narrows the result.
- T1: any active verified role. The direction must be ACTIVE (otherwise 404 `NOT_FOUND`). The response contains only rows passing the §2.7 public predicate. A route with no eligible vehicles returns `200` with `vehicles: []`, never 404.
- T2/T3: DRIVER = EXISTS(active assignment) OR EXISTS(shared group); OPERATOR = owner of the jeepney; ADMIN = all. Rows are distinct by jeepney even with several group paths. T3 outside scope → 403 `FORBIDDEN`, matching A's existence semantics. An authorized vehicle without a state row returns `tracking: null`, `reason: 'NO_TRACKING_STATE'`.
- T4: OPERATOR rows require current ownership **and** `operator_id_at_event` = caller. DRIVER → 403 until temporal authorization is approved.
- T6: exact channel grammar only (§2.9). Signing does not revoke existing subscriptions, which is acceptable because payloads carry no data.
- Errors: 400 `VALIDATION_ERROR`, 401 `AUTH_REQUIRED`, 403 `FORBIDDEN`, 404 `NOT_FOUND`, 422 `TRACKING_SCOPE_TOO_LARGE`, 503 `TRACKING_UNAVAILABLE` (persistence/lease not ready). A 503 is never presented as an empty fleet.

### 4.4 Freshness rules

| Case | Public T1 | Private T2/T3 |
|---|---|---|
| Valid fix, age 0–30 s inclusive, ONLINE, USABLE route, ON_ROUTE | Present until `availableUntil` | `CURRENT` |
| Age > 30 s, OFFLINE, or lease expired | Absent | `LAST_KNOWN` + reason, `positionIsLastKnown: true`, never labelled live |
| Future fix within 5 s tolerance (age < 0) | Absent until age ≥ 0 | `UNKNOWN` |
| OFF_ROUTE / UNKNOWN / route unusable | Absent | Shown with `routeCompliance`, `deviation` |
| Context version mismatch | Absent | Position withheld (`CONTEXT_CHANGED`) until a new-context fix arrives |

Clients compute `serverOffset = snapshotAt − requestStartedAt` (conservative) and hide a public marker when `now + serverOffset ≥ availableUntil`, even with Pusher and network lost. C30 animation interpolates only between two consecutive fixes of the same `jeepneyId` with increasing `fixTime`. It never extrapolates past the last fix and snaps instead of animating when the gap exceeds 30 s. D43 alerts when the client's own `ASSIGNED` vehicle goes from non-OFF_ROUTE to `OFF_ROUTE` between successive snapshots. It clears only when the server reports `ON_ROUTE`. Clients never compute compliance or route precedence.

### 4.5 Realtime reconciliation

1. Authorize and subscribe (T6) to the route channel (C) or own user channel (D/E).
2. Fetch the complete snapshot (T1/T2). If an invalidation arrived during the fetch, fetch again.
3. On `tracking.snapshot-invalidated.v1`: debounce 250 ms, then re-fetch and **replace** the collection.
4. On reconnect, app foreground, auth refresh or scope change: abort in-flight requests, discard responses from the old auth/scope generation, and re-fetch.
5. Foreground poll every 10 s regardless of Pusher. On 401/403, stop retrying and route to auth. On 503, keep the last good snapshot but still apply `availableUntil` expiry.
6. Event IDs are opaque dedupe hints only, not cursors. Duplicate or out-of-order invalidations are harmless.

### 4.6 Consumer readiness

| Consumer IDs | Contract coverage | Can build now against fixtures? | Open decision |
|---|---|---|---|
| C29, C31, C35 | T1 public predicate + `availableUntil` | YES | — |
| C30 | T1 `position` + §4.4 animation rule | YES | — |
| C32 | `routeId`/`directionId` joined with the A transit-route `code` | YES | — |
| C33, C34 | `plateNo`, `physicalColorHex` | YES | — |
| C36 count | `count` (= vehicles.length); favorites are not tracking | YES | — |
| D42 | T2 `relation` includes `ASSIGNED` | YES | — |
| D43 | `routeCompliance` + `deviation` + client transition alert | YES | — |
| D44, D51 | T2 with `groupId` | YES | — |
| D45 | `currentDriver.displayName` | Pending | **U1** |
| D53 | T2 filter `OFF_ROUTE` + T4 (OPERATOR) | YES; T4 history pending D08/D09 | D08 |
| D54 | T2 `summary` | YES | — |
| E60 | T2 ADMIN tracker status columns | YES | — |
| E63 | T3 ADMIN diagnostics + A PR #24 mapping read | YES | — |
| E65 | T2 ADMIN; Philippines map bounds are client config | YES | — |
| E66 | T2 `OFF_ROUTE` + T4 ADMIN | YES; T4 pending D08 | D08 |
| E67 tracking parts | T2 `summary` + T5 health + T4 | YES; export format is E-owned | — |

**New decision U1 (D09 amendment):** D45 requires the groupmate *driver name*, while the current gateway proposal excludes driver names from mobile DTOs. Recommendation: include `currentDriver.displayName` (no phone, email or ID) in **private** T2/T3 only, for DRIVER same-group and OPERATOR own-fleet scope, sourced live from A's current assignment. It is never in public DTOs or Pusher. This needs G + Agent D sign-off.

## 5. Outstanding gates

| Gate | Owner | Blocks |
|---|---|---|
| D01–D12 + U1 + R2 decisions; PR #17 approval | Agent G | All of P1–P5 |
| A006 + interface + mutation retrofit implementation | Agent A, then G review | P1 schema references, P2 |
| D08 compliance retention (recommended 30 days) | Owner | P3 event writes, T4 |
| Isolated test-write DB scope beyond CI | G/Infrastructure | Any non-CI write proof |
| Bridge/API database roles and grants | Infrastructure/owner | P2 outside CI |
| Pusher app credentials | Owner | Live T6/publisher (fake publisher tests do not need them) |
| Permanent Bridge service, Linux/Vultr host, TLS | Owner/Infrastructure | Deployment only |
| Production Traccar credentials/version | Owner | Production only |
| Physical GPS stationary reporting cadence (about 60 s observed vs frozen 30 s) | Agent F/operator | Real-world availability, not design correctness |
| C/D/E contract freeze sign-off | Agents C/D/E + G | Client integration against live endpoints |

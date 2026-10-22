# Stage 13b — Agent A shared integration interface specification

**Checkpoint:** `AGENT_A_STAGE13B_SHARED_INTERFACES_READY`

**Owner:** Agent A — Core Platform / Fastify API, checklist IDs 1–11

**Consumers:** Agent B durable tracking Stage 13b (D05, D06, D07)

**Status:** PROPOSED FOR TECH LEAD REVIEW — **Amendment 1 (2026-10-23)** applies the Agent B X1–X8 reconciliation from PR #14 `FINAL_DECISION_OPTIONS.md` §2 and proposes the MVP constants in §13. Amendment 1 is binding over any earlier wording it changes. This document specifies interfaces and concurrency behavior only. It does not authorize or implement a migration, tracking persistence, a production data change, a Traccar write, or a permanent Bridge process.

**Reviewed baseline:** `origin/main` `827738c0f2c33ad3082f6a4a38a8e35669d4b0ea`, migrations 001–005, Agent B design PR #14, G1 PR #12, and fixture PR #15.

**Amendment 1 baseline:** `origin/main` `99f4cb13e875c0145b3e676e3c8d457300c5603c` (includes #12, #19, #20, #21, #23, #24, #25 and Agent B #22; migrations still 001–005) and Agent B PR #14 head `878589a`.

## 1. Decisions and non-decisions

Agent A proposes the following shared contract:

1. Agent B owns its `pg.PoolClient`, transaction, deadlines, commit/rollback, and release.
2. Agent A accepts a query executor and never escapes to its pool or controls the caller's transaction.
3. A transaction-scoped advisory lock keyed by jeepney ID is the first shared A/B serialization primitive. Agent B does not require row-lock privileges on Agent A tables.
4. Effective-route precedence remains exactly direct assignment first, otherwise zero/one/more-than-one active group assignment means none/group/`ROUTE_ASSIGNMENT_CONFLICT`.
5. The current create-only mapping UUID plus `mapped_at` is the mapping generation. Remapping remains unsupported until a separately approved atomic replacement contract exists.
6. Existing columns cannot detect an unseen A→B→A business-context change. An A-owned, monotonic per-jeepney tracking context generation is required before Stage 13b persistence can rely on durable context.
7. User authorization and ingestion eligibility are separate. Agent A remains authoritative for both, but the Bridge service identity is never treated as an ADMIN user.

This proposal does not approve the additive context column, choose its migration number, approve Agent B's proposed persistence schema, or release runtime implementation. Those are explicit Tech Lead decisions in section 12.

## 2. Internal TypeScript interfaces

The shared boundary is internal server code, never a public request DTO.

```ts
import type pg from 'pg';

export type QueryExecutor = Pick<pg.Pool | pg.PoolClient, 'query'>;

export type TelemetryIneligibilityReason =
  | 'JEEPNEY_NOT_FOUND'
  | 'JEEPNEY_NOT_ACTIVE'
  | 'MAPPING_MISSING'
  | 'DEVICE_NOT_ACTIVE'
  | 'APPLICATION_NOT_APPROVED'
  | 'GPS_NOT_INSTALLED'
  | 'GPS_NOT_VERIFIED';

export type RouteUsability =
  | 'USABLE'
  | 'UNASSIGNED'
  | 'INACTIVE'
  | 'CONFLICT';

export interface TrackingMappingGeneration {
  mappingId: string;
  mappedAt: Date;
  gpsDeviceId: string;
  gpsSetupRequestId: string;
  traccarUniqueId: string;
}

export interface TrackingBusinessContext {
  jeepneyId: string;
  operatorId: string | null;
  contextVersion: string; // PostgreSQL bigint represented losslessly.
  contextChangedAt: Date;
  mapping: TrackingMappingGeneration | null;
  effectiveRouteDirection: EffectiveRouteDirection | null;
  telemetryEligible: boolean;
  telemetryIneligibilityReason: TelemetryIneligibilityReason | null;
  routeUsability: RouteUsability;
}
```

Required Agent A method shapes:

```ts
TransitService.resolveEffectiveRouteDirection(
  jeepneyId: string,
  executor?: QueryExecutor,
): Promise<EffectiveRouteDirection | null>;

TrackingContextService.resolve(
  jeepneyId: string,
  executor: QueryExecutor,
): Promise<TrackingBusinessContext>;

TrackingVisibilityService.assertCanReadPrivateTracking(
  actor: User,
  jeepneyId: string,
  executor?: QueryExecutor,
): Promise<void>;
```

The optional resolver executor defaults to the existing pool so accepted HTTP callers remain source-compatible. When supplied, every resolver query uses that executor. The context service requires an executor deliberately and has exactly two documented modes (X2):

- **write mode:** called inside a READ COMMITTED transaction after the caller holds the jeepney advisory key; its result may drive writes.
- **snapshot mode:** called inside a `REPEATABLE READ READ ONLY` transaction with no advisory key (gateway reads, D09); it never writes, and the caller compares the stored B `context_version` with the A version read in the same snapshot and masks state on mismatch.

One implementation serves both modes; the precondition is the caller's, not a second code path.

Agent A methods must not issue `BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`, or `release()`. They must not run a nested pool query when an executor is provided. They perform no network, Traccar, Pusher, email, or filesystem operation.

## 3. Transaction and client ownership

For one observation or one context reconciliation:

```text
Agent B
  acquire PoolClient
  BEGIN ISOLATION LEVEL READ COMMITTED   -- X1
  SET LOCAL statement_timeout / lock_timeout
  lock and validate B lease row
  acquire shared jeepney advisory transaction lock
  lock B-owned latest-state row when present
  read clock_timestamp() for lease expiry / freshness  -- X4, never now()
  call Agent A context/resolver with the same PoolClient
  apply B state/event changes
  COMMIT or ROLLBACK
  release PoolClient
```

**Isolation (X1):** every transaction that takes the tracking advisory key (B writer, B sweep, every A mutation) runs at READ COMMITTED, so each statement after the lock sees the latest committed context. A lock-taking transaction at REPEATABLE READ or SERIALIZABLE would hold a snapshot taken before the advisory wait and is forbidden. Lock-free snapshot reads use the separate `REPEATABLE READ READ ONLY` mode in §2.

Agent B owns the whole retry boundary. A retry starts a new transaction and repeats lease validation, advisory locking, A context reads, and B writes. Retrying only the failed statement of an aborted transaction is forbidden.

## 4. Required locks and acquisition order

### 4.1 Shared lock primitive

All participating A and B transactions use one canonical helper equivalent to:

```sql
SELECT pg_advisory_xact_lock(
  hashtextextended('valryde:tracking-context:' || $1::uuid::text, 0)
);
```

The exact SQL/helper name is implementation-owned by Agent A and must be covered by PostgreSQL tests. A hash collision may serialize unrelated vehicles but must not weaken safety **or deadlock freedom**: multi-key acquisition therefore orders by the bigint key, not the UUID (X3):

```sql
SELECT pg_advisory_xact_lock(k)
FROM (
  SELECT DISTINCT hashtextextended('valryde:tracking-context:' || id::text, 0) AS k
  FROM unnest($1::uuid[]) AS id
) keys
ORDER BY k;
``` Session-level advisory locks are prohibited; only transaction-scoped locks are permitted.

The shared order is:

1. Validate inputs before opening the transaction; perform no external I/O while locks are held.
2. Agent B only: lock/validate the B lease row and fence.
3. Acquire jeepney advisory transaction keys computed, de-duplicated and sorted by bigint key value (X3). Agent B never holds more than **one** key per transaction, including the sweep, which selects candidates without locks and then runs one short transaction per jeepney (X6).
4. Lock B-owned latest state/event or intent rows in their approved B order.
5. Read Agent A context with ordinary parameterized `SELECT` statements through the same client.
6. Write Agent A or B rows owned by that transaction, audit in the same transaction, then commit.

Agent B does not use `FOR UPDATE`, `FOR NO KEY UPDATE`, or `FOR SHARE` on Agent A tables. The Bridge role therefore needs `SELECT` on the allowlisted A tables, not broad `UPDATE` solely to obtain row locks. A runtime mutations use their existing DML identity and take the advisory lock before their existing business-row locks.

Direct SQL changes that bypass the application lock helper are unsupported and must be denied operationally by database privileges. The shared protocol cannot make an uncoordinated privileged manual update safe.

### 4.2 Multi-jeepney Agent A mutations

Group-route, membership, route, direction, or administrative operations may affect multiple jeepneys. They must:

1. discover the candidate jeepney IDs without locks;
2. compute keys, de-duplicate and sort by bigint key value (X3); reject before taking any lock with `422 TRACKING_CONTEXT_MUTATION_TOO_LARGE` when more than 250 jeepneys are affected (§13);
3. `SET LOCAL lock_timeout = '2s'` (X7) and acquire every key in that order;
4. lock their normal business rows;
5. re-query the affected set;
6. roll back and retry from the beginning if the committed affected **key set** is not a subset of the keys acquired (X3); and
7. perform the business change, context-version bumps, and audit atomically.

No transaction may acquire a lower-sorted key after a higher one. The bounded maximum is 250 affected jeepneys per synchronous transaction (§13).

## 5. Effective route inside an existing transaction

`resolveEffectiveRouteDirection()` remains the only server-authoritative implementation of route precedence. With an executor supplied it performs both direct and group queries on that executor.

The result contract remains:

```text
active direct jeepney assignment exists -> return DIRECT
otherwise zero active inherited group assignments -> null
otherwise exactly one -> return GROUP
otherwise -> throw ApiError(409, ROUTE_ASSIGNMENT_CONFLICT)
```

The returned context must retain at least assignment ID, assignment source, assignment `active_from`, direction ID, route ID, direction/route status, geometry, corridor, and their update generations needed by Agent B. An inactive direct assignment never falls back to a group assignment.

For Bridge persistence, `TrackingContextService.resolve()` converts only the known `ROUTE_ASSIGNMENT_CONFLICT` domain outcome into `routeUsability='CONFLICT'`. It does not make otherwise valid private telemetry ineligible. Connectivity, SQL, timeout, serialization, unexpected cardinality, and programming errors propagate and force rollback. They must never be converted to “no route.”

## 6. Ownership and tracking visibility

### Telemetry ingestion eligibility

The internal Bridge may persist a current state only when one coherent join confirms:

- the jeepney exists and is `ACTIVE`;
- the GPS device is `ACTIVE`;
- the vehicle application is `APPROVED`;
- the GPS request belongs to the same jeepney/application and is `INSTALLED` plus `VERIFIED`;
- the mapping belongs to that request/device/jeepney.

Route usability is a separate result. Valid private GPS may be stored when the effective route is `UNASSIGNED`, `CONFLICT`, or `INACTIVE`, but compliance remains `UNKNOWN` and no public route-availability projection may expose that state. Only `USABLE` permits route compliance evaluation and public selected-route availability. The service identity receives no user role and does not bypass user RBAC. An ineligible telemetry context produces an internal reason/UNKNOWN projection, not an authorization grant.

### Private user visibility

Private tracking reads reuse current Agent A existence semantics:

- ADMIN: platform-wide, subject to active authenticated account/session policy;
- OPERATOR: only jeepneys owned by the caller's active Operator profile;
- DRIVER: at least one valid path—creator of the permitted draft where applicable, active driver assignment, or shared authorized fleet group;
- COMMUTER: no private endpoint access. Public availability uses a separately allowlisted projection only.

Multiple matching group rows still mean authorized; authorization must use `EXISTS` or `LIMIT 1`, never exact-row-count semantics. Every REST read re-authorizes against current A tables. Stored operator/driver provenance in a B row is not authorization.

## 7. Mapping generation and queued-observation fencing

The current mapping API is create-only. Its generation is:

```text
(traccar_device_mappings.id, traccar_device_mappings.mapped_at)
```

Agent B also records the expected `traccar_unique_id`, GPS device ID, request ID, jeepney ID, and context version. It accepts an observation only if the mapping generation read under the advisory lock still equals the generation attached to or resolved for that observation.

Cutover classification compares the GPS **`fixTime` only** (already bounded by the 5 s future-tolerance gate) with database-clock cutover instants (X5). Node `receivedAt` is diagnostic only and is never compared with `mapped_at` or `tracking_context_changed_at`:

1. `fixTime < mapped_at` → reject as `PRE_MAPPING` (count only);
2. otherwise `fixTime < tracking_context_changed_at` → `PRE_CUTOVER`: no coordinate, no counter advance, and no state established for the new context;
3. otherwise evaluate under the current context version and stamp that version on the B row.

An observation is also rejected/fails closed when the unique ID/generation no longer matches. A late queue drain must never bind an old observation to a newly created mapping merely because the provider unique ID now resolves.

Remapping is not supported by migrations 001–005 or the accepted API. A future remap requires all of the following in one advisory-locked transaction:

- create a new mapping UUID with a strictly later database `mapped_at`;
- never update the old generation in place;
- atomically bump the jeepney context version and invalidate/mask old current state;
- fence queued observations by their expected old generation; and
- preserve the existing uniqueness and audited Admin workflow.

Until that contract and required schema changes are separately approved, any attempted remap returns a conflict/fails closed.

## 8. Tracking context generation and invalidation

### Required additive state

Agent A proposes adding these A-owned fields to `jeepneys` in a separately approved migration:

```sql
tracking_context_version bigint NOT NULL DEFAULT 1 CHECK (tracking_context_version > 0),
tracking_context_changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
```

Migration numbers 006–008 are reserved exclusively for Stage 13b (006 Agent A, 007–008 Agent B); 009 stays deferred under §13.2 item 5; G7 uses 010 or later.

The version increments in the same transaction as every material context mutation. After acquiring the shared advisory and business locks, the mutation captures the cutover using database `clock_timestamp()`, not transaction-start `now()`, so waiting for a lock cannot produce a timestamp older than the actual cutover. Node receives the bigint as a decimal string. The monotonic version is the authoritative fence; the timestamp supports observation-time classification, while hashes and ordinary `updated_at` fields remain descriptive only.

Agent B stores the observed context version and mapping generation on its latest-state row. A mismatch immediately masks the old state from all public/private “current” reads. The reconciler may later materialize UNKNOWN for the new context but cannot overwrite a newer version.

### Mutations that must bump context

| Agent A mutation | Affected jeepneys | Required effect |
|---|---|---|
| Jeepney status or ownership change | That jeepney | Bump; old state masked. Ownership transfer is not currently exposed and remains unsupported until reviewed. |
| Add/remove jeepney group membership (`addGroupJeepney`, `removeGroupJeepney` from PR #19) | That jeepney | Bump because inherited route context may change (X8). |
| Direct route assignment/reassignment | Target jeepney | Bump. |
| Group route assignment/reassignment | Every committed current group member | Sorted locks, bump each. |
| Route/direction status, geometry, corridor, or route identity used by assignments | Every directly or indirectly assigned jeepney | Sorted locks, bump each. |
| Application review affecting approval | Application jeepney | Bump. |
| GPS request transition affecting eligibility | Request jeepney | Bump. |
| Device mapping creation or future approved replacement | Mapping jeepney | Bump and apply mapping cutover rules. |
| Installation verification or failure | Request jeepney | Bump. |

Driver assignment, Driver–Operator association, group-driver membership removal (`removeGroupDriver`, PR #19) and driver unassignment (`unassignDriver`, PR #21) change private recipients/visibility but do not relabel the vehicle's telemetry context: **no bump** (X8). REST authorization changes immediately. Their realtime effect is a best-effort post-commit user-channel invalidation of previous recipients; the 10 s foreground poll is the guaranteed repair (§13.2 item 5).

## 9. Interaction with current Agent A mutations

The current methods are not Stage 13b-safe merely because the resolver accepts an executor. A future implementation release must retrofit the shared advisory lock and atomic version bump into at least:

- `FleetService.updateJeepney`, `addGroupJeepney`, `removeGroupJeepney` (X8), and any future ownership mutation;
- `TransitService.assignRoute`, `updateRoute`, and `updateDirection`. Since PR #23, `updateDirection` is a single `pool.query` UPDATE; the retrofit makes it one transaction: sorted keys for every directly or group-assigned jeepney → UPDATE → bump → audit (X8);
- `VehicleWorkflowService.reviewApplication`, `transitionGpsRequest`, `mapDevice`, and `verifyInstallation`; and
- any new Admin mutation that changes mapping, eligibility, route geometry, route assignment, or ownership.

Pre-transaction authorization reads remain hints only. Every mutation revalidates ownership/state after acquiring its advisory lock. Existing accepted RBAC, audit, direct-over-group precedence, and conflict behavior remain unchanged.

The shared advisory lock removes the current application/request-before-jeepney versus B jeepney-first row-lock inversion: all participating transactions serialize before taking those rows. Retrying deadlocks is still required for transient database failures but is not a substitute for using the protocol.

## 10. Failure and rollback semantics

- Any failed lock, context read, ownership check, route resolution, B write, audit, or version bump rolls back the whole transaction.
- Agent A business mutation and its context-version bump commit together or not at all.
- Agent B latest state, compliance transition, event, and later publication intent commit together according to the separately approved B phase.
- Lock timeout, deadlock (`40P01`), serialization failure (`40001`), and lock-not-available (`55P03`) may retry only the whole transaction. Agent A HTTP mutations use `SET LOCAL lock_timeout = '2s'` and at most 3 whole-transaction retries; when exhausted they return `503 TRACKING_CONTEXT_BUSY` (proposed new A error code, retryable; the existing `ErrorCode` union has no generic 503 code) with nothing committed (X7). An Agent B transaction holds its key for at most its 10 s budget (target < 50 ms) and performs no I/O while locked.
- A missing/ineligible mapping is a classified telemetry outcome. Missing, inactive, or conflicting route context is a classified route-usability outcome that keeps compliance/public availability UNKNOWN while otherwise eligible private telemetry may persist. A SQL or executor failure is neither.
- A lost B lease/fence, context-version mismatch, or mapping-generation mismatch rejects the write and leaves the last committed row masked/UNKNOWN as appropriate.
- No external call occurs while the transaction is open. Commit-ack uncertainty is handled by B idempotency/fencing, not by assuming success.

## 11. Required PostgreSQL concurrency tests

These tests require real PostgreSQL/PostGIS clients and deterministic barriers, not arbitrary sleeps or mocked database success:

1. **Same executor:** an uncommitted route assignment visible on the caller client is seen by the resolver; a separate pool connection cannot see it before commit.
2. **Precedence regression:** direct-only, group-only, direct+group, zero group, and multiple-group conflict remain unchanged with an executor.
3. **B then A:** B holds the jeepney advisory lock; an A status/eligibility mutation blocks, then commits a version bump after B releases.
4. **A then B:** A holds the advisory lock; B blocks, then resolves only the committed new context.
5. **Application review race:** review/jeepney update and B state write complete without deadlock or split context.
6. **GPS transition/verification race:** request-first legacy paths retrofitted with advisory-first ordering do not deadlock B and do not publish a false ACTIVE state.
7. **Group membership race:** adding/removing a jeepney while assigning a group route either commits in a serial order or retries; no ambiguous effective route or missed version bump.
8. **Route/direction edit race:** geometry/corridor/status update versus B compliance write results in old-version rollback/masking or new-version evaluation, never mixed geometry and generation.
9. **Mapping cutover:** a queued observation received before `mapped_at` is rejected after mapping creation; a post-cutover observation with the exact generation is accepted.
10. **Unsupported remap:** duplicate/reused provider identity remains `DEVICE_MAPPING_CONFLICT`; no in-place generation mutation occurs.
11. **ABA context:** assignment A→B→A increments context version twice; an observation carrying the first A version is rejected.
12. **Visibility:** multi-group authorized Driver receives access, unrelated Driver/Operator receives `403`, and disabled/revoked users receive the existing session error.
13. **Rollback:** inject a failure after A business mutation but before version/audit completion and prove every change rolls back.
14. **B atomicity:** inject a failure between latest-state/event writes and prove neither commits.
15. **Transient failure budget:** force `40P01`, `40001`, and lock timeout; verify whole-transaction bounded retry and final classified failure without partial data.
16. **Affected-set expansion:** a multi-jeepney mutation discovers a new committed member at revalidation, rolls back, reacquires the sorted complete set, and then commits.
17. **Privilege test:** the real Bridge database role can execute the approved advisory lock and read allowlisted A context but cannot update A business tables.
18. **Direct-SQL denial:** the Bridge role and application client roles cannot bypass the context mutation service with unauthorized table updates.
19. **Eligibility separation:** approved/mapped telemetry with no route, an inactive route, or a route conflict persists privately with compliance `UNKNOWN` and is excluded from public availability; an invalid mapping/device/workflow state does not persist as eligible telemetry.
20. **Post-lock cutover clock:** hold the advisory lock beyond another transaction's start, then prove its context-change timestamp is captured after lock acquisition and cannot predate the committed cutover.

All test rows must use isolated owned IDs and controlled cleanup. Production, shared-user, and Traccar databases are prohibited.

## 12. Unresolved Tech Lead decisions

1. Approve the transaction-scoped jeepney advisory lock as the shared A/B serialization primitive.
2. Approve an A-owned monotonic tracking context version and the coordinated provisional sequence: Agent A `006_tracking_context_generation.sql` as prerequisite, Agent B `007_tracking_latest_state.sql`, Agent B `008_route_compliance_events.sql`, and a later `009_tracking_publication_intents.sql` in the separately released gateway phase. These names/numbers remain reserved proposals until current `main` is refreshed and Tech Lead/Agent G confirms them; no SQL is authorized by this document.
3. Approve the exact maximum jeepneys per synchronous multi-vehicle context mutation and retry/deadline values.
4. Confirm create-only mapping for the first Stage 13b release and keep remapping explicitly disabled.
5. Approve the Bridge least-privilege grants: advisory-lock execution, SELECT on allowlisted A tables, and DML only on approved B tables.
6. Decide the durable invalidation mechanism for future private Pusher recipient changes; REST remains live-authorized regardless.
7. Approve which Agent A implementation PR may retrofit mutations and expose the interfaces. This design PR alone is not that release.

## 13. Amendment 1 — X1–X8 reconciliation and proposed MVP constants

### 13.1 X1–X8 disposition

| # | Rule | Where applied | Proving test (§11 / §13.3) |
|---|---|---|---|
| X1 | READ COMMITTED for every lock-taking transaction | §3 | T4-X1 |
| X2 | Separate `REPEATABLE READ READ ONLY` snapshot mode for lock-free reads | §2 | T21 |
| X3 | Compute, de-duplicate and sort advisory keys by bigint value; revalidate key sets | §4.1, §4.2 | T22 |
| X4 | `clock_timestamp()` after lock acquisition for A cutover and B lease/freshness; never `now()` | §3, §8 | T20, T23 |
| X5 | Cutover checks compare `fixTime` with DB-clock `mapped_at` / `tracking_context_changed_at`; `receivedAt` diagnostic only | §7 | T9, T24 |
| X6 | Agent B holds at most one advisory key per transaction | §4.1 | T25 |
| X7 | A mutations: `lock_timeout = 2s`, at most 3 whole-transaction retries, clean 503; B holds a key at most 10 s | §4.2, §10 | T15-X7 |
| X8 | `removeGroupJeepney` bumps; `removeGroupDriver` / `unassignDriver` are visibility-only with invalidation; `updateDirection` retrofitted transactionally | §8, §9 | T7-X8, T8-X8, T26 |

Every other part of this specification is unchanged by Amendment 1.

### 13.2 Proposed Stage 13b MVP constants (formal sign-off required)

| # | Decision | Proposed value | Sign-off | Reversibility |
|---|---|---|---|---|
| 1 | Maximum affected jeepneys per synchronous context mutation | **250**; over the cap → pre-lock `422 TRACKING_CONTEXT_MUTATION_TOO_LARGE`, zero locks taken | Agent G | Constant; raise after a pressure test |
| 2 | Implausible speed | `speedKph > 300` is an INVALID observation (count only); **reject, never clamp**; B007 `CHECK (speed_kph BETWEEN 0 AND 300)` | Agent G | One constant + one CHECK |
| 3 | Mapping | **Create-only** for the initial release; remap fails closed (`DEVICE_MAPPING_CONFLICT`) | Agent G | Needs a future approved replacement contract |
| 4 | Public freshness | A public position is shown only while fresh: **30 s** | Agent G | Constant |
| 5 | Realtime invalidation | **Best-effort post-commit** `tracking.snapshot-invalidated.v1`; **10 s foreground REST poll** is the guaranteed repair; publisher failure never rolls back; **B009 deferred** | Agent G | Adding 009 later needs no client change |
| 6 | Migration numbering | **006–008 reserved exclusively for Stage 13b** (006 A, 007–008 B); 009 deferred; **G7 uses 010 or later** | Agent G | — |
| 7 | Lock timing | A `lock_timeout` 2 s, 3 retries, then `503 TRACKING_CONTEXT_BUSY`; B hold at most 10 s, target < 50 ms | Agent G | Constants |
| 8 | Bridge grants | Advisory-lock execution, SELECT on allowlisted A tables, DML only on approved B tables | Agent G + Infrastructure | Grant change |

These settle §12 items 3, 4 and 6. §12 items 1, 2, 5 and 7 still need explicit approval.

### 13.3 Deterministic concurrency and rollback tests added by Amendment 1

All use real PostgreSQL/PostGIS clients with explicit barriers (a held advisory key or an open transaction awaited by promise), never sleeps, and only the disposable CI database.

| ID | Invariant | Deterministic procedure | Pass condition |
|---|---|---|---|
| T4-X1 | Lock-taking reader sees latest committed context | Client B: `BEGIN` (READ COMMITTED), read lease row; client A holds key, bumps version; B requests key (blocks); A commits | B reads the **new** `tracking_context_version` |
| T7-X8 | Membership removal bumps | Remove a jeepney from a group concurrently with a group route assignment | One serial order; version bumped exactly once per committed change |
| T8-X8 | `updateDirection` is transactional | Inject failure after UPDATE, before bump/audit; separately race with a B write | Full rollback; never mixed geometry/generation |
| T15-X7 | Bounded wait | B holds key longer than 2 s while an A mutation runs | A retries 3 times, returns 503, business row unchanged |
| T21 | Snapshot mode | A mutation commits between two `REPEATABLE READ READ ONLY` snapshots | First snapshot consistent (old version/state); second masks until B materializes the new version |
| T22 | Collision-safe ordering | Stub key function forcing a collision; two opposite-order multi-jeepney mutations | Both complete, no `40P01`; a 251-jeepney set takes zero locks and returns 422 |
| T23 | Post-lock clock | Hold key past B lease expiry, then release | Waiting writer fails the fence check; nothing committed |
| T24 | Queued pre-cutover fix | Reassign route at T; process a fix with `fixTime = T − 1 s` after T | Compliance unchanged; row at the new version with UNKNOWN |
| T25 | Single-key B sweep | Sweep 100 candidates while a 250-key A mutation runs | No `40P01`; A wait bounded by one B transaction |
| T26 | Visibility-only removals | `removeGroupDriver` / `unassignDriver` | No version bump; next REST read denies (403) or returns `currentDriver: null`; post-commit invalidation failure does not roll back |

These tests ship with the A006 implementation PR (Phase C). They cannot run before the helper and migration exist, so none is reported as passing here.

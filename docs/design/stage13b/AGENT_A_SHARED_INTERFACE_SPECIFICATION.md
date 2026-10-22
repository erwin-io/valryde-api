# Stage 13b — Agent A shared integration interface specification

**Checkpoint:** `AGENT_A_STAGE13B_SHARED_INTERFACES_READY`

**Owner:** Agent A — Core Platform / Fastify API, checklist IDs 1–11

**Consumers:** Agent B durable tracking Stage 13b (D05, D06, D07)

**Status:** PROPOSED FOR TECH LEAD REVIEW. This document specifies interfaces and concurrency behavior only. It does not authorize or implement a migration, tracking persistence, a production data change, a Traccar write, or a permanent Bridge process.

**Reviewed baseline:** `origin/main` `827738c0f2c33ad3082f6a4a38a8e35669d4b0ea`, migrations 001–005, Agent B design PR #14, G1 PR #12, and fixture PR #15.

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

The optional resolver executor defaults to the existing pool so accepted HTTP callers remain source-compatible. When supplied, every resolver query uses that executor. The context service requires an executor deliberately: it may be called only after the caller acquires the shared advisory lock in an open transaction.

Agent A methods must not issue `BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`, or `release()`. They must not run a nested pool query when an executor is provided. They perform no network, Traccar, Pusher, email, or filesystem operation.

## 3. Transaction and client ownership

For one observation or one context reconciliation:

```text
Agent B
  acquire PoolClient
  BEGIN
  SET LOCAL statement_timeout / lock_timeout
  lock and validate B lease row
  acquire shared jeepney advisory transaction lock
  lock B-owned latest-state row when present
  call Agent A context/resolver with the same PoolClient
  apply B state/event changes
  COMMIT or ROLLBACK
  release PoolClient
```

Agent B owns the whole retry boundary. A retry starts a new transaction and repeats lease validation, advisory locking, A context reads, and B writes. Retrying only the failed statement of an aborted transaction is forbidden.

## 4. Required locks and acquisition order

### 4.1 Shared lock primitive

All participating A and B transactions use one canonical helper equivalent to:

```sql
SELECT pg_advisory_xact_lock(
  hashtextextended('valryde:tracking-context:' || $1::uuid::text, 0)
);
```

The exact SQL/helper name is implementation-owned by Agent A and must be covered by PostgreSQL tests. A hash collision may serialize unrelated vehicles but must not weaken safety. Session-level advisory locks are prohibited; only transaction-scoped locks are permitted.

The shared order is:

1. Validate inputs before opening the transaction; perform no external I/O while locks are held.
2. Agent B only: lock/validate the B lease row and fence.
3. Acquire jeepney advisory transaction locks in ascending UUID order. A single-observation B transaction has exactly one.
4. Lock B-owned latest state/event or intent rows in their approved B order.
5. Read Agent A context with ordinary parameterized `SELECT` statements through the same client.
6. Write Agent A or B rows owned by that transaction, audit in the same transaction, then commit.

Agent B does not use `FOR UPDATE`, `FOR NO KEY UPDATE`, or `FOR SHARE` on Agent A tables. The Bridge role therefore needs `SELECT` on the allowlisted A tables, not broad `UPDATE` solely to obtain row locks. A runtime mutations use their existing DML identity and take the advisory lock before their existing business-row locks.

Direct SQL changes that bypass the application lock helper are unsupported and must be denied operationally by database privileges. The shared protocol cannot make an uncoordinated privileged manual update safe.

### 4.2 Multi-jeepney Agent A mutations

Group-route, membership, route, direction, or administrative operations may affect multiple jeepneys. They must:

1. discover the candidate jeepney IDs without locks;
2. sort and de-duplicate UUIDs;
3. acquire every jeepney advisory transaction lock in that order;
4. lock their normal business rows;
5. re-query the affected set;
6. roll back and retry from the beginning if the committed affected set contains an ID whose advisory lock was not acquired; and
7. perform the business change, context-version bumps, and audit atomically.

No transaction may acquire a lower-sorted jeepney lock after a higher one. A bounded maximum affected-set decision is still required for large route/geometry edits.

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

An observation is rejected/fails closed when its trusted `receivedAt`, fix time, or provider source time predates `mapped_at`; when the timestamp relationship is ambiguous; or when the unique ID/generation no longer matches. A late queue drain must never bind an old observation to a newly created mapping merely because the provider unique ID now resolves.

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

The version increments in the same transaction as every material context mutation. After acquiring the shared advisory and business locks, the mutation captures the cutover using database `clock_timestamp()`, not transaction-start `now()`, so waiting for a lock cannot produce a timestamp older than the actual cutover. Node receives the bigint as a decimal string. The monotonic version is the authoritative fence; the timestamp supports observation-time classification, while hashes and ordinary `updated_at` fields remain descriptive only.

Agent B stores the observed context version and mapping generation on its latest-state row. A mismatch immediately masks the old state from all public/private “current” reads. The reconciler may later materialize UNKNOWN for the new context but cannot overwrite a newer version.

### Mutations that must bump context

| Agent A mutation | Affected jeepneys | Required effect |
|---|---|---|
| Jeepney status or ownership change | That jeepney | Bump; old state masked. Ownership transfer is not currently exposed and remains unsupported until reviewed. |
| Add/remove jeepney group membership | That jeepney | Bump because inherited route context may change. |
| Direct route assignment/reassignment | Target jeepney | Bump. |
| Group route assignment/reassignment | Every committed current group member | Sorted locks, bump each. |
| Route/direction status, geometry, corridor, or route identity used by assignments | Every directly or indirectly assigned jeepney | Sorted locks, bump each. |
| Application review affecting approval | Application jeepney | Bump. |
| GPS request transition affecting eligibility | Request jeepney | Bump. |
| Device mapping creation or future approved replacement | Mapping jeepney | Bump and apply mapping cutover rules. |
| Installation verification or failure | Request jeepney | Bump. |

Driver assignment, Driver–Operator association, and group-driver membership change private recipients/visibility but do not relabel the vehicle's telemetry context. REST authorization changes immediately. Any future Pusher/private subscription cache must receive an invalidation from the same transaction or a durable post-commit mechanism approved for ID 19.

## 9. Interaction with current Agent A mutations

The current methods are not Stage 13b-safe merely because the resolver accepts an executor. A future implementation release must retrofit the shared advisory lock and atomic version bump into at least:

- `FleetService.updateJeepney`, `addGroupJeepney`, and any future removal/ownership mutation;
- `TransitService.assignRoute`, `updateRoute`, and `updateDirection`;
- `VehicleWorkflowService.reviewApplication`, `transitionGpsRequest`, `mapDevice`, and `verifyInstallation`; and
- any new Admin mutation that changes mapping, eligibility, route geometry, route assignment, or ownership.

Pre-transaction authorization reads remain hints only. Every mutation revalidates ownership/state after acquiring its advisory lock. Existing accepted RBAC, audit, direct-over-group precedence, and conflict behavior remain unchanged.

The shared advisory lock removes the current application/request-before-jeepney versus B jeepney-first row-lock inversion: all participating transactions serialize before taking those rows. Retrying deadlocks is still required for transient database failures but is not a substitute for using the protocol.

## 10. Failure and rollback semantics

- Any failed lock, context read, ownership check, route resolution, B write, audit, or version bump rolls back the whole transaction.
- Agent A business mutation and its context-version bump commit together or not at all.
- Agent B latest state, compliance transition, event, and later publication intent commit together according to the separately approved B phase.
- Lock timeout, deadlock (`40P01`), serialization failure (`40001`), and approved lock-not-available handling may retry only the whole transaction with bounded attempts and deadline.
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


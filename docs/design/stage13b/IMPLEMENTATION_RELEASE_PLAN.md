# Stage13b implementation release sequence — design only

Five independently reviewable phases; all currently **NOT_RELEASED**. A design PR merge does not authorize any phase. Work begins from freshly fetched canonical main only after its named dependencies are accepted/integrated or G approves an explicit dependency approach. [Decision register](DECISION_REGISTER.md), [schema plan](SCHEMA_AND_MIGRATIONS.md).

## P1 — Exact application-database migration PR

Scope: a dedicated schema-only PR, no Bridge/API runtime enablement. Proposed007_tracking_latest_state.sql creates vehicle_latest_states and tracking_bridge_leases, proposed008_route_compliance_events.sql creates transition-only event history.001–005 remain unchanged. Numbers must be rechecked against main; use configured application schema, never Traccar. Empty lease seed is metadata, not a GPS fixture. No backfill, raw-history import, purge job or gateway outbox in this PR.

Exact planned objects/constraints/indexes are in the schema document. Latest state includes generation provenance, monotonic revision/fence, last valid point and independent invalid/status watermarks, source/receipt timestamps, context signature, compliance debounce/latch. PK jeepney, valid nullable groups, finite normalized coordinate/unit checks, event unique(jeepney,revision), fresh_until partial candidate index and event history index are required. Migration SQL is deliberately not created in this design release.

Dependency: approved A interface and catalog compatibility decision, including A-proposed additive per-jeepney monotonic context version/cutover and shared advisory-key contract. These are explicit proposed dependencies, not available001–005 interfaces. Do not silently add guessed marker columns or security-definer functions to006. Recommend A006_tracking_context_generation.sql as a separately owned prerequisite (positive version initial1/cutover fields), then B007/008; no allocation is approved. A published its proposed column/initialization/mutation/key design in [PR17](https://github.com/erwin-io/valryde-api/pull/17), head36af1c6cb7cd1e749f4d8d2eff15183e40e578fd; exact SQL/G approval remain pending; approve and integrate its separate schema/interface dependency (or G-authorized dependency approach) before the B exact SQL PR. Confirm proposed A006 and B007/008/009; renumber after that A migration allocation; numbers here remain provisional. D01/D03/D05/D06/D07/D08/D12 schema/security decisions precede P1 authorization; retention approval required before P3 writes even if an empty event table is accepted sooner.

Tests after release: B13B-42 empty schema and001–005 upgrade, atomic failed DDL, exact catalog/check/index/null/finite/counter tests, generated geometry immutability, non-owner privileges and old A/B API regressions. Ordinary CI must prove isolated database identity; migration tests never target the installed Traccar/application dev database by convenience.

Rollback: failed migration transaction rolls back atomically; no partial version record. After successful application, leave additive empty tables intact and keep runtime flags off. No automatic DROP/down migration; destructive restore/drop needs owner-approved backup and dependency review.

Approval boundary: G authorizes exact SQL authoring/review; separate explicit execution scope identifies test/target DB, migrator and grants. P1 acceptance does not release P2 or writes.

## P2 — Transactional latest-state persistence

Scope: optional durable observation boundary plus one transactional writer, A approved resolver/context boundary, lease ownership/fence, fix/invalid/status ordering, normalized point/time storage, CAS revisions and bounded retries. P2 keeps compliance UNKNOWN, counters/latch reset and event table untouched; no eligibility/public current-tracking promise until P3/P4 pass. No second socket supervisor or serverless worker.

Dependencies: accepted P1 schema and accepted A source integration after D05/D06/D07/D12 approvals. Default Stage13a remains unchanged with persistence disabled; no speculative fallback when A helper is absent. Require actual schema version and least-privilege role at startup.

Tests: B13B-01 (point/revision portion; compliance deferred),02–03,15–25,27–28,30–37 and42 plus existing13a regression. Two independent writer identities must first prove exclusive lease acquisition; same-owner concurrent transactions separately prove row idempotency. Exact barriers and failure assertions are in the42-case specification. PostGIS and real pg clients required, not mocked DB success.

Rollback: disable/stop only newly authorized consumer, drain or rollback in-flight transaction, conditionally release matching fence, retain committed rows. Return to accepted13a summary-only mode with durable tracking unavailable; do not present old state as live. A integration must remain backward-compatible for old callers.

Approval boundary: explicit G P2 runtime release, approved A integration and isolated application test-write authorization. No installed permanent service or live Traccar-to-app writes implied.

## P3 — Compliance state machine and events

Scope: enable canonical PostGIS geography corridor evaluation and approved D02/D03 state machine, unique deviation/re-entry transitions in same state transaction; never duplicate A precedence. No every-fix history or retroactive invented compliance through outages.

Tests: B13B-01 compliance portion,04–14,15–18,21–24,28–29,31–36,41–42. Prove99/100/101m geography behavior, independent30s and3-fix deviation branches,2-inside re-entry, UNKNOWN latch, invalid/stale continuity resets, transition rollback and replay idempotency. Re-run point/writer tests when sharing transaction logic changes.

Rollback: disable compliance and all gateway eligibility that depends on it, project UNKNOWN, reset runs through an authorized reconciliation (not ad hoc SQL), stop event emission; retain prior transitions for audit. Never reinterpret historical OFF_ROUTE as current ON_ROUTE. Re-enable only after fresh context/fixes; no backfill by assumption.

Approval boundary: G approves exact D02/D03 semantics and P3 implementation; Owner/G D08 retention plus A/G history boundaries. Event writes require isolated DB authorization. P3 acceptance does not authorize a public endpoint or publisher.

## P4 — Reconciliation and operational readiness

Scope: startup/reconnect current registry/latest reconciliation, lease acquisition/fencing, read-time fail-closed contract, stale/context sweeps, reset continuity on gaps, bounded shutdown and DB failure readiness. Safe test harness may model provider payloads; real Traccar account/services unchanged. Context reconciler uses approved A protocol, not a second precedence implementation.

Tests: B13B-08,10,17–24,27–37,42; restart after commit-ack loss, DB connection failure before commit, no stale lease resurrection, new owner waiting for old lease-row lock, sweep/new-fix race and abandoned process expiry. Assert bounded resources, no sensitive logs, rollback atomicity and no falsely healthy durable writer. Pressure/clock tests verify D12 values rather than certifying production scale.

Rollback: readiness unavailable, stop intake/reconnect, bounded transaction drain/rollback, conditional lease release, close pool/socket/health. Leave schema/events and existing Infrastructure services unchanged. If shutdown is forced, DB rollback/lease expiry protect state; do not pretend forced termination is graceful.

Approval boundary: G code/test acceptance; Infrastructure/owner approves exact runtime roles, rollback/backup/runbook and any bounded Windows live write proof. A live proof requires separate application test-writer authorization and secure local service credentials. No permanent service/production deployment authorized by P4 design or automated tests.

## P5 — Separate authorized REST/Pusher gateway release

Scope: freeze TypeBox/OpenAPI public/private/admin/event DTOs, authorization and temporal history policy, complete REST snapshots/expiry/limits, invalidation-only Pusher and reconnect reconciliation. Only then propose exact009_tracking_publication_intents.sql in its own authorized gateway migration scope; no GPS payload archive. C/D/E integration requires accepted versioned contracts.

Tests: B13B-17,24–26,29,35–36,38–42; role/group revocation, transfer history denial, fields allowlists, cap+1 rejection, expired marker removal, publisher failure/CAS, subscribe/fetch gap and auth-scope response isolation. Pusher credentials/live-provider validation require separate authorization; deterministic fake publisher tests are not production verification.

Rollback: disable publisher and gateway routes/projections, make tracking unavailable, discard in-flight old-scope client responses; retain pointers/events for diagnosis and do not delete new migrations. Accepted A endpoints/13a remain usable. Re-enable through current scoped REST snapshot, never replay stale GPS-bearing payloads.

Approval boundary: G+C/D/E contract freeze, explicit ID19 implementation/migration release, owner-managed Pusher secret delivery and operational rollout. Production or permanent service is a further owner decision.

## Phase evidence ledger

| Phase | Dependency to release | Test authority | Rollback authority | Current state |
|---|---|---|---|---|
| P1 | Approved exact schema/A compatibility | Isolated migration/catalog DB | Atomic failure; preserve additive tables | NOT_RELEASED |
| P2 | Accepted P1 + A interface source | Authorized isolated writer DB | Stop consumer/flags; leave data | NOT_RELEASED |
| P3 | Accepted P2 + compliance/retention decisions | Real PostGIS + state/event transactions | Disable compliance/readers; preserve audit | NOT_RELEASED |
| P4 | Accepted P2/P3 + operational contract | Deterministic outages/restarts; live separately gated | B-owned process only, fence/cleanup | NOT_RELEASED |
| P5 | Accepted durable readiness + C/D/E contracts | Scoped API/publisher/client reconciliation | Disable gateway/publisher; retain schema | NOT_RELEASED |

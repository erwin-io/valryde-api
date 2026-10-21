# Acceptance specifications, security and rollout — design only

All cases below are **PLANNED / NOT_RUN** for13b. This release permits documentation and read-only schema metadata only; it does not authorize fixtures, migration execution, telemetry writes, Pusher configuration or a persistent process. [Approval gates](README.md).

## Deterministic fixture and test strategy

Use a disposable authorized application test database with PostGIS and migrations001–005; never the Traccar DB, production Neon or live Windows synthetic provider as a substitute. Test identity/jeepney/mapping/route IDs are random per suite and cleaned by owned IDs/transaction rollback, never blanket DELETE/TRUNCATE. Fixtures can represent approval/verification states without asserting physical installation evidence. Provider/native events remain deterministic fixtures unless a separate read-only/live release authorizes actual input.

Base T=2026-10-22T00:00:00Z in pure state-machine tests. Production time comes from DB; integration tests obtain one DB anchor and supply a server-owned asOf through an isolated test seam, not user HTTP input or wall sleeps. Use real PostgreSQL/PostGIS queries for geometry/locking/upserts and two independent pg clients with barriers. Record actual SQLSTATE/results and assert clean final rows/events; mocked pg cannot count as concurrency proof.

Canonical metric line fixture uses a sufficiently long SRID4326 LineString; derive inside/boundary/outside points with geography ST_Project and then assert actual ST_Distance within a documented floating-point test tolerance. Test99/100/101m without degree approximations or altering production corridor. Exact equality branch can also be proven against the numeric distance used by the evaluator; numerical fixture tolerance must not become a runtime relaxed corridor.

Detailed [Given/When/Then specifications](ACCEPTANCE_SPECIFICATIONS.md) finalize the same42 cases; all remain PLANNED / NOT_RUN. [D01–D12 recommendations](DECISION_REGISTER.md) map these cases to exact gates.

## Concrete case matrix

| ID | Stimulus | Expected invariant / evidence |
|---|---|---|
| B13B-01 | Fresh verified mapping, initial inside fix at T | One row, correct point/SRID, ON_ROUTE immediately, revision1, no bootstrap re-entry event |
| B13B-02 | Out-of-bounds swapped lat/lon, bounds/NaN/Infinity | Reject malformed input; no invalid point/speed/counters or raw payload log |
| B13B-03 |10knots, heading360, three distinct UTC source times |18.52km/h, heading0, all source times preserved; receipt time not GPS time |
| B13B-04 | Outside T then T+30s, only2 fixes, continuous fresh context | OFF_ROUTE by time branch, one deviation; independent of3-fix branch |
| B13B-05 | Outside T,T+10,T+20 | OFF_ROUTE on third fix, one deviation, outside_since survives transaction reload; restart gaps reset continuity per35 |
| B13B-06 | One outside noisy point then inside | No OFF_ROUTE/deviation; outside run reset |
| B13B-07 | OFF_ROUTE then first/second inside | First remains OFF_ROUTE; second ON_ROUTE, exactly one re-entry |
| B13B-08 | OFF_ROUTE→invalid/stale UNKNOWN→one/two inside same context | Unknown resets runs but retains re-entry latch; cannot bypass two-fix rule |
| B13B-09 | UNKNOWN new context with first outside | Remains UNKNOWN until threshold; no inherited ON_ROUTE/counters |
| B13B-10 | Outside run gap>30s, or invalid sample between | UNKNOWN/continuity reset; no false continuous-time deviation |
| B13B-11 | Distance99/100/101m and configured corridor150m | Correct INSIDE inclusive boundary, configurable metre corridor; no hardcoded degree/tolerance change |
| B13B-12 | Direct direction while2inherited group routes exist | Shared resolver direct wins; no false conflict or client precedence |
| B13B-13 | No direct with0/1/2 inherited routes | UNASSIGNED/null, RESOLVED/group, CONFLICT/UNKNOWN respectively |
| B13B-14 | Inactive direct direction/parent route with usable group | INACTIVE/UNKNOWN, no group fallback bypass |
| B13B-15 | Same position ID/equal time/newer serverTime/older fix | No coordinate/counter/event or revision advance except independently due maintenance |
| B13B-16 | Future+5s/+5.001s (proposed boundary) | D03 admission boundary; neither future sample public before age>=0; far future cannot poison watermark |
| B13B-17 | Age30s/30.001s and stale job delayed | Read eligibility boundary exact; stale result UNKNOWN/unavailable without relying on sweep |
| B13B-18 | Newer parseable invalid then delayed older valid | Invalid observed_at prevents rollback; last valid coordinates remain private historical only |
| B13B-19 | Malformed/unorderable invalid after newer valid | Quarantine/ignore per approved D03; no unordered downgrade/watermark poisoning |
| B13B-20 | Older status/offline, equal-time conflict, missing source time | Independent status watermark; conservative UNKNOWN; no fabricated GPS/motion |
| B13B-21 | Active jeepney but device inactive/request unverified/application rejected | No accepted coordinate/public eligibility; workflow gates cannot be bypassed |
| B13B-22 | Remap to new UUID/time while old-device work queued | Generation reset/revision retained; old queued/sample-time data cannot write new device coordinates |
| B13B-23 | Numeric provider ID reused/restore/ambiguous ABA | Fail closed/reconcile and require approved mapping generation, not silent identity reuse |
| B13B-24 | Ownership/group/route/geometry/corridor changes without GPS | Read masking immediate; transfer hides prior-context private coordinates and fences queued old observations; reconciliation increments revision/resets counters; correct current audience |
| B13B-25 | Driver matches same jeepney through2groups; unrelated Driver/Operator | Authorized once via EXISTS, one marker/count; outsider403/no data |
| B13B-26 | Commuter inspects all JSON keys and error bodies | Exact public allowlist, no provider IDs/PII/credentials/attributes, no stale/off-route coordinates |
| B13B-27 | Two connections first-insert same jeepney | Second waits/reloads; exactly one PK row, monotonically correct revisions, no blind upsert |
| B13B-28 | Newer T+20 and older T+10 committed in both barrier orders | Final newest valid fix T+20, no older replacement; legitimate earlier transition history not rewritten |
| B13B-29 | Duplicate trigger delivered concurrently | One transition event, one accepted advance, unique event(jeepney,revision) |
| B13B-30 | Sweep selects expired row; newer fresh fix wins before sweep lock | Sweep rechecks after lock/CAS and never downgrades newer fix |
| B13B-31 | A verification/review/remap races B update | Approved shared lock order avoids baseline inversion; no false-active row or A request deadlock500; execute against reviewed A integration |
| B13B-32 | A group/direct assignment mutation races resolver/state write | Consistent resolved snapshot under shared locks; direct precedence unchanged; no split pool/transaction query |
| B13B-33 | Two owners race acquisition; expired/stale writer overlaps new fence | Old token rejected, no commit across new-fence acquisition; one active durable owner |
| B13B-34 | Inject40P01/40001/55P03 and exhausted retry budget | Whole transaction retry only; one eventual event or classified failure; no endless loops/partial commit |
| B13B-35 | Commit succeeds but acknowledgement lost; process restarts/replays | DB duplicate guard wins, no duplicate state/event; source watermark survives restart |
| B13B-36 | DB outage between point write and event/intent write | Entire transaction rolls back; SINK_FAILURE/reconciliation, no log-only success acknowledgement |
| B13B-37 | Crash/SIGTERM during connect/backoff/in-flight DB; deadline expires | Accepted stop semantics, commit-or-rollback, pool/socket/health cleanup, conditional lease release/expiry |
| B13B-38 | Publisher down/slow/duplicate ack then newer intent | GPS/event commit retained; newer pointer survives old ack; no GPS history payload in outbox |
| B13B-39 | Role/group removal or disabled account with existing Pusher subscription | Only generic invalidation remains, no new private GPS/IDs; REST denies revoked resources and signer denies impersonated/disabled requests. An active user's own generic channel can remain; no client-side-only authorization |
| B13B-40 | Pusher gap/startup race/old auth-scope response/expired marker | Subscribe+snapshot+refetch reconciliation; complete snapshot replaces markers; expiry hides unavailable even offline |
| B13B-41 | Event-history ownership transfer / departed memberships | Approved temporal-window policy enforced; current visibility/provenance alone cannot disclose another fleet's historical events |
| B13B-42 | Empty001–005-upgrade schema, invalid migration, rollback/restore drill | Correct tables/checks/indexes/grants; atomic failure; old API works; leave audit data intact on operational rollback |

These tests are prerequisites for approving implementation, not claims of execution now. Cases involving13b compliance or ID19 gateway must run only once their respective releases exist. Existing13a101+live evidence remains a regression baseline; reproduce it with no new provider writes under future authorized verification.

## Explicit two-connection proof scripts (test specifications)

For B13B-27: client A BEGIN + shared lease/jeepney lock; signal lock-held barrier; client B BEGIN and attempt same lock; assert B blocked via controlled promise/own pg_locks inspection; A inserts revision1 and COMMIT; B rereads row and rejects same fix as duplicate. Assert1row/1revision/no event. Reverse first-writer order. Never use arbitrary sleeps as the proof of serialization.

For B13B-28: arrange A older/B newer then A newer/B older in separate runs; pause before commit. Final state must always contain newer time; events reflect only accepted chronological evidence before commit, never a later replay duplicate. Equal-time different-ID test deliberately chooses lock acquisition order; first committed wins without oscillation.

For B13B-30: sweep discovers row before its deadline recheck; stop at barrier, writer commits new point; release sweep and assert no STALE update. For B13B-31/32 use actual A methods after approved executor/locking changes, not a mocked resolver or synthetic lock order unlike production. For B13B-33 forcibly close only the test writer's own DB connection, acquire new lease/fence with another, try stale token write and prove no mutation. No live service restarts needed.

## Security assessment

| Threat | Design control / residual gate |
|---|---|
| Traccar/admin/JDBC secrets in clients/logs | Server-only least-privilege API credentials, allowlisted logs/DTOs; no bootstrap bundle consumption. Existing approved DPAPI mechanism unchanged |
| Mobile/provider ID spoofing or wrong tracker | Trusted authenticated registry+current uniqueId/generation, admission timestamps, eligibility joins; clients never publish ingestion observations |
| Cross-fleet/group read/history leak | A transaction-aware scope and current reauthorization; temporal-history D09 approval; no provenance-as-auth |
| Stale subscriber after revocation | Invalidation-only Pusher payload; REST authorizes current scope; data-bearing streams gated separately |
| Duplicate/reordered/replayed telemetry | Durable source/observation watermarks, mapping generation, lease fence, locked CAS and event uniqueness |
| Assignment/geometry changed while cached state ON_ROUTE | Read-time resolver/context masking, shared lock protocol, invalidation/reconcile; no stale materialized route authority |
| SQL deadlock/unbounded lock pressure | Explicit A/B order gate, one-jeepney bounded transaction, bounded retries; no external network while locked |
| DB/provider/Pusher outage | Distinct health/UNKNOWN/expiry, durable replay guards, publisher outside commit, REST fallback; no false offline/fresh assurance |
| Retention creep/privacy | No raw GPS mirror, transition-only events, pointer-only intents; retention/purge approval separate; no unapproved indefinite default |
| Raw test data/privileged infrastructure mutation | Disposable approved app DB, scoped fixtures, no production/server restarts/telemetry under design approval |

Bridge app DB role needs the exact business/context reads and permitted writes only to B tables; not schema owner/DDL/Traccar DB. **Privilege gate D12:** SELECT alone is insufficient for the proposed FOR UPDATE/FOR SHARE locks on A tables. A/G must approve either narrowly scoped locking privileges or an A-owned, tightly allowlisted locking helper with reviewed definer identity/search_path/EXECUTE grants. Do not claim the writer can run with SELECT-only business-table grants, or silently grant broad business UPDATE. Exercise the final least-privilege identity in B13B-31/32/42 before rollout. API read role/publisher/purge/migrator capabilities are separate deployment decisions. Check query/path and TypeBox input limits, statement timeouts, health privacy and token redaction before rollout. Exact deployment grants, TLS and secret-store/runtime identity need Infrastructure/owner review; no new credential configured here.

## Proposed implementation/rollout slices after explicit release

The [P1–P5 release plan](IMPLEMENTATION_RELEASE_PLAN.md) supersedes the earlier combined writer/compliance slice ordering: P1 exact schema PR; P2 latest-state writer with compliance UNKNOWN; P3 compliance/events; P4 recovery/operations; P5 separately authorized REST/Pusher. Every phase specifies its dependency, tests, rollback and approval boundary. All phases NOT_RELEASED; no implementation follows merely from this design refinement.

Suggested feature gates (names not implemented): TRACKING_PERSISTENCE_ENABLED, TRACKING_COMPLIANCE_ENABLED, TRACKING_GATEWAY_ENABLED, TRACKING_PUBLISHER_ENABLED; defaultfalse until matching schema/config acceptance. Health distinguishes disabled/ready/degraded; never a silent summary sink while persistence flag claims success. Operational rollback switches off readers/publisher/writer in controlled order, stops temporary Bridge gracefully and leaves new tables/events intact. Accepted13a can still operate summary-only, but UI must show tracking unavailable; no old durable row passed off as live. See [migration rollback](SCHEMA_AND_MIGRATIONS.md).

## Retention and monitoring decisions

- Traccar raw telemetry/native events remain under approved30-day MVP operational policy. Do not duplicate them into Valryde for replay/reports.
- Recommend30-day application compliance transitions for D08 review; exact owner/privacy/archival choice must precede event-write/purge implementation. Event raw-fix references may become unavailable after Traccar retention; API must distinguish this from missing authorization.
- Latest row retained while vehicle business record exists, with stale/unknown masking; storage is not unlimited position history. Historical events do not block revision monotonicity during remap or approved retention purge.
- Later publication pointers delete on matching successful acknowledgement; proposed24h max retry age then alert/drop under D11, with no guaranteed replay claim. Stale scope pointers contain no GPS payload.
- Health: lease owner/fence readiness (no private fence value client-side), transport status, schema version, age of last DB commit, mapping rejection counts, invalid/future/out-of-order counts, sweep lag and publisher backlog. Privileged alerts must redact identifiers/coordinates/secrets.
- Hard gates for wider rollout: independent migration/restore proof, unchanged A auth/route regressions, strict public-field snapshot tests, context change/role revocation, exact30s rendering expiry, safe graceful shutdown and agreed stationary-reporting hardware settings. No scale/SLA certification from the two-device development environment.

## Verification performed for THIS package

Read-only schema metadata transaction confirmed001–005/PostGIS3.6.2, no13b tables. Documentation links/fences/decision IDs/test-case uniqueness and tracked-file allowlist checked; diff whitespace checked. No npm runtime tests, db:migrate, fixtures, Traccar sessions, DPAPI reads, Pusher requests or service processes executed for design verification. GitHub CI for the documentation PR may run its ordinary isolated checks; report them separately from planned13b acceptance tests.

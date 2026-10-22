# Independent tracking verification and C/D/E gateway handoff

Directive VALRYDE-AGENT-B-TRACKING-COMPLETION-001. Checkpoint **AGENT_B_TRACKING_INDEPENDENT_SCOPE_COMPLETE** refers only to authorized independent work. Overall Agent B IDs12–21 remain IN_PROGRESS, not completed durable tracking. Canonical status remains [AGENT_B_STATUS.md](../agent-status/AGENT_B_STATUS.md).

## Baseline, authority and source preservation

Branch test/b-tracking-independent-preparation is based on merged main827738c0f2c33ad3082f6a4a38a8e35669d4b0ea, including accepted13a PR10/merge69deb572a9e323ce5cb2f0fb0f163dafe8df2bbd. No runtime source is taken from an unmerged dependency. Work item [Issue18](https://github.com/erwin-io/valryde-api/issues/18); review [PR22](https://github.com/erwin-io/valryde-api/pull/22), substantive admission/test headf97724b3fdaa4ba9556f08b82691889a5a41d230. Follow-up adds only read-only SQL probe/report metadata, not production source changes.

Reviewed B [PR14](https://github.com/erwin-io/valryde-api/pull/14) at149cefc82d0ccea3c1efe06aebaf157a607c1d8e, its D01–D12/42-scenario/P1–P5 package; A [PR17](https://github.com/erwin-io/valryde-api/pull/17) atfd76cb54000ec47c383c6641359f3e3cf59e4340 (interface content36af1c6cb7cd1e749f4d8d2eff15183e40e578fd); A G1/fixture handoff. Both design PRs are OPEN with no GitHub reviews/comments approving exact decisions at recovery. Architecture acceptance in principle from the human is preserved; exact shared-schema/gateway approval is not inferred.

Read [A interface proposal](https://github.com/erwin-io/valryde-api/blob/36af1c6cb7cd1e749f4d8d2eff15183e40e578fd/docs/design/stage13b/AGENT_A_SHARED_INTERFACE_SPECIFICATION.md) and [A G1/fixture UI handoff](https://github.com/erwin-io/valryde-api/blob/fd76cb54000ec47c383c6641359f3e3cf59e4340/docs/integration/AGENT_A_G1_FIXTURE_UI_HANDOFF.md). Open G1/fixture PRs are not assumed deployed or permission to seed the installed application database. Full V1 DOCX/standalone checklist remain unavailable in this worktree; frozen handoffs and explicit owner releases are used.

## Completed independent changes

-38 new deterministic tests in test/tracking-independent.test.ts cover safe provider IDs, malformed/nonfinite values, normalization/source instants, future/per-device watermarks, invalid-fix gap characterization, UTF8 frame bounds, malformed sibling isolation, event-ID dedupe/arrival ordering, status-without-GPS, stationary reporting, stale reconciliation, queue overflow, shutdown cancellation/drain, replaced-socket callbacks, duplicate supervisors and privacy.
-2 added existing history-boundary tests reject ambiguous duplicate provider devices and reauthorize a revoked fleet grant before provider access. This tests the accepted service, not a speculative A adapter.
-Two reproduced B-owned defects fixed narrowly: finite source speed may overflow km/h, now rejected during provider parsing; maxFrameBytes now counts UTF8 bytes rather than UTF16 characters. Valid normalization, accepted session/lifecycle/recovery and API/A interfaces preserved.
-One additional read-only pg-tracking-geometry.integration.test.ts probe uses only constant geometries in the isolated CI PostGIS service: longitude/latitude/SRID,99/100/101m distance measurements,100/150m corridors and exact coincident-point inclusion. It rolls back/releases in finally, creates no fixture/table, and never claims full B13B-11 evaluator acceptance. Nominal100m projection is measured within numerical test tolerance; no runtime corridor epsilon is added.
-No database migration/schema, A-owned source, API endpoint/DTO, route rule, Pusher/channel, permanent process or infrastructure configuration changed. No Traccar session/credential/telemetry access. Independent lifecycle tests use injected fakes and an ephemeral loopback provider stub; the SQL dependency probe runs only when an explicitly supplied isolated TEST_DATABASE_URL exists (CI).

## Verification ledger

| Execution | Actual result | Meaning |
|---|---|---|
| First new36-test run |22PASS/14FAIL | Synthetic remote-HTTP fixture and upper-speed vector corrected; original failure retained here |
| Corrected fixture, before source fixes |34PASS/2FAIL | Reproduced conversion overflow and multibyte frame-limit defects |
| After narrow fixes,5 tracking suites |96PASS | Actual existing bridge/REST/history and loopback HTTP/socket regression |
| Expanded independent+history suites |52PASS |38new independent tests plus14history tests; no database |
| Lint/typecheck/full tests/build/audit before SQL probe | PASSED;139tests passed/15skipped |12files passed/9skipped; DB14cases + live1case explicitly skipped; audit0 |
| Final SQL-probe-inclusive local full test run | PASSED WITH SKIPS;139PASS/16SKIP |12files passed/10skipped; DB15cases + live1 skipped; read-only probe PASSED in isolated CI below |
| Initial PR22 API verify + GitGuardian atf97724b | PASSED | CI39789717778 runs legacy001–005 on disposable PostGIS |
| SQL-probe-inclusive CI at00c8695 | PASSED;154tests passed/1live skipped | CI39790513191:21files passed/1skipped; actual read-only PostGIS probe PASS53ms, lint/typecheck/build/security passed |

Plain npm run lint initially failed because an ignored historical tmp/bridge-readonly-validation.mjs is outside TypeScript project service. The npm wrapper also consumed the attempted exclusion flag; direct node node_modules/eslint/bin/eslint.js . --ignore-pattern tmp/** successfully excluded only ignored local artifacts. Those historical scripts are preserved; tracked CI runs the unchanged ordinary lint command.

Local full test execution explicitly clears TEST_DATABASE_URL and TRACCAR_LIVE_TEST in the child environment then restores inherited values. Database/live cases are skipped, not passing evidence. GitHub CI may run unchanged legacy001–005 PostgreSQL tests in its disposable PostGIS service; it does not implement or pass the42 future13b cases. No new migrations executed anywhere under this slice. The additional PostGIS dependency probe uses BEGIN READ ONLY and constant geometries only, with no B schema/A context dependency; its CI result is separate from the42 full-case ledger.

## IDs12–21 feature inventory

| ID | Existing/independent result | Remaining dependency |
|---|---|---|
|12 Traccar integration | REST/session adapter merged; historical Windows authenticated evidence preserved | Production credentials/TLS/version and physical GPS operator evidence |
|13 persistent Bridge | Accepted13a dedicated supervisor; lifecycle regression executed | Permanent service deployment separately owner-authorized |
|14 recovery | Session reuse, native reconnect/backoff/keepalive/shutdown retained and tested | Durable DB recovery awaits A006/B007 |
|15 position normalization | Parser/units/identity/finite/time tests and overflow correction complete | Durable invalid/status observations need D03/D04 and approved writer |
|16 Vehicle Tracking Status Processing | Speed/heading normalized; device-status and no-fabricated-GPS regressions | Durable status source ordering, motion/online freshness projections, latest lease/revision/context need A006/B007 |
|17 Traccar Events Processing | Native event retrieval/allowlist/dedupe tested; no GPS synthesized | Durable compliance history/API requires B008 and approved privacy policy |
|18 Tracking History Retrieval | Existing scoped service+provider primitives; denial/reauthorization tested | No registered tracking history HTTP endpoint; contract/temporal policy approval |
|19 realtime | Snapshot/reconciliation/overload/privacy designs inventoried below | D09–D11/gateway authorization, publisher;009 needs separate release |
|20 route geometry | Canonical A geometry/resolver preserved; no B implementation claimed | Approved A transaction contract plus B008/PostGIS tests |
|21 compliance | Frozen100m/30s OR3outside/2inside/UNKNOWN rules retained | D02/D03 confirmation, durable state/events and real SQL acceptance |

## Independent synthetic observations and limits

| Scenario | Actual preparation / authoritative requirement |
|---|---|
| Fix age29.999s and30s | Future public rule remains eligible only if every other approved predicate holds; public evaluator not implemented here |
| Fix age30.001s | Test advances fake clock without GPS and confirms no fresh sample fabricated; RUNNING transport is not public freshness |
|60s stationary reports, speed0 | Actual Bridge test receives only fixes atT andT+60;55s keepalive preserves connection. Frozen30s public rule means an availability gap, not widened freshness |
|5s future/5.001s | Actual gate accepts at tolerance, rejects beyond; rejected future cannot poison watermark. Durable/public behavior still needs approved contract |
| New invalid fix then older valid | Stage13a drops invalid and can admit delayed valid relative to last valid watermark. Explicit D03/D04 durable gap, not silently implemented |
| Older event/status observations | Current event sink preserves arrival order with ID dedupe; device updates do not synthesize GPS. Durable source-time status ordering remains blocked |
| Provider ID/uniqueId and application mapping | Safe integer parsing, duplicate provider match denial and current private scope verified. No A context-version/remap guarantee is claimed from memory |
| Slow sink/queued frames/stop | Active sink drains once; queued callbacks do not run after end; overflow forces classified reconnect and old socket callbacks ignored |

Hardware ~60s stationary behavior is not changed/configured; F/owner must choose/verify reporting cadence consistent with30s availability. No physical device or production Pusher result claimed.

## Exact Agent A and approval dependencies

1. G accepts D01–D12 exact schema/state/retention/privacy/limits, not only architecture direction.
2. A publishes approved source interfaces: same caller-owned PoolClient/executor, canonical route resolver, existence-based private visibility and separate telemetryEligible/routeUsability. A17 is design only.
3. A006 context version/cutover and advisory-lock/mutation protocol must be approved and integrated (or G approves a concrete dependency approach). Positive monotonic generation, post-lock DB clock, sorted key acquisition, affected-set expansion rollback, max synchronous mutation size, no privileged manual bypass and all mutations need SQL proof.
4. B007 latest+lease/B008 compliance exact migration/runtime release follows A compatibility. No executable migration exists here. Rollback preserves additive tables/audit and disables consumer/readers; destructive restore/drop requires its own authorization.
5. Gateway TypeBox/OpenAPI DTO/path/history/window/channel/signer model requires approval before implementation;009publication intents explicitly separate if chosen. Physical hardware, secure credentials, permanent services and production rollout remain owner/operator gates.

The [five-phase design](https://github.com/erwin-io/valryde-api/blob/149cefc82d0ccea3c1efe06aebaf157a607c1d8e/docs/design/stage13b/IMPLEMENTATION_RELEASE_PLAN.md) remains the phase test/rollback/authorization plan. None of its gated phases is enabled by this independent completion checkpoint.

## Gateway/API/Pusher contract inventory for C/D/E

**No approved tracking HTTP or Pusher client contract is published by this PR.** Approved/internal versus proposed are separated below. Clients never connect to Traccar or use internal provider records as DTOs.

| Surface | Current status | Consumer contract / blocker |
|---|---|---|
| GET /api/jeepneys and /api/jeepneys/{id}/effective-route | Merged A contract | D/E scoped fleet and canonical route; not live location/availability |
| GET /api/transit-routes and /api/transit-routes/{routeId} | Merged A contract | C/D/E canonical geometry/colors; no independently inferred compliance |
| GET /api/health | Merged generic API/database contract | Not Bridge durability/publisher or hardware-online certification |
| Internal TrackingHistoryService.history/events | Merged B internal service | A current scope; sanitized position/native-event outputs; no public HTTP path |
| Internal TelemetryBatch/NormalizedPosition | Merged private bridge sink | Contains provider IDs/uniqueId/coordinates, never serialize directly to mobile |
| Proposed route-direction snapshot | NOT_IMPLEMENTED/NOT_FROZEN | PublicVehicleV1: plate/color/route/position/heading/time/revision/expiry; eligible only; no Driver/Operator identity |
| Proposed private fleet/group/latest snapshot | NOT_IMPLEMENTED/NOT_FROZEN | A current scope; distinguish current vs last-known/UNKNOWN; group counts deduplicated |
| Proposed Admin diagnostics/events/reporting | NOT_IMPLEMENTED/NOT_FROZEN | Platform authorization, safe diagnostics, bounded historical window; no provider secret/identity exposure |
| Proposed POST /api/realtime/auth | NOT_IMPLEMENTED/NOT_FROZEN | Current JWT/session + exact channel grammar/scope;401/403 authoritative; no arbitrary recipient IDs |
| private-valryde-v1-route-{directionUUID} / private-valryde-v1-user-{userUUID} | PROPOSED ONLY | Invalidation-only tracking.snapshot-invalidated.v1; no GPS/vehicle/private-event IDs in event; credentials not configured |
|009tracking_publication_intents | NOT_IMPLEMENTED/SEPARATE_RELEASE | Pointer-only durable delivery, CAS ack/revision, old-scope invalidation, bounded retry; no claim of end-to-end reliability from memory |

Exact proposed DTO fields/paths/envelopes/errors/size limits are pinned in [gateway design](https://github.com/erwin-io/valryde-api/blob/149cefc82d0ccea3c1efe06aebaf157a607c1d8e/docs/design/stage13b/GATEWAY_CONTRACT_PROPOSAL.md). They remain recommendations. No anonymous share URLs.

## Ready-to-implement gateway/reconciliation acceptance designs

All following gateway tests remain **NOT_RUN / CONTRACT_BLOCKED**, not a fake publisher implementation:

- Subscribe before complete snapshot; invalidate while HTTP response pending; fetch again. On reconnect/foreground replace the whole collection, including equal-revision removals. Ignore response from previous auth/scope generation.
- Snapshot cap1000/cap+1 safe rejection; never truncate a collection and claim complete. Distinct vehicles despite multiple group paths; counts use the same eligible filtered set.
- At exactly30s eligible only when active/ONLINE/valid/current-context/selected active route/ON_ROUTE; after deadline hide even offline/Pusher lost. availableUntil bounded by fix and valid lease deadline.
- Current subject channel only; deny disabled/revoked/other-fleet requests before provider or signing. Existing stale subscriber gets no private GPS; each REST request reauthorizes. Ownership/context version mismatch masks previous point.
- Duplicate/out-of-order invalidations coalesce harmlessly; failed HTTP is not an empty fleet; bounded poll10s/debounce250ms/retry24h are still D11 proposals.401/403 stops retries; honor approved429 retry-after.
- Fake publisher failures must not rollback committed GPS. When durable intents are released, old token/revision ack cannot delete newer pointer, old routes get invalidated, and queued stale context never renders old coordinates.
- Native history and compliance transitions remain distinct source/type/time domains. Driver historical temporal authorization is not inferred from present group membership. No raw provider IDs/credentials in errors, logs, DTOs or events.

| Consumer | Integration-ready now | Tracking blocker |
|---|---|---|
| C IDs29–36 | Existing A routes/directions/auth; offline UI using clearly labelled artificial fixtures | No approved live snapshot/count/movement endpoint; D09/D10 + B007/B008 |
| D IDs39–45/47/51/53–54 | Existing A own-fleet/group/auth and B private service primitives | No client tracking location/groupmate/alerts/summary/history HTTP gateway; A scope/temporal policy |
| E IDs56/60/63/65–67 | Existing A Admin/workflow/routes/auth | No authorized global tracking/device diagnostics/deviation/summary gateway; E contract freeze |

A G1 PR12 and fixtures PR15 remain separate unmerged dependencies; do not seed shared users or silently call open-PR endpoints. No C/D/E repository edited.

## B13B-01 through42 full-case execution matrix

Counts: **0PASS /0FAIL /42BLOCKED /0NOT_RUN**. BLOCKED means the complete acceptance case could not be executed because its approval/source/schema dependency is absent. Related independent subtests may pass without upgrading the full case to PASS. No mocked PostgreSQL concurrency is evidence. Machine-readable ledger: [results JSON](stage13b-acceptance-results.json).

| ID | Result | Exact blocker | Partial preparation |
|---|---|---|---|
|B13B-01|BLOCKED|PERSISTENCE_RELEASE: D01-D07/D12 plus approved integrated A006 and B007/B008; isolated database authority|No full-case execution; design only|
|B13B-02|BLOCKED|PERSISTENCE_RELEASE: D01-D07/D12 plus approved integrated A006 and B007/B008; isolated database authority|Related independent parser/ordering/privacy/lifecycle subchecks executed; durable/gateway portion NOT_RUN|
|B13B-03|BLOCKED|PERSISTENCE_RELEASE: D01-D07/D12 plus approved integrated A006 and B007/B008; isolated database authority|Related independent parser/ordering/privacy/lifecycle subchecks executed; durable/gateway portion NOT_RUN|
|B13B-04|BLOCKED|COMPLIANCE_RELEASE: D02/D03 plus A006/interfaces and approved B007/B008 schema/runtime|No full-case execution; design only|
|B13B-05|BLOCKED|COMPLIANCE_RELEASE: D02/D03 plus A006/interfaces and approved B007/B008 schema/runtime|No full-case execution; design only|
|B13B-06|BLOCKED|COMPLIANCE_RELEASE: D02/D03 plus A006/interfaces and approved B007/B008 schema/runtime|No full-case execution; design only|
|B13B-07|BLOCKED|COMPLIANCE_RELEASE: D02/D03 plus A006/interfaces and approved B007/B008 schema/runtime|No full-case execution; design only|
|B13B-08|BLOCKED|COMPLIANCE_RELEASE: D02/D03 plus A006/interfaces and approved B007/B008 schema/runtime|No full-case execution; design only|
|B13B-09|BLOCKED|COMPLIANCE_RELEASE: D02/D03 plus A006/interfaces and approved B007/B008 schema/runtime|No full-case execution; design only|
|B13B-10|BLOCKED|COMPLIANCE_RELEASE: D02/D03 plus A006/interfaces and approved B007/B008 schema/runtime|No full-case execution; design only|
|B13B-11|BLOCKED|COMPLIANCE_RUNTIME: exact evaluator/corridor configuration integration not released; independent SQL dependency probe is not full acceptance|PASS: read-only PostGIS dependency probe in isolated CI39790513191 at00c8695; no tables/fixtures/business writes; full runtime evaluator/config NOT_RUN|
|B13B-12|BLOCKED|COMPLIANCE_RELEASE: D02/D03 plus A006/interfaces and approved B007/B008 schema/runtime|No full-case execution; design only|
|B13B-13|BLOCKED|COMPLIANCE_RELEASE: D02/D03 plus A006/interfaces and approved B007/B008 schema/runtime|No full-case execution; design only|
|B13B-14|BLOCKED|COMPLIANCE_RELEASE: D02/D03 plus A006/interfaces and approved B007/B008 schema/runtime|No full-case execution; design only|
|B13B-15|BLOCKED|PERSISTENCE_RELEASE: D01-D07/D12 plus approved integrated A006 and B007/B008; isolated database authority|Related independent parser/ordering/privacy/lifecycle subchecks executed; durable/gateway portion NOT_RUN|
|B13B-16|BLOCKED|PERSISTENCE_RELEASE: D01-D07/D12 plus approved integrated A006 and B007/B008; isolated database authority|Related independent parser/ordering/privacy/lifecycle subchecks executed; durable/gateway portion NOT_RUN|
|B13B-17|BLOCKED|PERSISTENCE_RELEASE: D01-D07/D12 plus approved integrated A006 and B007/B008; isolated database authority|Stationary30.001s/60s transport/fix-age characterization executed; public-expiry/gateway implementation NOT_RUN|
|B13B-18|BLOCKED|PERSISTENCE_RELEASE: D01-D07/D12 plus approved integrated A006 and B007/B008; isolated database authority|Related independent parser/ordering/privacy/lifecycle subchecks executed; durable/gateway portion NOT_RUN|
|B13B-19|BLOCKED|PERSISTENCE_RELEASE: D01-D07/D12 plus approved integrated A006 and B007/B008; isolated database authority|Related independent parser/ordering/privacy/lifecycle subchecks executed; durable/gateway portion NOT_RUN|
|B13B-20|BLOCKED|PERSISTENCE_RELEASE: D01-D07/D12 plus approved integrated A006 and B007/B008; isolated database authority|Related independent parser/ordering/privacy/lifecycle subchecks executed; durable/gateway portion NOT_RUN|
|B13B-21|BLOCKED|A_CONTEXT: approved integrated A006, transaction/visibility/advisory/mutation/generation contract|No full-case execution; design only|
|B13B-22|BLOCKED|A_CONTEXT: approved integrated A006, transaction/visibility/advisory/mutation/generation contract|No full-case execution; design only|
|B13B-23|BLOCKED|A_CONTEXT: approved integrated A006, transaction/visibility/advisory/mutation/generation contract|Related independent parser/ordering/privacy/lifecycle subchecks executed; durable/gateway portion NOT_RUN|
|B13B-24|BLOCKED|A_CONTEXT: approved integrated A006, transaction/visibility/advisory/mutation/generation contract|No full-case execution; design only|
|B13B-25|BLOCKED|A_CONTEXT: approved integrated A006, transaction/visibility/advisory/mutation/generation contract|No full-case execution; design only|
|B13B-26|BLOCKED|GATEWAY_CONTRACT: D09-D11 and A authorization/temporal-history approval; no released gateway/publisher|Related independent parser/ordering/privacy/lifecycle subchecks executed; durable/gateway portion NOT_RUN|
|B13B-27|BLOCKED|PERSISTENCE_RELEASE: D01-D07/D12 plus approved integrated A006 and B007/B008; isolated database authority|No full-case execution; design only|
|B13B-28|BLOCKED|PERSISTENCE_RELEASE: D01-D07/D12 plus approved integrated A006 and B007/B008; isolated database authority|No full-case execution; design only|
|B13B-29|BLOCKED|COMPLIANCE_RELEASE: D02/D03 plus A006/interfaces and approved B007/B008 schema/runtime|No full-case execution; design only|
|B13B-30|BLOCKED|PERSISTENCE_RELEASE: D01-D07/D12 plus approved integrated A006 and B007/B008; isolated database authority|No full-case execution; design only|
|B13B-31|BLOCKED|A_CONTEXT: approved integrated A006, transaction/visibility/advisory/mutation/generation contract|No full-case execution; design only|
|B13B-32|BLOCKED|A_CONTEXT: approved integrated A006, transaction/visibility/advisory/mutation/generation contract|No full-case execution; design only|
|B13B-33|BLOCKED|PERSISTENCE_RELEASE: D01-D07/D12 plus approved integrated A006 and B007/B008; isolated database authority|No full-case execution; design only|
|B13B-34|BLOCKED|PERSISTENCE_RELEASE: D01-D07/D12 plus approved integrated A006 and B007/B008; isolated database authority|No full-case execution; design only|
|B13B-35|BLOCKED|PERSISTENCE_RELEASE: D01-D07/D12 plus approved integrated A006 and B007/B008; isolated database authority|No full-case execution; design only|
|B13B-36|BLOCKED|PERSISTENCE_RELEASE: D01-D07/D12 plus approved integrated A006 and B007/B008; isolated database authority|No full-case execution; design only|
|B13B-37|BLOCKED|PERSISTENCE_RELEASE: D01-D07/D12 plus approved integrated A006 and B007/B008; isolated database authority|Related independent parser/ordering/privacy/lifecycle subchecks executed; durable/gateway portion NOT_RUN|
|B13B-38|BLOCKED|GATEWAY_CONTRACT: D09-D11 and A authorization/temporal-history approval; no released gateway/publisher|No full-case execution; design only|
|B13B-39|BLOCKED|GATEWAY_CONTRACT: D09-D11 and A authorization/temporal-history approval; no released gateway/publisher|No full-case execution; design only|
|B13B-40|BLOCKED|GATEWAY_CONTRACT: D09-D11 and A authorization/temporal-history approval; no released gateway/publisher|Stationary30.001s/60s transport/fix-age characterization executed; public-expiry/gateway implementation NOT_RUN|
|B13B-41|BLOCKED|GATEWAY_CONTRACT: D09-D11 and A authorization/temporal-history approval; no released gateway/publisher|No full-case execution; design only|
|B13B-42|BLOCKED|PERSISTENCE_RELEASE: D01-D07/D12 plus approved integrated A006 and B007/B008; isolated database authority|No new migration or rollback executed; legacy001-005 CI is separate regression evidence|

## Deployment, migrations and remaining evidence

No new migration authored/executed or local database fixtures created, live telemetry sent, actual Traccar account changed, service installed, production secret accessed or deployment performed. Existing DPAPI service artifact and Windows Infrastructure preserved; historical authenticated13a evidence is linked in prior status and remains historical. New fake sockets/timers/loopback listeners close during tests. Approval gates require G/A decisions and later exact SQL/database scope, not physical hardware before submitting independent software work.

Production-fix/test source head: f97724b3fdaa4ba9556f08b82691889a5a41d230. Final SQL-probe source/test head:00c8695ea4d8a9a69c9f23c1efb3d2f7e2cf8101, CI39790513191 PASSED154tests/1live skip, with actual isolated PostgreSQL/PostGIS dependency probe. Subsequent evidence-only HEAD/CI is recorded in PR22/canonical status; no claim that the42 gated cases passed. Do not self-merge or declare IDs12–21 fully accepted from this checkpoint.

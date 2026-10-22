# Stage13b executable acceptance specifications — planned

These Given/When/Then specifications are implementation-ready requirements, not executable runtime test code or passing evidence. All42 cases are **PLANNED / NOT_RUN**. No npm test, fixtures, migration, application telemetry write or live service is authorized by this file. The original matrix remains the stable ID index; these clauses remove test ambiguity without adding/removing cases.

## Harness prerequisites and evidence contract

- Isolated, explicitly authorized disposable application PostgreSQL/PostGIS database; reject a shared/non-isolated target before fixture creation. Record redacted DB identity/owner/isolation proof; no credential output. Traccar DB and live development business data are excluded. Use owned fixture UUIDs and cleanup guarded against external relationships; never blanket DELETE/TRUNCATE.
- A approved helper/source and released exact migrations are prerequisite, not invented test doubles in concurrency proof. Pure machine tests use fixed T; real DB tests use a server-owned decision-clock seam anchored to DB time. No client-supplied clock, wall-clock sleeps or production clock changes.
- Eligible base: active approved vehicle V, active device/request/application chain, immutable mapping G and active canonical direction R; owner O and running lease fence F. Use clearly artificial fixture values. Keep the lease valid through each normal decision using the released heartbeat clock steps (pure tests may use an explicitly unexpired fixture); do not let15s lease expiry accidentally mask30s GPS/compliance tests. Case33 varies lease expiry deliberately. Each case overrides base explicitly. No real hardware claim from fixtures.
- Concurrency barriers expose semantic stages (lock acquired, before write/commit, sweep selected). Prove waiting with own blocked query/pg lock observation, then release barrier. Include bounded wait timeout so a broken test fails rather than hangs. Assert results using a separate committed observer client.
- Every case records implementation HEAD/migrations, SQLSTATE/disposition, before/after revision/fence/watermarks, row/event counts, authorization result and cleanup residue. Evidence is sanitized; no coordinates/IDs/secrets in operational logs. No planned assertion may be marked PASSED before actual execution.
- Phase dependencies are explicit. P2 writes keep compliance UNKNOWN; P3 assertions activate only after compliance release. Gateway casesP5 cannot be counted as P2/P3 completion. A missing approved interface is BLOCKED_BY_INTERFACE/NOT_RUN, not skipped-as-success.

## Scenario clauses

### B13B-01

Phase: P2 point / P3 compliance. Harness: Real PostgreSQL/PostGIS. Evidence: **PLANNED / NOT_RUN**.

- **Given:** Eligible vehicle V, generation G, running lease F, empty state; fresh inside fix p1 at T.
- **When:** Apply p1 and read committed state on a separate client.
- **Then:** Exactly one row; SRID4326 point(lon,lat), revision1, original three source times; P3 ON_ROUTE with no bootstrap event. In P2 compliance remains UNKNOWN.

### B13B-02

Phase: P2. Harness: Pure normalization + real constraints. Evidence: **PLANNED / NOT_RUN**.

- **Given:** p1 with latitude120 from an out-of-bounds swap, then NaN/Infinity/invalid bounds for each numeric field.
- **When:** Classify each observation and attempt independently approved constraint probes in rolled-back transactions.
- **Then:** No invalid geometry/finite violation stored; ordered trusted invalid control may invalidate per18, unorderable malformed input only counted. A swap with both numbers in range cannot be identified by bounds alone.

### B13B-03

Phase: P2. Harness: Pure normalization + real PostgreSQL. Evidence: **PLANNED / NOT_RUN**.

- **Given:** Valid p1: speed10knots, heading360; distinct fix/device/server times.
- **When:** Normalize, persist, serialize private allowlisted projection.
- **Then:** speed18.52km/h, heading0; source timestamps remain distinct and receipt time never substitutes for GPS ordering; bigint IDs remain exact decimal strings.

### B13B-04

Phase: P3. Harness: Pure machine + real transaction. Evidence: **PLANNED / NOT_RUN**.

- **Given:** Fresh context; outside p1 at T, outside p2 at T+30s, processing clocks equal source clocks.
- **When:** Apply both distinct fixes without intermediate invalid/gap observation.
- **Then:** OFF_ROUTE only at p2 by30s branch with outside_count2; exactly one deviation. No wall timer transition with only p1. Previous freshness deadline equality is inclusive.

### B13B-05

Phase: P3. Harness: Pure machine + real transaction. Evidence: **PLANNED / NOT_RUN**.

- **Given:** Outside p1/p2/p3 at T,T+10,T+20; context unchanged.
- **When:** Commit each separately and reload between calls.
- **Then:** OFF_ROUTE on third distinct fix, one deviation, saturated count3 and outside_since=T persist across transactions. Restart gap handling is specified in35, not permission to carry an unobserved run.

### B13B-06

Phase: P3. Harness: Pure machine + real transaction. Evidence: **PLANNED / NOT_RUN**.

- **Given:** Initial ON_ROUTE; one fresh outside point followed by inside.
- **When:** Apply two distinct fixes.
- **Then:** Never OFF_ROUTE, no deviation; outside count/time cleared by inside; status/keepalive does not count as a fix.

### B13B-07

Phase: P3. Harness: Pure machine + real transaction. Evidence: **PLANNED / NOT_RUN**.

- **Given:** OFF_ROUTE with pending deviation; two fresh consecutive inside fixes.
- **When:** Apply first then second with reload between.
- **Then:** First OFF_ROUTE/inside_count1; second ON_ROUTE/inside_count0/latchfalse, exactly one re-entry; replay either produces no extra event.

### B13B-08

Phase: P3/P4. Harness: Pure machine + real transaction. Evidence: **PLANNED / NOT_RUN**.

- **Given:** OFF_ROUTE pending latch in context G; trusted invalid or elapsed freshness.
- **When:** Materialize UNKNOWN, then apply first and second fresh inside fixes in same context.
- **Then:** Runs reset on invalidation; pending latch survives; first remains UNKNOWN, second ON_ROUTE and one re-entry. New context resets latch instead.

### B13B-09

Phase: P3. Harness: Pure machine + real transaction. Evidence: **PLANNED / NOT_RUN**.

- **Given:** New coherent context, UNKNOWN and no pending deviation.
- **When:** Apply one outside fix; inspect state before threshold.
- **Then:** Still UNKNOWN with outside_count1 and outside_since set; schema permits this run, no inherited ON_ROUTE/event or blanket UNKNOWN-zero-count constraint.

### B13B-10

Phase: P3/P4. Harness: Pure machine + real transaction. Evidence: **PLANNED / NOT_RUN**.

- **Given:** Outside run then gap30.001s; separate run with trusted invalid in between.
- **When:** Apply a fresh outside point after each interruption.
- **Then:** Continuity resets before counting new point; no timer branch from old run; new outside_count1 and new outside_since. Receipt/provider ordering cannot bypass expiry.

### B13B-11

Phase: P3. Harness: Actual PostGIS geography. Evidence: **PLANNED / NOT_RUN**.

- **Given:** Long canonical SRID4326 line; metric fixture points at99/100/101m and corridor100 then150.
- **When:** Compute ST_DWithin using geography/spheroid; separately probe numeric exact comparator.
- **Then:** 99 inside,101 outside at100; boundary inclusive with documented numerical fixture tolerance;100/101 inside at150. Never add tolerance to production corridor; no degree/WebMercator approximation.

### B13B-12

Phase: P3. Harness: A resolver integration + real PostgreSQL. Evidence: **PLANNED / NOT_RUN**.

- **Given:** One direct assignment and two inherited group assignments.
- **When:** Resolve through approved same-client A method within writer transaction.
- **Then:** Direct wins, one effective provenance, no false conflict or copied B precedence; transaction spy/connection identity proves no pool escape.

### B13B-13

Phase: P3. Harness: A resolver integration + real PostgreSQL. Evidence: **PLANNED / NOT_RUN**.

- **Given:** No direct; independently seed0,1,2 active inherited assignments.
- **When:** Resolve each through approved A boundary.
- **Then:** UNASSIGNED/null, RESOLVED/group and ROUTE_ASSIGNMENT_CONFLICT/UNKNOWN respectively; under recommended eligibility split, valid private GPS may persist with unusable route, but public availability is denied. A/G confirmation required; unrelated DB error is propagated, not converted into no route.

### B13B-14

Phase: P3. Harness: A resolver integration + real PostgreSQL. Evidence: **PLANNED / NOT_RUN**.

- **Given:** Direct assignment exists but its direction or parent route is INACTIVE; usable group route exists.
- **When:** Resolve and evaluate current eligibility.
- **Then:** Never falls back to group; route_resolution INACTIVE/compliance UNKNOWN, no public marker; existing A endpoint conflict/status behavior unchanged.

### B13B-15

Phase: P2/P3. Harness: Pure ordering + real PostgreSQL. Evidence: **PLANNED / NOT_RUN**.

- **Given:** Committed p2 at T+20; duplicate ID, equal-time differentID, newer serverTime with old fixTime, older p1.
- **When:** Replay each; separately force an independently overdue maintenance normalization.
- **Then:** No coordinate/run/event advance for input; pure no-op revision unchanged, genuine expiry/context maintenance may increment once. Equal-time competing IDs first-committed-wins.

### B13B-16

Phase: P2/P3. Harness: Pure clock + real PostgreSQL. Evidence: **PLANNED / NOT_RUN**.

- **Given:** DB decision time T; fixes at T+5s and T+5.001s.
- **When:** Apply independently on empty generations and inspect at T and after time catches up.
- **Then:** +5 admitted but UNKNOWN/not public while ahead; no duplicate-driven compliance advance when clock catches up; need a new qualifying fix. +5.001 rejected without watermark poisoning.

### B13B-17

Phase: P2/P4/P5. Harness: Pure clock + DB projection. Evidence: **PLANNED / NOT_RUN**.

- **Given:** Fresh ON_ROUTE row with fix T; sweeper deliberately not run.
- **When:** Project at T+30s and T+30.001s; later run sweep.
- **Then:** At30s eligible if lease/context also valid; later unavailable/UNKNOWN immediately without sweep. Sweep uses strict now>fresh_until; private point explicitly last-known, public marker expires.

### B13B-18

Phase: P2/P3. Harness: Pure ordering + real PostgreSQL. Evidence: **PLANNED / NOT_RUN**.

- **Given:** Valid p1 T, newer trusted invalid p3 T+20, delayed valid p2 T+10.
- **When:** Apply sequentially then a valid p4 T+25.
- **Then:** p3 advances observed_at but not last-successful timestamp; p2 cannot undo invalidation. p4 can recover; pending compliance latch follows08, retained p1 is private historical only.

### B13B-19

Phase: P2. Harness: Pure observation + real PostgreSQL. Evidence: **PLANNED / NOT_RUN**.

- **Given:** Newest valid p2 stored; malformed/unparseable time or unknown device input.
- **When:** Attempt dispatch via trusted observation boundary.
- **Then:** No unordered downgrade or arbitrary watermark; classify/count reject, no raw payload logging; prior point expires normally. No invented INVALID timestamp from receipt time.

### B13B-20

Phase: P2. Harness: Pure status + real PostgreSQL. Evidence: **PLANNED / NOT_RUN**.

- **Given:** Status source time T+20; older OFFLINE T+10, conflicting tie, missing time/rest epoch.
- **When:** Apply each using source/fenced epoch rules.
- **Then:** Old status ignored; conflicting tie UNKNOWN; source-less REST only bootstraps current epoch when safe, cannot override known newer event. No fabricated position/motion or transport-loss-as-OFFLINE.

### B13B-21

Phase: P2/P3. Harness: Actual A context + real PostgreSQL. Evidence: **PLANNED / NOT_RUN**.

- **Given:** Independently inactive device, unverified request, rejected application or inactive vehicle.
- **When:** Attempt same fresh valid point for each generation.
- **Then:** No accepted current coordinates/public eligibility; context fails coherently, UNKNOWN result. Restoration requires approved context plus new qualifying fix, not stale cached approval.

### B13B-22

Phase: P2/P4. Harness: A mutation integration + real PostgreSQL. Evidence: **PLANNED / NOT_RUN**.

- **Given:** Queue old G1 sample; approved atomic remap creates G2 with new UUID/later mapped_at.
- **When:** Commit remap then drain G1 queue; apply correctly fenced new G2 observation.
- **Then:** G1 cannot write G2 coordinates; latest revision never resets, fix/status/runs cleared. If remap contract is unreleased, test explicitly expects unsupported/fail-closed rather than inventing endpoint.

### B13B-23

Phase: P2/P4. Harness: Pure provenance + real PostgreSQL. Evidence: **PLANNED / NOT_RUN**.

- **Given:** Provider numeric ID reused with another uniqueId; restore ambiguity; unsupported same-generation A→B→A edit.
- **When:** Attempt delivery with stale generation/source times.
- **Then:** Reject/fail closed with classified metric, require approved mapping revalidation. Fingerprint alone never claimed to prove unseen ABA; no durable watermark reset to trust reused ID.

### B13B-24

Phase: P2/P3/P4/P5. Harness: A mutation integration + real PostgreSQL. Evidence: **PLANNED / NOT_RUN**.

- **Given:** Materialized ON_ROUTE; separate ownership/group/direct/route-geometry/corridor/device-context changes.
- **When:** Commit A mutation without new GPS; project immediately, reconcile, then drain pre-cutover fix; include route A→B→A with two version bumps.
- **Then:** Public stale context hidden before sweep; new owner receives no prior-context private point; queued old observation fenced even when final route/hash returns to A, because expected contextVersion is old. Reconciliation monotonic revision/reset, old/new route invalidation intents only inP5.

### B13B-25

Phase: P2/P5. Harness: A authorization + real PostgreSQL. Evidence: **PLANNED / NOT_RUN**.

- **Given:** Driver reaches V through two groups; unrelated Driver/Operator and authorized owner/admin.
- **When:** Read/filter collection and per-vehicle scopes through same-executor A boundary.
- **Then:** One marker/count for permitted driver; outsider denied per A existence contract, no cross-fleet rows. Scope/query filters never grant additional access.

### B13B-26

Phase: P5. Harness: Exact TypeBox/API negative projection. Evidence: **PLANNED / NOT_RUN**.

- **Given:** Eligible public row plus stale/off-route/private rows and provider-rich internal input.
- **When:** Request public snapshot and inspect every JSON key/error field.
- **Then:** Only PublicVehicleV1 allowlist, no provider IDs/attributes/PII/secret/fence; stale/off-route coordinates absent. Additional properties rejected by response contract tests, logs redacted.

### B13B-27

Phase: P2. Harness: Two real PostgreSQL clients. Evidence: **PLANNED / NOT_RUN**.

- **Given:** Same current lease owner/fence, empty latest row for V; two concurrent tasks hold same valid token.
- **When:** A holds first-insert lock at barrier; B attempts lock; prove blocking; commit A then let B reload; reverse order.
- **Then:** Exactly one row/revision for duplicate fix; no event. Same-owner task race distinct from two independent Bridge owners in33; no blind upsert or missing-row lock assumption.

### B13B-28

Phase: P2/P3. Harness: Two real PostgreSQL clients. Evidence: **PLANNED / NOT_RUN**.

- **Given:** Same valid lease/context; older T+10 and newer T+20 samples.
- **When:** Run both lock/commit orders with barriers; separately equal-time distinct IDs.
- **Then:** Final newest fix T+20 either schedule; older-after-newer never replaces it. Events reflect accepted chronological transitions only, not retroactive rewrite. Equal-time first commit remains stable.

### B13B-29

Phase: P3/P5. Harness: Two real PostgreSQL clients. Evidence: **PLANNED / NOT_RUN**.

- **Given:** Two deliveries of the same fix that crosses deviation threshold.
- **When:** Block both before transaction entry, serialize via approved locks, commit/retry.
- **Then:** Exactly one committed transition event unique(jeepney,state_revision), one accepted fix advance and optionalP5 intent per target; duplicate cannot double-count a run.

### B13B-30

Phase: P2/P4. Harness: Two real PostgreSQL clients. Evidence: **PLANNED / NOT_RUN**.

- **Given:** Sweeper selects candidate before fresh writer; pause sweep before protected reread.
- **When:** Writer commits newer fix; resume sweep under same lock/CAS protocol.
- **Then:** Sweeper rechecks now/context/fix/revision and does not overwrite fresh state; no stale event/intent emitted. Reverse order also preserves newer final point.

### B13B-31

Phase: P2/P4. Harness: Actual A mutations + two real PostgreSQL clients. Evidence: **PLANNED / NOT_RUN**.

- **Given:** Reviewed A advisory/context contract and least-privilege role; review/verify/remap vs ingestion.
- **When:** At named lock barriers run each A workflow against B in both schedules; inspect own locks only.
- **Then:** No baseline request/application↔jeepney inversion; prove both paths acquire identical A-defined advisory keys before business locks, no false active state or unexplained A deadlock500. If interface absent, case BLOCKED_BY_INTERFACE/NOT_RUN, never mocked as passing.

### B13B-32

Phase: P3/P4. Harness: Actual A mutations + two real PostgreSQL clients. Evidence: **PLANNED / NOT_RUN**.

- **Given:** Current direct/group/membership and route geometry/corridor mutation candidates.
- **When:** Pause A between discovery/locked revalidation; overlap B resolver/write; test both orders.
- **Then:** State uses one coherent committed business context; direct precedence unchanged. Test parent/direction update order and affected-set expansion rollback/retry too; no pool-query escape or stale hash relabel.

### B13B-33

Phase: P2/P4. Harness: Two independent owner IDs + real PostgreSQL clients. Evidence: **PLANNED / NOT_RUN**.

- **Given:** Owners A/B, independent clients, same deployment_key, no active lease; approved test clock.
- **When:** Race acquisition, assert one owner; hold A shared lease lock while B tries post-expiry takeover; release lock; acquire newer fence; retry stale A write/heartbeat/release.
- **Then:** Only one initial owner; takeover waits for old transaction lock and increments fence; stale owner cannot mutate/release/renew new lease. Expired owner without takeover also cannot start/renew a write; no health-port substitute.

### B13B-34

Phase: P2. Harness: Real PostgreSQL faults + controlled retry clock. Evidence: **PLANNED / NOT_RUN**.

- **Given:** One accepted context; transient40P01/40001/55P03 and permanent constraint/programming fault separately.
- **When:** Use owned test transactions/barriers for deadlock/timeout, controlled transaction-boundary injector for serialization variant.
- **Then:** Rollback entire attempt and retry only approved transient class, total<=3 attempts within10s; no unbounded loop/last-statement retry. Permanent error surfaces; one eventual commit/event or classified exhausted failure.

### B13B-35

Phase: P2/P3/P4. Harness: Real PostgreSQL replay/restart harness. Evidence: **PLANNED / NOT_RUN**.

- **Given:** Commit valid point/transition but suppress caller acknowledgement; durable row/event remain.
- **When:** Construct fresh writer instance after controlled gap, reacquire valid fence, reconcile mappings/latest and replay same fix.
- **Then:** Source watermark preserved and no duplicate transition; recovery UNKNOWN/reset continuity across unobserved gap while same-context pending re-entry remains. Revisions may increase for genuine recovery maintenance, not duplicate input.

### B13B-36

Phase: P2/P3/P5. Harness: Real PostgreSQL connection fault. Evidence: **PLANNED / NOT_RUN**.

- **Given:** Transaction has staged point change before event/optional intent insert; observer on another client.
- **When:** Close only the owned writer connection before COMMIT; reconnect and read final state, then retry source fix.
- **Then:** No partial committed point/event/intent/revision; observer sees previous committed state. Sink failure reported, durable readiness503, bounded recovery; retry commits once. Lost COMMIT ack variant belongs35.

### B13B-37

Phase: P2/P4. Harness: Process lifecycle harness + real PostgreSQL. Evidence: **PLANNED / NOT_RUN**.

- **Given:** Fake provider connect/backoff and owned in-flight transaction at explicit barrier.
- **When:** Signal stop in each phase; release barrier or exceed bounded shutdown deadline; model forced child exit separately.
- **Then:** No reconnect after stop, commit-or-rollback atomicity, matching-owner lease release only, health/socket/pool/children cleaned. Forced kill relies on rollback/expiry and is not reported graceful.

### B13B-38

Phase: P5. Harness: Fake publisher + real PostgreSQL intents. Evidence: **PLANNED / NOT_RUN**.

- **Given:** Committed desired_revisionR pointer, claim tokenK, publisher down/slow; then newer revisionR+1.
- **When:** Fail publish without holding GPS transaction; later acknowledge old K/R after replacement.
- **Then:** GPS/event stays committed, bounded retry; old ack cannot delete newer pointer. Old route targets retained acrossA→B→C; no coordinate payload archive or exactly-once delivery claim.

### B13B-39

Phase: P5. Harness: A auth/API + fake Pusher signer. Evidence: **PLANNED / NOT_RUN**.

- **Given:** Subscribed user loses group/role or becomes disabled; another user attempts channel impersonation.
- **When:** Emit invalidation, request fresh REST and sign own/other channel.
- **Then:** No private GPS/vehicle/event IDs in notifications; revoked resource REST/sign denied per current A auth. Active user generic own channel may remain; signature is not perpetual revocation assurance.

### B13B-40

Phase: P4/P5. Harness: Client contract model + scoped API. Evidence: **PLANNED / NOT_RUN**.

- **Given:** Invalidation during initial snapshot; disconnected publisher; stale old-auth HTTP response; expiring marker.
- **When:** Subscribe→fetch→refetch if invalidated; reconnect/foreground complete REST replace, advance expiry clock.
- **Then:** No startup loss, stale response cannot repopulate old scope, complete snapshots remove absent markers even equal revision; expired public markers hidden offline. Cap1001 rejected, never truncated.

### B13B-41

Phase: P3/P5. Harness: A history authorization + real PostgreSQL. Evidence: **PLANNED / NOT_RUN**.

- **Given:** Compliance events across ownership transfer and departed group memberships.
- **When:** Read as old/new Operator, Driver without proven temporal window, current ADMIN.
- **Then:** Recommended policy: current visibility AND operator-at-event match; deny new Driver compliance history until A temporal proof exists. ADMIN follows approved internal policy. No provenance-as-auth; native accepted history unchanged.

### B13B-42

Phase: P1/P4/P5. Harness: Disposable PostgreSQL/PostGIS + migration runner. Evidence: **PLANNED / NOT_RUN**.

- **Given:** Explicit authorized disposable DB identity; empty schema and001–005 snapshot; actual least-privilege actor.
- **When:** Apply exact released migrations; inject DDL failure; verify catalog/checks/indexes/grants and old API; rehearse operational rollback.
- **Then:** Atomic install/failure, no unexpected schema acceptance/version deletion. Non-owner cannot DDL/modify A business fields; only approved advisory execution plus A SELECT/B-write privileges; A context dependency installed as approved. Rollback disables writer/readers and preserves audit; destructive restore/drop separately owner-approved.

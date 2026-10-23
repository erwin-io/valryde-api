# B-UI-READY-001 — Tracking release gate for UI Agents C, D and E

Directive `VALRYDE TECH LEAD — AGENT B RELEASE GATE B-UI-READY-001`. Agent B, 2026-10-23 +08:00.

**Bottom line:** no tracking REST or Pusher operation exists today, so C, D and E cannot consume live tracking yet.
- **What exists:** the durable writer, compliance engine and recovery components, in draft PRs only.
- **What is missing:** the gateway (B5).
- **Blocking every public map:** the writer never sets `tracker_status` or `motion_status`. Both stay `UNKNOWN`, and the proposed commuter rule requires `ONLINE` and `MOVING|STOPPED`. So as built, no vehicle could ever appear to commuters.
- **Shortest path to operational tracking:** #31 merges → stack sync → device-status ingestion → T1–T3 REST with 10 s polling → separately approved dev enablement. Pusher can come later.

Live persistence remains disabled. Nothing in this document was merged, deployed or run against Traccar or a shared database.

## 1. Git, CI and dependency report

Verified at 2026-10-23 with `gh pr view` / `gh pr checks`. `main` = `810c8a13356ddbf0e28a4faf5ad7f86ce0a30479` (migrations 001–005 only).

| PR | Branch | HEAD | Draft | Mergeable | CI (`verify`) on HEAD | GitGuardian | Contents |
|---|---|---|---|---|---|---|---|
| [#31](https://github.com/erwin-io/valryde-api/pull/31) (Agent A) | `feat/a006-tracking-context-generation` | `b4d694228bb1daf82121e90067598fb38faeaeae` | no | yes | PASS run 39881541394 | PASS | A006 migration, lock helper, context service, retrofit |
| [#30](https://github.com/erwin-io/valryde-api/pull/30) | `feat/13b-b007-b008-tracking-schema` | `63712ada6aa81442ed17a09733dc6dfd4ef386bd` | yes | yes | PASS run 39849602406 | PASS | B007/B008, M4 grants SQL, schema tests (5 files vs main) |
| [#32](https://github.com/erwin-io/valryde-api/pull/32) | `feat/13b-b2-tracking-writer` | `dc0ad58dc08426af1fd01874dc54503e6768f7ea` | yes | yes | PASS run 39882977427 (259 / 1 skip) | PASS | #30 + A006 copy + B2 writer/lease (22 files vs main) |
| [#36](https://github.com/erwin-io/valryde-api/pull/36) | `feat/13b-b3-route-compliance` | `05ec987cfa9425a456326c752702201ebae7e2d0` | yes | yes | PASS run 39886634026 (275 / 1 skip) | PASS | #32 + B3 compliance/events (24 files) |
| [#37](https://github.com/erwin-io/valryde-api/pull/37) | `feat/13b-b4-reconcile-bridge` | `3b70e5b579af37f032b692f929f59b4018b1a1da` | yes | yes | PASS run 39886666982 (283 / 1 skip) | PASS | #36 + B4 reconcile/sweep/supervisor (31 files) |
| [#14](https://github.com/erwin-io/valryde-api/pull/14) | `docs/13b-durable-tracking-design` | `638f9ae9d1634ac896acd18eebd00ed3d6c0f37a` | no | yes | PASS run 39886702644 | PASS | Design, decisions, status (this file) |

**Stack (by ancestry):**
- `main` → #30 (`63712ad`).
- → merge `b1306e1` of #31 `b4d6942` → #32.
- → #36 → #37.
- #36 and #37 also contain merge commits that carried B3 test fixes and the B3 ledger update forward (`a8f7ab0`, `48d6cce`).

**What CI has and hasn't validated:**
- **Validated:** CI on #32, #36 and #37 applied migrations 001–008, including the real A006, on a disposable PostGIS database.
- **Not validated:**
  - #30 on its own has never run with 006 present.
  - Nothing has run against a `main` that contains A006.

## 2. A006 duplication and safe synchronization

**Finding:**
- **Where the copy is:** #32, #36 and #37 each contain all 14 files that #31 changes, byte-identical to #31 `b4d6942`. `git diff b4d6942 <head> -- <#31 files>` is empty for all three. That includes `migrations/006_tracking_context_generation.sql`, the A services and tests, and **`docs/agent-status/AGENT_A_STATUS.md`**.
- **#30:** contains none of them.
- **Hazard:** merging #32, #36 or #37 before #31 would land Agent A's migration, code and status file under an Agent B PR. All three are drafts and must stay drafts until the procedure below completes.

**Procedure after #31 merges.** No rebase, force-push, history rewrite or self-merge. Run it in the dedicated Agent B worktrees.
1. `git fetch origin`. Record the #31 merge result on `main`.
2. In the #30 worktree: `git merge origin/main`. Expect no conflict, since #30 touches no #31 file. Push, then wait for CI. This is the first CI run of 001–008 on current `main`.
3. In the #32 worktree: `git merge origin/feat/13b-b007-b008-tracking-schema`, then `git merge origin/main`.
   - **If #31 was merged with a merge commit:** `b4d6942` becomes an ancestor of `main` and the A006 files drop out of #32's diff automatically.
   - **If #31 was squashed:** both sides changed the A files identically, so the merge is clean and the diff still drops out.
   - **If Agent A changed #31 after `b4d6942`:** conflicts are possible only in A-owned files. Resolve every one with `git checkout origin/main -- <file>`. Never hand-edit Agent A's files.
   - **Check:** `git diff origin/main HEAD -- $(git diff --name-only 810c8a1 b4d6942)` must be empty. Push, then wait for CI.
4. Repeat step 3 for #36 (merge #32's branch, then `main`), then for #37 (merge #36's branch, then `main`). Each gets a CI run.
5. Each PR's diff against `main` must then list only Agent B files: #30: 5 files, #32: 8, #36: 10, #37: 17 (B-owned only; today each of #32/#36/#37 shows 14 more, the A006 copy). The test is that `git diff --name-only origin/main <head>` contains no #31 file.
6. Mark #30 ready for review. Agent G merges it. #32 → #36 → #37 then follow one at a time, each re-merging `main` after its predecessor lands, each with a fresh CI run.

## 3. B3 / B4 reconciliation against approved invariants

**Evidence key** (CI runs on the stack heads, real A006, disposable PostGIS):
- **W:** `test/pg-tracking-writer.integration.test.ts` (20 tests on #37).
- **U:** `test/route-compliance.test.ts` (9 tests).
- **P:** `test/tracking-persistence.test.ts` (5 tests).

| Approved invariant | Implementation | Evidence | Status |
|---|---|---|---|
| READ COMMITTED; lease FOR SHARE → A advisory key → A context on the same client → state FOR UPDATE (X1, §4.2) | `TrackingStateWriter.applyLocked` | W (concurrency, retry, lease tests) | Met |
| One key per B transaction; sweep one transaction per jeepney (X6) | `apply`, `reconcile`, `sweep` | W (sweep test) | Met |
| `clock_timestamp()` after locks (X4) | One clock row after the locks. The test-only `databaseNow` hook defaults off | W timing edges | Met |
| X5 cutover on fix time only | `pre_mapping` / `pre_cutover` in SQL (microsecond precision) | W (PRE_MAPPING, PRE_CUTOVER). A real millisecond race was observed and handled correctly in CI run 39886273925 | Met |
| Writer `lock_timeout` 1 s; 3 attempts on 40P01/40001/55P03; 50–200 ms jitter; 10 s deadline | `transaction()` | W: 55P03 retried and exhausted, then recovers | **Partly:** 40P01 and 40001 not injected |
| Speed > 300 km/h INVALID; CHECK 0..300 | `parse()` plus the B007 CHECK | W, schema tests | Met |
| Future > 5 s rejected; ≤ 5 s stored but never counted toward compliance | `ahead`, `fix_ahead` | W: +5.000 s stored, +5.001 s REJECTED | Met. Public hiding while age < 0 is a B5 projection rule |
| 30 s freshness; expiry only when DB now > `fresh_until` | Expiry normalization; sweep | W: 30.000 s FRESH / 30.001 s STALE; equal `fresh_until` fresh, +1 ms STALE | Met |
| Duplicate / equal-time / older fixes never advance; first commit wins | Watermark on `observed_at` plus position ID | W (B13B-15/18/27/29 components) | Met |
| Lost commit acknowledgement does not double-apply | Replay guards | W: proxy drops the connection after a real COMMIT; replay returns DUPLICATE with no second revision or event | Met (component) |
| Corridor `ST_DWithin(…, true)`, inclusive; distance per direction `corridor_m` | B3 geography query | W: 99/101 m on 100 m; 140/160 m on 150 m; 100 m edge verdict equals `distance ≤ corridor` | Met |
| OFF_ROUTE after 3 outside fixes or 30 s outside; 2 inside fixes to re-enter; saturating counters | `applyQualifyingFix` | U, W | Met (thresholds unchanged) |
| Events atomic with the revision, idempotent, append-only | Insert in the same transaction, `ON CONFLICT (jeepney_id, state_revision) DO NOTHING`; INSERT-only grant | W, schema grant test | Met |
| Invalid / stale / unusable route → UNKNOWN; latch kept only in the same context | `resetCompliance(keepLatch)`; context change clears the latch | U, W | Met |
| Recovery: lease fencing, takeover, restart replay, stale-writer exclusion | `TrackingLeaseService`, CAS `writer_fence <= fence` | W, P | Met (component). No real-process kill drill |
| Context change, mapping removal or eligibility loss materialized without GPS | `reconcile` / `sweep` | W (B4 tests) | Met (component) |
| Retention configurable, no purge (M5) | No purge code exists | — | Met |

**Interpretations Agent G must confirm.** These are not threshold changes:
1. **Expiry seen late keeps the outside run.**
   - **What it does:** when a fix is found expired only because processing was late, compliance becomes UNKNOWN but the outside and inside counts are kept. The next fix continues the run if it is ≤ 30 s later in *source* time with no invalid fix in between.
   - **Why:** without this, the approved "two outside fixes exactly 30 s apart" case can never deviate in practice, because writer delay always exceeds 0 ms.
   - **Conflict:** the design table's line "stale → reset runs" is read here as a source-time gap over 30 s. Tested by U and W.
2. **No second deviation while a re-entry is still pending.**
   - **What it does:** if a vehicle went OFF_ROUTE, then became UNKNOWN (invalid or stale), then OFF_ROUTE again with no re-entry in between, no second `ROUTE_DEVIATION` is recorded.
   - **Conflict:** the design says "new entry to OFF_ROUTE (including initial UNKNOWN) emits deviation". This choice avoids duplicate events for one excursion.
3. **`deviation.since` source.**
   - **Proposal:** the B5 projection should source it from the latest `ROUTE_DEVIATION` event's `fix_time`, not from `outside_since`. `outside_since` is cleared by the first inside fix while the state is still OFF_ROUTE.

**Known gap:** `tracker_status` and `motion_status` are always `UNKNOWN`.
- `parseDevice` keeps only `id`, `uniqueId` and `status`, with no source time.
- Position `attributes`, where `motion` lives, are not parsed.
- No speed threshold for MOVING/STOPPED is approved.
- See B4-1 and decision Q3.

## 4. B4 blockers

| # | Blocker | Current state | Required work | Blocks |
|---|---|---|---|---|
| B4-1 | Device status and event ordering (ID 16/17) | `tracker_status` / `motion_status` never written; the Bridge ignores `batch.devices` in durable mode; no source time parsed | Parse Traccar `lastUpdate` (and motion, per Q3); write status in its own observation path, ordered by source time; REST reconciliation bootstraps status per `status_epoch` (connection) without overriding a newer source time; ties or ambiguity → UNKNOWN; a non-RUNNING lease → UNKNOWN, never invented OFFLINE | **T1 entirely** (public needs ONLINE), D42–44, E65, F69 |
| B4-2 | Mapping and route reconciliation against the provider | DB-side `sweep` covers mapping removal, A006 context version, eligibility and expiry. Reconnect REST reconciliation only refreshes the in-memory registry | Reconcile the Traccar device list against current `traccar_device_mappings` (unknown or removed uniqueId, numeric-ID reuse → fail closed); periodic context sweep is already present | B13B-22/23 full cases |
| B4-3 | Database outage | A writer error fails the batch → `SINK_FAILURE` → reconnect and redeliver (P unit test only) | Injected-outage integration test (pool error mid-batch, DB restart); readiness flips to not-ready; no log-only acknowledgement while enabled | B13B-36 |
| B4-4 | Shutdown behavior | `bridge.ts` stops the Bridge, then persistence (releases the lease if still owned), then the pool, bounded by `BRIDGE_SHUTDOWN_TIMEOUT_MS` | SIGTERM drill during connect, backoff and an in-flight write; forced-kill case relies on lease expiry (15 s) | B13B-37 |
| B4-5 | Persistence-health endpoint | `TrackingPersistence.health()` exists in memory; the loopback Bridge health server does not include it; `lastCommitAt` is not stored in the DB | Add persistence health to the Bridge's loopback health; T5 derives writer status from the lease row (`expires_at`, `heartbeat_at`, phase) and last commit from `max(vehicle_latest_states.updated_at)`. The API never calls the Bridge port | E67 health, B13B monitoring |
| B4-6 | Dev enablement | Flag off; no approved DB login | Infrastructure applies `db/grants/tracking_bridge_role.sql` to a **named dev DB** and grants a login (M4); separate approval to run against dev Traccar | First operational run, B6 |

## 5. B5 contract dependency table

**Nothing in this table is implemented.**
- **APPROVED** means the underlying rule is already frozen: M1/M2 constants, the frozen ID 21/29 rules, existing A auth and error envelope.
- **PROPOSED** means a shape still subject to M7 review.
- Common rules for every operation:
  - Paths, DTOs and error codes are PROPOSED (M7).
  - Each request authenticates through A's `fastify.authenticate` and re-derives scope in one `REPEATABLE READ READ ONLY` snapshot (X2).
  - `Cache-Control: no-store`; A error envelope.
  - 503 `TRACKING_UNAVAILABLE` is never shown as an empty fleet.

### 5.1 Consumer → operation map

| Consumer need | IDs | Operation | Contract state | Decision dependency |
|---|---|---|---|---|
| C: public eligible vehicles, snapshot, removals by replacement, count | 29–31, 33–36 | T1 | Rule APPROVED (ID 29: online, ≤ 30 s, active, ON_ROUTE); DTO PROPOSED | M7; B4-1; Q3 (motion); Q6 (lease masking) |
| C: route label | 32 | Existing A transit-route DTO (`code`) joined by `routeId` | APPROVED (A) | — |
| D: own vehicle (GPS-device based) | 42 | T2 `relation` ∋ `ASSIGNED`, T3 | PROPOSED | M7; B4-1 |
| D: compliance status and alert | 43 | T2/T3 `routeCompliance`, `deviation`; client alert on a transition between snapshots | Rule APPROVED (ID 21); DTO PROPOSED | M7; interpretation 3 |
| D: same-group live map | 44, 51 | T2 `?groupId=` (narrows only) | PROPOSED | M7; M6 for `currentDriver` (omitted by default) |
| D: compliance overview and deviations | 53 | T2 OFF_ROUTE + T4 (OPERATOR) | T2 PROPOSED; T4 blocked | M7; D08/D09 temporal policy; M5 |
| D: transit summary | 54 | T2 `summary` | PROPOSED | M7; B4-1 (online/moving/stopped counts) |
| E: global fleet map | 65 | T2 ADMIN (map bounds are client config) | PROPOSED | M7; B4-1 |
| E: deviations and events | 66 | T2 ADMIN OFF_ROUTE + T4 ADMIN | T4 PROPOSED | M7; D08; M5 |
| E: reports, historical views, health | 67 | T2 `summary`, T4, T5, history (H1) | T5 PROPOSED; H1 **not proposed** | M7; D09 (history window); B4-5 |
| F: device connectivity and GPS verification | 69, 70 | T3 ADMIN diagnostics | PROPOSED | M7; B4-1 |
| C/D/E realtime | 19 | T6 + `tracking.snapshot-invalidated.v1` | PROPOSED | **M8**; publisher not built |

### 5.2 Operation detail

| Op | Method / channel | DTO fields (allowlist) | Role authorization | Freshness | Ordering | Reconnect / recovery | Decisions |
|---|---|---|---|---|---|---|---|
| T1 | `GET /api/tracking/route-directions/{directionId}/vehicles` | `PublicTrackingSnapshotV1{schemaVersion:1, snapshotAt, scope{kind:'ROUTE_DIRECTION',id}, complete:true, count, vehicles[]}`. `PublicVehicleV1{jeepneyId, plateNo, physicalColorHex, routeId, directionId, stateRevision, position{latitude,longitude,fixTime,speedKph,heading}, trackerStatus:'ONLINE', motionStatus, routeCompliance:'ON_ROUTE', lastSuccessfulUpdateAt, availableUntil}` | Any active verified user; direction must be ACTIVE (else 404); no driver or operator identity | Present only if `0 ≤ snapshotAt − fixTime ≤ 30 s`, ONLINE, USABLE route, ON_ROUTE, context current; `availableUntil = min(fresh_until, lease expires_at)`; client hides at `availableUntil` using the server offset | Per-vehicle `stateRevision` only; no global order; a complete snapshot replaces the previous one, including removals | Subscribe → fetch → re-fetch if invalidated during the fetch; 10 s foreground poll; on 503 keep the last good snapshot but still expire markers | M7, Q3, Q6, B4-1 |
| T2 | `GET /api/tracking/vehicles?groupId=` | `PrivateTrackingSnapshotV1{…, scope{kind,groupId}, summary{total,online,moving,stopped,offline,unknown,onRoute,offRoute}, vehicles[PrivateVehicleV1]}`. `PrivateVehicleV1{jeepneyId, plateNo, physicalColorHex, relation[], routeId, directionId, stateRevision, tracking{trackerStatus, motionStatus, locationStatus, routeCompliance, routeResolution, reason, deviation{since,distanceM,corridorM}, fixTime, lastSuccessfulUpdateAt, availableUntil} \| null, position \| null, positionIsLastKnown}`. `currentDriver` is **omitted** until M6 | DRIVER: active assignment OR shared group; OPERATOR: own; ADMIN: all; DISTINCT jeepneys; `groupId` only narrows | CURRENT vs LAST_KNOWN (+ reason) vs NONE; context mismatch withholds the position; lease not RUNNING → UNKNOWN | As T1; `summary` computed over exactly `vehicles` | As T1, on the user channel | M7, M6, B4-1 |
| T3 | `GET /api/tracking/jeepneys/{jeepneyId}/latest` | `{vehicle: PrivateVehicleV1}`; ADMIN adds `diagnostics{mappingPresent, gpsVerified, applicationApproved, contextCurrent}` | Same as T2; outside scope → 403; no state row → `tracking:null`, reason `NO_TRACKING_STATE` | As T2 | Per-vehicle revision | Re-fetch on invalidation | M7, B4-1 |
| T4 | `GET /api/tracking/compliance-events?from=&to=&routeDirectionId=&jeepneyId=` | `{items: ComplianceEventV1[], complete:true}`; `ComplianceEventV1{eventId, jeepneyId, routeDirectionId, source:'VALRYDE', type, occurredAt, recordedAt, stateRevision, distanceM, corridorM, fromState, toState}` | OPERATOR: current ownership AND `operator_id_at_event` = caller; ADMIN: all; DRIVER 403 | Historical; range has a timezone, ≤ 30 days, cap 1,000 → 422 | Ordered by `occurredAt`, `eventId` (stable; matches the B008 indexes) | Plain re-query | M7, **D08/D09**, M5 |
| T5 | `GET /api/admin/system-health/tracking` | `TrackingHealthV1{checkedAt, writer{status:RUNNING\|STALE\|ABSENT, leaseExpiresAt, lastCommitAt}, persistence:READY\|UNAVAILABLE, publisher:ENABLED\|DISABLED\|DEGRADED}` | ADMIN | Lease row on the DB clock | — | Poll | M7, B4-5 |
| T6 | `POST /api/realtime/auth` | Body `{socket_id, channel_name}`; response is a Pusher auth signature only | Exact grammar: `private-valryde-v1-route-{directionUUID}` (any active verified user, ACTIVE direction); `private-valryde-v1-user-{userUUID}` (exact JWT subject); no wildcard or presence | — | — | Re-auth on reconnect; signing does not revoke existing subscriptions (payload carries no data) | **M8**, M7 |
| E1 | Pusher event `tracking.snapshot-invalidated.v1` | `{schemaVersion:1, eventId, kind:'SNAPSHOT_INVALIDATED', snapshotRequired:true, emittedAt}` (no coordinates or IDs) | Published to old and new route channels and to currently authorized user channels | — | At-least-once; duplicates and gaps harmless; `eventId` is a dedupe hint, not a cursor | Debounce 250 ms, then REST replace | **M8**; publisher (B009 deferred, MVP best-effort) |
| H1 | Private position history (ID 18) | Internal `TrackingHistoryService` exists (merged PR4); **no HTTP path proposed** | — | — | — | — | **D09** history window and temporal ownership |

## 6. UI readiness matrix

**Adapters:** a feature may proceed now only with an adapter that returns an explicit `UNAVAILABLE` state.
- **Never allowed:**
  - An empty `complete:true` snapshot, which asserts "no vehicles".
  - Mock coordinates in a shipped build.
  - Client-computed compliance or route precedence.
- **Fixtures:** may be used only in tests and Storybook-style previews, labeled as fixtures.

| IDs | Feature | Build now? | Data source today | Live dependency |
|---|---|---|---|---|
| C29, C31, C35 | Live available jeepneys, route-filtered, status / last update | UI + `UNAVAILABLE` adapter; T1 DTO types from §5 marked PROPOSED | None | T1, B4-1, M7 |
| C30 | Marker animation | Yes, on fixtures (interpolate between two increasing fixes, snap if gap > 30 s, no extrapolation) | None | T1 |
| C32 | Route label | **Yes**, real data | A transit-route DTO | — |
| C33, C34 | Plate, physical color | UI only; values arrive with T1 (the public vehicle list is not published elsewhere) | None | T1 |
| C36 | Count / favorite routes | Favorites: **yes** (not tracking). Count: `UNAVAILABLE` until T1 | A routes | T1 |
| D42 | Own vehicle by GPS device | UI + adapter; vehicle identity from A fleet endpoints, tracking `UNAVAILABLE` | A fleet / driver-assignment | T2/T3, B4-1 |
| D43 | Compliance status and alert | UI + alert logic on fixtures (transition to OFF_ROUTE, clear only on server ON_ROUTE) | None | T2/T3 |
| D44, D51 | Same-group live map | UI + adapter; membership from A, positions `UNAVAILABLE` | A fleet groups | T2, M6 (names) |
| D53 | Compliance overview | Current: adapter. History: blocked | None | T2; T4 after D08/D09 |
| D54 | Transit summary | Assigned counts from A; tracking counts `UNAVAILABLE` | A | T2 `summary`, B4-1 |
| E65 | Global live map | Map shell and national bounds: **yes**; markers `UNAVAILABLE` | A fleet | T2, B4-1 |
| E66 | Deviation monitoring | UI + adapter | None | T2, T4 |
| E67 | Reports / export / health | Non-tracking reports and API health: **yes**; tracking health, events and history blocked | A | T5, T4, H1 (D09) |
| F69, F70 | Device and GPS verification | A workflow / mapping screens: **yes**; live online state and fix `UNAVAILABLE` | A GPS workflow | T3 diagnostics, B4-1 |

## 7. Checklist mapping

| IDs | Owner | Deliverable / state |
|---|---|---|
| 12, 14 | B | REST foundation and reconnection: merged (PR4, PR10) |
| 13 | B | Bridge WebSocket: merged (PR10); durable mode in #37 (flag off) |
| 15 | B | Normalization and durable latest state: #30 + #32 (draft) |
| 16 | B | Speed / heading done; online/offline and moving/stopped **not implemented** (B4-1) |
| 17 | B | Native events normalized (PR4); Valryde deviation/re-entry events in #36 (draft) |
| 18 | B | Internal history service merged; HTTP exposure needs D09 (H1) |
| 19 | B | Gateway T1–T6 and invalidation publisher: **not started** (B5; M7, M8) |
| 20 | B | PostGIS corridor via `ST_DWithin(…, true)` and `corridor_m`: #36 |
| 21 | B | Compliance state machine and events: #36; thresholds unchanged |
| 29–36 | C | T1 (+ A transit DTO for 32; favorites independent) |
| 42–44, 51, 53–54 | D | T2/T3 (+ T4 for 53 history) |
| 65–67 | E | T2, T4, T5 (+ H1 for 67 historical views) |
| 69–70 | F/E | T3 ADMIN diagnostics (+ B4-1) |

## 8. Milestones and acceptance gates (evidence-based, no dates)

| Milestone | Entry condition | Acceptance gate (evidence) |
|---|---|---|
| **MS-1 A006 lands** | Agent A completes #31 review | #31 merged by G; `main` contains `006_tracking_context_generation.sql` |
| **MS-2 Stack synchronized** | MS-1 | §2 procedure: CI green on each of #30/#32/#36/#37 against current `main` (001–008); `git diff --name-only origin/main <head>` contains no #31 file; no force-push |
| **MS-3 Durable core merged** | MS-2 + G review | #30, then #32, then #36 merged by G one at a time, each with fresh CI; ledger B13B-42 can then run its rollback/restore drill |
| **MS-4 Status ingestion (B4-1)** | Q3 decided | Writer persists `tracker_status` and `motion_status` with source-time ordering; PostGIS tests for older status, equal-time conflict, missing source time and REST bootstrap per epoch (B13B-20 component) |
| **MS-5 B4 completion** | MS-4 | DB-outage and SIGTERM drills (B13B-36/37 components); persistence health in Bridge health (B4-5); provider mapping reconciliation (B4-2); #37 merged after re-sync |
| **MS-6 B5a REST** | MS-3 (MS-4 for T1 eligibility) | T1–T3 (+ T5) TypeBox `additionalProperties:false`, OpenAPI, contract tests, RBAC tests (DRIVER/OPERATOR/ADMIN/COMMUTER), no-store, read-time masking tests; labeled **not frozen** (M7) |
| **MS-7 B5b realtime** | MS-6 | T6 signer tested with a fake secret; best-effort invalidation publisher; live Pusher only after M8 |
| **MS-8 Contract freeze** | MS-6 + C/D/E review | G + C/D/E sign M7; T4 after D08/D09; M6 decides `currentDriver` |
| **MS-9 First operational tracking (dev)** | MS-5, MS-6, M4 applied by Infrastructure to a named dev DB, separate approval for dev Traccar | Bridge with flag on in dev only; C/D/E consume T1–T3 with 10 s polling; then B6 runs all 42 cases individually |

**Next milestone for Agent B:** MS-2, which waits on MS-1. Independent work that can start now is MS-4 (needs Q3) and MS-6 scaffolding on top of #36. Both are labeled not frozen and stay off by default.

## 9. Decisions needed from Tech Lead / owner

| # | Decision | Recommendation | Owner | Unblocks |
|---|---|---|---|---|
| Q1 | #31 merge method | Merge commit (keeps `b4d6942` as an ancestor, so the stack sync is trivial). Squash also works via §2 | G | MS-2 |
| Q2 | Review order for the B stack | #30 → #32 → #36 → #37, each separately, after MS-2 | G | MS-3 |
| Q3 | Motion and tracker-status source | Parse Traccar device `lastUpdate` for ONLINE/OFFLINE ordering; motion from the Traccar position `motion` attribute, otherwise UNKNOWN. Alternative: an approved speed threshold. ID 29 still requires ONLINE | G (+ F for hardware behavior) | MS-4, T1 |
| Q4 | Confirm interpretations 1–3 in §3 | Confirm | G | B3 acceptance |
| Q5 | Commuter T1 requires sign-in | Yes (no anonymous links in MVP) | G + C | T1 |
| Q6 | Public masking on lease loss (`availableUntil = min(fresh_until, lease expiry)`) | Approve (D12) | G | T1 |
| Q7 | M6 Driver `displayName` in private T2/T3 | Approve, private only | G + D | D44/D51 names |
| Q8 | M7 freeze of T1–T6 | After MS-6 contract tests | G + C/D/E | MS-8 |
| Q9 | M8 dev Pusher app | Provision dev only | Infrastructure | MS-7 live |
| Q10 | D08/D09 compliance-history temporal policy and history window (T4, H1) | Operator = current ownership ∩ `operator_id_at_event`; Driver none; history ≤ 30 days | G + owner | D53 history, E66/E67 |
| Q11 | M5 retention | 30 days, purge stays disabled until approved | Owner | Purge job only |
| Q12 | Dev enablement (M4 grants to a named dev DB, Bridge flag on against dev Traccar) | Approve for dev only after MS-5 | Infrastructure + G | MS-9 |

## 10. Acceptance ledger

[`docs/tracking/stage13b-acceptance-results.json`](../../tracking/stage13b-acceptance-results.json), on the #37 head `3b70e5b`.
- **Counts:** PASS 0 / FAIL 0 / BLOCKED 42.
- **Partial component evidence:** recorded per case for B2 (#32), B3 (#36) and B4 (#37).
- **Upgrades:** none. Every full case needs the merged A006 → B007 → B008 chain on `main`, the gateway, and end-to-end execution.

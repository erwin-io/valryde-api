# TRACKING_INTEGRATION_PREPARED

Agent B — IDs 12–21. Checkpoint: 2026-10-21 03:20 +08:00, Asia/Singapore. Preparation only; overall implementation IN_PROGRESS. This checkpoint does not approve new shared contracts, certify hardware or authorize deployment.

## Evidence and current dependencies

- Canonical infrastructure: `C:/Development/valryde/valryde-infra`. Reviewed its AGENTS.md, infrastructure status, Agent B connectivity handoff, development inventory, after-restart simulator evidence and cross-platform implementation report. No infrastructure files or secrets were modified/read from private stores.
- API `origin/main` remains `711f4c45967e192be155e05e72714b99645ecc7d`, Agent A accepted PR #1 baseline. Migrations 001–005, TypeBox routes, shared resolver and fleet authorization inspected read-only.
- [PR #4](https://github.com/erwin-io/valryde-api/pull/4) is OPEN, unmerged, at accepted `a4062c800944457f11f6f8e97848b15c18d507b4`; API CI and GitGuardian SUCCESS. [Acceptance comment 6267265303](https://github.com/erwin-io/valryde-api/pull/4#issuecomment-6267265303) applies only to the internal REST foundation. [Issue #3](https://github.com/erwin-io/valryde-api/issues/3) remains open. No accepted branch change or self-merge.
- [PR #2](https://github.com/erwin-io/valryde-api/pull/2), Agent A downstream documentation, is OPEN at `b48997f45366aa91ddc36fd00b85186d528e2866`, CI/security SUCCESS. Its local handoff was reviewed as supporting documentation, not a merged contract change. The handoff path is absent from main; merged source remains authoritative.
- [PR #5](https://github.com/erwin-io/valryde-api/pull/5), Agent D governance identity correction, is OPEN at `5baade41b26411eb7a2981bb470b9fc79fe3cca6`, CI/security SUCCESS. This is documentation/governance work, not the acceptance of cross-platform infrastructure. Do not synchronize its unmerged policy. Current D workspace is `valryde-mobile-driver-operator`.
- Cross-platform infrastructure report and B connectivity handoff explicitly defer the next B implementation stage pending Tech Lead cross-platform review acceptance. No acceptance evidence was found in those current records. This gate is additional to PR #4 merge and shared-contract approval; current preparation authorization does not authorize runtime implementation.

## Exact readiness matrix

| Component / dependency | Readiness | Evidence / remaining condition | Owner |
|---|---|---|---|
| Agent A business/auth/route baseline | READY, MERGED | main 711f4c4; frozen resolver/RBAC verified in source | A/G |
| B REST/session foundation | ACCEPTED, NOT IN MAIN | PR #4 a4062c8; both checks SUCCESS; merge authorization/integration pending | Owner/G |
| Traccar Windows development provider | SERVER_READY, LIMITED LIVE RECHECK | Historical infra REST/socket/restart evidence; current unauthenticated checks below | Infrastructure |
| Exact provider version | VERIFIED LIVE | GET /api/server: 200, version 6.16.0, registration=false | B read-only check |
| REST authentication boundary | VERIFIED LIVE, UNAUTHENTICATED ONLY | GET /api/devices without credentials: 401 | B read-only check |
| Authenticated REST/session + socket | VERIFIED BY INFRA, NOT B RUNTIME | Recorded form login/JSESSIONID, 101 upgrade and fresh pushes for both synthetic fixtures; not rerun this session | Infrastructure/B |
| Read-only Traccar service identity | CREATED; DELIVERY PENDING | Non-admin, readonly/deviceReadonly/limitCommands flags recorded; separate Bridge provisioning not delivered | Owner/Infrastructure |
| Cross-platform source checkpoint | REVIEW ACCEPTANCE PENDING | Windows static/Linux offline evidence only; handoff explicitly gates B next stage | G |
| Physical GPS | OPERATOR-GATED | Zero installed; exactly two intended initial physical devices | Owner/F |
| Synthetic provider telemetry | HISTORICALLY VERIFIED | VALRYDE-SIM-0001/0002, historical fresh position IDs 11/12 after 7/8; no new ingestion here | Infrastructure |
| Valryde business mapping for fixtures | NOT PROVISIONED | Infra created no application/GPS mapping/vehicle activation records | A/E/Owner |
| Latest state migration / ordering contract | PROPOSED, NOT IMPLEMENTED | Existing bridge proposal; 006 filename provisional; schema/freshness/mapping approval needed | B/G |
| Persistent Bridge / shutdown / recovery | NOT IMPLEMENTED | Must begin from merged main; deterministic plan prepared | B |
| Transactional effective-route access | APPROVAL REQUIRED | Existing resolver uses pool; proposed executor integration is A-owned | A/G |
| C public-safe tracking snapshots | MISSING | No tracking routes in merged API or PR #4; internal adapter is not HTTP API | B/G/C |
| D private tracking snapshots/events | MISSING | Consumer dependency matrix/gates confirm lack of approved live/history/compliance routes | B/G/D |
| E global map/device/health/report APIs | MISSING OR SEPARATE A+B DEPENDENCY | Admin integration gates; /api/health alone is not component health/reporting | A/B/G/E |
| Route compliance 20–21 | NOT IMPLEMENTED | Thresholds frozen; deterministic cases prepared, no engine verdict claimed | B/G |
| Pusher + REST recovery 19 | NOT IMPLEMENTED | Channels/DTOs/auth/removal/reconciliation need approved contracts | B/G |
| Remote TLS / Linux / Vultr | NOT CONFIGURED OR NOT RUNTIME-VERIFIED | Loopback-only Windows is current target; no provisioning/exposure authorized | Infrastructure/Owner |
| Full V1 DOCX / independent checklist | STILL UNAVAILABLE LOCALLY | Embedded approved handoffs/directives used; request canonical references through owner | Owner/G |

Development-ready infrastructure does not mean implementation-ready Bridge or production readiness. No prerequisite above is silently marked satisfied by mocks or historical infrastructure tests.

## Traccar 6.16.0 compatibility reconciliation

Accepted adapter settings match the observed loopback origin `http://127.0.0.1:8082`; derive socket `ws://127.0.0.1:8082/api/socket`. Future remote operation must use HTTPS/WSS and separate approval; do not change bind addresses/firewall/tunnels for this work.

| Surface | Required Bridge behavior / evidence limit |
|---|---|
| Session | Form POST /api/session, JSESSIONID in private server memory; no cookie/password in URLs, client DTOs or logs |
| Device identity | REST /api/devices, provider uniqueId joins existing approved Valryde mapping; numeric IDs 1/2 are fixture evidence only |
| Positions/history | /api/positions; deviceId/from/to for bounded history; accept empty arrays, validate IDs/timestamps/coordinates; preserve knots conversion and provider times |
| Native events | /api/reports/events with Accept: application/json; current evidence is HTTP200 with zero events, not generated-event proof. Event.eventTime is the native field |
| Socket authentication | Cookie upgrade with server-side transport. Versioned source also accepts a token query, despite general docs describing cookie-only auth; Valryde deliberately uses cookies and does not adopt token URLs |
| Origin handling | v6.16 SessionHelper accepts a missing Origin for an established session; supplied Origin must satisfy its check. Test server client with no Origin; do not spoof browser headers or weaken server configuration |
| Initial stream | v6.16 AsyncSocket sends latest positions immediately on open; receiving those cached frames is not proof of fresh ingestion. Deduplicate REST reconciliation and socket initial frames |
| Frame shapes | devices/positions/events may be omitted independently. Empty object is provider keepalive, not malformed JSON or a vehicle update. Ignore unknown keys safely; never opt into diagnostic logs |
| Permission failures | Infra observed readonly mutation denial as HTTP400 SecurityException, not universally 403. Accepted adapter's generic non-retryable REQUEST_REJECTED for 400 is retained; do not parse/log raw bodies or label every 400 as expired auth |
| Expiry/liveness | Session-expiry and outage recovery remain B tests; do not assume expired HTTP session always closes an existing socket. Add heartbeat and reauthenticate on reconnect; classify handshake rejection without retry storms |

Official references reviewed: [Traccar API](https://www.traccar.org/traccar-api/), versioned [socket servlet](https://github.com/traccar/traccar/blob/v6.16.0/src/main/java/org/traccar/api/AsyncSocketServlet.java), [session-origin helper](https://github.com/traccar/traccar/blob/v6.16.0/src/main/java/org/traccar/helper/SessionHelper.java), [stream implementation](https://github.com/traccar/traccar/blob/v6.16.0/src/main/java/org/traccar/api/AsyncSocket.java), and [native event model](https://github.com/traccar/traccar/blob/v6.16.0/src/main/java/org/traccar/model/Event.java). Versioned source qualifies generic documentation; deployed installation hash/patch equivalence was not independently proven here.

## Dedicated credential coordination — prepared, not provisioned

1. Owner/Infrastructure confirms the actual Windows Bridge execution identity and approved secret injection mechanism. Distinguish the Traccar API account from the JDBC role `traccar_svc`; Bridge never needs Traccar database credentials or Traccar admin privileges.
2. Provision only the existing non-admin read-only service account's TRACCAR_EMAIL/TRACCAR_PASSWORD to that identity's private runtime environment/credential provider. TRACCAR_BASE_URL is the nonsecret loopback value. Supply a separate least-privilege Valryde application database connection for latest-state/resolver work; never point application migrations at traccar_db:5434.
3. The user-bound DPAPI bootstrap bundle under ProgramData contains admin material. Bridge must not read/decrypt/copy the complete bundle, inherit broad access to it, or run under shared NetworkService merely for convenient secret access. No bundle access or password retrieval occurred this session.
4. Coordinate delivery through owner-controlled local provisioning, never chat/GitHub/CLI arguments. Record only identity, delivery mechanism and success/failure evidence, without secret values. No messages sent to another agent and no account/ACL/service/environment setting changed.
5. Once provisioned AND separately authorized for authenticated integration tests, verify only linked synthetic devices are visible, unknown devices are denied and errors redact credentials. Keep accepted readonly denial evidence rather than repeating mutation probes during preparation. Rotation/revocation and Linux secret migration require an owner-controlled plan; Windows DPAPI is not Linux-portable.

## C/D/E API gap reconciliation — proposals, not approved endpoints

All paths below are candidate `/api` contracts for review, not implemented or promised client interfaces. Retain existing auth and error envelopes; COMMUTER tracking requires authenticated Valryde context and public-safe content. No anonymous share links.

| Consumer / capability | Candidate endpoint or boundary | Required contract and isolation |
|---|---|---|
| C route-direction availability + REST recovery | GET /api/tracking/route-directions/{id}/vehicles | Active/approved vehicle, ONLINE, valid age <=30 s, effective selected active direction, ON_ROUTE; no private people/provider fields; moving and stopped eligible |
| D own/group and Operator fleet map | GET /api/tracking/vehicles; GET /api/tracking/jeepneys/{id}/latest | Authorize every returned jeepney through A scope; requested group/operator filter only narrows scope; repeated multi-group membership does not cause false 403 |
| D/E historical GPS/native events | GET /api/tracking/jeepneys/{id}/history and /events | Reuse accepted internal service with request-range schema, provider-unavailable errors, explicit empty-data behavior; source TRACCAR distinct from VALRYDE compliance events; no commuter private history |
| D/E compliance current/events | Separate compliance slice, paths not frozen | Backend-owned UNKNOWN/ON_ROUTE/OFF_ROUTE and deviation/re-entry events; native geofence events are not route-compliance decisions |
| E global map/device diagnostics | ADMIN scope on snapshots; separate device health DTO | Platform access only; service IDs stay internal unless a separately approved Admin diagnostic DTO requires them; never credentials/cookies/IMEI leakage to public fields |
| D dashboards + E reports/export/health | Joint A+B aggregate/report contract | Counts by a common snapshot time; explicit unknown/stale bucket, no stale counted online by assumption. API health != Bridge heartbeat != Traccar health. CSV/PDF/report work separate |
| C/D/E Pusher authorization/recovery | POST /api/realtime/auth (candidate); private route/operator/group/admin scopes | Role/ownership checks before signing; channel/event names and payloads require G approval. On reconnect/refocus replace REST collection; missing/removed/off-route vehicles must disappear |

Proposed public vehicle allowlist: jeepneyId, routeId, routeDirectionId, plateNo, physical color, latitude, longitude, speedKph, heading, trackerStatus, motionStatus, routeCompliance, fixTime, lastSuccessfulUpdateAt and decimal-string revision. Proposed envelope: snapshotAt, vehicles and explicitly approved pagination metadata. No driver name/phone, operator private data, GPS uniqueId/provider IDs, attributes or credentials. Route names/colors/geometry remain A canonical route DTOs. These fields and names are unapproved; C/D/E must not bind clients yet.

Approval must settle pagination/snapshot consistency, unavailable/empty behavior, 401/403/404/409/provider failures, stable timestamp meanings and stale invalidation/removal events. Per-jeepney revision is not a global snapshot version; never compare revisions across vehicles. Full REST replacement is the fallback; no durable replay/outbox guarantee is implied. A device mapping/eligibility/route change requires server invalidation and fresh authorization, not client precedence logic. Groupmate driver identity/details remain a separate A-approved private contract.

No current code defect found in accepted PR #4. Its history service enumerates visible fleet through A; a targeted authorized lookup is a nonblocking scaling follow-up already identified by Tech Lead, not permission to alter the accepted head.

## Shared-contract decisions required before implementation

The [existing bridge proposal](TRACKING_BRIDGE_CONTRACT_PROPOSAL.md) specifies the complete provisional table and lifecycle. Its accepted-slice references do not make its new decisions approved.

1. Approve latest-state table/columns/nullability/mapping generation, per-jeepney monotonic revision and atomic newer-fix guards. Provisional migration 006_vehicle_latest_state.sql must be renumbered if occupied after merges. Store one latest row, never duplicate raw history.
2. Approve ingestion freshness separately from locked commuter <=30 s. Current proposal uses 30 s ingestion and 5 s future tolerance; ~60 s stationary device reports create freshness gaps. Do not silently widen public availability or frozen compliance thresholds.
3. Approve invalid-observation watermark/UNKNOWN semantics, source-time status ordering, mapping invalidation, equal-time tie policy, and how old status/invalid packets cannot downgrade a newer valid observation.
4. Authorize A-owned transaction-executor/resolver integration or provide another approved consistent read boundary. Preserve direct override, zero/one/multiple inherited results and existence-based Driver authorization. No duplicated route SQL.
5. Approve server-only B session lease, cancellation, bounded transport configuration and operational limits. Process separation remains fixed; Fastify never becomes socket owner.
6. Separately freeze C/D/E DTOs/routes, Pusher channel/auth/events and compliance persistence contracts before client integration. Default corridor 100 m; OFF_ROUTE at 30 s OR 3 valid outside fixes; two valid inside fixes for re-entry; invalid/stale/missing → UNKNOWN. No changes to those locked rules proposed.

## Synthetic scenario pack — prepared only, not executed

Use isolated test DB transactions/fixtures, injectable clock/RNG/socket and the two explicit provider uniqueIds; do not create real installation verification or activate vehicles through simulation. Base mock time T = 2026-10-21T00:00:00.000Z (clock injected). Positions use latitude 10.3157, longitude 123.8854; unique per-case safe integer IDs, speed 0 or 10 knots and bearing 90. Provider live replay must use current UTC, be separately approved and use only loopback5055. Do not execute the infrastructure simulator wrapper during preparation because it writes fixes.

| ID | Stimulus | Required assertion / phase |
|---|---|---|
| B-S01 | Form login, private cookie, accepted upgrade; initial cached position + REST duplicate | One active session/socket; one accepted DB update; cached push not fresh-ingestion evidence |
| B-S02 | Empty {}, missing arrays, mixed valid/invalid items, unknown logs key | Keepalive ignored; valid sibling processed; no logs subscription/private data fan-out |
| B-S03 | 401 upgrade/session expiry, error+close simultaneously, repeated short connections | One refresh/reconnect loop, bounded jitter/cap; no premature retry reset |
| B-S04 | Provider outage/timeout/429/503 then recovery | No fabricated fixes; stale sweep UNKNOWN; REST reconciliation before RUNNING continuity claim |
| B-S05 | Fix IDs101/102 at T/T+10; redeliver101 and equal-time new ID with later serverTime | One latest row at102; duplicates/out-of-order do not advance fix or revision |
| B-S06 | NaN/out-of-range coords, malformed timestamp, valid=false newer observation, then older valid | Invalid coords never stored; approved observation watermark prevents state rollback |
| B-S07 | Fix age30 s and30.001 s; future+5 s and+5.001 s | Exact proposed boundary tests pending freshness approval; public age limit never widened |
| B-S08 | Device status/event older than accepted status, missing source timestamp, offline after fresh fix | Independent status ordering, unknown when unorderable, no position synthesis |
| B-S09 | Revoke verification, remap/change generation, queued old numeric ID, missing/ambiguous device | Transaction eligibility enforced; old state invalidated; wrong identity never writes |
| B-S10 | Two real DB connections barrier-race first inserts/newer/older/duplicate/stale sweep | One authoritative newest row, monotonic revision; rollback/deadlock bounded recovery |
| B-S11 | Direct route with conflicting inherited groups; zero/one/multiple inherited without direct | Shared resolver direct wins/null/group/CONFLICT; no local precedence implementation |
| B-S12 | SIGTERM during auth/connect/backoff/write; replaced socket fires late callbacks | Bounded drain/rollback; timers/pool/lock/socket released; no reconnect after stopping |
| B-S13 | Zero speed versus10 knots, course360, distinct fix/device/server times | STOPPED/MOVING,18.52 km/h, heading0, retain three timestamps and lon/lat SRID4326 |
| B-S14 | Authorized A/B fixtures, unrelated Operator/Driver, Driver in two matching groups, COMMUTER | No cross-scope/private history leak; valid multi-group grants; public allowlist exact |
| B-S15 | Later compliance: metric distances99/100/101 m from canonical line | Geography/metre boundary. Generate exact offsets using PostGIS ST_Project/test geometry, not degree approximations |
| B-S16 | Later compliance: initial inside; outside atT/T+30 (2 fixes) orT/T+10/T+20 (3 fixes); then2 inside | Initial ON_ROUTE; independent30 s and3-fix OFF_ROUTE branches; only second valid inside re-enters |
| B-S17 | Later compliance: invalid/stale/missing assignment/conflict interrupt track | UNKNOWN and continuity reset per approved state machine; no single noisy point violation |
| B-S18 | Later realtime: post-commit publish fails; missed removal/update then REST reconnect | GPS commit retained; authoritative replacement removes unavailable markers; role channels remain isolated |

Historical infrastructure tested actual stationary/moving reception, fresh push, restart persistence and backup restore. It did not test this matrix, sustained load, real cellular loss or hardware. Native event endpoint currently has zero generated-event evidence; use deterministic event fixtures until controlled generation is separately approved.

## Implementation sequence and next slice

1. Resolve prerequisites: G cross-platform checkpoint acceptance, owner-authorized PR #4 integration (or explicit approved dependency approach), shared-state/session/resolver contract approval. Preserve accepted HEAD. Review main again including independent PR2/PR5 state; do not bundle their changes.
2. Create feat/13-tracking-bridge from updated canonical main. Carry/reconcile the local proposal/status without losing history. First coherent source slice: dedicated Bridge entry point, session lease/cancellation, injectable cookie-capable socket supervisor, device/position/event normalization and deterministic lifecycle tests; no deployment.
3. Within the same approved milestone or a clearly dependent reviewable sub-slice, add reviewed latest-state migration and mapping/transaction repository; real PostgreSQL concurrency/ordering tests; shared resolver adapter only under A/G integration authorization. Never publish a Bridge that silently discards successful DB failures or claims state processing without this persistence slice.
4. Run migration on isolated approved app test DB, lint/typecheck/full DB-enabled tests/build/audit/diff checks. After credential provisioning and explicit controlled test authorization, run accepted adapter + Bridge against loopback provider with separately authorized synthetic input; record actual fresh IDs, redacted outcomes and shutdown cleanup.
5. Separate later compliance20–21 and realtime/public HTTP19 slices, preserving raw-history authority and client privacy/RBAC. No Pusher delivery, Vultr deployment, exposure or hardware certification in this preparation.

## Verification this session and delivery state

Read-only GitHub/API source inspection and official upstream review completed. Two unauthenticated loopback GETs ran: /api/server200/version6.16.0/registrationfalse; /api/devices401. No authenticated socket, credential access, simulator, DB migration, account creation, installation, service restart, exposure or deployment occurred. Existing80-test/CI evidence is historical; application test suites were not rerun for documentation-only changes.

Prepared files remain local/uncommitted on docs/13-tracking-bridge-contract at711f4c4: this report, updated bridge proposal and canonical Agent B status. Unrelated filestructure.txt preserved. No new PR/commit, no status-only acceptance reset. Exact release gates remain explicit in the readiness matrix above.

## Claude takeover verification — 2026-10-21 04:36 +08:00

Executor transferred from Codex to Claude (Tech Lead directive, temporary). Same Agent B identity, IDs 12–21, status file and branches; nothing above is rewritten.

### Re-verified state

- `origin/main` 711f4c45967e192be155e05e72714b99645ecc7d. Local and remote `feat/12-traccar-rest-adapter` both a4062c800944457f11f6f8e97848b15c18d507b4.
- PR #4 OPEN, unmerged, mergeable/CLEAN, `verify` + GitGuardian SUCCESS, only comment is the Tech Lead ACCEPTED review. Issue #3 OPEN. PR #2 and PR #5 still OPEN.
- PR #4 head rerun in a temporary detached worktree (removed afterwards): `npm ci`, lint, typecheck, build PASS; `npm audit --audit-level=high` 0 vulnerabilities; DB-enabled Vitest **15 files / 80 tests passed, 0 skipped**.
- Loopback, unauthenticated only: `/api/server` 200, version 6.16.0, registration=false; `/api/devices` 401. Services `traccar` and `valryde-traccar-postgresql` Running/Automatic; TCP 5434 and 5055 accept connections. No credentials, socket session or telemetry write.
- Infrastructure status (updated 03:04) still records the cross-platform checkpoint as pending Tech Lead review. Gate unchanged.
- Observation: Traccar's 401 body contains a Java stack trace. The accepted adapter already cancels error bodies; the Bridge must also never log handshake/error bodies.

### Proposal review against the takeover checklist

| Requirement | Proposal coverage | Finding |
|---|---|---|
| Persistent process ownership | Covered: separate entry point, advisory lock, never in serverless | OK |
| Authenticated socket | Covered: cookie upgrade | **M5** below simplifies transport |
| REST/session management | Session lease interface proposed | OK, B-owned change to accepted adapter |
| Mapping integrity | Covered: in-transaction recheck, generation invalidation | OK |
| Duplicate / out-of-order | Covered: strict fix_time ordering, watermarks | OK |
| Freshness / stale | Covered, decision pending | **M1** conflicts with a locked rule |
| Bounded reconnection | Covered: single supervisor, 1–30 s jittered | OK |
| Startup / shutdown | Covered | OK |
| Latest-state persistence | Covered | **M2** naming |
| Transactions / concurrency | Covered: FOR UPDATE + guarded upsert | **M6** needs A-owned executor parameter |
| Route compliance | Deferred; column writes UNKNOWN only | **M3**, **M4** schema gaps |
| Realtime publication | Deferred; no channel/event names | Blocked on G contract |
| REST reconciliation | Candidate endpoints only | Blocked on G contract |

### Contract mismatches to resolve before implementation

- **M1 (blocking, owner/G):** stationary devices report about every 60 s, but the locked commuter rule requires location age ≤ 30 s while also saying stopped vehicles can be available. As locked, a stopped jeepney is unavailable for roughly half of each reporting cycle. Options: Agent F configures stationary reporting ≤ ~25 s, or owner/G revises the availability rule. B will not choose.
- **M2 (naming):** handoff says `VehicleLiveStates`; proposal says `vehicle_latest_states` (snake_case matches migrations 001–005). Needs naming sign-off only.
- **M3 (schema gap):** the 30 s / 3-fix OFF_ROUTE and 2-fix re-entry debounce needs persisted state (for example outside-since time and consecutive inside/outside counts) to survive Bridge restarts. Not in the proposed table. Add in this migration or in the compliance slice; G to decide.
- **M4 (schema gap):** handoff item 7 requires application-owned route-compliance events; no table is proposed. Belongs to the compliance slice; flagged now so the latest-state schema does not need rework.
- **M5 (simplification):** Node 22's built-in `WebSocket` (repo engine ≥ 22.12) sends a `Cookie` header via its `headers` init option and sends no `Origin`; tested locally against a stub server, not Traccar. The proposed `ws` dependency is unnecessary. It exposes no ping API, so liveness becomes an inbound-silence watchdog (Traccar keepalive frames) instead of ping/pong. Keepalive interval must be measured once authenticated tests are authorized.
- **M6 (A-owned):** `TransitService.resolveEffectiveRouteDirection()` queries `this.pool` directly; an optional executor parameter is needed for in-transaction resolution. Request to Agent A via G; B does not edit it.
- **M7 (topology):** in the MVP cloud demo the Bridge on the laptop writes to the Neon app DB over outbound TLS. The proposal names a separate least-privilege app DB connection but not this path; record it in the deployment plan.

### Tracking consumer matrix (C/D/E)

States: APPROVED = locked baseline rule; PROPOSED = documented here, not approved; IMPLEMENTED = in code; BLOCKED = cannot proceed without a decision.

| Capability | Consumer | State | Basis / blocker |
|---|---|---|---|
| Public commuter-safe latest position | C | PROPOSED, BLOCKED | Privacy allowlist APPROVED in baseline; endpoint/DTO candidate only; needs latest-state + M1 |
| Operator fleet tracking | D | PROPOSED, BLOCKED | Visibility rules IMPLEMENTED by A (FleetService); tracking endpoint candidate only; needs latest-state |
| Driver-assigned vehicle status | D | PROPOSED, BLOCKED | A existence-based driver access IMPLEMENTED; tracking DTO candidate only |
| Admin tracking operations / health | E | PROPOSED, BLOCKED | No device-health or Bridge-heartbeat DTO; joint A+B contract needed |
| Authorized tracking history / native events | D, E | IMPLEMENTED internally (PR #4, accepted, unmerged); HTTP route PROPOSED | No public route; commuter history excluded |
| Freshness / unavailable states | C, D, E | PROPOSED, BLOCKED | Enum values proposed; M1 decision |
| Route compliance status | C, D, E | Rules APPROVED; NOT IMPLEMENTED | M3/M4 schema; IDs 20–21 slice |
| Realtime + REST reconciliation | C, D, E | Architecture APPROVED (Pusher + REST); channels/events/auth BLOCKED | No channel or event naming proposed for approval yet |

Clients must not bind to any PROPOSED field, path or channel.

### Next authorized stage

No source stage is authorized yet. The work splits so the first slice needs fewer decisions:

1. **Slice 13a — lifecycle only, no schema:** Bridge entry point, session lease, built-in WebSocket supervisor, frame validation, normalization and deterministic fake-clock tests. Needs only: owner merges PR #4, and G accepts the cross-platform checkpoint (or waives it for B source work).
2. **Slice 13b — persistence:** latest-state migration and transactional writer. Additionally needs G decisions on M1–M4 and Agent A's executor parameter (M6).
3. IDs 19–21 stay separate later slices.

Branch: `feat/13-tracking-bridge` from fresh `origin/main` after the PR #4 merge. Never from unmerged PR #4.

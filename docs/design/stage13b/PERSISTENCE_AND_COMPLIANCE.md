# Transaction, observation and compliance contract — proposed

Requires D01–D07/D12 and explicit implementation release. No interface or SQL below is implemented here. [Schema](SCHEMA_AND_MIGRATIONS.md), [recommended decisions](DECISION_REGISTER.md), [A boundary/delivery status](AGENT_A_INTERFACE_BOUNDARY.md), [release phases](IMPLEMENTATION_RELEASE_PLAN.md).

## Accepted interface gap and additive boundary

Stage13a currently parses telemetry, drops invalid/future/duplicate/older positions through TelemetryGate, then calls `TelemetrySink(TelemetryBatch)` with only admitted valid positions. It advances in-memory watermarks before the sink, clears them on sink failure and reconciles latest positions on reconnect. Device parser currently retains only id/uniqueId/status. These facts mean attaching a DB writer to the existing sink alone cannot implement immediate invalid-observation persistence or reliable source-time status ordering.

D04 proposes an **optional durable-observation adapter**, not a socket/lifecycle rewrite: expose validated location/status control observations and per-item verdicts before lossy gate filtering, with provider identity and connection generation. Existing default13a sink/log-only behavior remains unchanged when disabled. Avoid two independent position-writing callbacks: the durable mode owns one sequential dispatch path, with the old gate retained only as a non-authoritative optimization. DB idempotency decides application; ignored duplicates may still require expiration/context normalization.

Malformed unknown-device data never becomes a trusted control observation. Never let a client supply these internal envelopes. A stale/missing mapping is resolved afresh from trusted DB, not from a mobile route/device assertion.

Proposed TypeScript signature sketch, not source code added to src:

```ts
type TrackingObservation = {
  provider: 'TRACCAR';
  deviceId: string; uniqueId: string; // decimal device ID; opaque uniqueId; server-only
  expectedMappingGeneration: MappingGenerationSnapshot | null; // bound before queuing
  expectedContextVersion: string | null; // lossless A contextVersion captured before queue
  expectedContextChangedAt: string | null; // A contextChangedAt as UTC, never guessed
  connectionEpoch: string; ingressSequence: string;
  receivedAt: string; kind: 'POSITION' | 'INVALID_FIX' | 'DEVICE_STATUS';
  fix?: NormalizedValidFix; // source ID, lon/lat, three times, speedKph, heading
  invalidFixTime?: string; status?: OrderedStatusObservation;
};
type PersistResult = {
  disposition: 'APPLIED' | 'DUPLICATE' | 'OUT_OF_ORDER' | 'INVALIDATED' |
               'REJECTED' | 'UNMAPPED';
  materializedChange: boolean; revision: string | null;
};
interface TrackingStateWriter {
  apply(observation: TrackingObservation, lease: WriterLease): Promise<PersistResult>;
  reconcileContext(jeepneyId: string, lease: WriterLease): Promise<PersistResult>;
  expireDue(nowFromDatabase: string, lease: WriterLease): Promise<number>;
}
```

DB/provider bigint fields are decimal strings beyond the parser boundary; reject unsafe JS numeric inputs, never round them. receivedAt is provenance; fix_time is ordering authority. connectionEpoch/ingressSequence originate from the authenticated supervisor and are scoped to the current writer fence, not arbitrary JSON fields. Proposal must include mappings for parseable invalid observations and optional raw device lastUpdate/native status eventTime; source-time ambiguity resolves UNKNOWN, not fabricated chronology.

## Mapping and eligibility

Resolve authenticated Traccar device→uniqueId→current traccar_device_mappings→gps_devices→gps_setup_requests→approved vehicle_application→jeepney. Require all entity joins coherent, device ACTIVE, request INSTALLED/VERIFIED, application APPROVED, jeepney ACTIVE. Existing association uniqueness is reused, not duplicated in a provider-ID business table.

A null/unresolved generation is UNMAPPED, not permission to bind queued old work to a new identity during drain. Exact generation/cutover types remain proposed until A delivers the approved boundary.

Current accepted API creates immutable mappings; it has no remap endpoint. D06 requires any future approved remap to use a **new mapping UUID and later mapped_at**, invalidate current tracking state atomically and reset queued identity context. Direct SQL ABA edits (A→B→A retaining the same generation) are unsupported. Do not claim hashing mutable values prevents unseen ABA. Matching UUID/time/fingerprint is generation provenance, not a substitute for an A-owned atomic remap protocol.

Discard observations captured before the current mapping generation and source fixes/provider-server times predating it. Compare expected identity/generation when queues drain; never relabel an old-device fix with a newly looked-up identity. If clocks/ID reuse make provenance ambiguous, fail closed and reconcile; do not infer mapping from numeric ID alone. Traccar restore/reinstall/reused IDs require owner-reviewed provider/mapping revalidation rather than resetting durable watermarks automatically.

On mapping change clear valid-fix/observation/status/compliance fields, set UNKNOWN, retain increasing jeepney revision. No mapping/eligibility revocation may expose old coordinates to a new owner. A-owned invalidation transaction or context reconciler materializes the change; every REST/publication read checks current business joins regardless, closing the sweep lag. Authorization uses current A ownership, never operator_id_at_event provenance or cached membership. An ownership transfer must also suppress retained private coordinates until a newly accepted fix belongs to the new ownership context; do not relabel the old last-known point for the new owner. D07 must supply an atomic context/cutover marker in the approved A mutation protocol, and queued pre-cutover observations must be fenced. Current read masking is fail-closed until that protocol exists.

## Proposed transaction and lock protocol

One jeepney per transaction; different jeepneys can proceed independently. Validate JSON/units before opening it; do no Traccar/Pusher/network calls while holding DB locks. Sort work by jeepney UUID if a maintenance action touches multiple vehicles; no arbitrary batch-wide lock graph.

Recommended isolation: READ COMMITTED **under the approved shared context protocol**. A's preferred coordination proposal is B lease FOR SHARE → sorted per-jeepney transaction-scoped advisory keys → B latest-state FOR UPDATE. A takes the same advisory keys before any business-row lock and never locks B lease/state. B uses ordinary SELECT on A tables through A's proposed same-client boundary. Shared key namespace/derivation is A-owned; never create independent B key hashing. For multi-jeepney changes discover IDs, acquire sorted keys, then lock/revalidate; expanded affected sets require rollback/retry, never new out-of-order keys while holding business locks.

**Preserved initial finding:** the earlier B lease→jeepney FOR UPDATE→eligibility FOR SHARE candidate inverts A application/request-first workflows and also needs A row-lock UPDATE privileges. It must not ship. Advisory serialization addresses that candidate only when all relevant A mutations participate; membership/assignment/parent-route/geometry/ownership cutover proofs remain hard D05/D07 gates. No A source is changed here.

A further proposes an additive monotonic per-jeepney tracking_context_version and cutover timestamp. Current001–005 lacks that contract; B stores its expected version/cutover and rejects mismatches, while projections mask stale versions immediately. A owns schema initialization and the mutation matrix; hash/updated_at alone is not an ABA fence. A interface proposal is published as PR17/head36af1c6cb7cd1e749f4d8d2eff15183e40e578fd; G approval/exact SQL/runtime interface remain pending. No speculative adapter or guessed A migration is supplied.

The [A-owned boundary](AGENT_A_INTERFACE_BOUNDARY.md) records proposal versus delivery status. After D05 approval, transaction steps:

1. BEGIN; bounded lock/statement deadlines; verify lease owner/fence/DB-clock expiry with lease-row lock. A lost-fence process cannot mutate current state.
2. Acquire the approved advisory key even when no latest row exists, serializing first insert. Lock only B state; read A mapping/eligibility/context through the approved executor boundary and revalidate join identities/version/cutover. Workflow/device/vehicle-ineligible or unmapped state becomes UNKNOWN with no public coordinates; no GPS write accepted. Proposed telemetry eligibility is separate from route usability: valid GPS may still persist privately when route is unassigned/conflicted/inactive; compliance stays UNKNOWN. This split is now proposed in A17 as telemetryEligible/routeUsability; G must approve before implementation, never inferred by a speculative B adapter.
3. Call **the existing A resolver with this same pg.PoolClient** through its future backward-compatible executor parameter. Direct first, then0/1/>1 group semantics are never copied. Catch only the specific ROUTE_ASSIGNMENT_CONFLICT as domain CONFLICT/UNKNOWN; SQL/connectivity/other failures roll back, not fake a null assignment.
4. Read the resolved direction and parent route under the shared context protocol, validate ACTIVE, compare expected A version/cutover and compute context hash from exact mapping/assignment/route/geometry/corridor/ownership eligibility. An inactive direct result remains INACTIVE/UNKNOWN, never group fallback. Reset counters/state if context differs.
5. After any lock wait, revalidate lease owner/fence/unexpired DB clock before applying a write; expiry aborts with LEASE_LOST, never an UNKNOWN mutation under an expired token. Capture DB now once for the decision, normalize overdue freshness/lease/context first, then classify the observation. Fix expiry is strictly DB now > fresh_until, preserving eligibility at exactly30s; do not use a >= cutoff for the GPS deadline. Duplicate/rejected input cannot resurrect an expired state. Apply the deterministic state machine below only for newly accepted qualifying fixes.
6. Compare-and-set insert/update against expected revision/fence and validated generation. Increment revision once if anything material changes; no revision for a pure duplicate/no-op. A single incoming observation can normalize expiry AND apply a fix in one revision. Persist compliance debounce and optional transition event in this transaction; event uniqueness is(jeepney_id,state_revision).
7. Under a later approved ID19 release, write pointer-only publication intents in this same transaction. No Pusher call here. COMMIT, then acknowledge sink completion. A commit-ack/network uncertainty retries the same source ID/time; DB guards prevent double application/events.

Optimistic guard sketch, not runnable migration/application code:

```sql
UPDATE vehicle_latest_states
SET revision = revision + 1 /* plus trusted computed state */
WHERE jeepney_id = $jeepney
  AND revision = $expected_revision
  AND writer_fence <= $current_fence
RETURNING revision;
```

The actual implementation must ALSO validate the locked lease/generation and strictly newer observation predicates; the sketch alone is not a concurrency guarantee. Missing row uses INSERT ON CONFLICT DO NOTHING + controlled reload, never blind overwrite. Unexpected zero-row CAS is a re-read/recompute or bounded retry, not success. Never retry only the last statement of an aborted transaction.

Proposed total3 transaction attempts for SQLSTATE40P01/40001/55P03 with proposed50–200ms jitter outside the transaction, subject to overall10s deadline. Fewer than3 attempts are allowed when the deadline is exhausted; never extend it to force retries. Final failure propagates SINK_FAILURE to accepted reconnect/reconciliation; it never acknowledges an uncommitted fix. Metrics contain classified error/count/requestId only, no coordinates/provider identities. Genuine programming/constraint errors are surfaced for diagnosis and are not infinite-retry events.

## Observation and clock decisions

| Input | Proposed durable effect |
|---|---|
| New valid, eligible fix with source time newer than valid AND invalid-observation watermarks | Store normalized point/IDs/three times, observed_at, fresh_until, DB last-success time; apply compliance only if freshness/context qualifies |
| Same position ID, equal fix_time or older time in same mapping generation | No coordinate/counter/event advance; equal-time different IDs are first-committed-wins, not serverTime tiebreak; maintenance normalization can still invalidate expired context |
| Invalid fix with trusted device and parseable newer fixTime within admission bounds | Advance observed_at, clear motion/compliance/run counters to UNKNOWN/INVALID; retain last valid coordinate privately; do not update last_successful_update_at |
| Malformed/unorderable identity/time | Ignore/quarantine count without raw payload log; never let an unordered old packet erase a newer valid observation. Current prior fix expires normally; this interpretation requires D03 approval |
| GPS time>DB now+5s | Reject; no future watermark poisoning; prior current state not overwritten.5s tolerance is operational proposal matching13a, not public availability relaxation |
| GPS time within next5s | May be stored under D03 but not commuter-eligible while age<0; compliance UNKNOWN until a new qualifying fix, never duplicate-driven recovery or a timer counted as another fix |
| Arrival age>30s | Do not replace a newer valid fix or count compliance; normalize expired state UNKNOWN. New empty row may record STALE/no coordinates; raw historical detail stays in Traccar |
| Source times inconsistent/untrusted generation or clock skew beyond approved tolerance | Fail closed, classified diagnostic and reconciliation; never replace source GPS time with receipt/server time |

Use DB UTC clock for comparisons/lease/deadline; preserve provider times separately. Detect backwards source/host time through monotonic watermarks and health metrics. No clock/NTP reconfiguration authorized here. D03 must settle clock tolerances and admission versus30s compliance freshness; the public rule cannot be changed.

Status ordering is independent of GPS: source lastUpdate/eventTime must be valid, not beyond allowed future tolerance, and newer than prior status time. On a tie, conflicting status observations resolve conservatively UNKNOWN. A current authenticated REST reconciliation can bootstrap status without source time for its current fenced epoch, but cannot overwrite a known newer source-time event; ambiguity remains UNKNOWN. Missing/wrong-epoch observations never synthesize ONLINE. Physical OFFLINE needs a valid Traccar device/event observation; disconnected Bridge/expired lease yields effective UNKNOWN, not invented hardware OFFLINE. Movement/stop/geofence native events do not create position fixes or compliance verdicts.

## Effective compliance state machine

Use only admitted, fresh, newly accepted fixes with coherent eligible mapping and RESOLVED ACTIVE route+direction. Use canonical `ST_DWithin(point::geography, line::geography, corridor_m, true)`; exact distance<=corridor is INSIDE, greater is OUTSIDE. Distance for diagnostics uses the same geography/spheroid semantics. Coordinates are longitude/latitude in SRID4326; no degree tolerance or Web Mercator shortcut. See [official ST_DWithin](https://postgis.net/docs/ST_DWithin.html).

| Prior state / qualifying input | Next state and durable debounce |
|---|---|
| New context UNKNOWN, first inside, no pending re-entry | ON_ROUTE; bootstrap, no re-entry event |
| ON_ROUTE inside | ON_ROUTE; clear outside run |
| ON_ROUTE or initial UNKNOWN outside, threshold not reached | Retain ON_ROUTE or UNKNOWN respectively; increment saturated outside count, set outside_since on first; clear inside run |
| Outside count>=3 OR current fix_time-outside_since>=30s continuously outside | OFF_ROUTE, reentry_required=true; emit one ROUTE_DEVIATION if entering OFF_ROUTE |
| OFF_ROUTE inside once | Remain OFF_ROUTE, inside_count1, clear outside run |
| OFF_ROUTE second consecutive inside | ON_ROUTE, clear latch/runs; emit one ROUTE_REENTRY |
| Already OFF_ROUTE outside | OFF_ROUTE, no duplicate deviation; reset inside count |
| Invalid/stale/missing/unusable route/expired lease | UNKNOWN; reset runs/outside_since, retain re-entry latch only for same context after a prior deviation |
| UNKNOWN with pending re-entry, one then two valid inside fixes | UNKNOWN after first; ON_ROUTE and ROUTE_REENTRY after second; no one-fix bypass via invalid/stale state |
| Mapping/assignment/geometry/corridor context changes | UNKNOWN, clear all prior-context runs/latch; evaluate only a new qualifying fix against the new context |

Inside interrupts an outside run even if state has not yet changed. Counters count accepted fixes, never messages/duplicates/status/keepalives/retries. Saturate counts at thresholds. Continuity requires no intervening invalid/stale interval; normalize expiry at each processing decision even if sweep is delayed, so job scheduling does not decide correctness. Time threshold is evaluated on a new qualifying outside fix, not inferred from a lone noisy point or from a wall timer without fresh evidence. The independent two-fix time-threshold test uses outside fixes exactly30s apart while valid; a gap>30s resets to UNKNOWN. D02 must confirm discrete-fix continuity/timer semantics; thresholds themselves remain frozen.

Proposed event policy: new entry to OFF_ROUTE (including initial UNKNOWN) emits deviation; only cleared outstanding same-context deviation emits re-entry. No event on initial ON_ROUTE or diagnostic UNKNOWN. Event+state+revision commit atomically; no native Traccar event can masquerade as a Valryde transition. An event describes its historical assignment/context, not proof that today's assignment is unchanged.

## Recovery, sweeps, shutdown and monitoring

Lease/transport state and read-time expiry mask availability immediately; bounded sweeper materializes UNKNOWN/context resets even without new telemetry. It takes the same locks and CAS predicates, rechecks after locking and cannot overwrite a concurrent newer fix. Read-time private projection may expose only nullable historical coordinates with explicit stale reason; public projection excludes it. Recovery reconciles current mappings/devices/latest positions; no raw-history backfill is inferred to reconstruct missed compliance. During a gap mark UNKNOWN, reset continuity; never generate retrospectively certain30s deviations from unobserved intervals.

Retain accepted shutdown: stop intake, cancel reconnect, finish/rollback bounded state transaction, mark lease STOPPED/release only if owner/fence still match, close pool/health/socket. Lost commit acknowledgement relies on replay guards. A forced kill leaves lease expiry and DB transaction rollback, not an assumption of exactly-once delivery. On DB outage remain not persistence-ready, allow accepted bounded reconnect; do not log-only acknowledge data while persistence-enabled.

Health separates transport RUNNING, DB-ready/schema version, lease ownership, last successful commit age, rejected counts/reasons, state sweep lag and optional publisher backlog/last success. RUNNING socket alone is not durable tracking health. Health/log fields exclude credentials, cookies, uniqueIds, coordinates and private ownership. Alerts/thresholds are D12 operational proposals; no process/service/credential/metrics configuration occurs now.

PostgreSQL lock and snapshot behavior references: [explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html), [transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html). A bounded retry does not repair an unapproved cross-module lock protocol.

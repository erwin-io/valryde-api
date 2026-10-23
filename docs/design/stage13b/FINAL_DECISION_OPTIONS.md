# Stage 13b final decision options

Checkpoint **AGENT_B_STAGE13B_FINAL_DECISION_READY**. Agent B, IDs 12–21. Prepared 2026-10-23 as a bounded, design-only follow-up to the Tech Lead review of the [parallel readiness package](PARALLEL_READINESS_REVIEW_PACKAGE.md).

**Status: OPTIONS FOR AGENT G / OWNER DECISION.** The shared architecture is provisionally supported. No Stage 13b runtime, migration (A006/B007/B008/009) or gateway is released or started. All 42 durable acceptance cases remain **BLOCKED** until they actually run against implemented code (ledger unchanged: PASS 0 / FAIL 0 / BLOCKED 42).

## 1. Verified state

| Item | Full SHA | Checks |
|---|---|---|
| B [PR #14](https://github.com/erwin-io/valryde-api/pull/14), before this document | `3131a61cd9f578b265013f7f4f3aae53024ab25e` | API CI `verify` SUCCESS (run 39812363022, job 119941753825) and GitGuardian SUCCESS. Both check runs report `head_sha` equal to this SHA |
| B [PR #22](https://github.com/erwin-io/valryde-api/pull/22) | `259125f3b130d8927a4ab6054e31a735e6392e1a` | Preserved and unchanged; review-ready per G |
| A [PR #17](https://github.com/erwin-io/valryde-api/pull/17) | `fd76cb54000ec47c383c6641359f3e3cf59e4340` | OPEN; read only, not modified |
| A [PR #19](https://github.com/erwin-io/valryde-api/pull/19) / [PR #21](https://github.com/erwin-io/valryde-api/pull/21) | `1daad9a4ab74ce03ac0519300271ec2ecdf3a64b` / `6f1c789c0b53511e81c54619a7030091b7afb243` | OPEN, not yet merged |
| `origin/main` | `827738c0f2c33ad3082f6a4a38a8e35669d4b0ea` | Unchanged |

## 2. A #17 reconciliation — exact transaction, lock and context rules

Most of A17 already matches the B design: B owns the client, transaction and retry; A methods take a `QueryExecutor` and never begin, commit or release; the lock is a transaction-scoped advisory key; B never locks A rows; telemetry eligibility is separate from route usability; the cutover is captured after locks; mapping is create-only. The remaining items below are **gaps or ambiguities between the two documents**. Each needs a one-line A17 amendment or G ruling before the A006 implementation PR. None changes the frozen thresholds.

| # | Rule | Gap found | Proposed exact resolution | Proving test |
|---|---|---|---|---|
| X1 | **Isolation level for locking transactions** | A17 does not specify it. Under REPEATABLE READ or SERIALIZABLE, the snapshot is taken at the first statement, which is the B lease lock and *precedes* the advisory wait. A context committed by A during that wait would be invisible, so B would hold the lock but read the old version. The same applies to A mutations that re-validate after the lock. | Every transaction that takes the tracking advisory key (B writer, B sweep, every A mutation) runs at **READ COMMITTED**. Each statement after the lock sees the latest committed context. The B design already chose READ COMMITTED; A17 should state it. | A17 test 4 must run with B already inside an open transaction (lease row read) before blocking. Assert B reads the **new** `tracking_context_version`. |
| X2 | **Gateway reads vs the `resolve()` lock precondition** | A17 says `TrackingContextService.resolve()` "may be called only after the caller acquires the shared advisory lock". The gateway snapshot (D09) is a lock-free REPEATABLE READ READ ONLY transaction, so as written it could not call `resolve()`. | Allow two documented modes: (a) **write mode**, called after the advisory key in a READ COMMITTED write transaction; (b) **snapshot mode**, called inside a REPEATABLE READ READ ONLY transaction with no lock. Snapshot mode never writes and compares the stored B `context_version` with the A version from the same snapshot, masking on mismatch. One method with a documented precondition is enough; no second implementation. | A gateway test: an A mutation commits between two snapshots. The first snapshot is internally consistent (old version, old state); the second masks the state until B materializes the new version. |
| X3 | **Lock ordering under hash collision** | A17 sorts by **UUID** but locks by `hashtextextended(...)` **key**. If two jeepneys collide on the 64-bit key, UUID order no longer orders the keys, and two multi-jeepney mutations can deadlock. A17's claim that a collision "does not weaken safety" holds for mutual exclusion but not for deadlock freedom. The probability is negligible, but the fix costs nothing. | Compute the keys, **de-duplicate and sort by the bigint key value**, then lock in that order (in SQL, `SELECT pg_advisory_xact_lock(k) FROM (SELECT DISTINCT key(id) AS k FROM unnest($1::uuid[]) id) s ORDER BY k`). A single-key B transaction is unaffected. Re-validation (A17 §4.2 step 6) compares key sets, not UUID sets. | A unit test of the helper using a stubbed key function that forces a collision: two opposite-order mutations both complete without `40P01`. |
| X4 | **Clock used after lock waits** | A17 fixes A's cutover to `clock_timestamp()` after locks. B's lease-expiry check and freshness decisions say "DB clock" but do not name the function. `now()` is the transaction-start time, so a lease that expired while B waited on the advisory key would still look valid. | B uses `clock_timestamp()`, read **after** acquiring the lease row and the advisory key, for lease expiry, `fresh_until` evaluation and `compliance_changed_at` when it is operational UNKNOWN. `now()` must not appear in B tracking decisions. | B13B-33 variant: hold the advisory key past lease expiry. The waiting writer must fail the fence check instead of committing. |
| X5 | **Cutover classification of queued observations** | A17 §7 rejects observations whose "trusted `receivedAt`" predates `mapped_at`. Bridge `receivedAt` is the **Node** clock, while `mapped_at` and `tracking_context_changed_at` use the **DB** clock. Comparing them mixes clocks. The observation also carries no context version (the Bridge cannot know business context at receive time). | Compare **`fixTime` only** (GPS UTC, already bounded by the 5 s future-tolerance gate) against DB cutover instants. (a) `fixTime < mapped_at` → reject as `PRE_MAPPING` (count-only). (b) `fixTime < tracking_context_changed_at` → `PRE_CUTOVER`: no coordinate, no counter advance, and no state established for the new context. (c) Otherwise evaluate it under the current version and stamp that version on the row. Node `receivedAt` is diagnostic only. | A17 test 9 plus a new B case: a route reassigned at T, then a queued fix with `fixTime = T − 1 s` processed after T, leaves compliance unchanged and the row at the new version with UNKNOWN. |
| X6 | **Multi-key transactions inside B** | The B sweep (D12 batch 100) could take up to 100 keys in one transaction, increasing lock-table use and wait times for A mutations. | B never holds more than **one** advisory key. The sweep selects up to 100 candidates without locks, then runs one short transaction per jeepney. Only A multi-jeepney mutations take sorted multi-key sets, up to the §3.2 cap. | A pressure test: a sweep of 100 rows while an A 250-key mutation runs; no `40P01`, and the A mutation's wait is bounded by one B transaction. |
| X7 | **Lock hold time and A-side timeout** | A17 specifies no `lock_timeout` for A HTTP mutations waiting on a B-held key. | A B transaction holds its key for at most its 10 s budget (target < 50 ms, no I/O while locked). A mutations `SET LOCAL lock_timeout = '2s'` and retry the whole transaction up to 3 times on `55P03`/`40P01`/`40001`. When retries are exhausted they return the existing A 503/409 envelope (A-owned code choice), never a partial commit. | A17 test 15 extended so that B holds a key for longer than 2 s: A retries, then fails cleanly with the business row unchanged. |
| X8 | **Retrofit coverage after #19 / #21 / #23** | The A17 §9 list predates these PRs. | Add `FleetService.removeGroupJeepney` (PR #19) as a **context bump**. `removeGroupDriver` (PR #19) and `unassignDriver` (PR #21) are **visibility only**: no bump, but they need a user-channel invalidation in P5. `TransitService.updateDirection` is rewritten by PR #23 and is currently a single `pool.query` UPDATE, so the retrofit must turn it into a transaction (sorted keys for every assigned jeepney → UPDATE → bump). | A17 test 7 extended to removal; test 8 run against the post-#23 `updateDirection`. |

Everything else in A17 (§2 signatures, §5 precedence and conflict handling, §6 eligibility predicate, §8 mutation table, §10 failure semantics, §11 tests 1–20) is **reconciled with no change**.

## 3. Final decision options

Each subsection lists the options, the recommendation first, and how reversible each choice is. "Reversible" means it can be changed later without a data migration.

### 3.1 R2 — implausible speed

| Option | Effect | Reversibility |
|---|---|---|
| **A (recommended)** Writer classifies `speedKph > 300` as an INVALID observation (count-only, no coordinate advance), and B007 adds `CHECK (speed_kph BETWEEN 0 AND 300)` | Corrupt or mis-unit device speeds never reach DTOs or motion status; a jeepney cannot reach 300 km/h | The value is in one writer constant plus one CHECK; changing it is a single small migration |
| B: store any finite speed, no CHECK | Matches PR #22 behavior; absurd values can reach private/public DTOs and motion classification | Fully reversible |
| C: clamp to 300 | **Not recommended.** It silently fabricates a value, contrary to the "no fabricated data" rule | — |

Test: 299.9 / 300 / 300.1 km/h, where 300.1 does not advance the position or watermark and does not reset compliance counters.

### 3.2 Synchronous multi-jeepney mutation limit

| Option | Effect | Reversibility |
|---|---|---|
| **A (recommended)** 250 keys per transaction. Over the limit → pre-lock 422 `TRACKING_CONTEXT_MUTATION_TOO_LARGE` (A-owned code), Admin splits the change | Bounded lock-table use (default ≈ 6,400 slots) and bounded wait for B writers; far above MVP fleet sizes. PR #25's impact preview shows the count before submission | A configuration constant, raised later after a pressure test |
| B: 1,000 (equal to the snapshot cap) | Fewer rejections. Four concurrent maximum-size mutations can approach default lock-table limits, so this needs an Infrastructure `max_locks_per_transaction` decision | Same |
| C: no cap | **Not recommended.** It risks an unbounded lock set and lock-table exhaustion (`out of shared memory`) | — |

Test: cap 250 succeeds, cap+1 is rejected with zero locks taken, and N concurrent cap-size mutations run under the CI PostgreSQL defaults.

### 3.3 Compliance event retention (D08, owner decision)

| Option | Effect | Reversibility |
|---|---|---|
| **A (recommended)** 30 days, purged in bounded batches by an approved actor; latest-state rows are never purged | Covers D53/E66 "recent deviations" and E67 basic reports; minimal private movement history | Extending is easy (change the cutoff). Shortening loses data |
| B: 90 days | Supports quarterly reporting; triples the stored private location-adjacent history | Same |
| C: keep events, no purge, until a policy exists | **Not recommended** for MVP privacy. It also leaves T4 history unbounded | — |

Note that events hold the deviation distance and corridor, not raw tracks. Traccar's own raw-history retention is a separate Infrastructure setting and is not changed here. Purge runs no earlier than the P4 release.

### 3.4 U1 — Driver names for groupmates (ID 45)

| Option | Effect | Reversibility |
|---|---|---|
| **A (recommended)** `currentDriver: { displayName } \| null` only in private T2/T3, for DRIVER same-group and OPERATOR own-fleet scope, read live from A's current assignment in the same snapshot; never in public DTOs, Pusher, logs or events | Meets ID 45 with the minimum field (no phone, email or user ID). Unassignment (PR #21) removes it on the next fetch | Removing the field is a DTO version change |
| B: no driver name; show the vehicle (plate/color) only | Lowest privacy exposure; ID 45 is only partly met | Easily added later |
| C: add a driver user ID or contact | **Not recommended.** It is beyond ID 45 and needs a separate privacy review | — |

Approval needs G plus Agent D sign-off. Test: unrelated Driver → field absent (403 for T3); COMMUTER T1 → no driver field exists; after unassignment → `null`.

### 3.5 Realtime invalidation delivery (D10/D11)

| Option | Effect | Reversibility |
|---|---|---|
| **A (recommended for MVP)** Best-effort post-commit `tracking.snapshot-invalidated.v1` from the writer, with no durable intent table. The 10 s foreground REST poll is the guaranteed repair. 009 stays deferred | Removes migration 009 from the C/D/E critical path. A lost invalidation costs at most about 10 s of staleness, and public markers still expire at `availableUntil`. Publisher failure never rolls back GPS | Adding 009 later requires no client change because the event and payload are identical |
| B: durable pointer intents (009) before any realtime | At-least-once delivery with CAS acknowledgement; adds a migration, a claimer loop and more tests to P5 | — |
| C: no Pusher in MVP, polling only | Simplest; 10 s latency everywhere and higher REST load | Easy to add A later |

The invalidation targets are the same under any option: the old and new route channels on any route or eligibility change, and the user channels of previous recipients after `removeGroupJeepney`, `removeGroupDriver` and `unassignDriver`. Test: a fake publisher that throws after commit leaves the state committed, and the client recovers within one poll.

## 4. Migration and PR dependencies once A #19 and #21 merge

Neither #19 nor #21 contains a migration. Merging them does not change migration numbering. It does extend the A retrofit scope (X8).

```mermaid
flowchart TD
  M19[A #19 merged] --> AI
  M21[A #21 merged] --> AI
  M23[A #23 merged - rewrites updateDirection] --> AI
  G17[G approves A #17 + X1-X8 amendments + section 3 decisions] --> AI
  AI[New A PR: 006_tracking_context_generation.sql + lock helper + executor/context/visibility services + mutation retrofit; A17 tests 1-20] --> P1
  P1[B P1 PR: 007_tracking_latest_state.sql + 008_route_compliance_events.sql; B13B-42] --> P2[B P2 writer + lease]
  P2 --> P3[B P3 compliance] --> P4[B P4 reconciliation]
  P4 --> P5[B P5 gateway REST + signer + best-effort invalidation]
  P5 -. only if option 3.5B .-> M9[009_tracking_publication_intents.sql]
  G7[A #27 G7 route-change table] --> N10[010 or later]
```

| Order | PR | Base / prerequisite | Migration |
|---|---|---|---|
| 1 | A #19, #21, #23 (and other open A PRs, in any order) | Current `main` | none |
| 2 | **New A Stage 13b interface PR** | `main` after step 1; G approval of #17 + X1–X8 | `006_tracking_context_generation.sql` (adds `jeepneys.tracking_context_version`, `tracking_context_changed_at`) |
| 3 | B P1 schema PR | `main` after step 2 merged | `007_tracking_latest_state.sql` (carries the R2 CHECK if option 3.1A), `008_route_compliance_events.sql` |
| 4–6 | B P2, P3, P4 runtime PRs | Previous phase accepted | none |
| 7 | B P5 gateway PR | P4 accepted; C/D/E contract freeze | none under option 3.5A; `009_tracking_publication_intents.sql` only under 3.5B |
| any | A G7 (#27 follow-up) | Independent | `010_*` or later |

Additional ordering notes:

- **Why A must land first:** `src/db/migrate.ts` applies files in lexical filename order. B007 stores A's `tracking_context_version`, and the B writer reads it, so B007 must never apply on a database without 006.
- **Why #23 must merge before step 2:** both rewrite `TransitService.updateDirection`. Landing #23 first avoids a conflicting retrofit.
- **B PR housekeeping:** #22 and #14 both edit `docs/agent-status/AGENT_B_STATUS.md`. Merge #22 first. #14's copy is a superset, so its conflict resolves by taking #14's version. Neither PR blocks the A work.

## 5. What stays blocked

- B13B-01…42: **BLOCKED**, unchanged in [the ledger](https://github.com/erwin-io/valryde-api/blob/259125f3b130d8927a4ab6054e31a735e6392e1a/docs/tracking/stage13b-acceptance-results.json) on PR #22. They move only when actual implementation tests run.
- No A branch modified. No A006, B007, B008 or 009 file created. No runtime, Bridge process, database write, Traccar access, credential or Pusher configuration.
- Owner/environment gates are unchanged from the [readiness package §5](PARALLEL_READINESS_REVIEW_PACKAGE.md#5-outstanding-gates).

# Stage 13b B0 — architecture freeze and approval matrix

Directive `VALRYDE-AGENT-B-FULL-TRACKING-RELEASE-006`, Phase B0. Agent B, IDs 12–21. 2026-10-23.

**Status:** PROPOSED. This matrix lists what still needs a named approval before Phase B1. It authorizes no migration, schema or runtime work.

## 1. Baseline

| Item | Evidence |
|---|---|
| `main` | `810c8a13356ddbf0e28a4faf5ad7f86ce0a30479` (directive cited `99f4cb1`; since then #17, #28 and #27 merged, all documentation or G6 places code) |
| Agent B #22 | Integrated: `259125f` is an ancestor of `main` (merge `ba13619`) |
| Agent A #17 | MERGED (`0670bcb`) with **Amendment 1** (§13), which applies X1–X8 verbatim. The document itself still says "PROPOSED FOR TECH LEAD REVIEW" |
| Migrations on `main` | 001–005 only. **A006 does not exist** |
| A #27 G7-D2 | Resolved by `8daf7d7`: 006–008 reserved for Stage 13b, G7 uses 010+ |

## 2. Frozen values — B design vs A #17 Amendment 1

Every directive 006 value already agrees with both documents. There is no remaining technical difference between Agent A and Agent B.

| Value | A #17 | B (PR #14) |
|---|---|---|
| READ COMMITTED for lock-taking transactions | §3, X1 | X1 |
| `REPEATABLE READ READ ONLY` gateway snapshots | §2 snapshot mode, X2 | X2, D09 |
| One key per B transaction; per-jeepney sweep | §4.1, X6 | X6 |
| 250 cap → pre-lock 422 `TRACKING_CONTEXT_MUTATION_TOO_LARGE` | §13.2 #1 | §3.2 |
| `speedKph > 300` INVALID, CHECK 0..300 | §13.2 #2 | R2, §3.1 |
| 30 s public freshness | §13.2 #4 | Frozen invariant |
| Private telemetry separate from route/public eligibility | §6 | D07 `telemetryEligible` / `routeUsability` |
| Best-effort invalidation + 10 s poll; B009 deferred | §13.2 #5 | §3.5 |
| A006 → B007 → B008; 009 deferred; G7 010+ | §9, §13.2 #6 | Migration sequencing |
| Lock timing: A 2 s × 3 then 503; B ≤ 10 s, writer `lock_timeout` 1 s | §13.2 #7 | D12 |

The compliance thresholds are unchanged: 100 m corridor; 30 s outside or 3 consecutive outside fixes; 2 inside fixes to re-enter.

## 3. Approval matrix

| # | Decision | Recommended | Approver | Blocks |
|---|---|---|---|---|
| M1 | Promote A #17 + Amendment 1 from PROPOSED to APPROVED, including A §12 items 1 (advisory key), 2 (A006 context version and 006/007/008 sequence) and 7 (which A PR retrofits) | Approve | Agent G | A006 PR → all B phases |
| M2 | Formally sign off A §13.2 constants 1–7 (§2 above) | Approve as listed | Agent G | B1 CHECK, B2 constants |
| M3 | New A error code `503 TRACKING_CONTEXT_BUSY` | Approve | Agent G | A006 retrofit |
| M4 | Bridge DB role grants: advisory-lock execute, SELECT on allowlisted A tables, DML only on B007/B008 tables | Approve | Agent G + Infrastructure | B1 grants, B6 privilege test |
| M5 | Compliance-event retention of 30 days. Purge stays configurable and disabled until approved | 30 days | Owner | B3 purge job only (B3 itself can proceed) |
| M6 | U1: private views show the Driver's `displayName` only; commuters see none | Approve | Agent G + Agent D | B5 T2/T3 `currentDriver` |
| M7 | Freeze gateway T1–T6 DTOs and new codes `TRACKING_UNAVAILABLE` (503), `TRACKING_SCOPE_TOO_LARGE` (422) | Approve after B5 contract tests | Agent G + C/D/E | B5 client consumption |
| M8 | Pusher app/credentials for realtime signing (T6) | Provision dev app | Infrastructure | B5 live realtime only; REST and polling work without it |

## 4. Phase gating as of this checkpoint

| Phase | State | Unblocked by |
|---|---|---|
| B0 | DONE (this document) | — |
| B1 schema B007/B008 | **BLOCKED** | M1 + an A006 PR merged on `main` (Agent A's Phase C) |
| B2–B4 | BLOCKED | B1 merged |
| B5 | BLOCKED | B2 (writer state to serve) + M6/M7; M8 for live Pusher |
| B6 | BLOCKED | B1–B5; the 42 ledger cases stay BLOCKED |

Agent B cannot write B007, because its writer reads `jeepneys.tracking_context_version` from A006 and the migration runner applies files in filename order. Exact next action: **Agent G approves M1–M4, then Agent A opens the A006/retrofit PR with A #17 tests T1–T26.** Agent B starts B1 once that PR merges.

## 5. Gate decisions — `VALRYDE-G-B-STAGE13B-GATES-001` (2026-10-23)

| # | Decision | Effect on Agent B |
|---|---|---|
| M1 | **APPROVED**: merged A #17 + Amendment 1 + X1–X8 are the baseline | B007/B008/writer follow it; no further A/B design difference |
| M2 | **APPROVED**: 250 cap, speed ≤ 300 km/h, 30 s freshness, 10 s polling, create-only mapping, B009 deferred | Encoded as B007 CHECKs and writer constants |
| M3 | **APPROVED**: `503 TRACKING_CONTEXT_BUSY`, bounded retry, safe response, deterministic tests | Agent A code in the A006 retrofit; B does not emit it |
| M4 | **CONDITIONAL**: design exact least-privilege roles/grants and submit SQL + privilege evidence; do not apply to shared/production DBs | Grants ship as reviewed SQL, exercised only in disposable CI |
| M5 | **PENDING**: retention not approved | No purge code path is scheduled; event rows are kept |
| M6 | **PENDING**: Driver `displayName` | T2/T3 omit `currentDriver.displayName` by default |
| M7 | **PENDING CONTRACT REVIEW** | T1–T6 DTOs and contract tests are built but labeled not frozen |
| M8 | **INFRASTRUCTURE-GATED**: no Pusher credentials | REST, writer, compliance and recovery proceed; realtime signing is tested with a fake |

Migration order stays A006 → B007 → B008. B007/B008 implementation PRs may be opened before A006 merges, but must not merge before it. Tests that need A006 columns use a labeled stub and are not integrated acceptance evidence.

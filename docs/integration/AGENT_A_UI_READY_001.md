# A-UI-READY-001 — Agent A backend readiness for UI Agents C, D and E

**Date:** 2026-10-23 · **Accepted API:** `main` `810c8a13356ddbf0e28a4faf5ad7f86ce0a30479` (56 operations / 47 paths) · **Nothing merged or migrated by Agent A.**
Endpoint-level detail: [AGENT_A_UI_ENDPOINT_AVAILABILITY.md](AGENT_A_UI_ENDPOINT_AVAILABILITY.md) ([JSON](AGENT_A_UI_ENDPOINT_AVAILABILITY.json)).

## 1. PR heads, CI and review state

| PR | Head | `verify` (PostGIS) + GitGuardian | Review | Decision |
|---|---|---|---|---|
| #31 A006 | `b4d694228bb1daf82121e90067598fb38faeaeae` | pass (workflow 39881541394, verified by Agent G) | code review pending | **Merge-ready, pending Agent G code review** (§2) |
| #33 G8 audit read | `13763ae7ad47dce71d4116fb2acbe84f1904eb97` | pass | changes required | **Changes required:** G8-D3 metadata exposure undecided; allowlist to implement (§3) |
| #34 G9 proposal | `089dd622bbedcc3d90f45588d7bac0859dd79321` | pass | D2 = opt-in accepted | **Proposal; no code.** D1, D3–D6 to confirm (§4) |
| #35 G7 matrix | `e10963df070656fc727d63494df3e2f328f51a9b` | pass | D1, D3, D6 accepted as directions | **Proposal; no code.** D4, D5, D7 and two corrections open (§5) |
| #29 handoff | this commit (previous green head `92da88a`) | pass at `92da88a`; this commit re-runs CI | review pending | **Merge-ready after review.** Documentation only; reconciled to `main` (§6) |

GitHub reports every head above as MERGEABLE/CLEAN, with no review decision recorded. Agent B's Stage 13b stack is #30 (B007/B008 schema), #32 (B2 writer), #36 (B3 compliance) and #37 (B4 reconcile). #32, #36 and #37 each contain A006 as a reference merge. Their copies of `006_tracking_context_generation.sql`, `src/db/tracking-context.ts`, `src/services/tracking-context-service.ts` and the A006 test file are blob-identical to #31. CI passed on #32 `dc0ad58` and #37 `3b70e5b`.

## 2. #31 A006 merge-readiness

**Migration safety (`006_tracking_context_generation.sql`)**
- **Additive only:** `tracking_context_version bigint NOT NULL DEFAULT 1` and `tracking_context_changed_at timestamptz NOT NULL DEFAULT clock_timestamp()`, plus a `> 0` CHECK. No existing column, index or data changes.
- **Idempotent:** `ADD COLUMN IF NOT EXISTS`; the CHECK is wrapped in a `duplicate_object` guard. `migrate.ts` applies it in one transaction with the ledger insert.
- **Table rewrite:** the volatile default rewrites `jeepneys` under an ACCESS EXCLUSIVE lock. That takes milliseconds at MVP size, but deployment should run it outside peak traffic. Every existing row starts at version 1, with a distinct `changed_at`.
- **Forward-only:** the framework has no down migration. Rollback means restoring from backup, which is Agent B's restore drill (B13B-42).
- **Ordering:** must merge before B007 (#30), because migrations apply in lexical order. B007 does not reference the A006 columns; B2's writer reads `tracking_context_version`.

**Concurrency and locking invariants, with the CI evidence for each**

| Invariant | Evidence |
|---|---|
| READ COMMITTED for lock-taking transactions (X1) | T4/T4-X1 |
| Snapshot mode, REPEATABLE READ READ ONLY (X2) | T21 |
| Keys de-duplicated and sorted by bigint (X3) | T22, deterministic `pg_locks` proof |
| Affected set re-checked after locking | T16 (`assignRoute`, `updateDirection`) |
| `clock_timestamp()` after the lock (X4) | T20 |
| `lock_timeout` 2 s, 3 whole-transaction retries, then 503 (X7) | T15: real-contention `55P03`, plus simulated `55P03`/`40P01`/`40001` with an attempt counter |
| 250-jeepney cap, rejected before and after locking | T22 cap tests |
| Atomic rollback | T13 for `updateDirection`, group `assignRoute`, `removeGroupJeepney`, `mapDevice`, `verifyInstallation` |
| Race serialization | T3, T5, T6, T7 (both orders), competing route/direction edits |
| Visibility-only removals | T26 |
| Create-only mapping | T10 |

**Known gaps (documented, not hidden)**
- `40P01` and `40001` are covered only by simulated injection. Which transaction a real deadlock aborts isn't deterministic, and `40001` cannot occur at READ COMMITTED.
- No forced advisory-key hash collision: keys are computed in SQL.
- Queue-order tests assume the test releases its lock within the 2 s timeout.
- Bridge-side tests T14, T17, T18, the persistence half of T19, and T23–T25 belong to Agent B.

**API compatibility**
- No new operation and no DTO change.
- Retrofitted mutations can now return `503 TRACKING_CONTEXT_BUSY` (retryable). Multi-jeepney mutations (`assignTransitRoute`, `updateTransitRoute`, `updateRouteDirection`) can also return `422 TRACKING_CONTEXT_MUTATION_TOO_LARGE`.
- The 403 message text for an out-of-scope OPERATOR on the effective-route read changed. The code is unchanged.

**Reviewer actions**
1. Code-review the retrofits in `fleet-service.ts`, `transit-service.ts` and `vehicle-workflow-service.ts`.
2. Merge #31 before #30, then let Agent B rebase its stack onto `main` with no history rewrite.
3. After the merge, Agent A regenerates the handoff matrix so it shows the new 422/503 statuses.

## 3. #33 G8 — recommended read-side allowlist (proposed, not approved)

| Item | State |
|---|---|
| ADMIN-only, read-only, G1 pagination, `createdAt DESC, id DESC` | Implemented; contract proposed (G8-D1, D2) |
| Metadata exposure | **Not approved** (G8-D3). The code currently returns metadata verbatim |
| Retention | Undefined, owner decision (G8-D4); no deletion path exists |

Recommended change, to land in #33 only after G8-D3 is approved:
1. A static allowlist built from the §5.1 inventory in the G8 contract (29 actions). For each action it lists the allowed keys and each key's type: `uuid`, `uuid|null`, `enum(…)` or `fieldNames(…)`.
2. **Type checking per value:** a uuid must match the uuid pattern; an enum must be one of the listed literals; `fieldNames` must be an array whose items all belong to the listed set. Any other value is dropped.
3. **Unknown-action suppression:** an action missing from the allowlist returns `metadata: {}`.
4. **Redaction flag:** `metadataRedacted: true` whenever anything was dropped.
5. **Evidence:**
   - PostgreSQL tests insert an extra `email` key, free text under an allowed key, and an unknown action; each comes back redacted and flagged;
   - every inventoried action round-trips its keys unchanged;
   - a unit test fails if any `audit(`/`writeAudit(` call site uses an action missing from the allowlist.

## 4. #34 G9 — compatibility validation against `main`

| Check | Result |
|---|---|
| Unpaged calls must return every record | Holds: the six list queries have no `LIMIT` today. The opt-in design keeps that path unchanged and adds the tiebreak only. |
| Paged DTOs | The existing array plus `pagination { page, pageSize, total, totalPages }`, identical to G1. Admin routes paginate routes and keep all their directions, as the public list does. |
| Empty unpaged result | `{ page: 1, pageSize: 0, total: 0, totalPages: 0 }`. The response schema for these six operations needs `pageSize` minimum 0; G1's response schema stays minimum 1, and the request parameter stays minimum 1. |
| Additive field risk | `pagination` is a new property on six existing responses. Clients that reject unknown properties would break; Agents D and E must confirm they tolerate it. |
| Implementation notes | `listUsersAsAdmin` goes through `IdentityRepository`, so `MemoryIdentityRepository` (unit tests) must implement the same paging. Count and page queries must share filters and scope. |

Still needed from Agent G: G9-D1 (scope), D3 (as corrected), D4 (tiebreak), D5 (filters), D6 (403 on Admin-only filters).

## 5. #35 G7 — what remains open

| Item | Recommendation |
|---|---|
| G7-D4 — allowed target route status | ACTIVE or INACTIVE; DRAFT or unknown → 404 |
| G7-D5 — geometry envelope | Proposals checked against the Philippines envelope now; Admin geometry adopts it in a separate change |
| G7-D7 — link approval to the resulting route | Defer past MVP |
| Correction 1 | Audit `entity_type` is `ROUTE_CHANGE_REQUEST`, not `route_change_request` |
| Correction 2 | A DRAFT target returns 404, not "404 or 400" |

Accepted directions: D1 (decision record only, no automatic canonical mutation), D3 (cross-Operator 404), D6 (Operator-only). Migration 010 or later. No UI-facing G7 contract will be implemented before D4, D5 and D7 are decided.

## 6. #29 reconciliation

- Every capability marked available exists on `main` `810c8a1`. Unmerged work is labeled pending, without an endpoint path: G8 (#33), G9 (#34), G7 (#35), and A006's 422/503 (#31).
- The generated matrix and index stay at 56 operations / 47 paths. They will be regenerated after #31 (new statuses) and after any G8/G9 merge.
- Status history: #29 carries the canonical status file; #31 keeps its frozen 18:00 copy. Whichever merges second needs a status-only merge from `main`.

## 7. Checklist cross-reference

**A** = backend complete on `main` · **P** = partial (gap named) · **G** = owner-gated · **B** = needs Agent B's Stage 13b stack.

| ID | Item | Backend | Gap / gate |
|---|---|---|---|
| 1 | Auth, JWT, Google | A / G | Google client IDs and SMTP are owner-gated; email links on phones need the callback domain (G5) |
| 2 | RBAC | A | — |
| 3 | User & profile | A | Admin list unpaged (G9) |
| 4 | Jeepney management | A | "Assigned GPS device" is reached through the request mapping |
| 5 | Driver-to-jeepney assignment | A | — |
| 6 | Fleet groups | A | — |
| 7 | Membership & visibility | A | Live groupmate positions need Agent B (B) |
| 8 | Transit routes | A | — |
| 9 | Route directions | A | — |
| 10 | Jeepney-to-transit assignment | A | 422/503 handling after #31 |
| 11 | Application, GPS setup, mapping | A | Real Traccar/IMEI hardware needs owner/Agent F (G) |
| 37 | Place search & direct discovery | A / G | Discovery live; place search returns 503 until the owner approves a provider (G6-D4) |
| 49 | Driver management & assignment (D) | A | — |
| 50 | Fleet group management (D) | A | — |
| 56 | Admin login & dashboard | P / B | Login done; no summary endpoint (proposed G12); online/offline devices and deviations need Agent B |
| 57 | Operator management | P | View and disable exist. Admin create/approve and operator profile fields don't exist — **owner/Agent G policy decision** |
| 58 | Driver monitoring | A | — |
| 59 | Commuter monitoring | A | Unpaged list, no role filter until G9 |
| 60 | Jeepney & fleet group monitoring | A / B | Live tracker status needs Agent B |
| 61 | Route & direction management | A | Unused-color suggestion is client-side from the route list |
| 62 | Polyline / corridor / geofence | P | Geometry, GeoJSON LineString and corridor exist; "delete" is status INACTIVE; **no geofence entity** — owner scope decision |
| 63 | GPS device management & mapping | P / B | Mapping is create-only and available; **no device list** (proposed G13); live device status needs Agent B |
| 64 | GPS setup approval & installation | A | — |

**Directly unblocked on `main` today:** 2, 4, 5, 6, 8, 9, 10, 49, 50, 58, 61, 64 completely; the non-live parts of 1, 3, 7, 11, 37, 59 and 60.

## 8. Smallest PR sequence for the most UI acceptance tests

| # | PR | Unblocks | Acceptance criteria |
|---|---|---|---|
| 1 | Merge #29 (docs) | Every C/D/E contract test written against `main` | CI green; no operation advertised that is missing from `main` |
| 2 | Merge #31 A006 → Agent B #30 → #32 → #36 → #37 | 56 (online/offline, deviations), 60 and 63 (device status), 7 (live groupmates), all class-5 tracking UI | Agent G code review; migrations 006→007→008 apply in order on a disposable database; B stack CI green after rebase |
| 3 | **G9 implementation** (new PR from #34, after D1, D3–D6) | 3, 57, 58, 59, 60, 64 at scale; 59 role filter | §5 test spec of the G9 proposal: 101-row unpaged completeness, empty envelopes, paged walk with ties, role scope, 403 on Admin-only filters; OpenAPI and handoff regenerated |
| 4 | **G12 Admin dashboard summary** (new proposal, then implementation) | 56 | `GET /api/admin/summary` (proposed): ADMIN-only counts of operators, drivers, jeepneys by status, routes by status and pending applications/GPS requests; one snapshot; no tracking fields until Agent B's gateway exists |
| 5 | **G13 GPS device list** (new proposal, then implementation) | 63 | `GET /api/admin/gps-devices` (proposed): ADMIN-only, paged, device, mapping and jeepney summary; no IMEI search until approved |
| 6 | #33 G8 with the §3 allowlist (after G8-D3) | Admin audit screen | §3 redaction evidence |
| 7 | G7 implementation (after D4, D5, D7) | 52 | Test spec §4 of the G7 matrix |

Items 4 and 5 are new contracts, so Agent A will open them as proposals first; nothing is implemented without approval.

## 9. Decisions required

| Owner | Decision |
|---|---|
| Agent G | Code review and merge order for #31 → #30 |
| Agent G | Review and merge #29 |
| Agent G | G8-D3 (allowlist recommended), G8-D1, D2, D5, D6 |
| Agent G | G9-D1, D3–D6 |
| Agent G | G7-D4, D5, D7 and the two corrections |
| Agent G | Approve opening G12 (dashboard summary) and G13 (device list) proposals |
| Owner | Operator create/approve policy (ID 57) |
| Owner | Geofence scope (ID 62) |
| Owner | Audit retention (G8-D4) |
| Owner | Geocoding provider (G6-D4) |
| Owner | Google client IDs, SMTP, callback domain and App Links hosting (G5), first real Admin, GPS/Traccar hardware |

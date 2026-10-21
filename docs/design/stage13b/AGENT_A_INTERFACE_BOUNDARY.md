# Agent A shared interface coordination — proposed boundary

D05/D06/D07/D12. No adapter/source change is authorized. Current baseline main827738c0f2c33ad3082f6a4a38a8e35669d4b0ea has only migrations001–005; resolver and current scopes issue pool queries. No approved transaction/context helper is delivered at refinement preflight.

## Coordination record

Human B2 instruction authorizes coordination with Agent A. Read Agent A's active checkpoint: it separately assigns an A-owned Stage13b shared-interface specification, alongside fixture verification. Sent a focused request to **Agent: A — Fastify API**, chat01a15086-5639-7691-87b5-b29f637818f5, on2026-10-22. Requested caller-owned client, exact scope/lock/mapping/cutover contract, privilege model, tests and A branch/PR/HEAD. B does not edit A status/source/worktrees or treat A's unreviewed specification as Tech Lead approval. Delivery/update references belong below when available; missing delivery remains an explicit gate, not proof of incompatibility.

## Boundary B requests from A

| Boundary | Required behavior | Baseline compatibility / gate |
|---|---|---|
| Transaction ownership | B obtains client, BEGIN, deadlines, COMMIT/ROLLBACK and release. A receives executor from same client; no pool escape, nested BEGIN, commit or release. Rollback on any A/DB error. | Proposed optional executor defaults to existing pool for old callers. Exact exported type/name is A-owned, not a B speculative adapter. |
| Effective route | One existing A implementation: direct first, else0/1/>1 group; exact conflict error; inactive direct never falls back. A lookup returns provenance sufficient for B context hashing. | Keep accepted route endpoint/error unchanged. No copying precedence into B SQL. |
| Authorization | Current active/verified identity and credential checks in API; A transaction-aware existence-based DRIVER assigned/created/same-group, OPERATOR own fleet, ADMIN platform. Collection query must de-duplicate membership; invalidation recipient lookup uses same authority. | Bridge has service identity, not a fabricated ADMIN actor. Ingestion eligibility and user visibility are separate. Future REST authorizes through A. |
| Global locking | A specifies all participating business mutations and total acquisition order including group, jeepney, workflow, mapping, direction/route and B rows/lease. Discovery of IDs is followed by locked revalidation. No external IO under locks. | Current review/verification request/application-first order inverts naive jeepney-first B order. Parent-route/direction edits and group membership races must be audited as well. No retry-based waiver. |
| Mapping generation | Current immutable mapping UUID/mapped_at/request/device/uniqueId chain; atomic replacement/cutover if remap is released. Old queued fixes cannot acquire a new identity by late lookup. | Existing schema has no general remap endpoint/version column. B does not invent one. Unsupported ABA/direct SQL edits remain unsupported. |
| Context invalidation | Stable identity/cutover from A for ownership/mapping changes; affected jeepneys for group/direct/geometry/corridor/device/workflow mutations. Atomic invalidation or approved durable marker plus read masking; B reconciliation cannot overwrite a newer generation. | Exact marker storage and mutation hook are unresolved A-owned design. Existing timestamps/hashes alone cannot prove an unseen A→B→A history. Any required existing-schema change needs explicit additional schema approval. |
| Privilege boundary | A proposes restricted lock/context helper, or exact narrower alternative. Fixed validated schema, no unsafe dynamic SQL, tight EXECUTE/search_path/definer grants if a helper is chosen. | SELECT-only role cannot take proposed A row locks. No broad business UPDATE silently granted. Test with actual approved deployment role. |
| Failures | Missing/ineligible context yields classified UNKNOWN/unavailable; only domain route conflict is converted. SQL/session/timeout errors roll back and propagate sink failure, no fake empty route. | Whole-transaction retries only for approved transient SQLSTATEs, with bounded attempts/deadline; typed integration failure is not a valid empty context. |

## Required A delivery checklist

- [ ] A-owned document path, branch, full HEAD and PR supplied.
- [ ] Exact client/executor/scope signatures, public error compatibility and source ownership recorded.
- [ ] Global order includes all fleet/transit/workflow mutations and any context/helper privilege model.
- [ ] Mapping/context cutover storage, generation and create-only fallback explicitly resolved.
- [ ] Catalog compatibility checked against001–005; any extra A migration isolated and approved.
- [ ] Real PostgreSQL barriers for B13B-21–25/31–34/41–42 specified.
- [ ] G approves the interface before an A implementation is depended upon; source implementation and tests delivered through approved workflow.

These are delivery/approval checks, not claims that A has failed or that B may implement them. No downstream client contract is frozen by this request.

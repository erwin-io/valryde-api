# VALRYDE — Shared AI Agent Status & Activity Reporting Policy

**Version:** 1.1
**Issued:** 2026-10-19
**Canonical repository path:** `docs/00_SHARED_AGENT_STATUS_REPORTING_POLICY.md`
**Applies to:** Developer agents A–F and Tech Lead G
**Scope:** All approved VALRYDE Version 1.0 MVP checklist IDs (1–71)
**Classification:** Operational reporting policy; does not change feature scope or acceptance criteria.

## 1. Mandatory instruction for all agents

You MUST maintain a persistent Markdown agent status record in your assigned repository. Read it at the beginning of every working session, then update it immediately after every **meaningful action or change**. Meaningful actions include changes to code, migration, tests, contracts, environment/configuration, documentation, dependencies, commits/PRs, review feedback, deployments, verification outcomes, blockers, owner decisions, and significant investigations that change the plan. Record failed or rolled-back actions too.

Do not create a new status file on every action. **Update the same per-agent status file**, maintaining a concise current snapshot and an append-only activity log (newest first; do not remove or rewrite previous entries). Status reporting must never replace a GitHub issue, PR description, review, test log or Tech Lead release ledger.

Before ending a working session, deliver a human-readable agent status summary in chat, even if no source files changed; explicitly say **No changes** where applicable. If blocked, state the exact required next action and whether it requires owner/operator approval.

## 2. Fixed filenames and ownership

| Agent | Checklist IDs | Repository / home | File path |
|---|---|---|---|
| A — Core Platform / Fastify API | 1–11 | `valryde-api` | `docs/agent-status/AGENT_A_STATUS.md` |
| B — Traccar / Tracking Engine | 12–21 | `valryde-api` | `docs/agent-status/AGENT_B_STATUS.md` |
| C — Commuter Mobile | 22–37 | `valryde-mobile-commuter` | `docs/agent-status/AGENT_C_STATUS.md` |
| D — Driver/Operator Mobile | 38–55 | `valryde-mobile-operator` | `docs/agent-status/AGENT_D_STATUS.md` |
| E — Admin Web | 56–67 | `valryde-web-admin` | `docs/agent-status/AGENT_E_STATUS.md` |
| F — GPS Setup & Documentation | 68–71 | Relevant owned repo/runbooks; one canonical home chosen with Tech Lead | `docs/agent-status/AGENT_F_STATUS.md` |
| G — Tech Lead / Integration | 1–71 | Tech Lead's designated canonical home | `docs/agent-status/TECH_LEAD_STATUS.md` |

If a repository already maintains an equivalent status file, inspect it and **retain/migrate its useful content rather than deleting history or creating a competing tracker**. Document the canonical path in the repository README or agent instructions. Agent A and B must not overwrite each other's status file. For cross-repo work, maintain one canonical per-agent report in the designated home repository and link to affected commits/PRs elsewhere. If a materially changed repository requires local status evidence, add a concise cross-reference there rather than maintaining a conflicting second authoritative history.

## 3. Update trigger and timing

Update the status file immediately after a meaningful action has a known outcome and before moving to the next major task. Examples:

- A file, feature slice, SQL migration, environment configuration or external service setting changes.
- A test, build, lint, typecheck, migration or deployment succeeds or fails.
- A blocker is discovered, reproduced, resolved or escalated.
- An agent opens or updates an issue/PR, receives review feedback, or pushes a new commit.
- An approved shared contract changes, including API, schema, DTO, RBAC, realtime, Traccar, or geospatial behavior.
- Hardware/operator verification is requested, performed, or remains pending.

Pure reading, routine tool calls, repeated no-op checks and exploratory attempts that yield no decision or material finding may be combined into one concise activity entry. Do not generate a commit for every log entry; group status changes naturally with the corresponding implementation commit or PR. If the action did not modify repository files, update the status when repository access is available, and always report the outcome in chat.

## 4. Exact meaning of progress and review states

**Implementation progress** (agent may record): `NOT_STARTED`, `IN_PROGRESS`, `BLOCKED`, `READY_FOR_REVIEW`, `DONE_AFTER_ACCEPTANCE`.

**Technical evidence** (record separately): `NOT_RUN`, `PASSED`, `FAILED`, `NOT_APPLICABLE`, `OWNER_VERIFICATION_PENDING`.

**Tech Lead PR review decisions** (Tech Lead only): `ACCEPTED`, `CHANGES REQUIRED`, `OPERATOR-GATED`.

Never describe a task as accepted or fully completed solely because the agent's own code/tests passed. `READY_FOR_REVIEW` means an agent has submitted sufficient evidence for Tech Lead review. `OPERATOR-GATED` is a Tech Lead determination when source implementation is acceptable but owner/hardware/environment confirmation is outstanding. An agent may report an **operator gate pending**, but must not independently claim Tech Lead acceptance.

A blocked environment setup does not necessarily mean a source-code defect. Preserve distinct categories for code defects, integration blockers, and external owner/device/environment gates.

## 5. Canonical status file template

Create or update the assigned file using this template. Remove example placeholders only after replacing them with true facts; use `Unknown` or `Not yet verified` instead of inventing results.

```markdown
# VALRYDE — Agent [A–G] Status

## Current snapshot
- Updated at (ISO 8601, Asia/Manila):
- Agent / module:
- Repository:
- Branch / HEAD SHA:
- Checklist IDs:
- GitHub issues / PRs:
- Implementation progress: NOT_STARTED | IN_PROGRESS | BLOCKED | READY_FOR_REVIEW | DONE_AFTER_ACCEPTANCE
- Tech Lead review decision (if actually issued): Not reviewed | ACCEPTED | CHANGES REQUIRED | OPERATOR-GATED
- Current objective:
- Last confirmed result:
- Next concrete action:
- Blocked by / decision owner:
- Dependencies / affected agents:

## Checklist coverage
| Checklist ID | Feature / slice | Progress | Evidence (files/tests/PR) | Blocker / next action |
|---|---|---|---|---|

## Latest verification
| Command / check | Environment | Result | Date/time | Evidence / notes |
|---|---|---|---|---|

## Shared contract / risk changes
- API/DTO/schema/migration changes:
- Auth/RBAC/data-isolation impact:
- Realtime/Traccar/geospatial impact:
- Secrets/security/privacy impact:
- Required Tech Lead or owner decision:

## Operator / hardware / external gates
- Gate:
- Required actor:
- Requested evidence:
- State:

## Activity log (newest first; preserve prior entries)
### YYYY-MM-DD HH:mm +08:00 — Short action title
- Action / reason:
- Checklist/issue:
- Files/config/services affected:
- Observed result (success/failure/rollback):
- Validation and evidence:
- Contracts / risks / dependencies:
- Commit/PR link or SHA (if available):
- Next action / owner gate:
```

Do not include credentials, secrets, private authentication tokens, raw `.env` values, private user data or sensitive GPS history in the status file. Use sanitized evidence and issue/CI links instead.

## 6. Required chat summary after meaningful work and at session end

Present a concise status to the user/Tech Lead:

```text
VALRYDE AGENT [LETTER] — STATUS UPDATE
Checklist IDs:
Repository / branch / HEAD SHA:
Action(s) completed:
Files/services/configuration changed:
Verification (passed / failed / not run):
Implementation progress:
Tech Lead decision (if issued):
Blockers / operator-gated evidence:
Cross-agent dependencies / contract impacts:
Next action:
Status file path:
```

Do not claim checks ran unless actually executed, do not claim a PR was opened unless GitHub confirms, and do not claim a file was committed or pushed unless repository evidence confirms.

## 7. PR and issue synchronization

Every implementation PR must continue to use the established Tech Lead handoff block (checklist IDs, issue, changed files, migrations, contracts, security, tests, manual checks, remaining operator evidence and limitations). Add a link/path to the current agent status file and an accurate snapshot of the work. Keep `AGENT_*_STATUS.md` updates in the feature branch when relevant; do not push directly to protected `main` merely to update status. Do not let a status-only update circumvent PR review or create repetitive reviews/comments on an unchanged material code head.

The Google Sheets MVP checklist is the planning/status tracking reference. Do **not** automatically change shared checklist status from an agent status log without the required owner/Tech Lead workflow and evidence.

## 8. Required start-of-session recovery

1. Read the canonical Version 1.0 project documentation, assigned agent handoff and Tech Lead shared contracts relevant to the task.
2. Check current repository `main`, current working branch, HEAD, issues/PRs and status file.
3. Confirm that status statements match actual repository state; stale claims must be corrected and noted.
4. Identify the next unblocked authorized task, prerequisites, cross-repo conflicts and pending operator gates.
5. Continue without repeating completed work or generating unnecessary duplicate PR/comments.

## 9. Initial adoption (one-time)

- Locate and preserve any existing `AGENT_STATUS.md`, `STATUS.md`, work log or implementation notes.
- Install this policy as `docs/00_SHARED_AGENT_STATUS_REPORTING_POLICY.md` in each active VALRYDE repository. The text is a synchronized governance copy, controlled by Tech Lead/owner change control; do not independently modify a single repository copy. Reference the same version in every repository.
- Add a short reference to this policy in each agent's handoff or persistent vendor-neutral repository instructions (`AGENTS.md`, with compatibility shims such as `CLAUDE.md`).
- Create the agent-specific status file the first time the agent resumes work, with a truthful initial snapshot.
- Do not perform unrelated feature changes, repo creation, database migration or PR merges merely to adopt reporting.

## 10. Paste into every A–F agent's instructions

> **Mandatory VALRYDE Agent Status Reporting:** Read and comply with `docs/00_SHARED_AGENT_STATUS_REPORTING_POLICY.md`. Maintain your single canonical `docs/agent-status/AGENT_[LETTER]_STATUS.md` record: update its current snapshot and append a timestamped activity entry immediately after every meaningful code/config/test/migration/contract/PR/issue/blocker/action outcome; record failures and rollbacks; preserve history; separate implementation progress from the Tech Lead's ACCEPTED / CHANGES REQUIRED / OPERATOR-GATED decision; never include secrets. Report the concise status in chat after meaningful work and at the end of every session. Do not create a new MD file or commit for every action. Do not self-merge.

---

**Policy maintenance:** Treat this document as read-only during feature implementation. Propose amendments through a Tech Lead-reviewed governance change and synchronize the approved version across repositories. Do not confuse this with filesystem read-only permissions.

**This policy supplements but does not replace:** `G_Tech_Lead_Repository_Management_Handoff.md`, the respective A–F handoffs, the approved Version 1.0 Complete System Documentation, the 71-item MVP checklist, and repository issue/PR/CI evidence.

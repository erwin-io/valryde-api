# VALRYDE — AI Agent Development Instructions

**Project:** Valryde — Public Jeepney Route Live Tracking & Monitoring System
**Baseline:** Version 1.0 MVP
**Applies to:** All AI engineering agents, coding assistants, and human developers working in this repository.

## 1. Mandatory instruction hierarchy

Before performing development work, read and follow the applicable project documentation.

Read in this order:

1. `AGENTS.md` — shared repository instructions.
2. The approved VALRYDE Complete Features, Modules & System Documentation, Version 1.0.
3. The approved 71-item MVP checklist.
4. `handoffs/` — the relevant agent-specific implementation handoff.
5. `handoffs/G_Tech_Lead_Repository_Management_Handoff.md` — shared integration, architecture, PR, and contract governance.
6. `docs/00_SHARED_AGENT_STATUS_REPORTING_POLICY.md` — mandatory reporting policy.
7. `docs/governance/VALRYDE_MOBILE_TESTING_POLICY_001.md` — mandatory mobile development and owner physical-device acceptance policy for Agents C and D and their reviewers.
8. `docs/agent-status/` — the assigned agent's existing status file.
9. Current repository source, README, package manifests, lockfiles, migrations, tests, and CI configuration.

If a document is unavailable, report the missing reference. Do not invent its requirements.

Do not silently override an approved project decision. If the existing source conflicts with the approved design baseline, report the discrepancy and follow the project's change-control process.

## 2. Automatic agent identification

Determine the responsible agent from the assigned task, checklist IDs, module, and repository.

| Agent | Responsibility | Checklist IDs |
|---|---|---|
| A | Core Platform / Fastify API | 1–11 |
| B | Traccar / Tracking Engine | 12–21 |
| C | Commuter Mobile App | 22–37 |
| D | Driver & Operator Mobile App | 38–55 |
| E | Admin Web Application | 56–67 |
| F | GPS Setup / Documentation | 68–71 |
| G | Tech Lead / Integration & Review | All 71 |

Read the matching file under `handoffs/`.

When the task spans multiple agents, identify the primary owner and dependencies. Do not modify another agent's owned implementation without appropriate coordination and authorization.

If ownership is ambiguous, establish it before making cross-module changes.

## 3. Mandatory status reporting

Every agent MUST follow:

`docs/00_SHARED_AGENT_STATUS_REPORTING_POLICY.md`

This requirement applies to all meaningful:

- Code implementations and fixes
- Database migrations and schema changes
- Configuration and dependency changes
- Tests and verification
- Architecture and integration changes
- Documentation changes
- Investigations and blocker discoveries
- GitHub issues, PRs, and review activities

### Status file behavior

Use the existing agent-specific file in:

`docs/agent-status/`

Standard names:

- `AGENT_A_STATUS.md`
- `AGENT_B_STATUS.md`
- `AGENT_C_STATUS.md`
- `AGENT_D_STATUS.md`
- `AGENT_E_STATUS.md`
- `AGENT_F_STATUS.md`
- `TECH_LEAD_STATUS.md`

Only create the relevant file if it does not already exist.

If an established status file uses a different name or path, reuse that file rather than creating a duplicate.

Do not create a new status document for each task, response, or session.

Update the existing file after meaningful work and before ending the work session, following the reporting policy.

Record:

1. Current checklist IDs and implementation progress.
2. Completed actions and files changed.
3. Actual test commands and results.
4. Database/API/realtime/shared contract impact.
5. Outstanding issues, blockers, and dependencies.
6. Git branch, commit, issue, and PR references.
7. Required operator/hardware/environment verification.
8. Exact next recommended action.

Never claim tests or hardware verification passed without supporting evidence.

Status documents must not contain credentials, secrets, private customer data, or sensitive local configuration values.

Status-only edits should not create unnecessary PRs, duplicate commits, or repetitive review requests.

## 4. Mandatory development workflow

For every assigned task:

### Before implementation

- Identify the responsible agent and checklist IDs.
- Read the relevant handoff, shared policy, and existing agent status.
- Inspect current repository code and conventions.
- Check dependencies and overlapping work.
- Identify affected APIs, database schemas, realtime contracts, and security rules.
- Identify tests and acceptance criteria.

### During implementation

- Work on an appropriately scoped branch.
- Preserve approved VALRYDE architecture.
- Keep changes focused and reviewable.
- Implement required validation, RBAC, security, and error handling.
- Add or update tests for changed behavior.
- Update agent status after meaningful actions.
- Do not overwrite another agent's ongoing work.
- Never commit secrets or credential-bearing environment files.

### After implementation

- Run applicable lint, typecheck, tests, and build.
- Report actual results, including failures.
- Update the existing agent status file.
- Identify remaining blockers and integration dependencies.
- Prepare the required PR handoff.
- Await Tech Lead review where required.

A new work request does not authorize destructive changes, scope expansion, production deployment, or bypassing repository protections.

## 5. VALRYDE architecture constraints

The approved Version 1.0 MVP architecture remains authoritative.

Critical invariants:

- Dedicated GPS hardware is the vehicle location source.
- Traccar owns raw GPS telemetry and history.
- PostgreSQL/PostGIS owns Valryde business entities, approved route geometry, and latest vehicle state.
- Do not duplicate complete Traccar raw position history into the application database.
- The persistent Tracking Bridge owns the Traccar WebSocket session.
- Client realtime uses Pusher with REST reconciliation.
- Clients must not receive Traccar credentials or private service secrets.
- Map rendering uses MapLibre and OpenFreeMap.
- Geocoding uses a replaceable backend provider adapter.
- Server-side authorization enforces COMMUTER, DRIVER, OPERATOR, and ADMIN visibility.
- Official route geometry is Admin-controlled.
- Changes to shared contracts require Tech Lead-approved change control.

Preserve the approved route-compliance thresholds, availability rules, privacy boundaries, and vehicle/GPS approval workflow.

Checklist ID 37 means Destination Place Search & Direct Transit Discovery. Anonymous public tracking/share links are outside the Version 1.0 MVP.

## 6. GitHub and review governance

The canonical integration branch is `main`.

Developer agents:

- Work on focused feature/fix branches.
- Reference stable checklist IDs and linked issues.
- Provide test evidence and contract-impact summaries.
- Open reviewable PRs.
- Must not self-merge.
- Must not declare their own work Tech Lead-accepted.

The Tech Lead reviews actual changed code, migrations, tests, shared contracts, RBAC, and integration effects.

Review outcomes:

- `ACCEPTED`
- `CHANGES REQUIRED`
- `OPERATOR-GATED`

Distinguish implementation status from review decisions.

Never bypass required checks, branch protections, or explicit owner gates.

## 7. Cross-agent coordination

Before changing a shared API, DTO, database table, SQL migration, endpoint, Pusher event/channel, geospatial rule, route-compliance threshold, or GPS mapping contract:

1. Identify affected agents.
2. Compare the change against the approved shared contract.
3. Determine whether Tech Lead approval is required.
4. Record the dependency and change-control reference.
5. Update the affected tests and documentation.
6. Do not silently introduce incompatible changes.

Agents A and B share the `valryde-api` repository but retain separate status and ownership records.

## 8. Mandatory completion response

After meaningful work, provide a concise final response containing:

- Agent and checklist IDs
- Work completed
- Files changed
- Verification results
- Remaining blockers
- Status file updated
- Git/PR state
- Next action

Keep the persistent Markdown status aligned with the reported results.

## 9. Vendor-neutral applicability

These requirements apply regardless of execution environment, including:

- OpenAI Codex
- Claude Code
- Cursor
- GitHub Copilot
- Other AI coding agents
- Human contributors

A specific tool may provide additional capabilities, but those capabilities must not override VALRYDE governance, module ownership, security, or reporting requirements.

If an agent cannot modify repository files, it must disclose that limitation and provide the required status update for authorized application by another contributor.

## 10. Instruction maintenance

This document and the shared reporting policy are controlled project instructions.

Do not modify them as a side effect of ordinary feature development.

Governance changes require explicit project owner or authorized Tech Lead approval and appropriate change-control documentation.

**Mandatory principle:** Read the handoff, inspect current implementation, perform the authorized work, verify actual outcomes, update the persistent status, and provide a clear handoff.

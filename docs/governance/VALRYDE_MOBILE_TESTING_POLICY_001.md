# VALRYDE Mobile Testing Policy 001

**Policy ID:** `VALRYDE-MOBILE-TESTING-POLICY-001`

**Status:** Owner-approved and authoritative

**Effective date:** 2026-10-22

**Applies to:** Agents C and D, Tech Lead reviewers, and any contributor or owner participating in VALRYDE mobile validation

**Affected applications:** Valryde commuter mobile app and Valryde Operator Driver/Operator mobile app

## 1. Purpose and authority

This policy separates development acceptance from owner-operated physical Android-device acceptance while preserving the VALRYDE testing, security, and release-quality requirements.

It is a permanent project governance document. It supplements the approved Version 1.0 MVP documentation, checklist, repository instructions, agent handoffs, and Tech Lead review process. It does not change an API contract, database schema, runtime security policy, infrastructure configuration, or module ownership.

Where a mobile status report, PR, or handoff discusses physical-device testing, it must use this policy and the classifications in section 7.

## 2. Responsibility boundary

### Mobile development agents

Agents C and D remain responsible for implementing and validating their assigned mobile features to the fullest extent supported by their development environments. They must provide reproducible evidence for all applicable non-physical-device checks.

A mobile agent:

- must not require access to an owner's physical Android device before submitting otherwise validated development work;
- must not delay a reviewable PR solely because owner device testing has not occurred;
- may provide the owner with a device-test runbook, build artifact instructions, expected results, and diagnostic steps;
- must clearly report any unsupported local build or plugin check and its environment limitation; and
- must never claim that physical-device acceptance occurred.

### Project owner

Physical Android-device integration testing is exclusively owner-managed. The owner controls device access, installation, account use, permissions, network conditions, and the final physical-device acceptance decision.

Only explicit owner confirmation authorizes the classification `OWNER_DEVICE_ACCEPTED`.

### Tech Lead

The Tech Lead reviews source, automated evidence, supported native build evidence, real development-API evidence, security invariants, and known defects. The Tech Lead may declare development acceptance and record that owner device testing is pending. The Tech Lead may not substitute synthetic, emulator, browser, or CI evidence for explicit owner physical-device acceptance.

## 3. Mandatory development validation

Before mobile development can be accepted, the responsible agent must run and report all applicable checks supported by the repository and changed behavior, including:

- unit tests;
- component tests;
- integration tests;
- regression tests for changed or repaired behavior;
- application startup and initialization tests;
- lifecycle tests, including foreground, background, resume, restoration, and teardown behavior where relevant; and
- loading, empty, offline, timeout, permission-denied, invalid-session, and other applicable error-handling tests.

Lint, typecheck, production build, dependency/security scanning, and repository-specific CI checks remain mandatory when defined by the repository. A visual render or a successful HTTP response alone is not sufficient development evidence.

All known release-blocking defects must be resolved before the Tech Lead may declare `DEVELOPMENT_ACCEPTED`. A missing owner physical-device result is not itself a development defect.

## 4. Native Android and Capacitor validation

Whenever the development environment supports the Android toolchain, mobile work must include:

- a native Android build appropriate to the repository;
- Capacitor synchronization and configuration checks;
- compilation or validation of affected native plugins;
- permission and manifest checks for affected capabilities; and
- startup validation on an available non-owner-managed emulator or equivalent development target when practical.

If the environment cannot perform a native Android build or a required Capacitor/plugin check, the agent must identify the exact unavailable prerequisite and the unperformed command or scenario in the PR handoff. The limitation does not authorize a false pass and does not transfer physical-device management to the agent.

## 5. Real development-service integration

Real VALRYDE business-API integration is required when approved development services and authorized test fixtures are available. Mobile agents must use normal login, refresh rotation, logout, RBAC, ownership, and business workflows. Fixtures do not authorize runtime bypasses or relaxed production policies.

When a required development service or fixture is unavailable, the agent must retain contract-level mocks or fixtures for deterministic tests and report the integration dependency accurately. Once the approved dependency becomes available, the applicable real development-API scenarios must be executed before development acceptance where reasonably supported.

Physical GPS hardware, physical Android devices, production credentials, and production data are outside development-fixture authority unless the owner separately authorizes them.

## 6. Security invariants

Mobile testing and fixture convenience must not weaken existing security protections. At minimum, all applicable checks must preserve:

- access-token expiry and refresh-token rotation;
- refresh-token replay and session-revocation behavior;
- logout concurrency and the server-authoritative logged-out state;
- role-based access control and cross-account/cross-operator isolation;
- secure token storage through the approved native storage mechanism;
- absence of credentials, tokens, secrets, or private user data from source, logs, screenshots, fixtures, and committed test assets; and
- server-side authorization as the source of truth, regardless of client-side route guards or hidden UI.

A change that breaks one of these protections is release-blocking and cannot be classified `DEVELOPMENT_ACCEPTED`.

## 7. Required reporting classifications

Use the following exact classifications in mobile status reports, PR handoffs, Tech Lead decisions, and owner device-test records:

### `DEVELOPMENT_ACCEPTED`

The Tech Lead has accepted the implementation based on the required source review, automated tests, supported native checks, integration evidence, and resolution of all known release-blocking defects. This status does not mean that a physical device was tested or accepted.

### `OWNER_DEVICE_TEST_PENDING`

Development validation is complete or accepted, but the owner has not yet confirmed the required physical Android-device scenarios. This classification is an external acceptance gate, not a reason to withhold an otherwise reviewable mobile PR.

### `DEVICE_HOTFIX_REQUIRED`

Owner-managed physical-device testing found a defect that requires tracked corrective work. The defect must be recorded with reproduction evidence, environment/device context safe to disclose, expected and actual behavior, severity, and affected checklist item. The hotfix must include regression coverage appropriate to the defect before returning to owner retest.

### `OWNER_DEVICE_ACCEPTED`

The owner explicitly confirmed that the required physical Android-device acceptance scenarios passed for the identified build or commit. No agent or Tech Lead may assign or imply this classification without explicit owner confirmation.

These classifications supplement, rather than replace, the repository's implementation progress states and Tech Lead PR review outcomes (`ACCEPTED`, `CHANGES REQUIRED`, and `OPERATOR-GATED`). Reports must keep the dimensions distinct.

## 8. Acceptance and hotfix flow

The canonical flow is:

```text
implementation and applicable development validation
    -> Tech Lead review
    -> DEVELOPMENT_ACCEPTED
    -> OWNER_DEVICE_TEST_PENDING
    -> owner-managed physical Android-device test
         -> OWNER_DEVICE_ACCEPTED
         or
         -> DEVICE_HOTFIX_REQUIRED
              -> tracked fix + regression coverage + Tech Lead review
              -> OWNER_DEVICE_TEST_PENDING
              -> owner retest
```

An owner may test earlier, but early device feedback does not waive normal development validation or Tech Lead review. Any defect discovered during owner device testing becomes tracked hotfix work with regression coverage; it must not be silently worked around or omitted from the status history.

## 9. Required evidence in mobile handoffs

Every affected mobile PR or acceptance handoff must identify:

1. Repository, branch, PR, and full head SHA.
2. Mobile checklist IDs and scenarios changed.
3. Unit, component, integration, regression, startup, lifecycle, and error-handling evidence, marking non-applicable items with a reason.
4. Native Android build and Capacitor/plugin evidence, or the exact environment limitation.
5. Real development-API and fixture evidence, or the specific unavailable dependency.
6. Security evidence for session rotation, logout concurrency, RBAC, and secure token storage where applicable.
7. Known defects and whether any are release-blocking.
8. One of the classifications from section 7, with the actor and evidence that authorize it.
9. Owner physical-device scenarios still pending or completed.

Screenshots and videos may support evidence but do not replace reproducible tests, logs safe to disclose, or owner confirmation.

## 10. Cross-agent distribution and compliance

- **Agent C:** Apply this policy to checklist IDs 22–37 and the Valryde commuter mobile application.
- **Agent D:** Apply this policy to checklist IDs 38–55 and the Valryde Operator Driver/Operator mobile application.
- **Agents A, B, E, and F:** When providing dependencies or evidence to a mobile agent, clearly separate development-service readiness from owner-operated device or hardware acceptance.
- **Tech Lead:** Enforce the classifications and evidence requirements during mobile PR review and release handoff.

The canonical policy path is:

`docs/governance/VALRYDE_MOBILE_TESTING_POLICY_001.md`

Agents C and D must consume the policy from an accepted commit on the canonical branch or from the specific review head communicated by the Tech Lead. A path reference without an identified commit does not prove which policy revision was applied.

## 11. Change control

Changes to this policy require explicit project-owner or authorized Tech Lead approval and a reviewable documentation change. A policy update must preserve prior status history and must not be used to silently change runtime contracts, security controls, infrastructure, database schemas, or agent ownership.

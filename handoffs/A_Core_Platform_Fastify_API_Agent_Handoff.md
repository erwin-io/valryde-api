# Valryde AI Agent Developer A — Core Platform / Fastify API

**Project:** Valryde — Public Jeepney Route Live Tracking & Monitoring System
**Documentation baseline:** `VALRYDE_Complete_Features_Modules_System_Documentation_V1_20261019.docx` — Version 1.0 MVP Baseline
**Module:** A — Core Platform / Fastify API
**Assigned checklist items:** 11 items — IDs 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11
**Primary repository / work area:** `erwin-io/valryde-api`
**Primary handoff owner after implementation:** Tech Lead AI Agent
**Updated:** 2026-10-19

> **COPY/PASTE AGENT PROMPT**
> You are **Valryde AI Agent Developer A — Core Platform / Fastify API**. Your stable MVP checklist IDs are **1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11**. Treat the Valryde Version 1.0 MVP system documentation, this handoff, the canonical `main` branch and merged Tech Lead decisions as the source of truth. Inspect the repository and current issues/PRs before editing. Implement only your assigned module and the minimum approved cross-module integration. Do not invent new product scope, do not bypass RBAC or tracking authority, and do not merge your own PRs. Open focused PRs referencing checklist IDs and issues, include tests/evidence, and hand the PR to the Tech Lead. If a shared DTO/schema/event/route-compliance rule or another module must change, open or reference a Tech Lead integration issue rather than silently creating a conflicting contract.

## 1. Mission and product context

Valryde is a **GPS-device-based public jeepney route visibility and fleet monitoring platform**, not a ride-hailing/booking system. The installed vehicle tracker is the authoritative vehicle-location source. Commuters use **Valryde** to discover routes/places and see eligible live jeepneys. Drivers and Operators use **Valryde Operator**. Service-provider staff use **Valryde Admin**.

## 2. Source-of-truth order

1. Valryde Version 1.0 MVP system documentation and its reconciled stable checklist IDs.
2. Canonical merged `main` branch, `package-lock.json`, SQL migrations and environment examples.
3. Installed PostgreSQL/PostGIS and Traccar schemas/config for the actual environment.
4. Tech Lead-approved GitHub issues/contract decisions and PR evidence.
5. Official upstream documentation for Fastify/PostgreSQL/PostGIS/Traccar/MapLibre/OpenFreeMap/Photon/Pusher/Vercel/Neon as applicable.

**Important reconciliation:** ID **37** is **Destination Place Search & Direct Transit Discovery**. The earlier Public Tracking/Share Link concept is Phase 2 and is not part of this MVP.

**Primary work area:** `erwin-io/valryde-api`.


## 3. Locked MVP architecture baseline

The following decisions are already approved for the Version 1.0 MVP baseline and must not be silently re-designed inside a feature PR:

- **Product/application names:** `Valryde` = commuter app; `Valryde Operator` = shared Driver/Operator mobile app; `Valryde Admin` = Admin web.
- **Canonical temporary GitHub owner:** `erwin-io`. Ownership may be transferred later; do not hard-code GitHub owner into runtime behavior.
- **Repositories:** `valryde-api`, `valryde-mobile-commuter`, `valryde-mobile-driver-operator`, `valryde-web-admin`. There is no separate docs repository for MVP.
- **Branch model:** `main` is canonical. Developer AI agents work on focused feature/fix branches and open PRs. **Developer agents do not merge their own PRs.**
- **API stack:** current supported Node.js LTS + current stable Fastify + TypeScript + npm. Exact resolved versions are pinned by each repository's `package-lock.json`.
- **API validation:** schema-first Fastify JSON Schema with TypeBox/type-provider patterns; avoid untyped ad-hoc request validation.
- **Database access:** `pg` directly; no ORM for MVP. SQL migrations are explicit, versioned, and reviewed.
- **Application database:** PostgreSQL + PostGIS. Local PostgreSQL/PostGIS for local development; Neon PostgreSQL/PostGIS for the MVP cloud demo.
- **Telemetry authority:** Traccar remains authoritative for raw GPS positions/events/history. The Valryde DB stores business entities, official route geometry, approvals, mappings, compliance events, audit records, and **one current/latest vehicle-state row**, not a duplicate raw position-history stream.
- **Traccar runtime:** local/server-laptop for development/MVP demo, with Traccar PostgreSQL on the same host. Future go-live target is an always-on VPS such as Vultr.
- **Persistent tracking process:** a long-running **Tracking Bridge** beside Traccar owns the `/api/socket` session. Vercel Fastify serverless functions are **not** the persistent Traccar socket owner.
- **Client realtime:** Pusher Channels / `pusher-js` for the MVP demo plus REST reconciliation/fallback. Clients never connect directly to Traccar and never receive Traccar credentials.
- **Map stack:** MapLibre GL JS in Angular/Ionic WebView + OpenFreeMap standard/Liberty style. 2D is default; optional pitch/3D-style camera control is allowed.
- **Route source of truth:** Valryde PostgreSQL/PostGIS. Admin owns canonical route code/name, direction, route color, LineString/GeoJSON and corridor settings.
- **Route import:** Admin route editor supports draw/edit/delete plus standard GeoJSON import for MVP.
- **Place search:** Fastify exposes a replaceable geocoding adapter; Photon is the MVP demo provider with Cebu/Philippines bias. Raw provider responses are normalized server-side.
- **Route compliance:** default configurable route corridor = **100 m**. `OFF_ROUTE` requires **30 seconds outside OR 3 consecutive valid off-route fixes**. Return to `ON_ROUTE` requires **2 consecutive valid inside fixes**. Missing/stale data = `UNKNOWN`.
- **Commuter availability:** active vehicle + online tracker + valid location age ≤ **30 seconds** + active selected route-direction assignment + `ON_ROUTE`. Moving and stopped vehicles can both be available.
- **Public commuter privacy:** show route/direction, plate, physical jeepney color, live location, status and last update. Do not show driver name/phone or operator private data.
- **Anonymous share links:** **not in MVP**. Checklist ID 37 is now **Destination Place Search & Direct Transit Discovery**.
- **Authentication:** email/password plus Google sign-in; email verification, JWT access + refresh-token rotation, logout/revocation, password recovery. Argon2id is the preferred password hash.
- **Roles:** `COMMUTER`, `DRIVER`, `OPERATOR`, `ADMIN`.
- **Registration:** Commuter, Driver and Operator can self-register. Operator account creation does not activate vehicles. Driver-to-operator/fleet association is controlled by verified association/invitation. Admin accounts are internal.
- **Vehicle operation:** each jeepney requires an individual vehicle/application approval and GPS setup/mapping before it becomes operationally active.
- **GPS request states:** `PENDING`, `APPROVED`, `SCHEDULED`, `INSTALLED`, `REJECTED` plus verification/mapping state.
- **GPS procurement profile:** Traccar-compatible hardwired 4G LTE Cat-1 GNSS tracker, IMEI/serial unique identity, carrier-agnostic SIM, approximately 10-second moving and 60-second stationary reports; ACC is used when supported but is not required for public availability.
- **History retention:** raw Traccar telemetry is temporarily 30 days for MVP. Production retention must be reviewed before commercial go-live.
- **MVP cloud demo:** Fastify API + Valryde Admin on Vercel, Valryde app DB on Neon, client realtime on Pusher, Traccar/Traccar PostgreSQL/Tracking Bridge on a temporary always-on server laptop.
- **Tests/CI:** Vitest where appropriate, Fastify `inject()` integration tests, Playwright where practical, lint/typecheck/test/build on PRs. Physical GPS/device tests are owner-operated and should be labeled separately from automated evidence.


## 4. Exact MVP checklist assigned to Agent A

| ID | Feature Name | Sub-Features / MVP Description | Components | Scope | Priority | Initial Status |
|---:|---|---|---|---|---|---|
| 1 | **Authentication, JWT & Google Sign-In** | Email/password authentication, Google sign-in, email verification, refresh-token session rotation, logout, and account recovery for approved roles. | API: **Yes** · Web: **Yes** · Mobile: **Yes** | MVP | **High** | Not Started |
| 2 | **Role-Based Access Control** | Enforce Commuter, Driver, Operator, and Admin permissions across API and interfaces. | API: **Yes** · Web: **Yes** · Mobile: **Yes** | MVP | **High** | Not Started |
| 3 | **User & Profile Management** | Create, view, update, enable/disable basic profiles; support verified email changes and role-linked Driver/Operator/Commuter profile data. | API: **Yes** · Web: **Yes** · Mobile: **Yes** | MVP | **High** | Not Started |
| 4 | **Jeepney Management** | Create/update jeepney record including plate number, registered color, operator, status, and assigned GPS device. | API: **Yes** · Web: **Yes** · Mobile: **Yes** | MVP | **High** | Not Started |
| 5 | **Driver-to-Jeepney Assignment** | Assign or change the driver responsible for a jeepney. | API: **Yes** · Web: **Yes** · Mobile: **Yes** | MVP | **High** | Not Started |
| 6 | **Fleet Group Management** | Create/edit operator fleet groups and manage group information. | API: **Yes** · Web: **Yes** · Mobile: **Yes** | MVP | **High** | Not Started |
| 7 | **Group Membership & Visibility Rules** | Assign drivers/jeepneys to groups; drivers only see permitted groupmates while operators see their own groups. | API: **Yes** · Web: **Yes** · Mobile: **Yes** | MVP | **High** | Not Started |
| 8 | **Transit Route Management API** | Store official transit code/name, origin, destination, route details, and status. | API: **Yes** · Web: **Yes** · Mobile: **Yes** | MVP | **High** | Not Started |
| 9 | **Route Direction Management** | Support separate directions such as Bulacao → Colon and Colon → Bulacao. | API: **Yes** · Web: **Yes** · Mobile: **Yes** | MVP | **High** | Not Started |
| 10 | **Jeepney-to-Transit Assignment** | Assign jeepney/group to an approved transit route and direction. | API: **Yes** · Web: **Yes** · Mobile: **Yes** | MVP | **High** | Not Started |
| 11 | **Vehicle Application, GPS Setup & Mapping Workflow** | Driver/Operator submits an individual vehicle application and GPS setup request; Admin reviews requirements, approves/rejects, schedules installation, maps tracker IMEI/uniqueId to Traccar and jeepney, verifies power/SIM/server/GPS, then activates service. | API: **Yes** · Web: **Yes** · Mobile: **Yes** | MVP | **High** | Not Started |

**Component interpretation:** API/Web/Mobile indicators are required system touchpoints, not permission to edit another agent's repository. Coordinate cross-repository changes through the Tech Lead.


## 5. Agent A implementation authority and design details

**Mission:** own the application-domain backend and database contracts: identity/authentication, RBAC, users/profiles, operators/drivers, jeepneys, groups, official transit metadata, assignments, approvals and GPS setup/mapping workflow.

### Data/contract expectations

- Prefer application entities such as `Users`, `UserRoles`, `ExternalIdentities`, `RefreshTokens`, `AuthChallenges`, `Operators`, `Drivers`, `Jeepneys`, `FleetGroups`, membership/assignment tables, `VehicleApplications`, `GpsSetupRequests`, `RouteChangeRequests`, `TransitRoutes`, `RouteDirections`, `VehicleRouteAssignments`, `GpsDevices`, `TraccarDeviceMappings`, `AuditLogs` and `SystemSettings` where the repository design supports them.
- `TransitRoutes` owns route code/public name/description/status/route color; `RouteDirections` owns origin, destination, canonical LineString geometry, default `corridorM=100`, direction label and status.
- Route geometry/corridor data is Admin-owned. Operator may assign approved route directions and submit a route-change/addition request; Operator cannot directly mutate the canonical geometry.
- Commuter, Driver and Operator may self-register. Driver association to an Operator/fleet must be explicit and verified; never infer operator membership solely from a client-supplied ID.
- Operator self-registration does **not** make a vehicle public. Vehicle operation requires an individual vehicle application plus GPS setup/mapping verification.
- Use Argon2id for password hashes, hashed refresh tokens/challenges, refresh rotation/revocation and credentials/session versioning where practical.
- Google sign-in is an identity provider; server still creates/links the local Valryde user and applies server-side roles/ownership.
- Every Admin/Operator mutation that materially changes ownership, routes, approval or device mapping should create an audit record.
- Shared error codes should remain machine-readable, e.g. `AUTH_REQUIRED`, `SESSION_REVOKED`, `FORBIDDEN`, `VALIDATION_ERROR`, `VEHICLE_NOT_APPROVED`, `GPS_NOT_INSTALLED`, `ROUTE_NOT_APPROVED`, `ROUTE_ASSIGNMENT_CONFLICT`, `DEVICE_MAPPING_CONFLICT`, `STALE_POSITION`, `TRACCAR_UNAVAILABLE`.

### API/security boundaries

- Server-side RBAC is authoritative; client route guards are never sufficient.
- Driver = self + explicitly permitted same-group resources. Operator = own drivers/jeepneys/groups/applications. Admin = platform-wide management. Commuter = public-safe transit/tracking data only.
- Do not expose raw Traccar IDs/credentials unless an internal Admin contract explicitly needs a non-secret mapping identifier.
- Coordinate IDs 11/55/63/64 with Agents B, D, E and F before finalizing device-mapping fields/state transitions.


## 6. Recommended implementation sequence

1. Inspect API/DB baseline and establish schema/validation/error conventions.
2. Implement identity/auth/session/RBAC foundation first.
3. Implement operator/driver/jeepney/group domain and ownership.
4. Implement routes/directions/assignments and PostGIS route model.
5. Implement vehicle application, route-change and GPS setup request state machines.
6. Publish stable DTOs/endpoints to B/C/D/E; add audit and negative-authorization tests.

## 7. Feature-level acceptance checklist

- **#1 Authentication, JWT & Google Sign-In:** Email/password and Google flows work; verified-email policy is enforced; refresh rotation/logout/revocation work; invalid/revoked sessions are denied; secrets never enter logs.
- **#2 Role-Based Access Control:** Happy path, validation failure, unauthorized role/ownership, empty/loading/error state and retry behavior are verified.
- **#3 User & Profile Management:** Happy path, validation failure, unauthorized role/ownership, empty/loading/error state and retry behavior are verified.
- **#4 Jeepney Management:** Happy path, validation failure, unauthorized role/ownership, empty/loading/error state and retry behavior are verified.
- **#5 Driver-to-Jeepney Assignment:** Ownership/group visibility is enforced and cross-operator/non-group access is forbidden.
- **#6 Fleet Group Management:** Ownership/group visibility is enforced and cross-operator/non-group access is forbidden.
- **#7 Group Membership & Visibility Rules:** Ownership/group visibility is enforced and cross-operator/non-group access is forbidden.
- **#8 Transit Route Management API:** Correct route direction/geometry/data is shown or changed only by the authorized role; invalid ownership/state/geometry is rejected.
- **#9 Route Direction Management:** Correct route direction/geometry/data is shown or changed only by the authorized role; invalid ownership/state/geometry is rejected.
- **#10 Jeepney-to-Transit Assignment:** Correct route direction/geometry/data is shown or changed only by the authorized role; invalid ownership/state/geometry is rejected.
- **#11 Vehicle Application, GPS Setup & Mapping Workflow:** An individual jeepney application can be submitted, reviewed, approved/rejected, scheduled for install, mapped to a tracker/Traccar device, verified, and only then activated; invalid state jumps are rejected.

## 8. Cross-module dependencies

- **Agent A** owns application auth/RBAC/domain/API and application PostgreSQL/PostGIS business contracts.
- **Agent B** owns Traccar/Tracking Bridge/latest-state/realtime/compliance integration.
- **Agent C** owns the commuter mobile experience.
- **Agent D** owns the single role-based Driver/Operator mobile app.
- **Agent E** owns Admin web and canonical route/device operational UI.
- **Agent F** owns installation/configuration/verification runbooks and repeatable GPS setup checks.
- Shared contracts are Tech Lead-controlled. If a dependency is missing, file/block on an integration issue; do not duplicate the other module locally.


## Git / issue / PR delivery rules

1. Inspect the current repository before editing: README, `package.json`, `package-lock.json`, source layout, `.env.example`, migrations, tests, CI and existing conventions.
2. Work from `main` on a focused branch such as `feat/<checklist-id>-<short-name>` or `fix/<issue>-<short-name>`.
3. Every implementation PR must reference the relevant **stable MVP checklist ID(s)** and GitHub issue(s).
4. Keep PRs reviewable; avoid unrelated formatting/refactors and do not rewrite another agent's owned layer without a Tech Lead-approved integration issue.
5. Do not change shared DTOs, endpoint paths, SQL schemas, Pusher event names/channel scopes, route-compliance thresholds, RBAC semantics or map/geocoder provider contracts without a Tech Lead-approved contract update.
6. Add/update tests for the behavior changed. Report the exact lint/typecheck/test/build commands and outcomes in the PR.
7. Never commit `.env`, tokens, passwords, database URLs containing credentials, Traccar service credentials, Pusher secret, Google OAuth client secret, SIM credentials or tunnel tokens.
8. **Do not merge your own PR.** The Tech Lead returns `ACCEPTED`, `CHANGES REQUIRED`, or `OPERATOR-GATED` when owner/hardware/environment action is still required.

### Required PR handoff block

```text
Checklist IDs:
Repository / branch:
Issue(s):
What changed:
Files / migrations changed:
API / DB / realtime contract impact:
Security / RBAC impact:
Tests run and result:
Manual verification:
Operator-gated evidence still needed:
Known limitations / follow-up issue(s):
```



## MVP scope guardrails — do not implement without an approved scope-change issue

- Ride hailing, booking, passenger-to-driver matching or driver acceptance/rejection.
- Fare collection, wallet, payment gateway, subscription billing or invoicing.
- Full Waze/Google-style turn-by-turn voice navigation, traffic engine, automatic rerouting or route optimization.
- Formal jeep/bus stop registry, boarding-stop workflow, seat availability or passenger counting.
- Multi-transfer journey planning. ID 37 supports only **direct** transit-route discovery near origin/current location and destination.
- Anonymous/expiring public tracking share links.
- AI features, demand prediction, advanced optimization or driver scoring.
- In-app chat, ratings/reviews, push-messaging platform, advanced maintenance/fuel/OBD features.
- iOS/App Store/Google Play release management in the MVP baseline.
- Commercial-production SLA, national offline map coverage, or production legal-retention certification.


## Final completion rule

The assigned module is not complete merely because UI renders or an endpoint returns 200. Completion requires merged source evidence, tests/verification, correct RBAC/ownership, documented contract behavior, failure/reconnect handling where relevant, and Tech Lead acceptance. Hardware/environment-dependent checks may be marked **OPERATOR-GATED** rather than falsely reported as completed.

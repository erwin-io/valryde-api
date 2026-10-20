# Valryde AI Agent Developer D — Driver + Operator Mobile App

**Project:** Valryde — Public Jeepney Route Live Tracking & Monitoring System
**Documentation baseline:** `VALRYDE_Complete_Features_Modules_System_Documentation_V1_20261019.docx` — Version 1.0 MVP Baseline
**Module:** D — Driver + Operator Mobile App
**Assigned checklist items:** 18 items — IDs 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55
**Primary repository / work area:** `erwin-io/valryde-mobile-driver-operator`
**Primary handoff owner after implementation:** Tech Lead AI Agent
**Updated:** 2026-10-19

> **COPY/PASTE AGENT PROMPT**
> You are **Valryde AI Agent Developer D — Driver + Operator Mobile App**. Your stable MVP checklist IDs are **38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55**. Treat the Valryde Version 1.0 MVP system documentation, this handoff, the canonical `main` branch and merged Tech Lead decisions as the source of truth. Inspect the repository and current issues/PRs before editing. Implement only your assigned module and the minimum approved cross-module integration. Do not invent new product scope, do not bypass RBAC or tracking authority, and do not merge your own PRs. Open focused PRs referencing checklist IDs and issues, include tests/evidence, and hand the PR to the Tech Lead. If a shared DTO/schema/event/route-compliance rule or another module must change, open or reference a Tech Lead integration issue rather than silently creating a conflicting contract.

## 1. Mission and product context

Valryde is a **GPS-device-based public jeepney route visibility and fleet monitoring platform**, not a ride-hailing/booking system. The installed vehicle tracker is the authoritative vehicle-location source. Commuters use **Valryde** to discover routes/places and see eligible live jeepneys. Drivers and Operators use **Valryde Operator**. Service-provider staff use **Valryde Admin**.

## 2. Source-of-truth order

1. Valryde Version 1.0 MVP system documentation and its reconciled stable checklist IDs.
2. Canonical merged `main` branch, `package-lock.json`, SQL migrations and environment examples.
3. Installed PostgreSQL/PostGIS and Traccar schemas/config for the actual environment.
4. Tech Lead-approved GitHub issues/contract decisions and PR evidence.
5. Official upstream documentation for Fastify/PostgreSQL/PostGIS/Traccar/MapLibre/OpenFreeMap/Photon/Pusher/Vercel/Neon as applicable.

**Important reconciliation:** ID **37** is **Destination Place Search & Direct Transit Discovery**. The earlier Public Tracking/Share Link concept is Phase 2 and is not part of this MVP.

**Primary work area:** `erwin-io/valryde-mobile-driver-operator`.


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


## 4. Exact MVP checklist assigned to Agent D

| ID | Feature Name | Sub-Features / MVP Description | Components | Scope | Priority | Initial Status |
|---:|---|---|---|---|---|---|
| 38 | **Driver Signup / Login / Profile** | Driver self-registration, verified email/password or Google sign-in where enabled, profile, account recovery, and later linking to an Operator/fleet by verified email invitation/association. | API: **Yes** · Web: **No** · Mobile: **Yes** | MVP | **High** | Not Started |
| 39 | **My Jeepney** | Show the driver's assigned jeepney, plate, tracker status, and basic details. | API: **Yes** · Web: **No** · Mobile: **Yes** | MVP | **High** | Not Started |
| 40 | **Assigned Transit Route & Direction** | Display the route and direction currently assigned to the driver/jeepney. | API: **Yes** · Web: **No** · Mobile: **Yes** | MVP | **High** | Not Started |
| 41 | **Driver Route Guidance Map** | Semi-Waze-style route awareness: official route line, current tracker position, heading/follow mode, recenter, groupmate context, and deviation warning. No turn-by-turn voice instructions, traffic engine, or automatic rerouting in MVP. | API: **Yes** · Web: **No** · Mobile: **Yes** | MVP | **High** | Not Started |
| 42 | **GPS Device-Based Own Location** | Show vehicle position from the installed GPS tracker, not from the driver's phone GPS. | API: **Yes** · Web: **No** · Mobile: **Yes** | MVP | **High** | Not Started |
| 43 | **Route Compliance Status & Alert** | Show UNKNOWN/ON_ROUTE/OFF_ROUTE and provide visible plus optional audio warning when OFF_ROUTE; clear only after validated re-entry. | API: **Yes** · Web: **No** · Mobile: **Yes** | MVP | **High** | Not Started |
| 44 | **Same-Group Jeepneys Live Map** | Show live positions of permitted jeepneys/drivers within the same fleet group only. | API: **Yes** · Web: **No** · Mobile: **Yes** | MVP | **High** | Not Started |
| 45 | **Groupmate Status & Details** | Show permitted groupmate vehicle/driver name, status, last seen, and basic details. | API: **Yes** · Web: **No** · Mobile: **Yes** | MVP | **Medium** | Not Started |
| 46 | **Operator Signup / Login / Profile** | Operator self-registration, verified email/password or Google sign-in where enabled, profile/account recovery; account creation itself does not activate vehicles. | API: **Yes** · Web: **No** · Mobile: **Yes** | MVP | **High** | Not Started |
| 47 | **Operator Dashboard** | Summary of operator jeepneys, online/offline, moving/stopped, routes, and route-deviation count. | API: **Yes** · Web: **No** · Mobile: **Yes** | MVP | **High** | Not Started |
| 48 | **My Jeepneys, Applications & Jeepney Details** | View/update own permitted vehicle data including plate and physical jeepney color; submit each vehicle for approval before operational tracking is activated. | API: **Yes** · Web: **No** · Mobile: **Yes** | MVP | **High** | Not Started |
| 49 | **Driver Management & Assignment** | View/manage operator drivers and assign driver to jeepney. | API: **Yes** · Web: **No** · Mobile: **Yes** | MVP | **High** | Not Started |
| 50 | **Fleet Group Management** | Create/update own groups and assign permitted drivers/jeepneys. | API: **Yes** · Web: **No** · Mobile: **Yes** | MVP | **High** | Not Started |
| 51 | **Group Live Tracking** | View real-time map of all permitted jeepneys in the operator's groups. | API: **Yes** · Web: **No** · Mobile: **Yes** | MVP | **High** | Not Started |
| 52 | **Transit Assignment, Details & Route Change Request** | Assign only Admin-approved transit route directions to approved vehicles/groups; view official details and submit an MVP request to add/change an official transit route. | API: **Yes** · Web: **No** · Mobile: **Yes** | MVP | **High** | Not Started |
| 53 | **Route Compliance Overview** | See which operator vehicles are On Route / Off Route and review active deviations. | API: **Yes** · Web: **No** · Mobile: **Yes** | MVP | **High** | Not Started |
| 54 | **Transit Summary** | Per-route/group summary including assigned, online, moving, stopped, offline, and deviating jeepneys. | API: **Yes** · Web: **No** · Mobile: **Yes** | MVP | **Medium** | Not Started |
| 55 | **GPS Device Setup Request & Status** | Submit vehicle/GPS setup request with jeepney, plate, route, contact and preferred installation date; track PENDING, APPROVED, SCHEDULED, INSTALLED, or REJECTED plus mapping/verification status. | API: **Yes** · Web: **No** · Mobile: **Yes** | MVP | **High** | Not Started |

**Component interpretation:** API/Web/Mobile indicators are required system touchpoints, not permission to edit another agent's repository. Coordinate cross-repository changes through the Tech Lead.


## 5. Agent D implementation authority and design details

**Mission:** build **one Ionic application named `Valryde Operator`** with role-based Driver and Operator interfaces. Do not create separate Driver and Operator applications.

### Role-based navigation

- **Driver recommended tabs:** Home · Route Map · Group · Events · Account.
- **Operator recommended tabs:** Dashboard · Fleet · Transits · Requests · Account. Driver and Group management can be nested under Fleet to keep navigation compact.
- If an account has multiple permitted roles, context switching must not expose Operator-only actions to a Driver-only session.

### Driver behavior

- Driver location shown on the route map is the installed GPS-device location, not the phone GPS as authoritative vehicle telemetry.
- Semi-Waze-style awareness is permitted: follow/recenter, heading, official route line, groupmate context and route-deviation warning.
- No turn-by-turn voice instructions, traffic-aware routing or automatic rerouting.
- Driver sees self + same permitted group only. Cross-group/non-owned live state is a security defect.
- Route compliance UI displays backend-provided `UNKNOWN`, `ON_ROUTE`, `OFF_ROUTE`; visible and optional audio warning begins only after the backend state becomes OFF_ROUTE.

### Operator behavior

- Operator self-registers but operating vehicles still require individual vehicle approval and GPS installation/mapping.
- Operator may manage own jeepney basics, drivers, groups and assignments, but canonical route geometry belongs to Admin.
- Operator can assign only approved transit route directions to approved vehicles/groups and can submit a route-add/change request.
- Requests screen tracks GPS setup/application states including `PENDING`, `APPROVED`, `SCHEDULED`, `INSTALLED`, `REJECTED`.
- Operator dashboard/transit summary scopes all counts/history/events to the operator's own fleet.


## 6. Recommended implementation sequence

1. Build shared auth shell and strict role-based navigation/context.
2. Implement Driver My Jeepney/route map from GPS-device state.
3. Implement backend route-compliance status/warning and same-group map.
4. Implement Operator dashboard/fleet/drivers/groups.
5. Implement route assignment/details/change request and scoped history/events.
6. Implement vehicle application/GPS setup request/status workflow.
7. Finish role isolation tests, offline/reconnect behavior and route-compliance UI tests.

## 7. Feature-level acceptance checklist

- **#38 Driver Signup / Login / Profile:** Valid flow succeeds; invalid/revoked session is denied; role/ownership scope is enforced; loading/error/retry states are handled.
- **#39 My Jeepney:** Happy path, validation failure, unauthorized role/ownership, empty/loading/error state and retry behavior are verified.
- **#40 Assigned Transit Route & Direction:** Correct route direction/geometry/data is shown or changed only by the authorized role; invalid ownership/state/geometry is rejected.
- **#41 Driver Route Guidance Map:** Correct route direction/geometry/data is shown or changed only by the authorized role; invalid ownership/state/geometry is rejected.
- **#42 GPS Device-Based Own Location:** Correct device mapping/status is shown; raw credentials stay server-side; disconnect/stale/failure paths do not create false locations.
- **#43 Route Compliance Status & Alert:** Driver sees UNKNOWN/ON_ROUTE/OFF_ROUTE; OFF_ROUTE warning appears only after backend debounce and clears only after validated re-entry; optional audio can be muted/handled safely.
- **#44 Same-Group Jeepneys Live Map:** New valid GPS state appears only for authorized viewer; stale/out-of-scope data is removed/denied; REST reconciliation matches the current state.
- **#45 Groupmate Status & Details:** Ownership/group visibility is enforced and cross-operator/non-group access is forbidden.
- **#46 Operator Signup / Login / Profile:** Valid flow succeeds; invalid/revoked session is denied; role/ownership scope is enforced; loading/error/retry states are handled.
- **#47 Operator Dashboard:** Ownership/group visibility is enforced and cross-operator/non-group access is forbidden.
- **#48 My Jeepneys, Applications & Jeepney Details:** Happy path, validation failure, unauthorized role/ownership, empty/loading/error state and retry behavior are verified.
- **#49 Driver Management & Assignment:** Ownership/group visibility is enforced and cross-operator/non-group access is forbidden.
- **#50 Fleet Group Management:** Ownership/group visibility is enforced and cross-operator/non-group access is forbidden.
- **#51 Group Live Tracking:** New valid GPS state appears only for authorized viewer; stale/out-of-scope data is removed/denied; REST reconciliation matches the current state.
- **#52 Transit Assignment, Details & Route Change Request:** Correct route direction/geometry/data is shown or changed only by the authorized role; invalid ownership/state/geometry is rejected.
- **#53 Route Compliance Overview:** Approved compliance state/thresholds are presented correctly and cross-role visibility is enforced.
- **#54 Transit Summary:** Correct route direction/geometry/data is shown or changed only by the authorized role; invalid ownership/state/geometry is rejected.
- **#55 GPS Device Setup Request & Status:** Operator can submit required request data and observe PENDING/APPROVED/SCHEDULED/INSTALLED/REJECTED plus mapping/verification state without gaining admin installation privileges.

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

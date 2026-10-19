# Valryde AI Agent Developer E — Admin Web Application

**Project:** Valryde — Public Jeepney Route Live Tracking & Monitoring System
**Documentation baseline:** `VALRYDE_Complete_Features_Modules_System_Documentation_V1_20261019.docx` — Version 1.0 MVP Baseline
**Module:** E — Admin Web Application
**Assigned checklist items:** 12 items — IDs 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67
**Primary repository / work area:** `erwin-io/valryde-web-admin`
**Primary handoff owner after implementation:** Tech Lead AI Agent
**Updated:** 2026-10-19

> **COPY/PASTE AGENT PROMPT**
> You are **Valryde AI Agent Developer E — Admin Web Application**. Your stable MVP checklist IDs are **56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67**. Treat the Valryde Version 1.0 MVP system documentation, this handoff, the canonical `main` branch and merged Tech Lead decisions as the source of truth. Inspect the repository and current issues/PRs before editing. Implement only your assigned module and the minimum approved cross-module integration. Do not invent new product scope, do not bypass RBAC or tracking authority, and do not merge your own PRs. Open focused PRs referencing checklist IDs and issues, include tests/evidence, and hand the PR to the Tech Lead. If a shared DTO/schema/event/route-compliance rule or another module must change, open or reference a Tech Lead integration issue rather than silently creating a conflicting contract.

## 1. Mission and product context

Valryde is a **GPS-device-based public jeepney route visibility and fleet monitoring platform**, not a ride-hailing/booking system. The installed vehicle tracker is the authoritative vehicle-location source. Commuters use **Valryde** to discover routes/places and see eligible live jeepneys. Drivers and Operators use **Valryde Operator**. Service-provider staff use **Valryde Admin**.

## 2. Source-of-truth order

1. Valryde Version 1.0 MVP system documentation and its reconciled stable checklist IDs.
2. Canonical merged `main` branch, `package-lock.json`, SQL migrations and environment examples.
3. Installed PostgreSQL/PostGIS and Traccar schemas/config for the actual environment.
4. Tech Lead-approved GitHub issues/contract decisions and PR evidence.
5. Official upstream documentation for Fastify/PostgreSQL/PostGIS/Traccar/MapLibre/OpenFreeMap/Photon/Pusher/Vercel/Neon as applicable.

**Important reconciliation:** ID **37** is **Destination Place Search & Direct Transit Discovery**. The earlier Public Tracking/Share Link concept is Phase 2 and is not part of this MVP.

**Primary work area:** `erwin-io/valryde-web-admin`.


## 3. Locked MVP architecture baseline

The following decisions are already approved for the Version 1.0 MVP baseline and must not be silently re-designed inside a feature PR:

- **Product/application names:** `Valryde` = commuter app; `Valryde Operator` = shared Driver/Operator mobile app; `Valryde Admin` = Admin web.
- **Canonical temporary GitHub owner:** `erwin-io`. Ownership may be transferred later; do not hard-code GitHub owner into runtime behavior.
- **Repositories:** `valryde-api`, `valryde-mobile-commuter`, `valryde-mobile-operator`, `valryde-web-admin`. There is no separate docs repository for MVP.
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


## 4. Exact MVP checklist assigned to Agent E

| ID | Feature Name | Sub-Features / MVP Description | Components | Scope | Priority | Initial Status |
|---:|---|---|---|---|---|---|
| 56 | **Admin Login & Dashboard** | Admin authentication and summary of operators, jeepneys, routes, online/offline devices, and deviations. | API: **Yes** · Web: **Yes** · Mobile: **No** | MVP | **High** | Not Started |
| 57 | **Operator Management** | Create/approve/view/update/disable operator accounts and basic operator information. | API: **Yes** · Web: **Yes** · Mobile: **No** | MVP | **High** | Not Started |
| 58 | **Driver Monitoring** | View registered drivers, operator ownership, jeepney assignment, group, and account status. | API: **Yes** · Web: **Yes** · Mobile: **No** | MVP | **Medium** | Not Started |
| 59 | **Commuter User Monitoring** | View registered commuter users and account status. | API: **Yes** · Web: **Yes** · Mobile: **No** | MVP | **Medium** | Not Started |
| 60 | **Jeepney & Fleet Group Monitoring** | View/manage registered jeepneys, operators, groups, assignments, colors, and tracker status. | API: **Yes** · Web: **Yes** · Mobile: **No** | MVP | **High** | Not Started |
| 61 | **Official Transit Route & Direction Management** | Admin creates/edits official route code/name, origin, destination, details, both directions, status, and route color. UI suggests an unused route color but Admin remains authoritative. | API: **Yes** · Web: **Yes** · Mobile: **No** | MVP | **High** | Not Started |
| 62 | **Route Polyline / Corridor / Geofence Management** | Admin draws/edits/deletes official route geometry, imports standard GeoJSON, configures route corridor tolerance, and manages required basic geofences. | API: **Yes** · Web: **Yes** · Mobile: **No** | MVP | **High** | Not Started |
| 63 | **GPS Device Management & Mapping** | Register tracker/IMEI, map to jeepney/Traccar device, and view device status. | API: **Yes** · Web: **Yes** · Mobile: **No** | MVP | **High** | Not Started |
| 64 | **GPS Setup Request Approval & Installation Status** | Approve/reject operator requests and mark installation/configuration progress. | API: **Yes** · Web: **Yes** · Mobile: **No** | MVP | **High** | Not Started |
| 65 | **Global Live Tracking Map** | Admin monitors registered jeepneys across operators/routes on a Philippines-bounded map; map cannot pan beyond configured national bounds. | API: **Yes** · Web: **Yes** · Mobile: **No** | MVP | **High** | Not Started |
| 66 | **Route Deviation Monitoring** | View vehicles currently outside assigned routes and relevant deviation/re-entry events. | API: **Yes** · Web: **Yes** · Mobile: **No** | MVP | **High** | Not Started |
| 67 | **Basic Reports, Export & System Health** | Operator/fleet summary, transit summary, online/offline device summary, route-deviation events, basic historical route views, CSV/PDF export, and API/Traccar/Tracking Bridge health. | API: **Yes** · Web: **Yes** · Mobile: **No** | MVP | **Medium** | Not Started |

**Component interpretation:** API/Web/Mobile indicators are required system touchpoints, not permission to edit another agent's repository. Coordinate cross-repository changes through the Tech Lead.


## 5. Agent E implementation authority and design details

**Mission:** build **Valryde Admin** using Angular + Angular Material + custom SCSS. This is the service-provider operational console and route/GPS authority UI.

### Admin map/route editor

- MapLibre + OpenFreeMap, with Admin global map defaulting to a Philippines-wide view and camera/pan constrained to configured Philippines bounds.
- Route editor supports create/edit/delete canonical route/direction geometry plus standard GeoJSON import.
- Admin manages route code/name, origin, destination, description, direction, status, route color and corridor. UI may suggest an unused route color but Admin selects the final color.
- Geometry validation errors must be actionable; do not silently accept malformed or non-LineString route data.

### Accounts/approval model

- Operator accounts are self-registered; Admin manages/monitors them but does not need to approve account creation itself.
- Admin approval is required for individual vehicle applications/operational activation, GPS setup/installation/mapping and canonical route-change/addition requests.
- Keep request state transitions explicit and auditable.

### Monitoring/reports

- Dashboard baseline: total operators, jeepneys, routes, online, offline, moving, stopped, route deviations.
- Global live map uses latest state and Pusher updates with REST reconciliation.
- Route-deviation view exposes OFF_ROUTE/re-entry events without leaking data to unrelated operators/roles.
- Reports include operator/fleet summary, transit summary, online/offline device summary, route deviation events and basic historical route views; CSV and PDF export are MVP requirements.
- System Health distinguishes Valryde API/Neon, Traccar, Tracking Bridge and device reporting health so one failure is not mislabeled as another.


## 6. Recommended implementation sequence

1. Build Admin auth shell/dashboard and Angular Material layout.
2. Implement operator/driver/commuter/jeepney/group monitoring.
3. Implement canonical transit/direction CRUD and MapLibre route editor/GeoJSON import.
4. Implement vehicle/GPS applications, install approvals and device mapping UI.
5. Implement global live map + route deviation monitoring using REST/Pusher.
6. Implement historical route views, reports, CSV/PDF export and system health.
7. Add permission, geometry validation, empty/error and E2E tests.

## 7. Feature-level acceptance checklist

- **#56 Admin Login & Dashboard:** Valid flow succeeds; invalid/revoked session is denied; role/ownership scope is enforced; loading/error/retry states are handled.
- **#57 Operator Management:** Ownership/group visibility is enforced and cross-operator/non-group access is forbidden.
- **#58 Driver Monitoring:** Ownership/group visibility is enforced and cross-operator/non-group access is forbidden.
- **#59 Commuter User Monitoring:** Happy path, validation failure, unauthorized role/ownership, empty/loading/error state and retry behavior are verified.
- **#60 Jeepney & Fleet Group Monitoring:** Ownership/group visibility is enforced and cross-operator/non-group access is forbidden.
- **#61 Official Transit Route & Direction Management:** Admin can create/edit official route/directions/status/color; route color suggestion avoids obvious duplicates but Admin chooses the final value; non-admin canonical edits are denied.
- **#62 Route Polyline / Corridor / Geofence Management:** Admin can draw/edit/delete route geometry and import valid GeoJSON; invalid geometry is rejected; corridorM persists and drives route-compliance behavior.
- **#63 GPS Device Management & Mapping:** Correct device mapping/status is shown; raw credentials stay server-side; disconnect/stale/failure paths do not create false locations.
- **#64 GPS Setup Request Approval & Installation Status:** Correct device mapping/status is shown; raw credentials stay server-side; disconnect/stale/failure paths do not create false locations.
- **#65 Global Live Tracking Map:** Admin global map loads authorized latest states across operators/routes and camera bounds remain within configured Philippines bounds.
- **#66 Route Deviation Monitoring:** Correct route direction/geometry/data is shown or changed only by the authorized role; invalid ownership/state/geometry is rejected.
- **#67 Basic Reports, Export & System Health:** Scoped reports/history match source records/time windows, CSV/PDF export works, and health clearly distinguishes API, app DB, Traccar and Tracking Bridge states.

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

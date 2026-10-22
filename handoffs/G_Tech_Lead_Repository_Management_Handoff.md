# Valryde Tech Lead AI Agent — Repository, Integration, PR Review, Merge & Issue Management

**Project:** Valryde — Public Jeepney Route Live Tracking & Monitoring System
**Authority:** Integration owner and merge reviewer for all 71 Version 1.0 MVP checklist items
**Developer agents supervised:** A–F
**Temporary GitHub owner:** `erwin-io`
**Default branch:** `main`
**Updated:** 2026-10-19

> **COPY/PASTE TECH LEAD PROMPT**
> You are the **Valryde Tech Lead AI Agent**. You are authorized to coordinate GitHub issues, inspect all Valryde repositories, review source/diffs/tests/migrations/contracts, request changes, and merge approved PRs when current repository permissions and owner policy allow. The six developer agents **must not self-merge**. Preserve the 71 stable MVP checklist IDs and the Version 1.0 system documentation as the design baseline. Before acting on a PR, compare the latest head SHA, checks, issue/checklist IDs and existing review comments. If nothing materially changed, do not create repetitive review comments. For materially new heads, inspect actual code/diff/tests. Classify review outcomes as **ACCEPTED**, **CHANGES REQUIRED** for concrete code/security/contract defects, or **OPERATOR-GATED** when code is acceptable but owner/hardware/environment evidence is still required. Never silently expand MVP scope or change shared contracts without an issue/change-control record.

## 1. Canonical module ownership

- **Agent A — Core Platform / Fastify API:** IDs 1–11 · `erwin-io/valryde-api`
- **Agent B — Traccar / Tracking Engine:** IDs 12–21 · `erwin-io/valryde-api + internal Traccar host/config`
- **Agent C — Commuter Mobile App:** IDs 22–37 · `erwin-io/valryde-mobile-commuter`
- **Agent D — Driver + Operator Mobile App:** IDs 38–55 · `erwin-io/valryde-mobile-driver-operator`
- **Agent E — Admin Web Application:** IDs 56–67 · `erwin-io/valryde-web-admin`
- **Agent F — GPS Setup / Documentation:** IDs 68–71 · `Runbooks/README/docs in the relevant Valryde repos + internal Traccar host notes`

## 2. Source-of-truth hierarchy

1. `VALRYDE_Complete_Features_Modules_System_Documentation_V1_20261019.docx` and the reconciled 71 checklist IDs.
2. Current canonical `main` branches, lockfiles, SQL migrations and tests after accepted merges.
3. Environment-specific installed PostgreSQL/PostGIS and Traccar configuration.
4. Tech Lead-approved issues/ADRs/contracts and CI/PR evidence.
5. Official upstream documentation for external dependencies.

Mobile development and physical-device acceptance must additionally follow the owner-approved `docs/governance/VALRYDE_MOBILE_TESTING_POLICY_001.md`. That policy defines the mandatory mobile validation boundary and the exact `DEVELOPMENT_ACCEPTED`, `OWNER_DEVICE_TEST_PENDING`, `DEVICE_HOTFIX_REQUIRED`, and `OWNER_DEVICE_ACCEPTED` classifications. Only the owner may authorize `OWNER_DEVICE_ACCEPTED`.

ID 37 is **Destination Place Search & Direct Transit Discovery**. Anonymous Public Tracking/Share Link is Phase 2/out of MVP.


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
- **Mobile device acceptance:** Physical Android-device integration testing is exclusively owner-managed. Mobile development remains subject to the automated, native-build, Capacitor/plugin, real development-API, security, and defect-resolution requirements in `VALRYDE-MOBILE-TESTING-POLICY-001`; absence of owner device access does not prevent submission of otherwise validated work.


## 4. Master 71-item MVP responsibility matrix

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
| 12 | **Traccar REST API Integration** | Fastify connection to Traccar for devices, positions, history, events, and required tracking data. | API: **Yes** · Web: **No** · Mobile: **No** | MVP | **High** | Not Started |
| 13 | **Traccar WebSocket Integration** | A long-running Tracking Bridge on the Traccar host maintains the authoritative Traccar /api/socket session and receives live devices, positions, and events. The MVP Vercel API is not used as the always-on Traccar ingestion process. | API: **Yes** · Web: **No** · Mobile: **No** | MVP | **High** | Not Started |
| 14 | **Automatic Traccar Reconnection** | Restore Traccar session/WebSocket automatically after connection failure. | API: **Yes** · Web: **No** · Mobile: **No** | MVP | **High** | Not Started |
| 15 | **GPS Position Processing** | Normalize latitude, longitude, fix time, and server/device timestamps for application use. | API: **Yes** · Web: **No** · Mobile: **No** | MVP | **High** | Not Started |
| 16 | **Vehicle Tracking Status Processing** | Process speed, heading/direction, online/offline, moving/stopped, and last update. | API: **Yes** · Web: **No** · Mobile: **No** | MVP | **High** | Not Started |
| 17 | **Traccar Events Processing** | Normalize movement, stop, online/offline, geofence entry/exit, and related Traccar events; Valryde separately records route-deviation/re-entry events. | API: **Yes** · Web: **No** · Mobile: **No** | MVP | **High** | Not Started |
| 18 | **Tracking History Retrieval** | Retrieve historical GPS positions for selected jeepney/date ranges. | API: **Yes** · Web: **No** · Mobile: **No** | MVP | **Medium** | Not Started |
| 19 | **Realtime Client Gateway (Pusher + REST Fallback)** | Tracking Bridge publishes authorized normalized updates through Pusher Channels for the MVP cloud demo; clients reconcile with Fastify REST. No client connects directly to Traccar. | API: **Yes** · Web: **Yes** · Mobile: **Yes** | MVP | **High** | Not Started |
| 20 | **Geofence & Route Geometry Integration** | Use PostGIS route polylines/corridors and basic circle/polygon geometry; Traccar geofences/events may supplement tracking, while Valryde remains authoritative for route-compliance state. | API: **Yes** · Web: **Yes** · Mobile: **Yes** | MVP | **Medium** | Not Started |
| 21 | **Route Compliance Monitoring** | Evaluate each valid position against a configurable 100 m route corridor. OFF_ROUTE requires at least 30 seconds outside or 3 consecutive valid off-route points; ON_ROUTE re-entry requires 2 consecutive valid inside points. States: UNKNOWN, ON_ROUTE, OFF_ROUTE. | API: **Yes** · Web: **Yes** · Mobile: **Yes** | MVP | **High** | Not Started |
| 22 | **Commuter Signup / Login / Profile** | Commuter self-registration using verified email/password or Google sign-in, login/logout, password recovery, and basic profile. | API: **Yes** · Web: **No** · Mobile: **Yes** | MVP | **High** | Not Started |
| 23 | **Landing, Main Transit Map & Current Location** | Show a standard landing/auth flow, then the main map with current location, recenter/follow controls, 2D default view, optional pitch/3D-style camera control, and bounded offline-ready map cache. | API: **Yes** · Web: **No** · Mobile: **Yes** | MVP | **High** | Not Started |
| 24 | **Route / Transit Search** | Search Valryde transit data by route code, public name, origin, destination, and related route metadata. | API: **Yes** · Web: **No** · Mobile: **Yes** | MVP | **High** | Not Started |
| 25 | **Route / Transit List** | Browse available registered jeepney transit routes. | API: **Yes** · Web: **No** · Mobile: **Yes** | MVP | **High** | Not Started |
| 26 | **Route Details Drawer / Filter** | Display route code/name, origin/destination, direction, and basic route information in a compact UI. | API: **Yes** · Web: **No** · Mobile: **Yes** | MVP | **High** | Not Started |
| 27 | **Route Direction Selection** | Select the correct transit direction before displaying live jeepneys. | API: **Yes** · Web: **No** · Mobile: **Yes** | MVP | **High** | Not Started |
| 28 | **Official Route Line on Map** | Display the selected route-direction polyline using its Admin-managed unique route color; route line and selected route metadata are cacheable for offline fallback. | API: **Yes** · Web: **No** · Mobile: **Yes** | MVP | **High** | Not Started |
| 29 | **Live Available Jeepneys** | Show active jeepneys for the selected route/direction when tracker is online, latest valid fix is not older than 30 seconds, vehicle is active, and route compliance is ON_ROUTE. | API: **Yes** · Web: **No** · Mobile: **Yes** | MVP | **High** | Not Started |
| 30 | **Real-Time Jeepney Movement** | Animate marker movement smoothly between valid GPS fixes using current direction/heading without fabricating future positions. | API: **Yes** · Web: **No** · Mobile: **Yes** | MVP | **High** | Not Started |
| 31 | **Route-Filtered Availability** | Only show eligible jeepneys for the selected route/direction. Stale or significantly off-route jeepneys are removed from commuter availability while Operator/Admin retain operational visibility. | API: **Yes** · Web: **No** · Mobile: **Yes** | MVP | **High** | Not Started |
| 32 | **Transit Label / Route Name on Jeepney** | Display transit code/name such as 10F on jeepney map markers/details. | API: **Yes** · Web: **No** · Mobile: **Yes** | MVP | **Medium** | Not Started |
| 33 | **Jeepney Details & Plate Number** | Tap a jeepney to view plate number and basic public vehicle information. | API: **Yes** · Web: **No** · Mobile: **Yes** | MVP | **High** | Not Started |
| 34 | **Color-Coded Jeepney Marker** | Use a circle/marker color based on the registered real jeepney color. | API: **Yes** · Web: **No** · Mobile: **Yes** | MVP | **Medium** | Not Started |
| 35 | **Tracking Status / Last Update / Direction** | Show public-safe tracking state, last valid update, movement direction, and online state. Driver/operator identity remains private from commuters. | API: **Yes** · Web: **No** · Mobile: **Yes** | MVP | **High** | Not Started |
| 36 | **Available Jeepney Count & Favorite Routes** | Show active jeepney count for selected transit and allow saving frequently used routes. | API: **Yes** · Web: **No** · Mobile: **Yes** | MVP | **Medium** | Not Started |
| 37 | **Destination Place Search & Direct Transit Discovery** | Search named places/POIs through a backend geocoding adapter (Photon demo provider for MVP, Philippines/Cebu biased) and suggest direct Valryde route directions that pass near both the commuter/current location and destination. No multi-transfer trip planner in MVP. | API: **Yes** · Web: **No** · Mobile: **Yes** | MVP | **Medium** | Not Started |
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
| 68 | **Tracker Configuration Guide** | Document the approved Traccar-compatible 4G LTE Cat-1 tracker profile, SIM/APN, server address, protocol port, reporting intervals, IMEI/uniqueId, ACC where supported, and safe configuration process. | API: **No** · Web: **Yes** · Mobile: **No** | MVP | **Medium** | Not Started |
| 69 | **Device Connectivity Verification** | Confirm device is online and communicating successfully with Traccar. | API: **Yes** · Web: **Yes** · Mobile: **No** | MVP | **High** | Not Started |
| 70 | **GPS Position Verification** | Confirm valid GPS fix, latest location, and expected position updates after installation. | API: **Yes** · Web: **Yes** · Mobile: **No** | MVP | **High** | Not Started |
| 71 | **Installation / Troubleshooting Guide** | Technician/service-provider installation and setup checklist covering power, SIM, server connectivity, GPS fix, correct jeepney mapping, placement, and common faults. Customer self-install is not the primary MVP operating model. | API: **No** · Web: **Yes** · Mobile: **No** | MVP | **Medium** | Not Started |

## 5. Tech Lead repository authority and safety rules

- Confirm the four canonical repos exist and target `main`: `erwin-io/valryde-api`, `erwin-io/valryde-mobile-commuter`, `erwin-io/valryde-mobile-driver-operator`, `erwin-io/valryde-web-admin`.
- Treat Traccar installation/config and the temporary server-laptop/VPS runtime as internal infrastructure, not a customer-facing fork.
- Never merge a developer-agent PR without reviewing changed code, tests/checks, checklist/issue linkage, RBAC/ownership impact and cross-repo contract impact.
- Heightened review is mandatory for auth/session changes, RBAC, migrations, PostGIS geometry, Pusher auth/channel scope, Traccar mapping, route-compliance semantics, device setup states, OAuth and secret/config changes.
- Do not bypass branch protections/checks unless the owner gives explicit current emergency authorization.
- Keep a traceable chain: **checklist ID → issue → branch/commits → PR → review decision → merge SHA → deployment/test evidence**.
- When repositories transfer away from `erwin-io`, coordinate GitHub ownership, Vercel/Neon/Pusher/Google OAuth relinking, secret rotation and canonical documentation update.

## 6. Issue taxonomy and required issue body

Recommended labels: `module:A-fastify`, `module:B-traccar`, `module:C-commuter`, `module:D-driver-operator`, `module:E-admin`, `module:F-gps-docs`, `integration`, `bug`, `blocker`, `security`, `schema`, `api-contract`, `realtime`, `map-geospatial`, `tracking-event`, `scope-change`, `operator-gated`, `mvp`.

```text
Checklist ID(s):
Module owner:
Repository:
Feature / defect:
Approved MVP behavior:
Acceptance criteria:
Dependencies / blocked-by:
API / schema / realtime / geometry impact:
Security / RBAC / privacy impact:
Test expectations:
Operator/hardware evidence needed:
Out-of-scope reminders:
```

A request outside the approved 71-item MVP must receive a separate `scope-change` issue and explicit owner approval before implementation.

## 7. Recommended cross-module integration order

1. **Baseline:** verify each repo builds/tests, environment examples are sanitized, and existing blockers are logged.
2. **Agent A foundation:** identity/auth/RBAC, users/operators/drivers/jeepneys/groups/routes/directions/approval contracts.
3. **Agent B foundation:** Traccar REST/session, persistent Tracking Bridge, latest-state contract, route compliance, Pusher/REST client realtime.
4. **A+B stabilization:** lock shared IDs/DTOs/errors/route geometry/device mapping/realtime payload/channel authorization.
5. **C/D/E parallel slices:** integrate mobile/admin UI only after the required contract slice is stable; prefer vertical feature PRs rather than one giant UI PR.
6. **F operational runbooks:** evolve alongside real Traccar/device behavior; mark untested physical steps OPERATOR-GATED.
7. **Cross-module E2E:** commuter route availability + destination discovery; driver route compliance + same-group visibility; operator fleet/application/GPS request; Admin approvals/route editor/global map/reports.
8. **MVP release candidate:** no open P0/P1 security/data-isolation defects, High-priority MVP features accepted, Medium items verified or explicitly owner-deferred, migrations/backups/env documentation current.

## 8. Shared contracts controlled by Tech Lead

### Authentication/RBAC
- Roles: `COMMUTER`, `DRIVER`, `OPERATOR`, `ADMIN`.
- Email/password + Google sign-in, email verification, refresh rotation/revocation and password recovery.
- Driver same-group visibility; Operator own-fleet only; Admin all platform; Commuter public-safe only.

### Route/geospatial
- `TransitRoute` + separate `RouteDirection` records with canonical PostGIS LineString, Admin route color and configurable corridor.
- Admin owns canonical geometry; Operator submits route-change/addition request.
- GeoJSON import is the MVP standard.

### Tracking/realtime
- Traccar raw telemetry/history authority; Valryde one latest-state row + application compliance events.
- Persistent `/api/socket` lives in Tracking Bridge on Traccar host, not Vercel.
- Client realtime = Pusher + REST reconciliation.
- Route compliance = 100 m default, 30 s or 3 outside fixes to OFF_ROUTE, 2 inside fixes to ON_ROUTE, otherwise UNKNOWN.
- Commuter availability = active + online + ≤30 s + assigned + ON_ROUTE.

### Device setup
- Individual vehicle application precedes operational tracking.
- GPS statuses: `PENDING`, `APPROVED`, `SCHEDULED`, `INSTALLED`, `REJECTED` plus mapping/verification state.
- Exact tracker model remains operator/owner-selected only after bench test; software contract stays on the approved Cat-1/Traccar-compatible profile.

### Map/search
- MapLibre + OpenFreeMap; route layers are Valryde-owned.
- Photon is behind the Fastify provider adapter; mobile/web must not hard-code the provider.
- ID 37 = direct transit discovery; no multi-transfer planner and no share links.

## 9. PR review protocol

For each materially new PR head:

1. Read linked issue/checklist IDs and confirm feature belongs to the agent/module.
2. Inspect actual changed code and migrations, not only screenshots/PR prose.
3. Review authorization and data-scope negative paths, not only happy path.
4. Check shared contracts against the current documentation and merged consumers.
5. Run/inspect lint, typecheck, unit/integration/E2E/build checks appropriate to the repo.
6. For migrations, verify forward behavior, conflicts, constraints/indexes and no unintended destructive changes.
7. For realtime, verify channel auth/scoping and REST reconciliation.
8. For maps/geospatial, verify coordinate order/SRID/metre semantics, invalid GeoJSON handling and route direction identity.
9. For GPS/Traccar, distinguish code acceptance from owner-operated physical-device evidence.
10. Post **at most one concise actionable review finding** for the current head unless multiple independent blockers truly require separation. Avoid repetitive review loops on unchanged heads.

### Review outcomes

- **ACCEPTED** — implementation and automated/reproducible evidence satisfy the current scope; may merge when required checks/permissions are satisfied.
- **CHANGES REQUIRED** — concrete code/security/schema/contract defect; cite exact file/behavior/test needed.
- **OPERATOR-GATED** — code is acceptable, but a real GPS device, Traccar host, OAuth console, external provider, owner credential/configuration, or physical installation test is still required. Do not mislabel this as a code defect.

## 10. CI/CD and migration policy

- PR CI should install from lockfile and run lint/typecheck/tests/build where practical.
- Vercel may auto-deploy the MVP demo after merge to `main`; this is a **development/demo deployment**, not commercial production approval.
- SQL/PostGIS migrations are explicit versioned files. Fast MVP development can avoid ceremony, but migrations are never silently auto-generated/applied without source review.
- Destructive schema/data changes require separate owner/Tech Lead review and backup/restore awareness.
- `.env.example` is the tracked configuration contract; secrets stay outside Git. If repositories include an env-sync helper, it may add missing keys to a local `.env` without overwriting existing secret values.

## 11. Cross-module release acceptance scenarios

1. **Commuter live route:** authenticate → choose route direction → REST snapshot → authorized realtime → only fresh ON_ROUTE jeepneys → marker detail privacy → reconnect reconciliation.
2. **Destination discovery:** search POI → normalized candidate → direct route suggestions → no-direct-route state.
3. **Driver compliance:** assigned tracker/route → ON_ROUTE → synthetic OFF_ROUTE threshold → warning → 2-fix re-entry → group visibility remains scoped.
4. **Operator onboarding:** self-register → vehicle application → Admin approval → GPS request → SCHEDULED → install/mapping/verification → INSTALLED/active.
5. **Admin route/GPS:** create route/directions/color → draw/import GeoJSON → corridor → approve vehicle/device → global live map → deviation/history/report/export.
6. **Failure recovery:** Traccar socket loss → Tracking Bridge reconnect → Pusher gap → clients reconcile REST; Traccar/Photon/OpenFreeMap outage is distinguishable from Valryde API failure.
7. **Security:** Driver cannot view non-group vehicle; Operator cannot read another operator's fleet; Commuter cannot read private driver/operator data; client cannot obtain Traccar/Pusher secret/DB credentials.


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


## 14. Tech Lead completion / handoff report

Maintain a release ledger containing at least:

```text
Checklist ID(s):
Issue:
Repository / PR / head SHA:
Agent owner:
Change summary:
Migration / API / realtime contract changes:
Automated evidence:
Manual/synthetic evidence:
Operator-gated evidence:
Review decision: ACCEPTED | CHANGES REQUIRED | OPERATOR-GATED
Merge SHA / deployment URL if applicable:
Follow-up issue(s):
Documentation/checklist/handoff updated?:
```

The Tech Lead must update this handoff and the Complete System Documentation whenever a merged change materially alters a DTO, endpoint, table, role permission, route-compliance threshold, realtime contract, map/geocoder provider, GPS setup state or MVP checklist meaning.

For mobile work, the Tech Lead must also record the applicable `VALRYDE-MOBILE-TESTING-POLICY-001` classification separately from the ordinary PR review outcome. `DEVELOPMENT_ACCEPTED` never implies physical-device acceptance; `OWNER_DEVICE_ACCEPTED` requires explicit owner confirmation tied to an identified build or commit. Owner-discovered device defects are tracked as `DEVICE_HOTFIX_REQUIRED` work with regression coverage before owner retest.

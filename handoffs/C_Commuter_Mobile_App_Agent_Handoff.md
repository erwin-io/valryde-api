# Valryde AI Agent Developer C — Commuter Mobile App

**Project:** Valryde — Public Jeepney Route Live Tracking & Monitoring System
**Documentation baseline:** `VALRYDE_Complete_Features_Modules_System_Documentation_V1_20261019.docx` — Version 1.0 MVP Baseline
**Module:** C — Commuter Mobile App
**Assigned checklist items:** 16 items — IDs 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37
**Primary repository / work area:** `erwin-io/valryde-mobile-commuter`
**Primary handoff owner after implementation:** Tech Lead AI Agent
**Updated:** 2026-10-19

> **COPY/PASTE AGENT PROMPT**
> You are **Valryde AI Agent Developer C — Commuter Mobile App**. Your stable MVP checklist IDs are **22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37**. Treat the Valryde Version 1.0 MVP system documentation, this handoff, the canonical `main` branch and merged Tech Lead decisions as the source of truth. Inspect the repository and current issues/PRs before editing. Implement only your assigned module and the minimum approved cross-module integration. Do not invent new product scope, do not bypass RBAC or tracking authority, and do not merge your own PRs. Open focused PRs referencing checklist IDs and issues, include tests/evidence, and hand the PR to the Tech Lead. If a shared DTO/schema/event/route-compliance rule or another module must change, open or reference a Tech Lead integration issue rather than silently creating a conflicting contract.

## 1. Mission and product context

Valryde is a **GPS-device-based public jeepney route visibility and fleet monitoring platform**, not a ride-hailing/booking system. The installed vehicle tracker is the authoritative vehicle-location source. Commuters use **Valryde** to discover routes/places and see eligible live jeepneys. Drivers and Operators use **Valryde Operator**. Service-provider staff use **Valryde Admin**.

## 2. Source-of-truth order

1. Valryde Version 1.0 MVP system documentation and its reconciled stable checklist IDs.
2. Canonical merged `main` branch, `package-lock.json`, SQL migrations and environment examples.
3. Installed PostgreSQL/PostGIS and Traccar schemas/config for the actual environment.
4. Tech Lead-approved GitHub issues/contract decisions and PR evidence.
5. Official upstream documentation for Fastify/PostgreSQL/PostGIS/Traccar/MapLibre/OpenFreeMap/Photon/Pusher/Vercel/Neon as applicable.

**Important reconciliation:** ID **37** is **Destination Place Search & Direct Transit Discovery**. The earlier Public Tracking/Share Link concept is Phase 2 and is not part of this MVP.

**Primary work area:** `erwin-io/valryde-mobile-commuter`.


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


## 4. Exact MVP checklist assigned to Agent C

| ID | Feature Name | Sub-Features / MVP Description | Components | Scope | Priority | Initial Status |
|---:|---|---|---|---|---|---|
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

**Component interpretation:** API/Web/Mobile indicators are required system touchpoints, not permission to edit another agent's repository. Coordinate cross-repository changes through the Tech Lead.


## 5. Agent C implementation authority and design details

**Mission:** build the consumer-facing Ionic app named **Valryde**. The app helps a commuter discover a route/place and see eligible live jeepneys; it is not a booking/hailing app.

### Navigation/UI baseline

- Standard landing/onboarding/auth flow before the main application.
- Recommended bottom tabs: **Home/Map · Routes · Favorites · Account**.
- Route tap opens a bottom sheet/detail drawer with route code/name, direction, route information and live availability.
- Map uses MapLibre + OpenFreeMap. Use 2D by default; optional pitch/3D-style camera toggle is allowed.
- Route line uses the Admin-defined unique route color. Jeepney marker is Waze-style/compact, uses the physical registered jeepney color and a transit/route label.
- Marker tap shows public-safe plate, route, direction, status and last update. Do not expose driver/operator identity.

### Live availability behavior

- A public jeepney is available only when active + tracker online + latest valid fix ≤30 s + assigned to selected route direction + `ON_ROUTE`.
- Moving and stopped vehicles can both be available.
- Stale/off-route vehicles are removed from commuter availability rather than presented as current service; the app may use transient last-known UI while reconciling but must not mislabel it as live/available.
- Animate only between real valid fixes; do not extrapolate future position.
- On app resume/reconnect/network recovery, refresh current route state from REST before trusting accumulated realtime events.

### Destination discovery (ID 37)

- Search places/POIs only through Valryde Fastify `/places/search` or equivalent normalized endpoint. Do not call Photon directly from the mobile app.
- User selects a place candidate; backend/PostGIS returns **direct** route directions near current/origin and destination.
- Clearly show “No direct route found” when appropriate. Multi-transfer journey planning is out of scope.
- Anonymous public tracking/share links are removed from MVP and must not be reintroduced under ID 37.

### Offline-ready behavior

- Limited cached basemap/route metadata may support a degraded offline view, but fresh live vehicles and place search require connectivity. Never promise nationwide offline operation.


## 6. Recommended implementation sequence

1. Set up auth/session/Google integration against Agent A contracts.
2. Build landing and MapLibre/OpenFreeMap shell plus bottom navigation.
3. Implement route list/search/direction/details/favorites.
4. Implement REST snapshot + Pusher subscription/reconciliation for selected route.
5. Implement live markers/details/availability and smooth non-predictive animation.
6. Implement place search/direct transit discovery and offline-degraded handling.
7. Finish accessibility, loading/empty/error/retry and Playwright/component tests.

## 7. Feature-level acceptance checklist

- **#22 Commuter Signup / Login / Profile:** Valid flow succeeds; invalid/revoked session is denied; role/ownership scope is enforced; loading/error/retry states are handled.
- **#23 Landing, Main Transit Map & Current Location:** Correct route direction/geometry/data is shown or changed only by the authorized role; invalid ownership/state/geometry is rejected.
- **#24 Route / Transit Search:** Correct route direction/geometry/data is shown or changed only by the authorized role; invalid ownership/state/geometry is rejected.
- **#25 Route / Transit List:** Correct route direction/geometry/data is shown or changed only by the authorized role; invalid ownership/state/geometry is rejected.
- **#26 Route Details Drawer / Filter:** Correct route direction/geometry/data is shown or changed only by the authorized role; invalid ownership/state/geometry is rejected.
- **#27 Route Direction Selection:** Correct route direction/geometry/data is shown or changed only by the authorized role; invalid ownership/state/geometry is rejected.
- **#28 Official Route Line on Map:** Correct route direction/geometry/data is shown or changed only by the authorized role; invalid ownership/state/geometry is rejected.
- **#29 Live Available Jeepneys:** Only active, online, ≤30 s fresh, assigned and ON_ROUTE jeepneys appear as available; stale/off-route vehicles disappear from commuter availability without being lost to operator/admin monitoring.
- **#30 Real-Time Jeepney Movement:** Marker movement interpolates only between received valid fixes, respects heading, handles out-of-order/stale fixes and never predicts/fabricates future vehicle positions.
- **#31 Route-Filtered Availability:** Correct route direction/geometry/data is shown or changed only by the authorized role; invalid ownership/state/geometry is rejected.
- **#32 Transit Label / Route Name on Jeepney:** Correct route direction/geometry/data is shown or changed only by the authorized role; invalid ownership/state/geometry is rejected.
- **#33 Jeepney Details & Plate Number:** Happy path, validation failure, unauthorized role/ownership, empty/loading/error state and retry behavior are verified.
- **#34 Color-Coded Jeepney Marker:** Happy path, validation failure, unauthorized role/ownership, empty/loading/error state and retry behavior are verified.
- **#35 Tracking Status / Last Update / Direction:** Happy path, validation failure, unauthorized role/ownership, empty/loading/error state and retry behavior are verified.
- **#36 Available Jeepney Count & Favorite Routes:** Correct route direction/geometry/data is shown or changed only by the authorized role; invalid ownership/state/geometry is rejected.
- **#37 Destination Place Search & Direct Transit Discovery:** Place query returns normalized Photon-backed candidates; selected destination produces direct Valryde route-direction candidates near current/origin and destination; no-transfer case is clear; no multi-transfer planner is implied.

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

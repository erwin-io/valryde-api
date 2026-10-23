# Agent A — UI endpoint availability matrix (A-UI-READY-001)

Accepted API: `main` `810c8a13356ddbf0e28a4faf5ad7f86ce0a30479`. Generated from `AGENT_A_FRONTEND_ENDPOINT_INDEX.json` plus pending and missing operations. Machine-readable copy: [AGENT_A_UI_ENDPOINT_AVAILABILITY.json](AGENT_A_UI_ENDPOINT_AVAILABILITY.json).

Availability: **ACCEPTED_MAIN** callable now · **PENDING_PR** in an open PR, not callable, do not build against it · **UNAVAILABLE** no implementation.

| Method | Route | Roles | Availability | DTO (success) | IDs | UI | Notes |
|---|---|---|---|---|---|---|---|
| GET | `/api/health` | PUBLIC | ACCEPTED_MAIN (main 810c8a1) | 200 {status, database} | — | C, D, E |  |
| POST | `/api/auth/register` | PUBLIC | ACCEPTED_MAIN (main 810c8a1) | 201 {user, message} | 1, 3 | C, D |  |
| POST | `/api/auth/verify-email` | PUBLIC | ACCEPTED_MAIN (main 810c8a1) | 200 {user} | 1 | C, D, E |  |
| POST | `/api/auth/resend-verification` | PUBLIC | ACCEPTED_MAIN (main 810c8a1) | 202 {message} | 1 | C, D, E | Real delivery owner-gated (SMTP). |
| POST | `/api/auth/login` | PUBLIC | ACCEPTED_MAIN (main 810c8a1) | 200 {accessToken, refreshToken, accessTokenExpiresIn, refreshTokenExpiresAt, user} | 1, 56 | C, D, E |  |
| POST | `/api/auth/google` | PUBLIC | ACCEPTED_MAIN (main 810c8a1) | 200 {accessToken, refreshToken, accessTokenExpiresIn, refreshTokenExpiresAt, user} | 1 | C, D | Owner-gated: Google client IDs not provisioned; returns 503 GOOGLE_SIGN_IN_UNAVAILABLE. |
| POST | `/api/auth/refresh` | PUBLIC | ACCEPTED_MAIN (main 810c8a1) | 200 {accessToken, refreshToken, accessTokenExpiresIn, refreshTokenExpiresAt, user} | 1 | C, D, E |  |
| POST | `/api/auth/logout` | PUBLIC | ACCEPTED_MAIN (main 810c8a1) | 204 no body | 1 | C, D, E |  |
| POST | `/api/auth/forgot-password` | PUBLIC | ACCEPTED_MAIN (main 810c8a1) | 202 {message} | 1 | C, D, E | Real delivery owner-gated (SMTP). |
| POST | `/api/auth/reset-password` | PUBLIC | ACCEPTED_MAIN (main 810c8a1) | 204 no body | 1 | C, D, E |  |
| GET | `/api/auth/me` | ANY_VERIFIED_ACTIVE_ROLE | ACCEPTED_MAIN (main 810c8a1) | 200 {user} | 1, 2, 3 | C, D, E |  |
| PATCH | `/api/auth/me` | ANY_VERIFIED_ACTIVE_ROLE | ACCEPTED_MAIN (main 810c8a1) | 200 {user} | 3 | C, D, E |  |
| POST | `/api/auth/me/change-password` | ANY_VERIFIED_ACTIVE_ROLE | ACCEPTED_MAIN (main 810c8a1) | 204 no body | 1, 3 | C, D, E |  |
| POST | `/api/auth/me/change-email` | ANY_VERIFIED_ACTIVE_ROLE | ACCEPTED_MAIN (main 810c8a1) | 202 {message} | 3 | C, D, E |  |
| POST | `/api/auth/confirm-email-change` | PUBLIC | ACCEPTED_MAIN (main 810c8a1) | 200 {user} | 3 | C, D, E |  |
| GET | `/api/admin/users/` | ADMIN | ACCEPTED_MAIN (main 810c8a1) | 200 {users} | 3, 57, 58, 59 | E | Unbounded, no filters; G9 (#34) proposes opt-in pagination. |
| PATCH | `/api/admin/users/{userId}/status` | ADMIN | ACCEPTED_MAIN (main 810c8a1) | 200 {user} | 3, 57, 58, 59 | E |  |
| GET | `/api/places/search` | ANY_VERIFIED_ACTIVE_ROLE | ACCEPTED_MAIN (main 810c8a1) | 200 {places, attribution} | 37 | C, D, E | Provider disabled by default: 503 GEOCODER_UNAVAILABLE until owner approves a provider (G6-D4). |
| GET | `/api/drivers` | OPERATOR, ADMIN | ACCEPTED_MAIN (main 810c8a1) | 200 {drivers, pagination} | 49, 58 | D, E |  |
| GET | `/api/operators` | ADMIN | ACCEPTED_MAIN (main 810c8a1) | 200 {operators, pagination} | 57, 56 | E |  |
| POST | `/api/driver-associations` | OPERATOR | ACCEPTED_MAIN (main 810c8a1) | 200 {association} | 49 | D |  |
| GET | `/api/jeepneys` | DRIVER, OPERATOR, ADMIN | ACCEPTED_MAIN (main 810c8a1) | 200 {jeepneys} | 4, 56, 60 | D, E | Unbounded; G9 (#34). #31 adds 503 TRACKING_CONTEXT_BUSY to the status-changing PATCH only. |
| POST | `/api/jeepneys` | DRIVER, OPERATOR, ADMIN | ACCEPTED_MAIN (main 810c8a1) | 201 {jeepney} | 4 | D, E |  |
| PATCH | `/api/jeepneys/{jeepneyId}` | DRIVER, OPERATOR, ADMIN | ACCEPTED_MAIN (main 810c8a1) | 200 {jeepney} | 4, 60 | D, E | After #31: may return 503 TRACKING_CONTEXT_BUSY. |
| GET | `/api/fleet-groups/{groupId}/members` | DRIVER, OPERATOR, ADMIN | ACCEPTED_MAIN (main 810c8a1) | 200 {members, pagination} | 7, 50, 60 | D, E |  |
| POST | `/api/jeepneys/{jeepneyId}/driver-assignment` | OPERATOR, ADMIN | ACCEPTED_MAIN (main 810c8a1) | 201 {assignment} | 5, 49 | D, E |  |
| DELETE | `/api/jeepneys/{jeepneyId}/driver-assignment` | OPERATOR, ADMIN | ACCEPTED_MAIN (main 810c8a1) | 200 {assignment} | 5, 49 | D, E |  |
| DELETE | `/api/fleet-groups/{groupId}/drivers/{driverId}` | OPERATOR, ADMIN | ACCEPTED_MAIN (main 810c8a1) | 204 no body | 7, 50 | D, E |  |
| DELETE | `/api/fleet-groups/{groupId}/jeepneys/{jeepneyId}` | OPERATOR, ADMIN | ACCEPTED_MAIN (main 810c8a1) | 204 no body | 7, 50 | D, E | After #31: may return 503. |
| GET | `/api/me/assignment` | DRIVER | ACCEPTED_MAIN (main 810c8a1) | 200 {assignment} | 5 | D |  |
| GET | `/api/fleet-groups` | DRIVER, OPERATOR, ADMIN | ACCEPTED_MAIN (main 810c8a1) | 200 {groups} | 6, 50, 60 | D, E | Unbounded; G9 (#34). |
| POST | `/api/fleet-groups` | OPERATOR, ADMIN | ACCEPTED_MAIN (main 810c8a1) | 201 {group} | 6, 50 | D, E |  |
| PATCH | `/api/fleet-groups/{groupId}` | OPERATOR, ADMIN | ACCEPTED_MAIN (main 810c8a1) | 200 {group} | 6, 50 | D, E |  |
| POST | `/api/fleet-groups/{groupId}/drivers` | OPERATOR, ADMIN | ACCEPTED_MAIN (main 810c8a1) | 200 {message} | 7, 50 | D, E |  |
| POST | `/api/fleet-groups/{groupId}/jeepneys` | OPERATOR, ADMIN | ACCEPTED_MAIN (main 810c8a1) | 200 {message} | 7, 50 | D, E | After #31: may return 503. |
| GET | `/api/transit-routes` | PUBLIC | ACCEPTED_MAIN (main 810c8a1) | 200 {routes, pagination} | 8 | C, D, E |  |
| GET | `/api/transit-routes/discover` | PUBLIC | ACCEPTED_MAIN (main 810c8a1) | 200 {candidates, directRouteFound} | 37 | C, D, E |  |
| GET | `/api/transit-routes/{routeId}` | PUBLIC | ACCEPTED_MAIN (main 810c8a1) | 200 {route} | 8, 9 | C, D, E |  |
| GET | `/api/admin/transit-routes` | ADMIN | ACCEPTED_MAIN (main 810c8a1) | 200 {routes} | 8, 56, 61 | E | Unbounded; G9 (#34). |
| POST | `/api/admin/transit-routes` | ADMIN | ACCEPTED_MAIN (main 810c8a1) | 201 {route} | 8, 61 | E |  |
| PATCH | `/api/admin/transit-routes/{routeId}` | ADMIN | ACCEPTED_MAIN (main 810c8a1) | 200 {route} | 8, 61 | E | After #31: may return 422 TRACKING_CONTEXT_MUTATION_TOO_LARGE or 503. |
| POST | `/api/admin/transit-routes/{routeId}/directions` | ADMIN | ACCEPTED_MAIN (main 810c8a1) | 201 {direction} | 9, 61, 62 | E |  |
| PATCH | `/api/admin/route-directions/{directionId}` | ADMIN | ACCEPTED_MAIN (main 810c8a1) | 200 {direction} | 9, 61, 62 | E | After #31: may return 422 or 503. Deletion is status INACTIVE; no hard delete. |
| POST | `/api/route-assignments` | OPERATOR | ACCEPTED_MAIN (main 810c8a1) | 201 {assignment} | 10 | D | After #31: may return 422 or 503. |
| GET | `/api/route-assignments` | OPERATOR, ADMIN | ACCEPTED_MAIN (main 810c8a1) | 200 {assignments, pagination} | 10, 60 | D, E |  |
| GET | `/api/admin/route-directions/{directionId}/assignment-impact` | ADMIN | ACCEPTED_MAIN (main 810c8a1) | 200 {impact, pagination} | 10, 61, 62 | E |  |
| GET | `/api/jeepneys/{jeepneyId}/effective-route` | DRIVER, OPERATOR, ADMIN | ACCEPTED_MAIN (main 810c8a1) | 200 {effectiveRouteDirection} | 10, 60 | D, E |  |
| GET | `/api/vehicle-applications` | DRIVER, OPERATOR, ADMIN | ACCEPTED_MAIN (main 810c8a1) | 200 {applications} | 11, 64 | D, E | Unbounded; G9 (#34). |
| POST | `/api/vehicle-applications` | DRIVER, OPERATOR | ACCEPTED_MAIN (main 810c8a1) | 201 {application} | 11 | D | After #31: may return 503. |
| PATCH | `/api/admin/vehicle-applications/{applicationId}/review` | ADMIN | ACCEPTED_MAIN (main 810c8a1) | 200 {application} | 11, 64 | E | After #31: may return 503. |
| GET | `/api/gps-setup-requests` | DRIVER, OPERATOR, ADMIN | ACCEPTED_MAIN (main 810c8a1) | 200 {requests} | 11, 63, 64 | D, E | Unbounded; G9 (#34). |
| POST | `/api/gps-setup-requests` | DRIVER, OPERATOR | ACCEPTED_MAIN (main 810c8a1) | 201 {request} | 11 | D |  |
| PATCH | `/api/admin/gps-setup-requests/{requestId}/status` | ADMIN | ACCEPTED_MAIN (main 810c8a1) | 200 {request} | 11, 64 | E | After #31: may return 503. |
| POST | `/api/admin/gps-setup-requests/{requestId}/device-mapping` | ADMIN | ACCEPTED_MAIN (main 810c8a1) | 201 {mapping} | 11, 63 | E | Create-only (Stage 13b). After #31: may return 503. |
| GET | `/api/admin/gps-setup-requests/{requestId}/device-mapping` | ADMIN | ACCEPTED_MAIN (main 810c8a1) | 200 {mapping} | 11, 63 | E |  |
| POST | `/api/admin/gps-setup-requests/{requestId}/verification` | ADMIN | ACCEPTED_MAIN (main 810c8a1) | 200 {request} | 11, 64 | E | After #31: may return 503. |
| GET | `/api/admin/audit-logs` | ADMIN | PENDING_PR (#33 (G8; metadata exposure G8-D3 not approved)) | 200 {auditLogs, pagination} | 56, 60 | E | Not for merge until G8-D3 is decided; do not build against it yet. |
| GET | `(none) Admin dashboard summary counts` | ADMIN | UNAVAILABLE (No contract (proposed G12)) | — | 56 | E | Counts of operators/drivers come from directory pagination.total today; jeepneys and routes need full lists. |
| GET | `(none) Live device online/offline, deviations` | ADMIN, OPERATOR, DRIVER | UNAVAILABLE (Agent B Stage 13b stack #30/#32/#36/#37 after #31) | — | 56, 60, 63 | D, E | Class 5: needs A006 (#31) merged, then Agent B B007/B008 and the gateway. |
| GET | `(none) GPS device list` | ADMIN | UNAVAILABLE (No contract (proposed G13)) | — | 63 | E | Today a device is reachable only through its setup request mapping (N+1 reads). |
| POST/PATCH | `(none) Admin creates/approves Operator, edits operator profile` | ADMIN | UNAVAILABLE (Owner/Agent G policy decision) | — | 57 | E | Operators self-register; Admin can view (listOperators) and disable (updateUserStatusAsAdmin). No approval state or profile fields exist. |
| * | `(none) Basic geofences` | ADMIN | UNAVAILABLE (Owner decision (scope) / Agent B compliance) | — | 62 | E | Corridor tolerance exists per direction (corridorM); no geofence entity. |
| * | `/api/route-change-requests (5 operations)` | OPERATOR, ADMIN | UNAVAILABLE (G7: matrix #35; D4, D5, D7 open) | — | 52 | D, E | Not in this checkpoint scope; listed for completeness. |

# VALRYDE OpenAPI endpoint-to-tag mapping

The OpenAPI server URL is `/api`; paths below are relative to that base. Categories 09–15 are declared as future contract areas and intentionally contain no operations until those routes are implemented.

## 01 — System & Health

- `GET /health` — `getHealth`

## 02 — Authentication & Sessions

- `POST /auth/register` — `registerUser`
- `POST /auth/verify-email` — `verifyEmail`
- `POST /auth/resend-verification` — `resendEmailVerification`
- `POST /auth/login` — `loginUser`
- `POST /auth/google` — `signInWithGoogle`
- `POST /auth/refresh` — `refreshSession`
- `POST /auth/logout` — `logoutSession`
- `POST /auth/forgot-password` — `requestPasswordReset`
- `POST /auth/reset-password` — `resetPassword`

## 03 — User Profiles & Accounts

- `GET /auth/me` — `getCurrentUser`
- `PATCH /auth/me` — `updateCurrentUser`
- `POST /auth/me/change-password` — `changeCurrentUserPassword`
- `POST /auth/me/change-email` — `requestCurrentUserEmailChange`
- `POST /auth/confirm-email-change` — `confirmCurrentUserEmailChange`
- `GET /admin/users/` — `listUsersAsAdmin`
- `PATCH /admin/users/{userId}/status` — `updateUserStatusAsAdmin`

## 04 — Jeepney Management

- `GET /jeepneys` — `listJeepneys`
- `POST /jeepneys` — `createJeepney`
- `PATCH /jeepneys/{jeepneyId}` — `updateJeepney`
- `POST /jeepneys/{jeepneyId}/driver-assignment` — `assignDriverToJeepney`
- `GET /me/assignment` — `getCurrentDriverAssignment`

`GET /me/assignment` is the server-authoritative current assignment identity for a DRIVER and returns
an explicit business `driverId`. A `null` assignment is different from `GET /jeepneys`: group-visible or
Driver-created jeepneys do not become the Driver's active assignment.

## 05 — Fleet Groups & Membership

- `GET /drivers` — `listDrivers`
- `GET /operators` — `listOperators`
- `GET /fleet-groups` — `listFleetGroups`
- `POST /fleet-groups` — `createFleetGroup`
- `PATCH /fleet-groups/{groupId}` — `updateFleetGroup`
- `POST /fleet-groups/{groupId}/drivers` — `addDriverToFleetGroup`
- `POST /fleet-groups/{groupId}/jeepneys` — `addJeepneyToFleetGroup`
- `POST /driver-associations` — `associateDriverWithOperator`

## 06 — Transit Routes & Directions

- `GET /transit-routes` — `listPublicTransitRoutes`
- `GET /transit-routes/{routeId}` — `getPublicTransitRoute`
- `GET /admin/transit-routes` — `listTransitRoutesAsAdmin`
- `POST /admin/transit-routes` — `createTransitRoute`
- `PATCH /admin/transit-routes/{routeId}` — `updateTransitRoute`
- `POST /admin/transit-routes/{routeId}/directions` — `createRouteDirection`
- `PATCH /admin/route-directions/{directionId}` — `updateRouteDirection`
- `POST /route-assignments` — `assignTransitRoute`
- `GET /route-assignments` — `listRouteAssignments`
- `GET /admin/route-directions/{directionId}/assignment-impact` — `getRouteDirectionAssignmentImpact`
- `GET /jeepneys/{jeepneyId}/effective-route` — `getJeepneyEffectiveRoute`

Effective-route precedence is server-owned: an active direct jeepney assignment wins; otherwise one
active group assignment is inherited. Zero group assignments returns `null`; an ambiguous legacy
configuration returns `409 ROUTE_ASSIGNMENT_CONFLICT`. Agents B–E must consume this endpoint or the
shared `TransitService.resolveEffectiveRouteDirection()` method instead of recreating precedence logic.

## 07 — Vehicle Applications & Approvals

- `GET /vehicle-applications` — `listVehicleApplications`
- `POST /vehicle-applications` — `submitVehicleApplication`
- `PATCH /admin/vehicle-applications/{applicationId}/review` — `reviewVehicleApplication`

## 08 — GPS Devices & Installation

- `GET /gps-setup-requests` — `listGpsSetupRequests`
- `POST /gps-setup-requests` — `submitGpsSetupRequest`
- `PATCH /admin/gps-setup-requests/{requestId}/status` — `transitionGpsSetupStatus`
- `GET /admin/gps-setup-requests/{requestId}/device-mapping` — `getGpsDeviceMapping`
- `POST /admin/gps-setup-requests/{requestId}/device-mapping` — `mapGpsDevice`
- `POST /admin/gps-setup-requests/{requestId}/verification` — `verifyGpsInstallation`

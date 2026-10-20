# Agent A endpoint / DTO / RBAC matrix for C, D and E

Audited merged commit: `711f4c45967e192be155e05e72714b99645ecc7d` (PR1). Generated from registered Fastify OpenAPI schemas plus source preHandlers;44 operations/38 paths. This is an audit of existing contracts, not a new API specification or evidence of live deployment.

**All paths below include /api.** The [exact OpenAPI audit snapshot](AGENT_A_OPENAPI_AUDIT.json) instead has server `/api` and unprefixed paths. Do not prepend /api twice. Public means no JWT required; protected means verified/active account plus route guard and service-level scope. Consumer letters describe legitimate application use, not authorization grants. E has no public Admin registration; Google Admin UX is not approved by this matrix.

| Exact HTTP endpoint | Consumers | Route RBAC | Success envelope | DTO operationId |
|---|---|---|---|---|
| `GET /api/health` | C,D,E | PUBLIC | 200 {status,database} | `getHealth` |
| `POST /api/auth/register` | C,D | PUBLIC | 201 {user,message} | `registerUser` |
| `POST /api/auth/verify-email` | C,D,E | PUBLIC | 200 {user} | `verifyEmail` |
| `POST /api/auth/resend-verification` | C,D,E | PUBLIC | 202 {message} | `resendEmailVerification` |
| `POST /api/auth/login` | C,D,E | PUBLIC | 200 {accessToken,refreshToken,accessTokenExpiresIn,refreshTokenExpiresAt,user} | `loginUser` |
| `POST /api/auth/google` | C,D | PUBLIC | 200 {accessToken,refreshToken,accessTokenExpiresIn,refreshTokenExpiresAt,user} | `signInWithGoogle` |
| `POST /api/auth/refresh` | C,D,E | PUBLIC | 200 {accessToken,refreshToken,accessTokenExpiresIn,refreshTokenExpiresAt,user} | `refreshSession` |
| `POST /api/auth/logout` | C,D,E | PUBLIC | 204 no body | `logoutSession` |
| `POST /api/auth/forgot-password` | C,D,E | PUBLIC | 202 {message} | `requestPasswordReset` |
| `POST /api/auth/reset-password` | C,D,E | PUBLIC | 204 no body | `resetPassword` |
| `GET /api/auth/me` | C,D,E | ANY_VERIFIED_ACTIVE_ROLE | 200 {user} | `getCurrentUser` |
| `PATCH /api/auth/me` | C,D,E | ANY_VERIFIED_ACTIVE_ROLE | 200 {user} | `updateCurrentUser` |
| `POST /api/auth/me/change-password` | C,D,E | ANY_VERIFIED_ACTIVE_ROLE | 204 no body | `changeCurrentUserPassword` |
| `POST /api/auth/me/change-email` | C,D,E | ANY_VERIFIED_ACTIVE_ROLE | 202 {message} | `requestCurrentUserEmailChange` |
| `POST /api/auth/confirm-email-change` | C,D,E | PUBLIC | 200 {user} | `confirmCurrentUserEmailChange` |
| `GET /api/admin/users/` | E | ADMIN | 200 {users} | `listUsersAsAdmin` |
| `PATCH /api/admin/users/{userId}/status` | E | ADMIN | 200 {user} | `updateUserStatusAsAdmin` |
| `POST /api/driver-associations` | D | OPERATOR | 200 {association} | `associateDriverWithOperator` |
| `GET /api/jeepneys` | D,E | DRIVER, OPERATOR, ADMIN | 200 {jeepneys} | `listJeepneys` |
| `POST /api/jeepneys` | D,E | DRIVER, OPERATOR, ADMIN | 201 {jeepney} | `createJeepney` |
| `PATCH /api/jeepneys/{jeepneyId}` | D,E | DRIVER, OPERATOR, ADMIN | 200 {jeepney} | `updateJeepney` |
| `POST /api/jeepneys/{jeepneyId}/driver-assignment` | D,E | OPERATOR, ADMIN | 201 {assignment} | `assignDriverToJeepney` |
| `GET /api/fleet-groups` | D,E | DRIVER, OPERATOR, ADMIN | 200 {groups} | `listFleetGroups` |
| `POST /api/fleet-groups` | D,E | OPERATOR, ADMIN | 201 {group} | `createFleetGroup` |
| `PATCH /api/fleet-groups/{groupId}` | D,E | OPERATOR, ADMIN | 200 {group} | `updateFleetGroup` |
| `POST /api/fleet-groups/{groupId}/drivers` | D,E | OPERATOR, ADMIN | 200 {message} | `addDriverToFleetGroup` |
| `POST /api/fleet-groups/{groupId}/jeepneys` | D,E | OPERATOR, ADMIN | 200 {message} | `addJeepneyToFleetGroup` |
| `GET /api/transit-routes` | C,D,E | PUBLIC | 200 {routes,pagination} | `listPublicTransitRoutes` |
| `GET /api/transit-routes/{routeId}` | C,D,E | PUBLIC | 200 {route} | `getPublicTransitRoute` |
| `GET /api/admin/transit-routes` | E | ADMIN | 200 {routes} | `listTransitRoutesAsAdmin` |
| `POST /api/admin/transit-routes` | E | ADMIN | 201 {route} | `createTransitRoute` |
| `PATCH /api/admin/transit-routes/{routeId}` | E | ADMIN | 200 {route} | `updateTransitRoute` |
| `POST /api/admin/transit-routes/{routeId}/directions` | E | ADMIN | 201 {direction} | `createRouteDirection` |
| `PATCH /api/admin/route-directions/{directionId}` | E | ADMIN | 200 {direction} | `updateRouteDirection` |
| `POST /api/route-assignments` | D | OPERATOR | 201 {assignment} | `assignTransitRoute` |
| `GET /api/jeepneys/{jeepneyId}/effective-route` | D,E | DRIVER, OPERATOR, ADMIN | 200 {effectiveRouteDirection} | `getJeepneyEffectiveRoute` |
| `GET /api/vehicle-applications` | D,E | DRIVER, OPERATOR, ADMIN | 200 {applications} | `listVehicleApplications` |
| `POST /api/vehicle-applications` | D | DRIVER, OPERATOR | 201 {application} | `submitVehicleApplication` |
| `PATCH /api/admin/vehicle-applications/{applicationId}/review` | E | ADMIN | 200 {application} | `reviewVehicleApplication` |
| `GET /api/gps-setup-requests` | D,E | DRIVER, OPERATOR, ADMIN | 200 {requests} | `listGpsSetupRequests` |
| `POST /api/gps-setup-requests` | D | DRIVER, OPERATOR | 201 {request} | `submitGpsSetupRequest` |
| `PATCH /api/admin/gps-setup-requests/{requestId}/status` | E | ADMIN | 200 {request} | `transitionGpsSetupStatus` |
| `POST /api/admin/gps-setup-requests/{requestId}/device-mapping` | E | ADMIN | 201 {mapping} | `mapGpsDevice` |
| `POST /api/admin/gps-setup-requests/{requestId}/verification` | E | ADMIN | 200 {request} | `verifyGpsInstallation` |

## Request contracts and source locations

JSON requests use Content-Type application/json. Every body schema rejects additional properties. POST creation does not imply a matching GET detail/list/removal route exists. Only the public transit list declares pagination/query filtering; all other listed collections lack a server pagination/search contract. Constraints and response field types are preserved exactly in the snapshot, including optional versus nullable fields. The [handoff](AGENT_A_FRONTEND_API_INTEGRATION_HANDOFF.md) explains resource-level restrictions and field semantics.

### getHealth

- Endpoint: `GET /api/health`.
- Route guard: PUBLIC; resource checks still apply.
- Parameters: none.
- JSON body (`?` = optional): none.
- Declared statuses: 200, 503.
- Source: [src/app.ts:164](../../src/app.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/health`, method `get`.

### registerUser

- Endpoint: `POST /api/auth/register`.
- Route guard: PUBLIC; resource checks still apply.
- Parameters: none.
- JSON body (`?` = optional): email:string, password:string, displayName:string, role:COMMUTER/DRIVER/OPERATOR.
- Declared statuses: 201, 400, 401, 403, 409.
- Source: [src/routes/auth-routes.ts:38](../../src/routes/auth-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/auth/register`, method `post`.

### verifyEmail

- Endpoint: `POST /api/auth/verify-email`.
- Route guard: PUBLIC; resource checks still apply.
- Parameters: none.
- JSON body (`?` = optional): token:string.
- Declared statuses: 200, 400, 401, 403, 409.
- Source: [src/routes/auth-routes.ts:72](../../src/routes/auth-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/auth/verify-email`, method `post`.

### resendEmailVerification

- Endpoint: `POST /api/auth/resend-verification`.
- Route guard: PUBLIC; resource checks still apply.
- Parameters: none.
- JSON body (`?` = optional): email:string.
- Declared statuses: 202, 400, 401, 403, 409.
- Source: [src/routes/auth-routes.ts:87](../../src/routes/auth-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/auth/resend-verification`, method `post`.

### loginUser

- Endpoint: `POST /api/auth/login`.
- Route guard: PUBLIC; resource checks still apply.
- Parameters: none.
- JSON body (`?` = optional): email:string, password:string.
- Declared statuses: 200, 400, 401, 403, 409.
- Source: [src/routes/auth-routes.ts:109](../../src/routes/auth-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/auth/login`, method `post`.

### signInWithGoogle

- Endpoint: `POST /api/auth/google`.
- Route guard: PUBLIC; resource checks still apply.
- Parameters: none.
- JSON body (`?` = optional): idToken:string, role:COMMUTER/DRIVER/OPERATOR.
- Declared statuses: 200, 400, 401, 403, 409, 503.
- Source: [src/routes/auth-routes.ts:133](../../src/routes/auth-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/auth/google`, method `post`.

### refreshSession

- Endpoint: `POST /api/auth/refresh`.
- Route guard: PUBLIC; resource checks still apply.
- Parameters: none.
- JSON body (`?` = optional): refreshToken:string.
- Declared statuses: 200, 400, 401, 403, 409.
- Source: [src/routes/auth-routes.ts:157](../../src/routes/auth-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/auth/refresh`, method `post`.

### logoutSession

- Endpoint: `POST /api/auth/logout`.
- Route guard: PUBLIC; resource checks still apply.
- Parameters: none.
- JSON body (`?` = optional): refreshToken:string.
- Declared statuses: 204, 400, 401, 403, 409.
- Source: [src/routes/auth-routes.ts:177](../../src/routes/auth-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/auth/logout`, method `post`.

### requestPasswordReset

- Endpoint: `POST /api/auth/forgot-password`.
- Route guard: PUBLIC; resource checks still apply.
- Parameters: none.
- JSON body (`?` = optional): email:string.
- Declared statuses: 202, 400, 401, 403, 409.
- Source: [src/routes/auth-routes.ts:195](../../src/routes/auth-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/auth/forgot-password`, method `post`.

### resetPassword

- Endpoint: `POST /api/auth/reset-password`.
- Route guard: PUBLIC; resource checks still apply.
- Parameters: none.
- JSON body (`?` = optional): token:string, password:string.
- Declared statuses: 204, 400, 401, 403, 409.
- Source: [src/routes/auth-routes.ts:216](../../src/routes/auth-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/auth/reset-password`, method `post`.

### getCurrentUser

- Endpoint: `GET /api/auth/me`.
- Route guard: ANY_VERIFIED_ACTIVE_ROLE; resource checks still apply.
- Parameters: none.
- JSON body (`?` = optional): none.
- Declared statuses: 200, 400, 401, 403, 409.
- Source: [src/routes/auth-routes.ts:237](../../src/routes/auth-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/auth/me`, method `get`.

### updateCurrentUser

- Endpoint: `PATCH /api/auth/me`.
- Route guard: ANY_VERIFIED_ACTIVE_ROLE; resource checks still apply.
- Parameters: none.
- JSON body (`?` = optional): displayName:string.
- Declared statuses: 200, 400, 401, 403, 409.
- Source: [src/routes/auth-routes.ts:253](../../src/routes/auth-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/auth/me`, method `patch`.

### changeCurrentUserPassword

- Endpoint: `POST /api/auth/me/change-password`.
- Route guard: ANY_VERIFIED_ACTIVE_ROLE; resource checks still apply.
- Parameters: none.
- JSON body (`?` = optional): currentPassword:string, newPassword:string.
- Declared statuses: 204, 400, 401, 403, 409.
- Source: [src/routes/auth-routes.ts:277](../../src/routes/auth-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/auth/me/change-password`, method `post`.

### requestCurrentUserEmailChange

- Endpoint: `POST /api/auth/me/change-email`.
- Route guard: ANY_VERIFIED_ACTIVE_ROLE; resource checks still apply.
- Parameters: none.
- JSON body (`?` = optional): email:string.
- Declared statuses: 202, 400, 401, 403, 409, 503.
- Source: [src/routes/auth-routes.ts:304](../../src/routes/auth-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/auth/me/change-email`, method `post`.

### confirmCurrentUserEmailChange

- Endpoint: `POST /api/auth/confirm-email-change`.
- Route guard: PUBLIC; resource checks still apply.
- Parameters: none.
- JSON body (`?` = optional): token:string.
- Declared statuses: 200, 400, 401, 403, 409.
- Source: [src/routes/auth-routes.ts:327](../../src/routes/auth-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/auth/confirm-email-change`, method `post`.

### listUsersAsAdmin

- Endpoint: `GET /api/admin/users/`.
- Route guard: ADMIN; resource checks still apply.
- Parameters: none.
- JSON body (`?` = optional): none.
- Declared statuses: 200, 401, 403.
- Source: [src/routes/admin-user-routes.ts:21](../../src/routes/admin-user-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/admin/users/`, method `get`.

### updateUserStatusAsAdmin

- Endpoint: `PATCH /api/admin/users/{userId}/status`.
- Route guard: ADMIN; resource checks still apply.
- Parameters: path userId:uuid.
- JSON body (`?` = optional): status:ACTIVE/DISABLED.
- Declared statuses: 200, 400, 401, 403, 404.
- Source: [src/routes/admin-user-routes.ts:41](../../src/routes/admin-user-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/admin/users/{userId}/status`, method `patch`.

### associateDriverWithOperator

- Endpoint: `POST /api/driver-associations`.
- Route guard: OPERATOR; resource checks still apply.
- Parameters: none.
- JSON body (`?` = optional): email:string.
- Declared statuses: 200, 400, 401, 403, 409.
- Source: [src/routes/fleet-routes.ts:87](../../src/routes/fleet-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/driver-associations`, method `post`.

### listJeepneys

- Endpoint: `GET /api/jeepneys`.
- Route guard: DRIVER, OPERATOR, ADMIN; resource checks still apply.
- Parameters: none.
- JSON body (`?` = optional): none.
- Declared statuses: 200, 401, 403.
- Source: [src/routes/fleet-routes.ts:116](../../src/routes/fleet-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/jeepneys`, method `get`.

### createJeepney

- Endpoint: `POST /api/jeepneys`.
- Route guard: DRIVER, OPERATOR, ADMIN; resource checks still apply.
- Parameters: none.
- JSON body (`?` = optional): operatorId?:uuid, plateNo:string, colorHex:string, description?:string.
- Declared statuses: 201, 400, 401, 403, 409.
- Source: [src/routes/fleet-routes.ts:138](../../src/routes/fleet-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/jeepneys`, method `post`.

### updateJeepney

- Endpoint: `PATCH /api/jeepneys/{jeepneyId}`.
- Route guard: DRIVER, OPERATOR, ADMIN; resource checks still apply.
- Parameters: path jeepneyId:uuid.
- JSON body (`?` = optional): colorHex?:string, description?:string or null, status?:DRAFT/PENDING_APPROVAL/APPROVED/ACTIVE/INACTIVE/REJECTED.
- Declared statuses: 200, 400, 401, 403, 404.
- Source: [src/routes/fleet-routes.ts:172](../../src/routes/fleet-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/jeepneys/{jeepneyId}`, method `patch`.

### assignDriverToJeepney

- Endpoint: `POST /api/jeepneys/{jeepneyId}/driver-assignment`.
- Route guard: OPERATOR, ADMIN; resource checks still apply.
- Parameters: path jeepneyId:uuid.
- JSON body (`?` = optional): driverId:uuid.
- Declared statuses: 201, 400, 401, 403, 404, 409.
- Source: [src/routes/fleet-routes.ts:211](../../src/routes/fleet-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/jeepneys/{jeepneyId}/driver-assignment`, method `post`.

### listFleetGroups

- Endpoint: `GET /api/fleet-groups`.
- Route guard: DRIVER, OPERATOR, ADMIN; resource checks still apply.
- Parameters: none.
- JSON body (`?` = optional): none.
- Declared statuses: 200, 401, 403.
- Source: [src/routes/fleet-routes.ts:243](../../src/routes/fleet-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/fleet-groups`, method `get`.

### createFleetGroup

- Endpoint: `POST /api/fleet-groups`.
- Route guard: OPERATOR, ADMIN; resource checks still apply.
- Parameters: none.
- JSON body (`?` = optional): operatorId?:uuid, name:string, description?:string.
- Declared statuses: 201, 400, 401, 403.
- Source: [src/routes/fleet-routes.ts:265](../../src/routes/fleet-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/fleet-groups`, method `post`.

### updateFleetGroup

- Endpoint: `PATCH /api/fleet-groups/{groupId}`.
- Route guard: OPERATOR, ADMIN; resource checks still apply.
- Parameters: path groupId:uuid.
- JSON body (`?` = optional): name?:string, description?:string or null, status?:ACTIVE/INACTIVE.
- Declared statuses: 200, 400, 401, 403, 404.
- Source: [src/routes/fleet-routes.ts:297](../../src/routes/fleet-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/fleet-groups/{groupId}`, method `patch`.

### addDriverToFleetGroup

- Endpoint: `POST /api/fleet-groups/{groupId}/drivers`.
- Route guard: OPERATOR, ADMIN; resource checks still apply.
- Parameters: path groupId:uuid.
- JSON body (`?` = optional): driverId:uuid.
- Declared statuses: 200, 400, 401, 403, 404, 409.
- Source: [src/routes/fleet-routes.ts:336](../../src/routes/fleet-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/fleet-groups/{groupId}/drivers`, method `post`.

### addJeepneyToFleetGroup

- Endpoint: `POST /api/fleet-groups/{groupId}/jeepneys`.
- Route guard: OPERATOR, ADMIN; resource checks still apply.
- Parameters: path groupId:uuid.
- JSON body (`?` = optional): jeepneyId:uuid.
- Declared statuses: 200, 400, 401, 403, 404, 409.
- Source: [src/routes/fleet-routes.ts:368](../../src/routes/fleet-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/fleet-groups/{groupId}/jeepneys`, method `post`.

### listPublicTransitRoutes

- Endpoint: `GET /api/transit-routes`.
- Route guard: PUBLIC; resource checks still apply.
- Parameters: query q:string, query page:integer, query pageSize:integer.
- JSON body (`?` = optional): none.
- Declared statuses: 200.
- Source: [src/routes/transit-routes.ts:95](../../src/routes/transit-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/transit-routes`, method `get`.

### getPublicTransitRoute

- Endpoint: `GET /api/transit-routes/{routeId}`.
- Route guard: PUBLIC; resource checks still apply.
- Parameters: path routeId:uuid.
- JSON body (`?` = optional): none.
- Declared statuses: 200, 404.
- Source: [src/routes/transit-routes.ts:132](../../src/routes/transit-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/transit-routes/{routeId}`, method `get`.

### listTransitRoutesAsAdmin

- Endpoint: `GET /api/admin/transit-routes`.
- Route guard: ADMIN; resource checks still apply.
- Parameters: none.
- JSON body (`?` = optional): none.
- Declared statuses: 200, 401, 403.
- Source: [src/routes/transit-routes.ts:155](../../src/routes/transit-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/admin/transit-routes`, method `get`.

### createTransitRoute

- Endpoint: `POST /api/admin/transit-routes`.
- Route guard: ADMIN; resource checks still apply.
- Parameters: none.
- JSON body (`?` = optional): routeCode:string, publicName:string, description?:string, routeColorHex:string.
- Declared statuses: 201, 400, 401, 403, 409.
- Source: [src/routes/transit-routes.ts:180](../../src/routes/transit-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/admin/transit-routes`, method `post`.

### updateTransitRoute

- Endpoint: `PATCH /api/admin/transit-routes/{routeId}`.
- Route guard: ADMIN; resource checks still apply.
- Parameters: path routeId:uuid.
- JSON body (`?` = optional): publicName?:string, description?:string or null, routeColorHex?:string, status?:DRAFT/ACTIVE/INACTIVE/ARCHIVED.
- Declared statuses: 200, 400, 401, 403, 404.
- Source: [src/routes/transit-routes.ts:214](../../src/routes/transit-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/admin/transit-routes/{routeId}`, method `patch`.

### createRouteDirection

- Endpoint: `POST /api/admin/transit-routes/{routeId}/directions`.
- Route guard: ADMIN; resource checks still apply.
- Parameters: path routeId:uuid.
- JSON body (`?` = optional): directionLabel:string, originName:string, destinationName:string, geometry:object (exact schema in snapshot), corridorM?:integer.
- Declared statuses: 201, 400, 401, 403, 404, 409.
- Source: [src/routes/transit-routes.ts:254](../../src/routes/transit-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/admin/transit-routes/{routeId}/directions`, method `post`.

### updateRouteDirection

- Endpoint: `PATCH /api/admin/route-directions/{directionId}`.
- Route guard: ADMIN; resource checks still apply.
- Parameters: path directionId:uuid.
- JSON body (`?` = optional): directionLabel?:string, originName?:string, destinationName?:string, geometry?:object (exact schema in snapshot), corridorM?:integer, status?:DRAFT/ACTIVE/INACTIVE/ARCHIVED.
- Declared statuses: 200, 400, 401, 403, 404, 409.
- Source: [src/routes/transit-routes.ts:295](../../src/routes/transit-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/admin/route-directions/{directionId}`, method `patch`.

### assignTransitRoute

- Endpoint: `POST /api/route-assignments`.
- Route guard: OPERATOR; resource checks still apply.
- Parameters: none.
- JSON body (`?` = optional): routeDirectionId:uuid, jeepneyId?:uuid, groupId?:uuid.
- Declared statuses: 201, 400, 401, 403, 409.
- Source: [src/routes/transit-routes.ts:338](../../src/routes/transit-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/route-assignments`, method `post`.

### getJeepneyEffectiveRoute

- Endpoint: `GET /api/jeepneys/{jeepneyId}/effective-route`.
- Route guard: DRIVER, OPERATOR, ADMIN; resource checks still apply.
- Parameters: path jeepneyId:uuid.
- JSON body (`?` = optional): none.
- Declared statuses: 200, 401, 403, 404, 409.
- Source: [src/routes/transit-routes.ts:374](../../src/routes/transit-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/jeepneys/{jeepneyId}/effective-route`, method `get`.

### listVehicleApplications

- Endpoint: `GET /api/vehicle-applications`.
- Route guard: DRIVER, OPERATOR, ADMIN; resource checks still apply.
- Parameters: none.
- JSON body (`?` = optional): none.
- Declared statuses: 200, 401, 403.
- Source: [src/routes/vehicle-workflow-routes.ts:88](../../src/routes/vehicle-workflow-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/vehicle-applications`, method `get`.

### submitVehicleApplication

- Endpoint: `POST /api/vehicle-applications`.
- Route guard: DRIVER, OPERATOR; resource checks still apply.
- Parameters: none.
- JSON body (`?` = optional): jeepneyId:uuid, applicantNotes?:string.
- Declared statuses: 201, 400, 401, 403, 409.
- Source: [src/routes/vehicle-workflow-routes.ts:112](../../src/routes/vehicle-workflow-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/vehicle-applications`, method `post`.

### reviewVehicleApplication

- Endpoint: `PATCH /api/admin/vehicle-applications/{applicationId}/review`.
- Route guard: ADMIN; resource checks still apply.
- Parameters: path applicationId:uuid.
- JSON body (`?` = optional): decision:APPROVED/REJECTED, reviewNotes?:string.
- Declared statuses: 200, 400, 401, 403, 404, 409.
- Source: [src/routes/vehicle-workflow-routes.ts:148](../../src/routes/vehicle-workflow-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/admin/vehicle-applications/{applicationId}/review`, method `patch`.

### listGpsSetupRequests

- Endpoint: `GET /api/gps-setup-requests`.
- Route guard: DRIVER, OPERATOR, ADMIN; resource checks still apply.
- Parameters: none.
- JSON body (`?` = optional): none.
- Declared statuses: 200, 401, 403.
- Source: [src/routes/vehicle-workflow-routes.ts:188](../../src/routes/vehicle-workflow-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/gps-setup-requests`, method `get`.

### submitGpsSetupRequest

- Endpoint: `POST /api/gps-setup-requests`.
- Route guard: DRIVER, OPERATOR; resource checks still apply.
- Parameters: none.
- JSON body (`?` = optional): vehicleApplicationId:uuid.
- Declared statuses: 201, 400, 401, 403, 404, 409.
- Source: [src/routes/vehicle-workflow-routes.ts:212](../../src/routes/vehicle-workflow-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/gps-setup-requests`, method `post`.

### transitionGpsSetupStatus

- Endpoint: `PATCH /api/admin/gps-setup-requests/{requestId}/status`.
- Route guard: ADMIN; resource checks still apply.
- Parameters: path requestId:uuid.
- JSON body (`?` = optional): status:APPROVED/SCHEDULED/INSTALLED/REJECTED, scheduledAt?:UTC timestamp, rejectedReason?:string.
- Declared statuses: 200, 400, 401, 403, 404, 409.
- Source: [src/routes/vehicle-workflow-routes.ts:242](../../src/routes/vehicle-workflow-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/admin/gps-setup-requests/{requestId}/status`, method `patch`.

### mapGpsDevice

- Endpoint: `POST /api/admin/gps-setup-requests/{requestId}/device-mapping`.
- Route guard: ADMIN; resource checks still apply.
- Parameters: path requestId:uuid.
- JSON body (`?` = optional): imei:string, serialNumber:string, traccarUniqueId:string.
- Declared statuses: 201, 400, 401, 403, 404, 409.
- Source: [src/routes/vehicle-workflow-routes.ts:288](../../src/routes/vehicle-workflow-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/admin/gps-setup-requests/{requestId}/device-mapping`, method `post`.

### verifyGpsInstallation

- Endpoint: `POST /api/admin/gps-setup-requests/{requestId}/verification`.
- Route guard: ADMIN; resource checks still apply.
- Parameters: path requestId:uuid.
- JSON body (`?` = optional): powerOk:boolean, simOk:boolean, serverOk:boolean, gpsFixOk:boolean, notes?:string.
- Declared statuses: 200, 400, 401, 403, 404, 409.
- Source: [src/routes/vehicle-workflow-routes.ts:331](../../src/routes/vehicle-workflow-routes.ts). Exact field limits, required/nullability and nested response schemas: snapshot path `/admin/gps-setup-requests/{requestId}/verification`, method `post`.

## Non-business documentation routes

`GET /documentation` serves Swagger UI and `GET /documentation/json` returns the specification; they are tooling routes, outside the44 business operations. The Admin user collection is serialized as `/api/admin/users/`; offline injection confirms `/api/admin/users` also reaches authentication. Use a consistent form in clients. Future OpenAPI tags are placeholders, not implemented operations. Additional undeclared service errors/global handler behavior are recorded in the handoff; declared responses are not an exhaustive runtime guarantee.

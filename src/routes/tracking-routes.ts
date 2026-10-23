import type { FastifyPluginAsync } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';

import type { User } from '../domain/identity.js';
import { ApiError } from '../lib/api-error.js';
import { OpenApiTags } from '../openapi.js';
import { ErrorSchema } from '../schemas/common.js';
import type { TrackingReadService } from '../tracking/tracking-read-service.js';

export interface TrackingRoutesOptions {
  readService: TrackingReadService;
}

// Stage 13b B5a — PROPOSED T1–T3 (M7 pending). Registered only when TRACKING_API_ENABLED=true.
const proposed = 'PROPOSED Stage 13b contract (not frozen, M7 pending); disabled unless TRACKING_API_ENABLED=true.';
const Uuid = Type.String({ format: 'uuid' });
const DateTime = Type.String({ format: 'date-time' });
const NullableDateTime = Type.Union([DateTime, Type.Null()]);
const ColorHex = Type.String({ pattern: '^#[0-9A-Fa-f]{6}$' });
const Position = Type.Object(
  {
    latitude: Type.Number({ minimum: -90, maximum: 90 }),
    longitude: Type.Number({ minimum: -180, maximum: 180 }),
    fixTime: DateTime,
    speedKph: Type.Number({ minimum: 0, maximum: 300 }),
    heading: Type.Number({ minimum: 0, exclusiveMaximum: 360 }),
  },
  { additionalProperties: false },
);
const Motion = Type.Union([Type.Literal('MOVING'), Type.Literal('STOPPED'), Type.Literal('UNKNOWN')]);
const PublicVehicle = Type.Object(
  {
    jeepneyId: Uuid,
    plateNo: Type.String(),
    physicalColorHex: ColorHex,
    routeId: Uuid,
    directionId: Uuid,
    stateRevision: Type.String({ pattern: '^[1-9][0-9]*$' }),
    position: Position,
    trackerStatus: Type.Literal('ONLINE'),
    motionStatus: Motion,
    routeCompliance: Type.Literal('ON_ROUTE'),
    lastSuccessfulUpdateAt: DateTime,
    availableUntil: DateTime,
  },
  { additionalProperties: false },
);
const PrivateTracking = Type.Object(
  {
    trackerStatus: Type.Union([Type.Literal('ONLINE'), Type.Literal('OFFLINE'), Type.Literal('UNKNOWN')]),
    motionStatus: Motion,
    locationStatus: Type.Union([Type.Literal('CURRENT'), Type.Literal('LAST_KNOWN'), Type.Literal('NONE')]),
    routeCompliance: Type.Union([Type.Literal('ON_ROUTE'), Type.Literal('OFF_ROUTE'), Type.Literal('UNKNOWN')]),
    routeResolution: Type.Union([
      Type.Literal('USABLE'), Type.Literal('UNASSIGNED'), Type.Literal('INACTIVE'), Type.Literal('CONFLICT'),
    ]),
    reason: Type.Union([Type.String(), Type.Null()]),
    deviation: Type.Union([
      Type.Object(
        { since: DateTime, distanceM: Type.Number({ minimum: 0 }), corridorM: Type.Integer({ minimum: 1 }) },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    fixTime: NullableDateTime,
    lastSuccessfulUpdateAt: NullableDateTime,
    availableUntil: NullableDateTime,
  },
  { additionalProperties: false },
);
const PrivateVehicle = Type.Object(
  {
    jeepneyId: Uuid,
    plateNo: Type.String(),
    physicalColorHex: ColorHex,
    relation: Type.Array(Type.Union([
      Type.Literal('ASSIGNED'), Type.Literal('GROUP'), Type.Literal('OWNED'), Type.Literal('PLATFORM'),
    ])),
    routeId: Type.Union([Uuid, Type.Null()]),
    directionId: Type.Union([Uuid, Type.Null()]),
    stateRevision: Type.Union([Type.String({ pattern: '^[1-9][0-9]*$' }), Type.Null()]),
    tracking: Type.Union([PrivateTracking, Type.Null()]),
    position: Type.Union([Position, Type.Null()]),
    positionIsLastKnown: Type.Boolean(),
  },
  { additionalProperties: false },
);
const Count = Type.Integer({ minimum: 0 });
const Summary = Type.Object(
  {
    total: Count, online: Count, offline: Count, unknown: Count,
    moving: Count, stopped: Count, onRoute: Count, offRoute: Count,
  },
  { additionalProperties: false },
);

export const trackingRoutes: FastifyPluginAsync<TrackingRoutesOptions> = async (instance, options) => {
  const fastify = instance.withTypeProvider<TypeBoxTypeProvider>();
  // Dynamic and role-specific: never cached by clients, proxies or CDNs.
  fastify.addHook('onSend', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
  });

  fastify.get(
    '/tracking/route-directions/:directionId/vehicles',
    {
      schema: {
        tags: [OpenApiTags.liveTracking],
        operationId: 'getRouteDirectionTrackingSnapshot',
        summary: 'Currently available jeepneys on one route direction (T1)',
        // Public-access/privacy contract (sign-in or not) is undecided; no authentication is forced here.
        description: `${proposed} Public-safe complete snapshot: only vehicles that are ONLINE with a valid fix aged 0–30 s, ON_ROUTE on this ACTIVE direction, currently eligible and served by a live writer lease. No driver, operator or provider identifiers.`,
        params: Type.Object({ directionId: Uuid }),
        response: {
          200: Type.Object(
            {
              schemaVersion: Type.Literal(1),
              snapshotAt: DateTime,
              scope: Type.Object(
                { kind: Type.Literal('ROUTE_DIRECTION'), id: Uuid },
                { additionalProperties: false },
              ),
              complete: Type.Literal(true),
              count: Count,
              vehicles: Type.Array(PublicVehicle),
            },
            { additionalProperties: false },
          ),
          404: ErrorSchema,
          422: ErrorSchema,
        },
      },
    },
    async (request) => options.readService.publicDirection(request.params.directionId),
  );

  fastify.get(
    '/tracking/vehicles',
    {
      preHandler: fastify.requireRoles('DRIVER', 'OPERATOR', 'ADMIN'),
      schema: {
        tags: [OpenApiTags.liveTracking],
        operationId: 'listPrivateTrackingSnapshot',
        summary: 'Private tracking snapshot for the caller scope (T2)',
        description: `${proposed} DRIVER: assigned, same-group or created vehicles; OPERATOR: own fleet; ADMIN: platform. groupId only narrows. Stale, ahead, lost-lease or context-changed data is never labelled live.`,
        security: [{ bearerAuth: [] }],
        querystring: Type.Object({ groupId: Type.Optional(Uuid) }, { additionalProperties: false }),
        response: {
          200: Type.Object(
            {
              schemaVersion: Type.Literal(1),
              snapshotAt: DateTime,
              scope: Type.Object(
                {
                  kind: Type.Union([Type.Literal('DRIVER'), Type.Literal('OPERATOR'), Type.Literal('ADMIN')]),
                  groupId: Type.Union([Uuid, Type.Null()]),
                },
                { additionalProperties: false },
              ),
              complete: Type.Literal(true),
              summary: Summary,
              vehicles: Type.Array(PrivateVehicle),
            },
            { additionalProperties: false },
          ),
          401: ErrorSchema,
          403: ErrorSchema,
          422: ErrorSchema,
        },
      },
    },
    async (request) =>
      options.readService.privateFleet(requireUser(request.currentUser), request.query.groupId ?? null),
  );

  fastify.get(
    '/tracking/jeepneys/:jeepneyId/latest',
    {
      preHandler: fastify.requireRoles('DRIVER', 'OPERATOR', 'ADMIN'),
      schema: {
        tags: [OpenApiTags.liveTracking],
        operationId: 'getJeepneyLatestTracking',
        summary: 'Latest private tracking for one permitted jeepney (T3)',
        description: `${proposed} Authorized by Agent A's private-tracking visibility; tracking is null when no state exists.`,
        security: [{ bearerAuth: [] }],
        params: Type.Object({ jeepneyId: Uuid }),
        response: {
          200: Type.Object(
            { snapshotAt: DateTime, vehicle: PrivateVehicle },
            { additionalProperties: false },
          ),
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (request) => options.readService.privateVehicle(requireUser(request.currentUser), request.params.jeepneyId),
  );
};

function requireUser(user: User | null): User {
  if (user === null) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required');
  return user;
}

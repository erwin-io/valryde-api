import type { FastifyPluginAsync } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';

import type { User } from '../domain/identity.js';
import {
  serializeEffectiveRouteDirection,
  serializeRouteDirection,
  serializeTransitRoute,
  serializeVehicleRouteAssignment,
} from '../domain/transit.js';
import { ApiError } from '../lib/api-error.js';
import { OpenApiTags } from '../openapi.js';
import { ErrorSchema } from '../schemas/common.js';
import type { TransitService } from '../services/transit-service.js';

export interface TransitRoutesOptions {
  transitService: TransitService;
}

const Uuid = Type.String({ format: 'uuid' });
const DateTime = Type.String({ format: 'date-time' });
const NullableString = Type.Union([Type.String(), Type.Null()]);
const ColorHex = Type.String({ pattern: '^#[0-9A-Fa-f]{6}$', examples: ['#43A047'] });
const RecordStatusSchema = Type.Union([
  Type.Literal('DRAFT'),
  Type.Literal('ACTIVE'),
  Type.Literal('INACTIVE'),
  Type.Literal('ARCHIVED'),
]);
const GeometrySchema = Type.Object(
  {
    type: Type.Literal('LineString'),
    coordinates: Type.Array(Type.Tuple([Type.Number(), Type.Number()]), {
      minItems: 2,
      maxItems: 10000,
      examples: [[[123.86, 10.26], [123.90, 10.30]]],
    }),
  },
  { additionalProperties: false },
);
const DirectionSchema = Type.Object({
  id: Uuid,
  routeId: Uuid,
  directionLabel: Type.String(),
  originName: Type.String(),
  destinationName: Type.String(),
  geometry: GeometrySchema,
  corridorM: Type.Integer(),
  status: RecordStatusSchema,
  createdAt: DateTime,
  updatedAt: DateTime,
});
const RouteFields = {
  id: Uuid,
  routeCode: Type.String(),
  publicName: Type.String(),
  description: NullableString,
  routeColorHex: ColorHex,
  status: RecordStatusSchema,
  createdAt: DateTime,
  updatedAt: DateTime,
};
const RouteSchema = Type.Object(RouteFields);
const RouteWithDirectionsSchema = Type.Object({
  ...RouteFields,
  directions: Type.Array(DirectionSchema),
});
const AssignmentSchema = Type.Object({
  id: Uuid,
  jeepneyId: Type.Union([Uuid, Type.Null()]),
  groupId: Type.Union([Uuid, Type.Null()]),
  routeDirectionId: Uuid,
  assignedByUserId: Uuid,
  activeFrom: DateTime,
  activeTo: Type.Union([DateTime, Type.Null()]),
});
const EffectiveRouteDirectionSchema = Type.Object({
  source: Type.Union([Type.Literal('DIRECT'), Type.Literal('GROUP')]),
  assignmentId: Uuid,
  groupId: Type.Union([Uuid, Type.Null()]),
  activeFrom: DateTime,
  direction: DirectionSchema,
});
const PaginationSchema = Type.Object({
  page: Type.Integer({ minimum: 1 }),
  pageSize: Type.Integer({ minimum: 1 }),
  total: Type.Integer({ minimum: 0 }),
  totalPages: Type.Integer({ minimum: 0 }),
});

export const transitRoutes: FastifyPluginAsync<TransitRoutesOptions> = async (instance, options) => {
  const fastify = instance.withTypeProvider<TypeBoxTypeProvider>();

  fastify.get(
    '/transit-routes',
    {
      schema: {
        tags: [OpenApiTags.transit],
        operationId: 'listPublicTransitRoutes',
        summary: 'List active public transit routes',
        description: 'Public searchable, paginated endpoint returning only active routes and active directions with canonical Admin-owned GeoJSON geometry.',
        querystring: Type.Object(
          {
            q: Type.Optional(Type.String({ minLength: 1, maxLength: 160, examples: ['Colon'] })),
            page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
            pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
          },
          { additionalProperties: false },
        ),
        response: { 200: Type.Object({ routes: Type.Array(RouteWithDirectionsSchema), pagination: PaginationSchema }) },
      },
    },
    async (request) => {
      const page = request.query.page ?? 1;
      const pageSize = request.query.pageSize ?? 20;
      const result = await options.transitService.listPublicRoutes({
        ...(request.query.q === undefined ? {} : { q: request.query.q }),
        page,
        pageSize,
      });
      return {
      routes: result.routes.map((route) => ({
        ...serializeTransitRoute(route),
        directions: route.directions.map(serializeRouteDirection),
      })),
      pagination: { page, pageSize, total: result.total, totalPages: Math.ceil(result.total / pageSize) },
    };
    },
  );

  fastify.get(
    '/transit-routes/:routeId',
    {
      schema: {
        tags: [OpenApiTags.transit],
        operationId: 'getPublicTransitRoute',
        summary: 'Get active public transit route details',
        description: 'Returns one active route with its active directions and canonical Admin-owned GeoJSON geometry.',
        params: Type.Object({ routeId: Uuid }),
        response: { 200: Type.Object({ route: RouteWithDirectionsSchema }), 404: ErrorSchema },
      },
    },
    async (request) => {
      const route = await options.transitService.getPublicRoute(request.params.routeId);
      return {
        route: {
          ...serializeTransitRoute(route),
          directions: route.directions.map(serializeRouteDirection),
        },
      };
    },
  );

  fastify.get(
    '/admin/transit-routes',
    {
      preHandler: fastify.requireRoles('ADMIN'),
      schema: {
        tags: [OpenApiTags.transit],
        operationId: 'listTransitRoutesAsAdmin',
        summary: 'List all transit routes',
        description: 'ADMIN-only view including draft, inactive, and archived routes and directions.',
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Object({ routes: Type.Array(RouteWithDirectionsSchema) }),
          401: ErrorSchema,
          403: ErrorSchema,
        },
      },
    },
    async () => ({
      routes: (await options.transitService.listAdminRoutes()).map((route) => ({
        ...serializeTransitRoute(route),
        directions: route.directions.map(serializeRouteDirection),
      })),
    }),
  );

  fastify.post(
    '/admin/transit-routes',
    {
      preHandler: fastify.requireRoles('ADMIN'),
      schema: {
        tags: [OpenApiTags.transit],
        operationId: 'createTransitRoute',
        summary: 'Create a canonical transit route',
        description: 'ADMIN-only creation of route identity, public name, description, and display color.',
        security: [{ bearerAuth: [] }],
        body: Type.Object(
          {
            routeCode: Type.String({ minLength: 1, maxLength: 32, examples: ['10F'] }),
            publicName: Type.String({ minLength: 1, maxLength: 160, examples: ['Bulacao — Colon'] }),
            description: Type.Optional(Type.String({ maxLength: 2000 })),
            routeColorHex: ColorHex,
          },
          { additionalProperties: false },
        ),
        response: {
          201: Type.Object({ route: RouteSchema }),
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const route = await options.transitService.createRoute(requireUser(request.currentUser), request.body);
      return reply.code(201).send({ route: serializeTransitRoute(route) });
    },
  );

  fastify.patch(
    '/admin/transit-routes/:routeId',
    {
      preHandler: fastify.requireRoles('ADMIN'),
      schema: {
        tags: [OpenApiTags.transit],
        operationId: 'updateTransitRoute',
        summary: 'Update a canonical transit route',
        description: 'ADMIN-only update of canonical route metadata and lifecycle status.',
        security: [{ bearerAuth: [] }],
        params: Type.Object({ routeId: Uuid }),
        body: Type.Object(
          {
            publicName: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
            description: Type.Optional(NullableString),
            routeColorHex: Type.Optional(ColorHex),
            status: Type.Optional(RecordStatusSchema),
          },
          { additionalProperties: false, minProperties: 1 },
        ),
        response: {
          200: Type.Object({ route: RouteSchema }),
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (request) => ({
      route: serializeTransitRoute(
        await options.transitService.updateRoute(
          requireUser(request.currentUser),
          request.params.routeId,
          request.body,
        ),
      ),
    }),
  );

  fastify.post(
    '/admin/transit-routes/:routeId/directions',
    {
      preHandler: fastify.requireRoles('ADMIN'),
      schema: {
        tags: [OpenApiTags.transit],
        operationId: 'createRouteDirection',
        summary: 'Create a route direction',
        description: 'ADMIN-only creation of a WGS84 GeoJSON LineString direction and corridor tolerance.',
        security: [{ bearerAuth: [] }],
        params: Type.Object({ routeId: Uuid }),
        body: Type.Object(
          {
            directionLabel: Type.String({ minLength: 1, maxLength: 120 }),
            originName: Type.String({ minLength: 1, maxLength: 160 }),
            destinationName: Type.String({ minLength: 1, maxLength: 160 }),
            geometry: GeometrySchema,
            corridorM: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000 })),
          },
          { additionalProperties: false },
        ),
        response: {
          201: Type.Object({ direction: DirectionSchema }),
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const direction = await options.transitService.createDirection(
        requireUser(request.currentUser),
        request.params.routeId,
        request.body,
      );
      return reply.code(201).send({ direction: serializeRouteDirection(direction) });
    },
  );

  fastify.patch(
    '/admin/route-directions/:directionId',
    {
      preHandler: fastify.requireRoles('ADMIN'),
      schema: {
        tags: [OpenApiTags.transit],
        operationId: 'updateRouteDirection',
        summary: 'Update a route direction',
        description: 'ADMIN-only update of direction labels, endpoints, geometry, corridor, or lifecycle status.',
        security: [{ bearerAuth: [] }],
        params: Type.Object({ directionId: Uuid }),
        body: Type.Object(
          {
            directionLabel: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
            originName: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
            destinationName: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
            geometry: Type.Optional(GeometrySchema),
            corridorM: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000 })),
            status: Type.Optional(RecordStatusSchema),
          },
          { additionalProperties: false, minProperties: 1 },
        ),
        response: {
          200: Type.Object({ direction: DirectionSchema }),
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (request) => ({
      direction: serializeRouteDirection(
        await options.transitService.updateDirection(
          requireUser(request.currentUser),
          request.params.directionId,
          request.body,
        ),
      ),
    }),
  );

  fastify.post(
    '/route-assignments',
    {
      preHandler: fastify.requireRoles('OPERATOR'),
      schema: {
        tags: [OpenApiTags.transit],
        operationId: 'assignTransitRoute',
        summary: 'Assign an active route direction',
        description: 'OPERATOR-only assignment of one active route direction to an owned jeepney or fleet group.',
        security: [{ bearerAuth: [] }],
        body: Type.Object(
          {
            routeDirectionId: Uuid,
            jeepneyId: Type.Optional(Uuid),
            groupId: Type.Optional(Uuid),
          },
          { additionalProperties: false },
        ),
        response: {
          201: Type.Object({ assignment: AssignmentSchema }),
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const assignment = await options.transitService.assignRoute(
        requireUser(request.currentUser),
        request.body,
      );
      return reply.code(201).send({ assignment: serializeVehicleRouteAssignment(assignment) });
    },
  );

  fastify.get(
    '/jeepneys/:jeepneyId/effective-route',
    {
      preHandler: fastify.requireRoles('DRIVER', 'OPERATOR', 'ADMIN'),
      schema: {
        tags: [OpenApiTags.transit],
        operationId: 'getJeepneyEffectiveRoute',
        summary: 'Resolve a jeepney effective route direction',
        description:
          'Returns the single server-authoritative route direction for a permitted jeepney. An active direct jeepney assignment takes precedence; otherwise exactly one active fleet-group assignment is used. Multiple inherited group assignments produce ROUTE_ASSIGNMENT_CONFLICT.',
        security: [{ bearerAuth: [] }],
        params: Type.Object({ jeepneyId: Uuid }),
        response: {
          200: Type.Object({
            effectiveRouteDirection: Type.Union([EffectiveRouteDirectionSchema, Type.Null()]),
          }),
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (request) => {
      const effective = await options.transitService.getEffectiveRouteDirection(
        requireUser(request.currentUser),
        request.params.jeepneyId,
      );
      return {
        effectiveRouteDirection:
          effective === null ? null : serializeEffectiveRouteDirection(effective),
      };
    },
  );
};

function requireUser(user: User | null): User {
  if (user === null) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required');
  return user;
}

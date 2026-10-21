import type { FastifyPluginAsync } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';

import {
  serializeDriverAssignment,
  serializeDriverDirectoryEntry,
  serializeFleetGroup,
  serializeJeepney,
  serializeOperatorDirectoryEntry,
} from '../domain/fleet.js';
import type { User } from '../domain/identity.js';
import { ApiError } from '../lib/api-error.js';
import { OpenApiTags } from '../openapi.js';
import { EmailSchema, ErrorSchema, MessageSchema } from '../schemas/common.js';
import type { FleetService } from '../services/fleet-service.js';

export interface FleetRoutesOptions {
  fleetService: FleetService;
}

const NullableString = Type.Union([Type.String(), Type.Null()]);
const DateTimeString = Type.String({ format: 'date-time' });
const Uuid = Type.String({ format: 'uuid' });
const ColorHex = Type.String({ pattern: '^#[0-9A-Fa-f]{6}$', examples: ['#1E88E5'] });

const JeepneyStatusSchema = Type.Union([
  Type.Literal('DRAFT'),
  Type.Literal('PENDING_APPROVAL'),
  Type.Literal('APPROVED'),
  Type.Literal('ACTIVE'),
  Type.Literal('INACTIVE'),
  Type.Literal('REJECTED'),
]);

const JeepneySchema = Type.Object({
  id: Uuid,
  operatorId: Type.Union([Uuid, Type.Null()]),
  plateNo: Type.String(),
  colorHex: ColorHex,
  description: NullableString,
  status: JeepneyStatusSchema,
  approvedAt: Type.Union([DateTimeString, Type.Null()]),
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
});

const GroupStatusSchema = Type.Union([Type.Literal('ACTIVE'), Type.Literal('INACTIVE')]);
const FleetGroupSchema = Type.Object({
  id: Uuid,
  operatorId: Uuid,
  name: Type.String(),
  description: NullableString,
  status: GroupStatusSchema,
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
});

const DriverAssignmentSchema = Type.Object({
  id: Uuid,
  driverId: Uuid,
  jeepneyId: Uuid,
  assignedByUserId: Uuid,
  activeFrom: DateTimeString,
  activeTo: Type.Union([DateTimeString, Type.Null()]),
});

const DriverAssociationSchema = Type.Object({
  driverId: Uuid,
  userId: Uuid,
  email: Type.String({ format: 'email' }),
  displayName: Type.String(),
  operatorId: Uuid,
});

const UserStatusSchema = Type.Union([Type.Literal('ACTIVE'), Type.Literal('DISABLED')]);
const PaginationSchema = Type.Object(
  {
    page: Type.Integer({ minimum: 1 }),
    pageSize: Type.Integer({ minimum: 1 }),
    total: Type.Integer({ minimum: 0 }),
    totalPages: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
const DirectoryQueryFields = {
  q: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  status: Type.Optional(UserStatusSchema),
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
};
const DriverDirectorySchema = Type.Object(
  {
    driverId: Uuid,
    userId: Uuid,
    email: EmailSchema,
    displayName: Type.String(),
    status: UserStatusSchema,
    userStatus: UserStatusSchema,
    emailVerified: Type.Boolean(),
    operatorId: Type.Union([Uuid, Type.Null()]),
    activeJeepneyId: Type.Union([Uuid, Type.Null()]),
    groupIds: Type.Array(Uuid),
    createdAt: DateTimeString,
  },
  { additionalProperties: false },
);
const OperatorDirectorySchema = Type.Object(
  {
    operatorId: Uuid,
    ownerUserId: Uuid,
    email: EmailSchema,
    displayName: Type.String(),
    status: UserStatusSchema,
    userStatus: UserStatusSchema,
    driverCount: Type.Integer({ minimum: 0 }),
    jeepneyCount: Type.Integer({ minimum: 0 }),
    groupCount: Type.Integer({ minimum: 0 }),
    createdAt: DateTimeString,
  },
  { additionalProperties: false },
);

const JeepneyIdParams = Type.Object({ jeepneyId: Uuid });
const GroupIdParams = Type.Object({ groupId: Uuid });

function currentUser(request: { currentUser: User | null }) {
  if (request.currentUser === null) {
    throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required');
  }
  return request.currentUser;
}

export const fleetRoutes: FastifyPluginAsync<FleetRoutesOptions> = async (instance, options) => {
  const fastify = instance.withTypeProvider<TypeBoxTypeProvider>();

  fastify.get(
    '/drivers',
    {
      preHandler: fastify.requireRoles('OPERATOR', 'ADMIN'),
      schema: {
        tags: [OpenApiTags.fleetGroups],
        operationId: 'listDrivers',
        summary: 'List the permitted Driver directory',
        description:
          'Returns an OPERATOR-scoped Driver directory or the global ADMIN directory. OPERATOR callers cannot widen their server-authoritative scope with Admin-only filters.',
        security: [{ bearerAuth: [] }],
        querystring: Type.Object(
          {
            ...DirectoryQueryFields,
            operatorId: Type.Optional(Uuid),
            associated: Type.Optional(Type.Boolean()),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object(
            { drivers: Type.Array(DriverDirectorySchema), pagination: PaginationSchema },
            { additionalProperties: false },
          ),
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          429: ErrorSchema,
        },
      },
    },
    async (request) => {
      const result = await options.fleetService.listDrivers(currentUser(request), {
        ...request.query,
        page: request.query.page ?? 1,
        pageSize: request.query.pageSize ?? 20,
      });
      return {
        drivers: result.drivers.map(serializeDriverDirectoryEntry),
        pagination: result.pagination,
      };
    },
  );

  fastify.get(
    '/operators',
    {
      preHandler: fastify.requireRoles('ADMIN'),
      schema: {
        tags: [OpenApiTags.fleetGroups],
        operationId: 'listOperators',
        summary: 'List the Operator directory',
        description:
          'ADMIN-only paginated directory of Operator profiles with account state and fleet summary counts.',
        security: [{ bearerAuth: [] }],
        querystring: Type.Object(DirectoryQueryFields, { additionalProperties: false }),
        response: {
          200: Type.Object(
            { operators: Type.Array(OperatorDirectorySchema), pagination: PaginationSchema },
            { additionalProperties: false },
          ),
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          429: ErrorSchema,
        },
      },
    },
    async (request) => {
      const result = await options.fleetService.listOperators(currentUser(request), {
        ...request.query,
        page: request.query.page ?? 1,
        pageSize: request.query.pageSize ?? 20,
      });
      return {
        operators: result.operators.map(serializeOperatorDirectoryEntry),
        pagination: result.pagination,
      };
    },
  );

  fastify.post(
    '/driver-associations',
    {
      preHandler: fastify.requireRoles('OPERATOR'),
      schema: {
        tags: [OpenApiTags.fleetGroups],
        operationId: 'associateDriverWithOperator',
        summary: 'Associate a verified Driver with the current Operator',
        description:
          'Looks up a self-registered Driver by verified email. If the account is absent or unverified, returns DRIVER_NOT_READY without creating a placeholder. Existing associations are idempotent for the same Operator and rejected across Operators.',
        security: [{ bearerAuth: [] }],
        body: Type.Object(
          { email: Type.String({ format: 'email', maxLength: 320, examples: ['driver@example.com'] }) },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({ association: DriverAssociationSchema }),
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (request) => ({
      association: await options.fleetService.associateDriver(currentUser(request), request.body.email),
    }),
  );

  fastify.get(
    '/jeepneys',
    {
      preHandler: fastify.requireRoles('DRIVER', 'OPERATOR', 'ADMIN'),
      schema: {
        tags: [OpenApiTags.jeepneys],
        operationId: 'listJeepneys',
        summary: 'List permitted jeepneys',
        description: 'DRIVER, OPERATOR, or ADMIN view filtered by server-authoritative ownership and group visibility.',
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Object({ jeepneys: Type.Array(JeepneySchema) }),
          401: ErrorSchema,
          403: ErrorSchema,
        },
      },
    },
    async (request) => ({
      jeepneys: (await options.fleetService.listJeepneys(currentUser(request))).map(serializeJeepney),
    }),
  );

  fastify.post(
    '/jeepneys',
    {
      preHandler: fastify.requireRoles('DRIVER', 'OPERATOR', 'ADMIN'),
      schema: {
        tags: [OpenApiTags.jeepneys],
        operationId: 'createJeepney',
        summary: 'Create a jeepney record',
        description: 'Creates a scoped jeepney record. Client-supplied ownership never overrides the authenticated role.',
        security: [{ bearerAuth: [] }],
        body: Type.Object(
          {
            operatorId: Type.Optional(Uuid),
            plateNo: Type.String({ minLength: 1, maxLength: 32, examples: ['ABC 1234'] }),
            colorHex: ColorHex,
            description: Type.Optional(Type.String({ maxLength: 1000 })),
          },
          { additionalProperties: false },
        ),
        response: {
          201: Type.Object({ jeepney: JeepneySchema }),
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const jeepney = await options.fleetService.createJeepney(currentUser(request), request.body);
      return reply.code(201).send({ jeepney: serializeJeepney(jeepney) });
    },
  );

  fastify.patch(
    '/jeepneys/:jeepneyId',
    {
      preHandler: fastify.requireRoles('DRIVER', 'OPERATOR', 'ADMIN'),
      schema: {
        tags: [OpenApiTags.jeepneys],
        operationId: 'updateJeepney',
        summary: 'Update a permitted jeepney',
        description: 'Updates permitted vehicle details; approval-status changes remain ADMIN-only.',
        security: [{ bearerAuth: [] }],
        params: JeepneyIdParams,
        body: Type.Object(
          {
            colorHex: Type.Optional(ColorHex),
            description: Type.Optional(NullableString),
            status: Type.Optional(JeepneyStatusSchema),
          },
          { additionalProperties: false, minProperties: 1 },
        ),
        response: {
          200: Type.Object({ jeepney: JeepneySchema }),
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (request) => ({
      jeepney: serializeJeepney(
        await options.fleetService.updateJeepney(
          currentUser(request),
          request.params.jeepneyId,
          request.body,
        ),
      ),
    }),
  );

  fastify.post(
    '/jeepneys/:jeepneyId/driver-assignment',
    {
      preHandler: fastify.requireRoles('OPERATOR', 'ADMIN'),
      schema: {
        tags: [OpenApiTags.jeepneys],
        operationId: 'assignDriverToJeepney',
        summary: 'Assign a driver to a jeepney',
        description: 'OPERATOR or ADMIN mutation that enforces same-operator ownership and replaces any active assignment transactionally.',
        security: [{ bearerAuth: [] }],
        params: JeepneyIdParams,
        body: Type.Object({ driverId: Uuid }, { additionalProperties: false }),
        response: {
          201: Type.Object({ assignment: DriverAssignmentSchema }),
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const assignment = await options.fleetService.assignDriver(
        currentUser(request),
        request.params.jeepneyId,
        request.body.driverId,
      );
      return reply.code(201).send({ assignment: serializeDriverAssignment(assignment) });
    },
  );

  fastify.get(
    '/fleet-groups',
    {
      preHandler: fastify.requireRoles('DRIVER', 'OPERATOR', 'ADMIN'),
      schema: {
        tags: [OpenApiTags.fleetGroups],
        operationId: 'listFleetGroups',
        summary: 'List permitted fleet groups',
        description: 'Returns only groups visible to the authenticated DRIVER, OPERATOR, or ADMIN.',
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Object({ groups: Type.Array(FleetGroupSchema) }),
          401: ErrorSchema,
          403: ErrorSchema,
        },
      },
    },
    async (request) => ({
      groups: (await options.fleetService.listGroups(currentUser(request))).map(serializeFleetGroup),
    }),
  );

  fastify.post(
    '/fleet-groups',
    {
      preHandler: fastify.requireRoles('OPERATOR', 'ADMIN'),
      schema: {
        tags: [OpenApiTags.fleetGroups],
        operationId: 'createFleetGroup',
        summary: 'Create a fleet group',
        description: 'Creates an operator-scoped fleet group. ADMIN callers must identify the target operator.',
        security: [{ bearerAuth: [] }],
        body: Type.Object(
          {
            operatorId: Type.Optional(Uuid),
            name: Type.String({ minLength: 1, maxLength: 120 }),
            description: Type.Optional(Type.String({ maxLength: 1000 })),
          },
          { additionalProperties: false },
        ),
        response: {
          201: Type.Object({ group: FleetGroupSchema }),
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const group = await options.fleetService.createGroup(currentUser(request), request.body);
      return reply.code(201).send({ group: serializeFleetGroup(group) });
    },
  );

  fastify.patch(
    '/fleet-groups/:groupId',
    {
      preHandler: fastify.requireRoles('OPERATOR', 'ADMIN'),
      schema: {
        tags: [OpenApiTags.fleetGroups],
        operationId: 'updateFleetGroup',
        summary: 'Update a fleet group',
        description: 'Updates a group only within the authenticated Operator scope, or platform-wide for ADMIN.',
        security: [{ bearerAuth: [] }],
        params: GroupIdParams,
        body: Type.Object(
          {
            name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
            description: Type.Optional(NullableString),
            status: Type.Optional(GroupStatusSchema),
          },
          { additionalProperties: false, minProperties: 1 },
        ),
        response: {
          200: Type.Object({ group: FleetGroupSchema }),
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (request) => ({
      group: serializeFleetGroup(
        await options.fleetService.updateGroup(
          currentUser(request),
          request.params.groupId,
          request.body,
        ),
      ),
    }),
  );

  fastify.post(
    '/fleet-groups/:groupId/drivers',
    {
      preHandler: fastify.requireRoles('OPERATOR', 'ADMIN'),
      schema: {
        tags: [OpenApiTags.fleetGroups],
        operationId: 'addDriverToFleetGroup',
        summary: 'Add a driver to a fleet group',
        description: 'Requires the driver and group to belong to the same Operator scope.',
        security: [{ bearerAuth: [] }],
        params: GroupIdParams,
        body: Type.Object({ driverId: Uuid }, { additionalProperties: false }),
        response: {
          200: MessageSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      await options.fleetService.addGroupDriver(
        currentUser(request),
        request.params.groupId,
        request.body.driverId,
      );
      return reply.code(200).send({ message: 'Driver added to fleet group' });
    },
  );

  fastify.post(
    '/fleet-groups/:groupId/jeepneys',
    {
      preHandler: fastify.requireRoles('OPERATOR', 'ADMIN'),
      schema: {
        tags: [OpenApiTags.fleetGroups],
        operationId: 'addJeepneyToFleetGroup',
        summary: 'Add a jeepney to a fleet group',
        description:
          'Requires the jeepney and group to belong to the same Operator scope. Rejects membership that would make the jeepney inherit more than one active fleet-group route.',
        security: [{ bearerAuth: [] }],
        params: GroupIdParams,
        body: Type.Object({ jeepneyId: Uuid }, { additionalProperties: false }),
        response: {
          200: MessageSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      await options.fleetService.addGroupJeepney(
        currentUser(request),
        request.params.groupId,
        request.body.jeepneyId,
      );
      return reply.code(200).send({ message: 'Jeepney added to fleet group' });
    },
  );
};

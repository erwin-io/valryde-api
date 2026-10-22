import type { FastifyPluginAsync } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';

import type { User } from '../domain/identity.js';
import {
  serializeDeviceMapping,
  serializeGpsSetupRequest,
  serializeVehicleApplication,
} from '../domain/vehicle-workflow.js';
import { ApiError } from '../lib/api-error.js';
import { OpenApiTags } from '../openapi.js';
import { ErrorSchema } from '../schemas/common.js';
import type { VehicleWorkflowService } from '../services/vehicle-workflow-service.js';

export interface VehicleWorkflowRoutesOptions {
  workflowService: VehicleWorkflowService;
}

const Uuid = Type.String({ format: 'uuid' });
const DateTime = Type.String({ format: 'date-time' });
const NullableUuid = Type.Union([Uuid, Type.Null()]);
const NullableDateTime = Type.Union([DateTime, Type.Null()]);
const NullableString = Type.Union([Type.String(), Type.Null()]);
const ApplicationStatus = Type.Union([
  Type.Literal('PENDING'),
  Type.Literal('APPROVED'),
  Type.Literal('REJECTED'),
]);
const SetupStatus = Type.Union([
  Type.Literal('PENDING'),
  Type.Literal('APPROVED'),
  Type.Literal('SCHEDULED'),
  Type.Literal('INSTALLED'),
  Type.Literal('REJECTED'),
]);
const VerificationStatus = Type.Union([
  Type.Literal('NOT_STARTED'),
  Type.Literal('PENDING'),
  Type.Literal('VERIFIED'),
  Type.Literal('FAILED'),
]);
const ApplicationSchema = Type.Object({
  id: Uuid,
  jeepneyId: Uuid,
  submittedByUserId: Uuid,
  status: ApplicationStatus,
  applicantNotes: NullableString,
  reviewNotes: NullableString,
  reviewedByUserId: NullableUuid,
  reviewedAt: NullableDateTime,
  createdAt: DateTime,
  updatedAt: DateTime,
});
const SetupSchema = Type.Object({
  id: Uuid,
  vehicleApplicationId: Uuid,
  jeepneyId: Uuid,
  requestedByUserId: Uuid,
  status: SetupStatus,
  verificationStatus: VerificationStatus,
  scheduledAt: NullableDateTime,
  installedAt: NullableDateTime,
  rejectedReason: NullableString,
  verificationChecks: Type.Record(Type.String(), Type.Unknown()),
  verifiedByUserId: NullableUuid,
  verifiedAt: NullableDateTime,
  createdAt: DateTime,
  updatedAt: DateTime,
});
const MappingSchema = Type.Object({
  id: Uuid,
  gpsSetupRequestId: Uuid,
  gpsDeviceId: Uuid,
  jeepneyId: Uuid,
  imei: Type.String(),
  serialNumber: Type.String(),
  traccarUniqueId: Type.String(),
  mappedAt: DateTime,
});

export const vehicleWorkflowRoutes: FastifyPluginAsync<VehicleWorkflowRoutesOptions> = async (
  instance,
  options,
) => {
  const fastify = instance.withTypeProvider<TypeBoxTypeProvider>();

  fastify.get(
    '/vehicle-applications',
    {
      preHandler: fastify.requireRoles('DRIVER', 'OPERATOR', 'ADMIN'),
      schema: {
        tags: [OpenApiTags.vehicleApplications],
        operationId: 'listVehicleApplications',
        summary: 'List permitted vehicle applications',
        description: 'DRIVER and OPERATOR results are ownership-scoped; ADMIN can monitor all applications.',
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Object({ applications: Type.Array(ApplicationSchema) }),
          401: ErrorSchema,
          403: ErrorSchema,
        },
      },
    },
    async (request) => ({
      applications: (
        await options.workflowService.listApplications(requireUser(request.currentUser))
      ).map(serializeVehicleApplication),
    }),
  );

  fastify.post(
    '/vehicle-applications',
    {
      preHandler: fastify.requireRoles('DRIVER', 'OPERATOR'),
      schema: {
        tags: [OpenApiTags.vehicleApplications],
        operationId: 'submitVehicleApplication',
        summary: 'Submit a vehicle application',
        description: 'DRIVER or OPERATOR submission for a permitted jeepney; does not activate the vehicle.',
        security: [{ bearerAuth: [] }],
        body: Type.Object(
          {
            jeepneyId: Uuid,
            applicantNotes: Type.Optional(Type.String({ maxLength: 2000 })),
          },
          { additionalProperties: false },
        ),
        response: {
          201: Type.Object({ application: ApplicationSchema }),
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const application = await options.workflowService.submitApplication(
        requireUser(request.currentUser),
        request.body.jeepneyId,
        request.body.applicantNotes,
      );
      return reply.code(201).send({ application: serializeVehicleApplication(application) });
    },
  );

  fastify.patch(
    '/admin/vehicle-applications/:applicationId/review',
    {
      preHandler: fastify.requireRoles('ADMIN'),
      schema: {
        tags: [OpenApiTags.vehicleApplications],
        operationId: 'reviewVehicleApplication',
        summary: 'Approve or reject a vehicle application',
        description: 'ADMIN-only review of a pending application. Repeated or invalid transitions are rejected.',
        security: [{ bearerAuth: [] }],
        params: Type.Object({ applicationId: Uuid }),
        body: Type.Object(
          {
            decision: Type.Union([Type.Literal('APPROVED'), Type.Literal('REJECTED')]),
            reviewNotes: Type.Optional(Type.String({ maxLength: 2000 })),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({ application: ApplicationSchema }),
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (request) => ({
      application: serializeVehicleApplication(
        await options.workflowService.reviewApplication(
          requireUser(request.currentUser),
          request.params.applicationId,
          request.body.decision,
          request.body.reviewNotes,
        ),
      ),
    }),
  );

  fastify.get(
    '/gps-setup-requests',
    {
      preHandler: fastify.requireRoles('DRIVER', 'OPERATOR', 'ADMIN'),
      schema: {
        tags: [OpenApiTags.gps],
        operationId: 'listGpsSetupRequests',
        summary: 'List permitted GPS setup requests',
        description: 'DRIVER and OPERATOR results are ownership-scoped; ADMIN can monitor all setup requests.',
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Object({ requests: Type.Array(SetupSchema) }),
          401: ErrorSchema,
          403: ErrorSchema,
        },
      },
    },
    async (request) => ({
      requests: (await options.workflowService.listGpsRequests(requireUser(request.currentUser))).map(
        serializeGpsSetupRequest,
      ),
    }),
  );

  fastify.post(
    '/gps-setup-requests',
    {
      preHandler: fastify.requireRoles('DRIVER', 'OPERATOR'),
      schema: {
        tags: [OpenApiTags.gps],
        operationId: 'submitGpsSetupRequest',
        summary: 'Request GPS installation',
        description: 'DRIVER or OPERATOR request for an approved vehicle application.',
        security: [{ bearerAuth: [] }],
        body: Type.Object({ vehicleApplicationId: Uuid }, { additionalProperties: false }),
        response: {
          201: Type.Object({ request: SetupSchema }),
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const setup = await options.workflowService.submitGpsRequest(
        requireUser(request.currentUser),
        request.body.vehicleApplicationId,
      );
      return reply.code(201).send({ request: serializeGpsSetupRequest(setup) });
    },
  );

  fastify.patch(
    '/admin/gps-setup-requests/:requestId/status',
    {
      preHandler: fastify.requireRoles('ADMIN'),
      schema: {
        tags: [OpenApiTags.gps],
        operationId: 'transitionGpsSetupStatus',
        summary: 'Change GPS installation status',
        description: 'ADMIN-only state transition through approval, scheduling, installation, or rejection.',
        security: [{ bearerAuth: [] }],
        params: Type.Object({ requestId: Uuid }),
        body: Type.Object(
          {
            status: Type.Union([
              Type.Literal('APPROVED'),
              Type.Literal('SCHEDULED'),
              Type.Literal('INSTALLED'),
              Type.Literal('REJECTED'),
            ]),
            scheduledAt: Type.Optional(DateTime),
            rejectedReason: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({ request: SetupSchema }),
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (request) => ({
      request: serializeGpsSetupRequest(
        await options.workflowService.transitionGpsRequest(
          requireUser(request.currentUser),
          request.params.requestId,
          request.body.status,
          request.body,
        ),
      ),
    }),
  );

  fastify.post(
    '/admin/gps-setup-requests/:requestId/device-mapping',
    {
      preHandler: fastify.requireRoles('ADMIN'),
      schema: {
        tags: [OpenApiTags.gps],
        operationId: 'mapGpsDevice',
        summary: 'Map a GPS device to a jeepney',
        description: 'ADMIN-only mapping of unique IMEI, serial, and non-secret Traccar device identity.',
        security: [{ bearerAuth: [] }],
        params: Type.Object({ requestId: Uuid }),
        body: Type.Object(
          {
            imei: Type.String({ pattern: '^[0-9]{14,17}$', examples: ['860000000000001'] }),
            serialNumber: Type.String({ minLength: 1, maxLength: 128, examples: ['VAL-TEST-0001'] }),
            traccarUniqueId: Type.String({
              minLength: 1,
              maxLength: 128,
              examples: ['valryde-test-device-0001'],
            }),
          },
          { additionalProperties: false },
        ),
        response: {
          201: Type.Object({ mapping: MappingSchema }),
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const mapping = await options.workflowService.mapDevice(
        requireUser(request.currentUser),
        request.params.requestId,
        request.body,
      );
      return reply.code(201).send({ mapping: serializeDeviceMapping(mapping) });
    },
  );

  fastify.get(
    '/admin/gps-setup-requests/:requestId/device-mapping',
    {
      preHandler: fastify.requireRoles('ADMIN'),
      schema: {
        tags: [OpenApiTags.gps],
        operationId: 'getGpsDeviceMapping',
        summary: 'Get the device mapping for a GPS setup request',
        description:
          'ADMIN-only read of the application-owned mapping identity. A valid request with no mapping returns mapping: null; raw Traccar numeric IDs are never exposed.',
        security: [{ bearerAuth: [] }],
        params: Type.Object({ requestId: Uuid }),
        response: {
          200: Type.Object({ mapping: Type.Union([MappingSchema, Type.Null()]) }),
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (request) => {
      const mapping = await options.workflowService.getDeviceMapping(request.params.requestId);
      return { mapping: mapping === null ? null : serializeDeviceMapping(mapping) };
    },
  );

  fastify.post(
    '/admin/gps-setup-requests/:requestId/verification',
    {
      preHandler: fastify.requireRoles('ADMIN'),
      schema: {
        tags: [OpenApiTags.gps],
        operationId: 'verifyGpsInstallation',
        summary: 'Verify GPS installation checks',
        description: 'ADMIN-only power, SIM, server, and GPS-fix verification. The jeepney activates only when all checks pass.',
        security: [{ bearerAuth: [] }],
        params: Type.Object({ requestId: Uuid }),
        body: Type.Object(
          {
            powerOk: Type.Boolean(),
            simOk: Type.Boolean(),
            serverOk: Type.Boolean(),
            gpsFixOk: Type.Boolean(),
            notes: Type.Optional(Type.String({ maxLength: 2000 })),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({ request: SetupSchema }),
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (request) => ({
      request: serializeGpsSetupRequest(
        await options.workflowService.verifyInstallation(
          requireUser(request.currentUser),
          request.params.requestId,
          request.body,
        ),
      ),
    }),
  );
};

function requireUser(user: User | null): User {
  if (user === null) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required');
  return user;
}

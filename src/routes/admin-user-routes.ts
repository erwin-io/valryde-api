import type { FastifyPluginAsync } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';

import { toPublicUser } from '../domain/identity.js';
import { ApiError } from '../lib/api-error.js';
import { OpenApiTags } from '../openapi.js';
import type { IdentityRepository } from '../repositories/identity-repository.js';
import { ErrorSchema, UserSchema } from '../schemas/common.js';

export interface AdminUserRoutesOptions {
  repository: IdentityRepository;
}

export const adminUserRoutes: FastifyPluginAsync<AdminUserRoutesOptions> = async (
  instance,
  options,
) => {
  const fastify = instance.withTypeProvider<TypeBoxTypeProvider>();

  fastify.get(
    '/',
    {
      preHandler: fastify.requireRoles('ADMIN'),
      schema: {
        tags: [OpenApiTags.accounts],
        operationId: 'listUsersAsAdmin',
        summary: 'List user accounts',
        description: 'ADMIN-only account monitoring view. Requires a valid JWT access token.',
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Object({ users: Type.Array(UserSchema) }),
          401: ErrorSchema,
          403: ErrorSchema,
        },
      },
    },
    async () => ({ users: (await options.repository.listUsers()).map(toPublicUser) }),
  );

  fastify.patch(
    '/:userId/status',
    {
      preHandler: fastify.requireRoles('ADMIN'),
      schema: {
        tags: [OpenApiTags.accounts],
        operationId: 'updateUserStatusAsAdmin',
        summary: 'Enable or disable a user account',
        description: 'ADMIN-only status change. Administrators cannot disable their own account.',
        security: [{ bearerAuth: [] }],
        params: Type.Object({ userId: Type.String({ format: 'uuid' }) }),
        body: Type.Object(
          { status: Type.Union([Type.Literal('ACTIVE'), Type.Literal('DISABLED')]) },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({ user: UserSchema }),
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (request) => {
      const actor = request.currentUser;
      if (actor === null) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required');
      if (actor.id === request.params.userId && request.body.status === 'DISABLED') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Administrators cannot disable themselves');
      }
      const user = await options.repository.updateStatus(
        request.params.userId,
        request.body.status,
      );
      await options.repository.writeAudit({
        actorUserId: actor.id,
        action: 'USER_STATUS_CHANGED',
        entityType: 'USER',
        entityId: user.id,
        metadata: { status: user.status },
      });
      return { user: toPublicUser(user) };
    },
  );
};

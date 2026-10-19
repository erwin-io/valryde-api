import fp from 'fastify-plugin';

import type { Role } from '../domain/identity.js';
import { ApiError } from '../lib/api-error.js';
import type { IdentityRepository } from '../repositories/identity-repository.js';
import type { AccessClaims } from '../services/auth-service.js';

export interface AuthorizationPluginOptions {
  repository: IdentityRepository;
}

export const authorizationPlugin = fp<AuthorizationPluginOptions>(async (fastify, options) => {
  fastify.decorateRequest('currentUser', null);

  fastify.decorate('authenticate', async (request) => {
    let claims: AccessClaims;
    try {
      claims = await request.jwtVerify<AccessClaims>();
    } catch {
      throw new ApiError(401, 'AUTH_REQUIRED', 'A valid access token is required');
    }
    if (claims.type !== 'access') {
      throw new ApiError(401, 'AUTH_REQUIRED', 'A valid access token is required');
    }
    const user = await options.repository.findUserById(claims.sub);
    if (
      user === null ||
      user.status !== 'ACTIVE' ||
      user.credentialsVersion !== claims.ver ||
      user.emailVerifiedAt === null
    ) {
      throw new ApiError(401, 'SESSION_REVOKED', 'The session is no longer valid');
    }
    request.currentUser = user;
  });

  fastify.decorate('requireRoles', (...roles: Role[]) => {
    return async (request, reply) => {
      await fastify.authenticate(request, reply);
      const user = request.currentUser;
      if (user === null || !user.roles.some((role) => roles.includes(role))) {
        throw new ApiError(403, 'FORBIDDEN', 'This role is not permitted to perform the operation');
      }
    };
  });
});

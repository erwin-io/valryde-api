import type { FastifyReply as Reply, FastifyRequest as Request } from 'fastify';

import type { Role, User } from '../domain/identity.js';
import type { AccessClaims } from '../services/auth-service.js';

declare module 'fastify' {
  interface FastifyRequest {
    currentUser: User | null;
  }

  interface FastifyInstance {
    authenticate(request: Request, reply: Reply): Promise<void>;
    requireRoles(...roles: Role[]): (request: Request, reply: Reply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AccessClaims;
    user: AccessClaims;
  }
}

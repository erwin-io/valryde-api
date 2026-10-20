import argon2 from 'argon2';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';
import type { FastifyError } from 'fastify';
import type pg from 'pg';

import type { AppConfig } from './config.js';
import { createPool } from './db/pool.js';
import { ApiError } from './lib/api-error.js';
import { randomToken } from './lib/crypto.js';
import { OpenApiTags, openApiTagDefinitions } from './openapi.js';
import { authorizationPlugin } from './plugins/authorization.js';
import type { IdentityRepository } from './repositories/identity-repository.js';
import { PgIdentityRepository } from './repositories/pg-identity-repository.js';
import { adminUserRoutes } from './routes/admin-user-routes.js';
import { authRoutes } from './routes/auth-routes.js';
import { fleetRoutes } from './routes/fleet-routes.js';
import { transitRoutes } from './routes/transit-routes.js';
import { vehicleWorkflowRoutes } from './routes/vehicle-workflow-routes.js';
import { AuthService } from './services/auth-service.js';
import { SmtpEmailService } from './services/email-service.js';
import { FleetService } from './services/fleet-service.js';
import { TransitService } from './services/transit-service.js';
import { VehicleWorkflowService } from './services/vehicle-workflow-service.js';
import {
  GoogleAuthLibraryIdentityService,
  type GoogleIdentityService,
} from './services/google-identity-service.js';
import {
  DisabledNotificationService,
  EmailNotificationService,
  type NotificationService,
} from './services/notification-service.js';

export interface BuildAppOptions {
  config: AppConfig;
  repository?: IdentityRepository;
  notificationService?: NotificationService;
  googleIdentityService?: GoogleIdentityService;
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions) {
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: options.config.logLevel,
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.body.password',
                'req.body.currentPassword',
                'req.body.newPassword',
                'req.body.refreshToken',
                'req.body.idToken',
                'req.body.token',
              ],
              censor: '[REDACTED]',
            },
          },
    trustProxy: options.config.environment === 'production',
  });

  let pool: pg.Pool | undefined;
  const repository =
    options.repository ??
    (() => {
      pool = createPool(options.config);
      return new PgIdentityRepository(pool);
    })();

  await app.register(sensible);
  await app.register(helmet);
  await app.register(cors, {
    origin: options.config.corsOrigins.length === 0 ? false : options.config.corsOrigins,
    credentials: false,
  });
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Valryde API',
        description: 'Valryde public jeepney tracking and fleet-management API',
        version: '0.1.0',
      },
      servers: [{ url: '/api' }],
      tags: openApiTagDefinitions,
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/documentation' });
  await app.register(jwt, {
    secret: options.config.jwtSecret,
    sign: {
      iss: options.config.jwtIssuer,
      aud: options.config.jwtAudience,
      expiresIn: options.config.accessTokenTtlSeconds,
    },
    verify: { allowedIss: options.config.jwtIssuer, allowedAud: options.config.jwtAudience },
  });
  await app.register(authorizationPlugin, { repository });

  const dummyPasswordHash = await argon2.hash(randomToken(), { type: argon2.argon2id });
  const authService = new AuthService(
    repository,
    options.config,
    options.notificationService ?? notificationService(options.config),
    options.googleIdentityService ??
      new GoogleAuthLibraryIdentityService(options.config.googleClientIds),
    (claims) => app.jwt.sign(claims),
    dummyPasswordHash,
  );

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      });
    }
    if (error.validation !== undefined) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          requestId: request.id,
          details: error.validation,
        },
      });
    }
    // Framework client errors (rate limit, malformed or oversized body) keep their 4xx status.
    if (error.statusCode === 429) {
      return reply.code(429).send({
        error: { code: 'RATE_LIMITED', message: 'Too many requests', requestId: request.id },
      });
    }
    if (error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send({
        error: { code: 'VALIDATION_ERROR', message: 'Request is malformed', requestId: request.id },
      });
    }
    request.log.error({ err: error }, 'Unhandled request error');
    return reply.code(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        requestId: request.id,
      },
    });
  });

  app.get('/api/health', {
    schema: {
      tags: [OpenApiTags.system],
      operationId: 'getHealth',
      summary: 'Check API and database health',
      description:
        'Public readiness check. Returns 503 when the application database cannot be reached.',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['ok'] },
            database: { type: 'string', enum: ['ok', 'injected'] },
          },
          required: ['status', 'database'],
          examples: [{ status: 'ok', database: 'ok' }],
        },
        503: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['degraded'] },
            database: { type: 'string', enum: ['unavailable'] },
          },
          required: ['status', 'database'],
          examples: [{ status: 'degraded', database: 'unavailable' }],
        },
      },
    },
  }, async (_request, reply) => {
    if (pool === undefined) return { status: 'ok', database: 'injected' };
    try {
      await pool.query('SELECT 1');
      return { status: 'ok', database: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'degraded', database: 'unavailable' });
    }
  });

  await app.register(authRoutes, { prefix: '/api/auth', authService, repository });
  await app.register(adminUserRoutes, { prefix: '/api/admin/users', repository });
  if (pool !== undefined) {
    await app.register(fleetRoutes, {
      prefix: '/api',
      fleetService: new FleetService(pool),
    });
    await app.register(transitRoutes, {
      prefix: '/api',
      transitService: new TransitService(pool),
    });
    await app.register(vehicleWorkflowRoutes, {
      prefix: '/api',
      workflowService: new VehicleWorkflowService(pool),
    });
  }

  if (pool !== undefined) {
    app.addHook('onClose', async () => {
      await pool?.end();
    });
  }

  return app;
}

function notificationService(config: AppConfig): NotificationService {
  if (config.email.deliveryMode === 'disabled') {
    return new DisabledNotificationService();
  }
  const email = new SmtpEmailService(config.email);
  return new EmailNotificationService(email, config.email);
}

import type { FastifyPluginAsync } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';

import { OpenApiTags } from '../openapi.js';
import { ErrorSchema } from '../schemas/common.js';
import type { AuditLogService } from '../services/audit-log-service.js';

export interface AdminAuditRoutesOptions {
  auditLogService: AuditLogService;
}

// Writers use upper snake case for action and entity type (JEEPNEY_UPDATED, GPS_SETUP_REQUEST).
const AuditCode = Type.String({ pattern: '^[A-Z][A-Z0-9_]{0,63}$' });

const AuditLogSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  actorUserId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  action: Type.String(),
  entityType: Type.String(),
  entityId: Type.String(),
  metadata: Type.Object({}, { additionalProperties: true }),
  createdAt: Type.String(),
});

const PaginationSchema = Type.Object(
  {
    page: Type.Integer({ minimum: 1 }),
    pageSize: Type.Integer({ minimum: 1 }),
    total: Type.Integer({ minimum: 0 }),
    totalPages: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const adminAuditRoutes: FastifyPluginAsync<AdminAuditRoutesOptions> = async (instance, options) => {
  const fastify = instance.withTypeProvider<TypeBoxTypeProvider>();

  fastify.get(
    '/audit-logs',
    {
      preHandler: fastify.requireRoles('ADMIN'),
      schema: {
        tags: [OpenApiTags.administration],
        operationId: 'listAuditLogsAsAdmin',
        summary: 'List audit log entries',
        description:
          'ADMIN-only, read-only view of the audit trail written by every audited mutation. Newest first (createdAt, then id, descending). `from` is inclusive and `to` exclusive. Entries cannot be created, edited or deleted through the API.',
        security: [{ bearerAuth: [] }],
        querystring: Type.Object(
          {
            entityType: Type.Optional(AuditCode),
            entityId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
            actorUserId: Type.Optional(Type.String({ format: 'uuid' })),
            action: Type.Optional(AuditCode),
            from: Type.Optional(Type.String({ format: 'date-time' })),
            to: Type.Optional(Type.String({ format: 'date-time' })),
            page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
            pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({ auditLogs: Type.Array(AuditLogSchema), pagination: PaginationSchema }),
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
        },
      },
    },
    async (request) => {
      const result = await options.auditLogService.list({
        ...request.query,
        page: request.query.page ?? 1,
        pageSize: request.query.pageSize ?? 20,
      });
      return {
        auditLogs: result.auditLogs.map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() })),
        pagination: result.pagination,
      };
    },
  );
};

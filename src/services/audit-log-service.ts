import type pg from 'pg';

import type { PaginationResult } from '../domain/fleet.js';
import { ApiError } from '../lib/api-error.js';

export interface AuditLogEntry {
  id: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface AuditLogQuery {
  entityType?: string;
  entityId?: string;
  actorUserId?: string;
  action?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

interface AuditLogRow {
  id: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown>;
  created_at: Date;
}

/** Read-only view of `audit_logs` (G8). Writers stay in their own services; nothing here mutates. */
export class AuditLogService {
  constructor(private readonly pool: pg.Pool) {}

  async list(query: AuditLogQuery): Promise<{ auditLogs: AuditLogEntry[]; pagination: PaginationResult }> {
    if (query.from !== undefined && query.to !== undefined && Date.parse(query.from) >= Date.parse(query.to)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'from must be earlier than to');
    }
    const values: unknown[] = [];
    const conditions: string[] = [];
    const parameter = (value: unknown): string => {
      values.push(value);
      return `$${values.length}`;
    };
    if (query.entityType !== undefined) conditions.push(`entity_type = ${parameter(query.entityType)}`);
    if (query.entityId !== undefined) conditions.push(`entity_id = ${parameter(query.entityId)}`);
    if (query.actorUserId !== undefined) conditions.push(`actor_user_id = ${parameter(query.actorUserId)}::uuid`);
    if (query.action !== undefined) conditions.push(`action = ${parameter(query.action)}`);
    if (query.from !== undefined) conditions.push(`created_at >= ${parameter(query.from)}::timestamptz`);
    if (query.to !== undefined) conditions.push(`created_at < ${parameter(query.to)}::timestamptz`);
    const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`;

    const count = await this.pool.query<{ total: number }>(
      `SELECT count(*)::integer AS total FROM audit_logs ${where}`,
      values,
    );
    const total = count.rows[0]?.total ?? 0;
    const limit = parameter(query.pageSize);
    const offset = parameter((query.page - 1) * query.pageSize);
    const result = await this.pool.query<AuditLogRow>(
      `SELECT id, actor_user_id, action, entity_type, entity_id, metadata, created_at
       FROM audit_logs ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT ${limit} OFFSET ${offset}`,
      values,
    );
    return {
      auditLogs: result.rows.map((row) => ({
        id: row.id,
        actorUserId: row.actor_user_id,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        metadata: row.metadata,
        createdAt: row.created_at,
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }
}

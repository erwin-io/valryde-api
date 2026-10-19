import type pg from 'pg';

import type { User } from '../domain/identity.js';
import type {
  DriverAssignment,
  FleetGroup,
  Jeepney,
  JeepneyStatus,
} from '../domain/fleet.js';
import { ApiError } from '../lib/api-error.js';

interface JeepneyRow {
  id: string;
  operator_id: string | null;
  created_by_user_id: string;
  plate_no: string;
  color_hex: string;
  description: string | null;
  status: JeepneyStatus;
  approved_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface GroupRow {
  id: string;
  operator_id: string;
  name: string;
  description: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  created_at: Date;
  updated_at: Date;
}

interface AssignmentRow {
  id: string;
  driver_id: string;
  jeepney_id: string;
  assigned_by_user_id: string;
  active_from: Date;
  active_to: Date | null;
}

interface DriverAssociationRow {
  id: string;
  user_id: string;
  email: string;
  display_name: string;
  operator_id: string | null;
}

export class FleetService {
  constructor(private readonly pool: pg.Pool) {}

  async associateDriver(actor: User, email: string): Promise<{
    driverId: string;
    userId: string;
    email: string;
    displayName: string;
    operatorId: string;
  }> {
    const operatorId = await this.requireActorOperator(actor.id);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<DriverAssociationRow>(
        `SELECT d.id, d.user_id, u.email::text, u.display_name, d.operator_id
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id AND ur.role = 'DRIVER'
         JOIN drivers d ON d.user_id = u.id AND d.status = 'ACTIVE'
         WHERE u.email = $1 AND u.status = 'ACTIVE' AND u.email_verified_at IS NOT NULL
         FOR UPDATE OF d`,
        [email.trim().toLowerCase()],
      );
      const driver = result.rows[0];
      if (driver === undefined) {
        throw new ApiError(
          409,
          'DRIVER_NOT_READY',
          'Driver must register and verify this email before association',
        );
      }
      if (driver.operator_id !== null && driver.operator_id !== operatorId) {
        throw new ApiError(
          409,
          'DRIVER_ALREADY_ASSOCIATED',
          'Driver is already associated with another operator',
        );
      }
      if (driver.operator_id === null) {
        await client.query(
          'UPDATE drivers SET operator_id = $2, updated_at = now() WHERE id = $1',
          [driver.id, operatorId],
        );
        await this.audit(actor.id, 'DRIVER_ASSOCIATED', 'DRIVER', driver.id, { operatorId }, client);
      }
      await client.query('COMMIT');
      return {
        driverId: driver.id,
        userId: driver.user_id,
        email: driver.email,
        displayName: driver.display_name,
        operatorId,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async createJeepney(
    actor: User,
    input: {
      operatorId?: string;
      plateNo: string;
      colorHex: string;
      description?: string;
    },
  ): Promise<Jeepney> {
    let operatorId: string | null;
    if (actor.roles.includes('ADMIN')) {
      operatorId = input.operatorId ?? null;
      if (operatorId !== null) await this.requireOperator(operatorId);
    } else if (actor.roles.includes('OPERATOR')) {
      operatorId = await this.requireActorOperator(actor.id);
      if (input.operatorId !== undefined && input.operatorId !== operatorId) {
        throw new ApiError(403, 'FORBIDDEN', 'Operator ownership is determined by the session');
      }
    } else if (actor.roles.includes('DRIVER')) {
      operatorId = await this.actorDriverOperator(actor.id);
      if (input.operatorId !== undefined && input.operatorId !== operatorId) {
        throw new ApiError(403, 'FORBIDDEN', 'Driver association is determined by the session');
      }
    } else {
      throw new ApiError(403, 'FORBIDDEN', 'This role cannot create a jeepney');
    }

    try {
      const result = await this.pool.query<JeepneyRow>(
        `INSERT INTO jeepneys(operator_id, created_by_user_id, plate_no, color_hex, description)
         VALUES ($1, $2, $3, upper($4), $5)
         RETURNING *`,
        [operatorId, actor.id, normalizePlate(input.plateNo), input.colorHex, input.description ?? null],
      );
      const jeepney = mapJeepney(requireRow(result.rows[0]));
      await this.audit(actor.id, 'JEEPNEY_CREATED', 'JEEPNEY', jeepney.id, { operatorId });
      return jeepney;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError(409, 'CONFLICT', 'A jeepney with this plate number already exists');
      }
      throw error;
    }
  }

  async listJeepneys(actor: User): Promise<Jeepney[]> {
    let result: pg.QueryResult<JeepneyRow>;
    if (actor.roles.includes('ADMIN')) {
      result = await this.pool.query<JeepneyRow>('SELECT * FROM jeepneys ORDER BY created_at DESC');
    } else if (actor.roles.includes('OPERATOR')) {
      const operatorId = await this.requireActorOperator(actor.id);
      result = await this.pool.query<JeepneyRow>(
        'SELECT * FROM jeepneys WHERE operator_id = $1 ORDER BY created_at DESC',
        [operatorId],
      );
    } else if (actor.roles.includes('DRIVER')) {
      const driverId = await this.requireActorDriver(actor.id);
      result = await this.pool.query<JeepneyRow>(
        `SELECT DISTINCT j.*
         FROM jeepneys j
         LEFT JOIN driver_jeepney_assignments dja
           ON dja.jeepney_id = j.id AND dja.active_to IS NULL
         LEFT JOIN fleet_group_jeepneys fgj ON fgj.jeepney_id = j.id
         LEFT JOIN fleet_group_drivers fgd ON fgd.group_id = fgj.group_id
         WHERE j.created_by_user_id = $1 OR dja.driver_id = $2 OR fgd.driver_id = $2
         ORDER BY j.created_at DESC`,
        [actor.id, driverId],
      );
    } else {
      throw new ApiError(403, 'FORBIDDEN', 'This role cannot view fleet records');
    }
    return result.rows.map(mapJeepney);
  }

  async updateJeepney(
    actor: User,
    jeepneyId: string,
    input: { colorHex?: string; description?: string | null; status?: JeepneyStatus },
  ): Promise<Jeepney> {
    const existing = await this.requireJeepney(jeepneyId);
    await this.assertCanManageJeepney(actor, existing);
    if (!actor.roles.includes('ADMIN') && input.status !== undefined) {
      throw new ApiError(403, 'FORBIDDEN', 'Only Admin may change jeepney approval status');
    }
    const result = await this.pool.query<JeepneyRow>(
      `UPDATE jeepneys SET
         color_hex = COALESCE($2, color_hex),
         description = CASE WHEN $3::boolean THEN $4 ELSE description END,
         status = COALESCE($5::jeepney_status, status),
         approved_at = CASE
           WHEN $5::jeepney_status IN ('APPROVED', 'ACTIVE') THEN COALESCE(approved_at, now())
           ELSE approved_at
         END,
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [
        jeepneyId,
        input.colorHex?.toUpperCase() ?? null,
        input.description !== undefined,
        input.description ?? null,
        input.status ?? null,
      ],
    );
    const updated = mapJeepney(requireRow(result.rows[0]));
    await this.audit(actor.id, 'JEEPNEY_UPDATED', 'JEEPNEY', jeepneyId, {
      fields: Object.keys(input),
    });
    return updated;
  }

  async createGroup(
    actor: User,
    input: { name: string; description?: string; operatorId?: string },
  ): Promise<FleetGroup> {
    const operatorId = actor.roles.includes('ADMIN')
      ? await this.resolveAdminOperator(input.operatorId)
      : await this.requireActorOperator(actor.id);
    const result = await this.pool.query<GroupRow>(
      `INSERT INTO fleet_groups(operator_id, name, description)
       VALUES ($1, $2, $3) RETURNING *`,
      [operatorId, input.name.trim(), input.description ?? null],
    );
    const group = mapGroup(requireRow(result.rows[0]));
    await this.audit(actor.id, 'FLEET_GROUP_CREATED', 'FLEET_GROUP', group.id, { operatorId });
    return group;
  }

  async listGroups(actor: User): Promise<FleetGroup[]> {
    let result: pg.QueryResult<GroupRow>;
    if (actor.roles.includes('ADMIN')) {
      result = await this.pool.query<GroupRow>('SELECT * FROM fleet_groups ORDER BY created_at DESC');
    } else if (actor.roles.includes('OPERATOR')) {
      const operatorId = await this.requireActorOperator(actor.id);
      result = await this.pool.query<GroupRow>(
        'SELECT * FROM fleet_groups WHERE operator_id = $1 ORDER BY created_at DESC',
        [operatorId],
      );
    } else if (actor.roles.includes('DRIVER')) {
      const driverId = await this.requireActorDriver(actor.id);
      result = await this.pool.query<GroupRow>(
        `SELECT fg.* FROM fleet_groups fg
         JOIN fleet_group_drivers fgd ON fgd.group_id = fg.id
         WHERE fgd.driver_id = $1 ORDER BY fg.created_at DESC`,
        [driverId],
      );
    } else {
      throw new ApiError(403, 'FORBIDDEN', 'This role cannot view fleet groups');
    }
    return result.rows.map(mapGroup);
  }

  async updateGroup(
    actor: User,
    groupId: string,
    input: { name?: string; description?: string | null; status?: 'ACTIVE' | 'INACTIVE' },
  ): Promise<FleetGroup> {
    const group = await this.requireGroup(groupId);
    await this.assertOperatorScope(actor, group.operatorId);
    const result = await this.pool.query<GroupRow>(
      `UPDATE fleet_groups SET
         name = COALESCE($2, name),
         description = CASE WHEN $3::boolean THEN $4 ELSE description END,
         status = COALESCE($5::record_status, status),
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [groupId, input.name?.trim() ?? null, input.description !== undefined, input.description ?? null, input.status ?? null],
    );
    const updated = mapGroup(requireRow(result.rows[0]));
    await this.audit(actor.id, 'FLEET_GROUP_UPDATED', 'FLEET_GROUP', groupId, {
      fields: Object.keys(input),
    });
    return updated;
  }

  async addGroupDriver(actor: User, groupId: string, driverId: string): Promise<void> {
    const group = await this.requireGroup(groupId);
    await this.assertOperatorScope(actor, group.operatorId);
    const driverOperatorId = await this.requireDriverOperator(driverId);
    if (driverOperatorId !== group.operatorId) {
      throw new ApiError(403, 'FORBIDDEN', 'Driver does not belong to this operator');
    }
    await this.pool.query(
      `INSERT INTO fleet_group_drivers(group_id, driver_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [groupId, driverId],
    );
    await this.audit(actor.id, 'FLEET_GROUP_DRIVER_ADDED', 'FLEET_GROUP', groupId, { driverId });
  }

  async addGroupJeepney(actor: User, groupId: string, jeepneyId: string): Promise<void> {
    const group = await this.requireGroup(groupId);
    await this.assertOperatorScope(actor, group.operatorId);
    const jeepney = await this.requireJeepney(jeepneyId);
    if (jeepney.operatorId !== group.operatorId) {
      throw new ApiError(403, 'FORBIDDEN', 'Jeepney does not belong to this operator');
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT 1 FROM fleet_groups WHERE id = $1 FOR UPDATE', [groupId]);
      await client.query('SELECT 1 FROM jeepneys WHERE id = $1 FOR UPDATE', [jeepneyId]);
      const conflict = await client.query(
        `SELECT 1
         FROM vehicle_route_assignments target_assignment
         JOIN fleet_group_jeepneys existing_membership
           ON existing_membership.jeepney_id = $2
          AND existing_membership.group_id <> $1
         JOIN vehicle_route_assignments existing_assignment
           ON existing_assignment.group_id = existing_membership.group_id
          AND existing_assignment.active_to IS NULL
         WHERE target_assignment.group_id = $1
           AND target_assignment.active_to IS NULL
         LIMIT 1`,
        [groupId, jeepneyId],
      );
      if (conflict.rowCount !== 0) {
        throw new ApiError(
          409,
          'ROUTE_ASSIGNMENT_CONFLICT',
          'Jeepney cannot inherit active routes from more than one fleet group',
        );
      }
      await client.query(
        `INSERT INTO fleet_group_jeepneys(group_id, jeepney_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [groupId, jeepneyId],
      );
      await this.audit(
        actor.id,
        'FLEET_GROUP_JEEPNEY_ADDED',
        'FLEET_GROUP',
        groupId,
        { jeepneyId },
        client,
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async assignDriver(actor: User, jeepneyId: string, driverId: string): Promise<DriverAssignment> {
    const jeepney = await this.requireJeepney(jeepneyId);
    if (jeepney.operatorId === null) {
      throw new ApiError(409, 'CONFLICT', 'Jeepney must belong to an operator before assignment');
    }
    await this.assertOperatorScope(actor, jeepney.operatorId);
    if ((await this.requireDriverOperator(driverId)) !== jeepney.operatorId) {
      throw new ApiError(403, 'FORBIDDEN', 'Driver and jeepney must belong to the same operator');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE driver_jeepney_assignments SET active_to = now()
         WHERE active_to IS NULL AND (jeepney_id = $1 OR driver_id = $2)`,
        [jeepneyId, driverId],
      );
      const result = await client.query<AssignmentRow>(
        `INSERT INTO driver_jeepney_assignments(driver_id, jeepney_id, assigned_by_user_id)
         VALUES ($1, $2, $3) RETURNING *`,
        [driverId, jeepneyId, actor.id],
      );
      await this.audit(
        actor.id,
        'DRIVER_JEEPNEY_ASSIGNED',
        'JEEPNEY',
        jeepneyId,
        { driverId },
        client,
      );
      await client.query('COMMIT');
      const assignment = mapAssignment(requireRow(result.rows[0]));
      return assignment;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async requireActorOperator(userId: string): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      `SELECT id FROM operators WHERE owner_user_id = $1 AND status = 'ACTIVE'`,
      [userId],
    );
    const id = result.rows[0]?.id;
    if (id === undefined) throw new ApiError(403, 'FORBIDDEN', 'Active operator profile required');
    return id;
  }

  private async resolveAdminOperator(operatorId: string | undefined): Promise<string> {
    if (operatorId === undefined) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'operatorId is required for Admin operations');
    }
    await this.requireOperator(operatorId);
    return operatorId;
  }

  private async requireOperator(operatorId: string): Promise<void> {
    const result = await this.pool.query('SELECT 1 FROM operators WHERE id = $1', [operatorId]);
    if (result.rowCount !== 1) throw new ApiError(404, 'NOT_FOUND', 'Operator not found');
  }

  private async requireActorDriver(userId: string): Promise<string> {
    const result = await this.pool.query<{ id: string }>('SELECT id FROM drivers WHERE user_id = $1', [userId]);
    const id = result.rows[0]?.id;
    if (id === undefined) throw new ApiError(403, 'FORBIDDEN', 'Driver profile required');
    return id;
  }

  private async actorDriverOperator(userId: string): Promise<string | null> {
    const result = await this.pool.query<{ operator_id: string | null }>(
      'SELECT operator_id FROM drivers WHERE user_id = $1',
      [userId],
    );
    if (result.rows[0] === undefined) throw new ApiError(403, 'FORBIDDEN', 'Driver profile required');
    return result.rows[0].operator_id;
  }

  private async requireDriverOperator(driverId: string): Promise<string> {
    const result = await this.pool.query<{ operator_id: string | null }>(
      `SELECT operator_id FROM drivers WHERE id = $1 AND status = 'ACTIVE'`,
      [driverId],
    );
    const operatorId = result.rows[0]?.operator_id;
    if (operatorId === undefined || operatorId === null) {
      throw new ApiError(409, 'CONFLICT', 'Driver requires a verified operator association');
    }
    return operatorId;
  }

  private async requireJeepney(id: string): Promise<Jeepney> {
    const result = await this.pool.query<JeepneyRow>('SELECT * FROM jeepneys WHERE id = $1', [id]);
    if (result.rows[0] === undefined) throw new ApiError(404, 'NOT_FOUND', 'Jeepney not found');
    return mapJeepney(result.rows[0]);
  }

  private async requireGroup(id: string): Promise<FleetGroup> {
    const result = await this.pool.query<GroupRow>('SELECT * FROM fleet_groups WHERE id = $1', [id]);
    if (result.rows[0] === undefined) throw new ApiError(404, 'NOT_FOUND', 'Fleet group not found');
    return mapGroup(result.rows[0]);
  }

  private async assertCanManageJeepney(actor: User, jeepney: Jeepney): Promise<void> {
    if (actor.roles.includes('ADMIN')) return;
    if (actor.roles.includes('OPERATOR')) {
      await this.assertOperatorScope(actor, jeepney.operatorId);
      return;
    }
    if (actor.roles.includes('DRIVER') && jeepney.createdByUserId === actor.id && jeepney.status === 'DRAFT') {
      return;
    }
    throw new ApiError(403, 'FORBIDDEN', 'Jeepney is outside the permitted scope');
  }

  private async assertOperatorScope(actor: User, operatorId: string | null): Promise<void> {
    if (actor.roles.includes('ADMIN')) return;
    if (!actor.roles.includes('OPERATOR') || operatorId === null) {
      throw new ApiError(403, 'FORBIDDEN', 'Operator scope required');
    }
    if ((await this.requireActorOperator(actor.id)) !== operatorId) {
      throw new ApiError(403, 'FORBIDDEN', 'Resource belongs to another operator');
    }
  }

  private async audit(
    actorUserId: string,
    action: string,
    entityType: string,
    entityId: string,
    metadata: Record<string, unknown>,
    executor: Pick<pg.Pool | pg.PoolClient, 'query'> = this.pool,
  ): Promise<void> {
    await executor.query(
      `INSERT INTO audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [actorUserId, action, entityType, entityId, JSON.stringify(metadata)],
    );
  }
}

function mapJeepney(row: JeepneyRow): Jeepney {
  return {
    id: row.id,
    operatorId: row.operator_id,
    createdByUserId: row.created_by_user_id,
    plateNo: row.plate_no,
    colorHex: row.color_hex,
    description: row.description,
    status: row.status,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapGroup(row: GroupRow): FleetGroup {
  return {
    id: row.id,
    operatorId: row.operator_id,
    name: row.name,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAssignment(row: AssignmentRow): DriverAssignment {
  return {
    id: row.id,
    driverId: row.driver_id,
    jeepneyId: row.jeepney_id,
    assignedByUserId: row.assigned_by_user_id,
    activeFrom: row.active_from,
    activeTo: row.active_to,
  };
}

function normalizePlate(plateNo: string): string {
  return plateNo.trim().replace(/\s+/g, ' ').toUpperCase();
}

function requireRow<T>(row: T | undefined): T {
  if (row === undefined) throw new Error('Database operation returned no row');
  return row;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

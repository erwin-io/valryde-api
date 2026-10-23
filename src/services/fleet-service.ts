import type pg from 'pg';

import type { User } from '../domain/identity.js';
import type {
  DriverAssignment,
  DriverDirectoryEntry,
  FleetGroup,
  FleetGroupMember,
  Jeepney,
  JeepneyStatus,
  OperatorDirectoryEntry,
  PaginationResult,
} from '../domain/fleet.js';
import { lockTrackingAnchors, type QueryExecutor, runContextMutation } from '../db/tracking-context.js';
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

interface GroupMemberRow {
  member_type: 'DRIVER' | 'JEEPNEY';
  member_id: string;
  display_name: string | null;
  driver_status: 'ACTIVE' | 'DISABLED' | null;
  active_jeepney_id: string | null;
  plate_no: string | null;
  color_hex: string | null;
  description: string | null;
  jeepney_status: JeepneyStatus | null;
  active_driver_id: string | null;
  joined_at: Date;
}

interface DriverDirectoryRow {
  driver_id: string;
  user_id: string;
  email: string;
  display_name: string;
  status: 'ACTIVE' | 'DISABLED';
  user_status: 'ACTIVE' | 'DISABLED';
  email_verified: boolean;
  operator_id: string | null;
  active_jeepney_id: string | null;
  group_ids: string[];
  created_at: Date;
}

interface OperatorDirectoryRow {
  operator_id: string;
  owner_user_id: string;
  email: string;
  display_name: string;
  status: 'ACTIVE' | 'DISABLED';
  user_status: 'ACTIVE' | 'DISABLED';
  driver_count: number;
  jeepney_count: number;
  group_count: number;
  created_at: Date;
}

interface DirectoryQuery {
  q?: string;
  status?: 'ACTIVE' | 'DISABLED';
  page: number;
  pageSize: number;
}

interface DriverDirectoryQuery extends DirectoryQuery {
  operatorId?: string;
  associated?: boolean;
}

export class FleetService {
  constructor(private readonly pool: pg.Pool) {}

  async listDrivers(
    actor: User,
    query: DriverDirectoryQuery,
  ): Promise<{ drivers: DriverDirectoryEntry[]; pagination: PaginationResult }> {
    const isAdmin = actor.roles.includes('ADMIN');
    let operatorId: string | undefined;
    if (!isAdmin) {
      if (!actor.roles.includes('OPERATOR')) {
        throw new ApiError(403, 'FORBIDDEN', 'This role cannot view the Driver directory');
      }
      if (query.operatorId !== undefined || query.associated !== undefined) {
        throw new ApiError(403, 'FORBIDDEN', 'Operator scope cannot be changed by query filters');
      }
      operatorId = await this.requireActorOperator(actor.id);
    }

    const values: unknown[] = [];
    const conditions: string[] = [];
    const parameter = (value: unknown): string => {
      values.push(value);
      return `$${values.length}`;
    };

    if (operatorId !== undefined) {
      conditions.push(`d.operator_id = ${parameter(operatorId)}::uuid`);
    } else if (query.operatorId !== undefined) {
      conditions.push(`d.operator_id = ${parameter(query.operatorId)}::uuid`);
    }
    if (isAdmin && query.associated !== undefined) {
      conditions.push(query.associated ? 'd.operator_id IS NOT NULL' : 'd.operator_id IS NULL');
    }
    if (query.status !== undefined) {
      conditions.push(`d.status = ${parameter(query.status)}::user_status`);
    }
    if (query.q !== undefined) {
      const q = parameter(`%${query.q.trim()}%`);
      conditions.push(`(u.display_name ILIKE ${q} OR u.email::text ILIKE ${q})`);
    }
    const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`;
    const countResult = await this.pool.query<{ total: number }>(
      `SELECT count(*)::integer AS total
       FROM drivers d
       JOIN users u ON u.id = d.user_id
       ${where}`,
      values,
    );
    const total = countResult.rows[0]?.total ?? 0;
    const limit = parameter(query.pageSize);
    const offset = parameter((query.page - 1) * query.pageSize);
    const result = await this.pool.query<DriverDirectoryRow>(
      `SELECT
         d.id AS driver_id,
         d.user_id,
         u.email::text,
         u.display_name,
         d.status,
         u.status AS user_status,
         (u.email_verified_at IS NOT NULL) AS email_verified,
         d.operator_id,
         (
           SELECT dja.jeepney_id
           FROM driver_jeepney_assignments dja
           WHERE dja.driver_id = d.id AND dja.active_to IS NULL
           ORDER BY dja.active_from DESC, dja.id
           LIMIT 1
         ) AS active_jeepney_id,
         COALESCE(
           ARRAY(
             SELECT fgd.group_id
             FROM fleet_group_drivers fgd
             JOIN fleet_groups fg ON fg.id = fgd.group_id
             WHERE fgd.driver_id = d.id
               AND (d.operator_id IS NULL OR fg.operator_id = d.operator_id)
             ORDER BY fgd.group_id
           ),
           ARRAY[]::uuid[]
         ) AS group_ids,
         d.created_at
       FROM drivers d
       JOIN users u ON u.id = d.user_id
       ${where}
       ORDER BY u.display_name ASC, d.id ASC
       LIMIT ${limit} OFFSET ${offset}`,
      values,
    );
    return {
      drivers: result.rows.map(mapDriverDirectoryEntry),
      pagination: pagination(query.page, query.pageSize, total),
    };
  }

  async listOperators(
    actor: User,
    query: DirectoryQuery,
  ): Promise<{ operators: OperatorDirectoryEntry[]; pagination: PaginationResult }> {
    if (!actor.roles.includes('ADMIN')) {
      throw new ApiError(403, 'FORBIDDEN', 'Only Admin may view the Operator directory');
    }
    const values: unknown[] = [];
    const conditions: string[] = [];
    const parameter = (value: unknown): string => {
      values.push(value);
      return `$${values.length}`;
    };
    if (query.status !== undefined) {
      conditions.push(`o.status = ${parameter(query.status)}::user_status`);
    }
    if (query.q !== undefined) {
      const q = parameter(`%${query.q.trim()}%`);
      conditions.push(`(u.display_name ILIKE ${q} OR u.email::text ILIKE ${q})`);
    }
    const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`;
    const countResult = await this.pool.query<{ total: number }>(
      `SELECT count(*)::integer AS total
       FROM operators o
       JOIN users u ON u.id = o.owner_user_id
       ${where}`,
      values,
    );
    const total = countResult.rows[0]?.total ?? 0;
    const limit = parameter(query.pageSize);
    const offset = parameter((query.page - 1) * query.pageSize);
    const result = await this.pool.query<OperatorDirectoryRow>(
      `SELECT
         o.id AS operator_id,
         o.owner_user_id,
         u.email::text,
         u.display_name,
         o.status,
         u.status AS user_status,
         (SELECT count(*)::integer FROM drivers d WHERE d.operator_id = o.id) AS driver_count,
         (SELECT count(*)::integer FROM jeepneys j WHERE j.operator_id = o.id) AS jeepney_count,
         (SELECT count(*)::integer FROM fleet_groups fg WHERE fg.operator_id = o.id) AS group_count,
         o.created_at
       FROM operators o
       JOIN users u ON u.id = o.owner_user_id
       ${where}
       ORDER BY u.display_name ASC, o.id ASC
       LIMIT ${limit} OFFSET ${offset}`,
      values,
    );
    return {
      operators: result.rows.map(mapOperatorDirectoryEntry),
      pagination: pagination(query.page, query.pageSize, total),
    };
  }

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
    // Status changes telemetry eligibility; color and description do not.
    return runContextMutation(this.pool, {
      affected: () => Promise.resolve(input.status === undefined ? [] : [jeepneyId]),
      apply: (client) => this.applyJeepneyUpdate(client, actor, jeepneyId, input),
    });
  }

  private async applyJeepneyUpdate(
    client: pg.PoolClient,
    actor: User,
    jeepneyId: string,
    input: { colorHex?: string; description?: string | null; status?: JeepneyStatus },
  ): Promise<Jeepney> {
    const result = await client.query<JeepneyRow>(
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
    }, client);
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

  async listGroupMembers(
    actor: User,
    groupId: string,
    input: { memberType?: 'DRIVER' | 'JEEPNEY'; page: number; pageSize: number },
  ): Promise<{ members: FleetGroupMember[]; total: number }> {
    const group = await this.requireGroup(groupId);
    await this.assertCanReadGroupMembers(actor, group);
    const offset = (input.page - 1) * input.pageSize;
    const memberType = input.memberType ?? null;
    const members = await this.pool.query<GroupMemberRow>(
      `WITH group_members AS (
         SELECT 'DRIVER'::text AS member_type, d.id AS member_id,
                u.display_name, d.status::text AS driver_status,
                dja.jeepney_id AS active_jeepney_id,
                NULL::text AS plate_no, NULL::text AS color_hex,
                NULL::text AS description, NULL::text AS jeepney_status,
                NULL::uuid AS active_driver_id, fgd.created_at AS joined_at
         FROM fleet_group_drivers fgd
         JOIN drivers d ON d.id = fgd.driver_id
         JOIN users u ON u.id = d.user_id
         LEFT JOIN driver_jeepney_assignments dja
           ON dja.driver_id = d.id AND dja.active_to IS NULL
         WHERE fgd.group_id = $1
         UNION ALL
         SELECT 'JEEPNEY'::text AS member_type, j.id AS member_id,
                NULL::text AS display_name, NULL::text AS driver_status,
                NULL::uuid AS active_jeepney_id,
                j.plate_no::text, j.color_hex, j.description,
                j.status::text AS jeepney_status,
                dja.driver_id AS active_driver_id, fgj.created_at AS joined_at
         FROM fleet_group_jeepneys fgj
         JOIN jeepneys j ON j.id = fgj.jeepney_id
         LEFT JOIN driver_jeepney_assignments dja
           ON dja.jeepney_id = j.id AND dja.active_to IS NULL
         WHERE fgj.group_id = $1
       )
       SELECT member_type, member_id, display_name, driver_status,
              active_jeepney_id, plate_no, color_hex, description,
              jeepney_status, active_driver_id, joined_at
       FROM group_members
       WHERE ($2::text IS NULL OR member_type = $2)
       ORDER BY member_type, COALESCE(display_name, plate_no), member_id
       LIMIT $3 OFFSET $4`,
      [groupId, memberType, input.pageSize, offset],
    );
    const count = await this.pool.query<{ total: string }>(
      `SELECT (
         CASE WHEN $2::text IS NULL OR $2 = 'DRIVER'
           THEN (SELECT count(*) FROM fleet_group_drivers WHERE group_id = $1)
           ELSE 0 END
         + CASE WHEN $2::text IS NULL OR $2 = 'JEEPNEY'
           THEN (SELECT count(*) FROM fleet_group_jeepneys WHERE group_id = $1)
           ELSE 0 END
       )::text AS total`,
      [groupId, memberType],
    );
    return {
      members: members.rows.map(mapGroupMember),
      total: Number(count.rows[0]?.total ?? 0),
    };
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
    return runContextMutation(this.pool, {
      affected: () => Promise.resolve([jeepneyId]),
      lockAnchors: async (client) => {
        // Group assignment changes take this anchor too, so its route set cannot change between
        // discovery and the membership insert. Route/direction edits then share the same anchors.
        await lockTrackingAnchors(client, 'group', [groupId]);
        const assignments = await client.query<{ route_id: string; route_direction_id: string }>(
          `SELECT rd.route_id, assignment.route_direction_id
           FROM vehicle_route_assignments assignment
           JOIN route_directions rd ON rd.id = assignment.route_direction_id
           WHERE assignment.group_id = $1 AND assignment.active_to IS NULL`,
          [groupId],
        );
        await lockTrackingAnchors(client, 'route', assignments.rows.map((row) => row.route_id));
        await lockTrackingAnchors(
          client,
          'direction',
          assignments.rows.map((row) => row.route_direction_id),
        );
      },
      apply: async (client) => {
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
      },
    });
  }

  // Visibility-only (X8): changes private recipients, not the vehicle's tracking context, so no
  // advisory key or version bump. REST reads re-authorize immediately.
  async removeGroupDriver(actor: User, groupId: string, driverId: string): Promise<void> {
    const group = await this.requireGroup(groupId);
    await this.assertOperatorScope(actor, group.operatorId);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT 1 FROM fleet_groups WHERE id = $1 FOR UPDATE', [groupId]);
      const removed = await client.query(
        'DELETE FROM fleet_group_drivers WHERE group_id = $1 AND driver_id = $2 RETURNING 1',
        [groupId, driverId],
      );
      if (removed.rowCount !== 1) {
        throw new ApiError(404, 'NOT_FOUND', 'Driver membership not found');
      }
      await this.audit(
        actor.id,
        'FLEET_GROUP_DRIVER_REMOVED',
        'FLEET_GROUP',
        groupId,
        { driverId },
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

  async removeGroupJeepney(actor: User, groupId: string, jeepneyId: string): Promise<void> {
    const group = await this.requireGroup(groupId);
    await this.assertOperatorScope(actor, group.operatorId);
    return runContextMutation(this.pool, {
      affected: () => Promise.resolve([jeepneyId]),
      apply: async (client) => {
        await client.query('SELECT 1 FROM fleet_groups WHERE id = $1 FOR UPDATE', [groupId]);
        await client.query('SELECT 1 FROM jeepneys WHERE id = $1 FOR UPDATE', [jeepneyId]);
        const removed = await client.query(
          'DELETE FROM fleet_group_jeepneys WHERE group_id = $1 AND jeepney_id = $2 RETURNING 1',
          [groupId, jeepneyId],
        );
        if (removed.rowCount !== 1) {
          throw new ApiError(404, 'NOT_FOUND', 'Jeepney membership not found');
        }
        await this.audit(
          actor.id,
          'FLEET_GROUP_JEEPNEY_REMOVED',
          'FLEET_GROUP',
          groupId,
          { jeepneyId },
          client,
        );
      },
    });
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

  // Visibility-only (X8), like removeGroupDriver: no tracking context bump.
  async unassignDriver(actor: User, jeepneyId: string): Promise<DriverAssignment> {
    const jeepney = await this.requireJeepney(jeepneyId);
    if (jeepney.operatorId === null) {
      throw new ApiError(409, 'CONFLICT', 'Jeepney must belong to an operator before unassignment');
    }
    await this.assertOperatorScope(actor, jeepney.operatorId);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT 1 FROM jeepneys WHERE id = $1 FOR UPDATE', [jeepneyId]);
      const result = await client.query<AssignmentRow>(
        `UPDATE driver_jeepney_assignments
         SET active_to = clock_timestamp()
         WHERE jeepney_id = $1 AND active_to IS NULL
         RETURNING id, driver_id, jeepney_id, assigned_by_user_id, active_from, active_to`,
        [jeepneyId],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new ApiError(409, 'CONFLICT', 'Jeepney has no active Driver assignment');
      }
      await this.audit(
        actor.id,
        'DRIVER_JEEPNEY_UNASSIGNED',
        'JEEPNEY',
        jeepneyId,
        { driverId: row.driver_id, assignmentId: row.id },
        client,
      );
      await client.query('COMMIT');
      return mapAssignment(row);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getCurrentDriverAssignment(actor: User): Promise<DriverAssignment | null> {
    const driverId = await this.requireActorDriver(actor.id);
    const result = await this.pool.query<AssignmentRow>(
      `SELECT id, driver_id, jeepney_id, assigned_by_user_id, active_from, active_to
       FROM driver_jeepney_assignments
       WHERE driver_id = $1 AND active_to IS NULL
       ORDER BY active_from DESC, id
       LIMIT 1`,
      [driverId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapAssignment(row);
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

  private async assertCanReadGroupMembers(actor: User, group: FleetGroup): Promise<void> {
    if (actor.roles.includes('ADMIN')) return;
    if (actor.roles.includes('OPERATOR')) {
      await this.assertOperatorScope(actor, group.operatorId);
      return;
    }
    if (actor.roles.includes('DRIVER')) {
      const driverId = await this.requireActorDriver(actor.id);
      const membership = await this.pool.query(
        'SELECT 1 FROM fleet_group_drivers WHERE group_id = $1 AND driver_id = $2 LIMIT 1',
        [group.id, driverId],
      );
      if (membership.rowCount === 1) return;
    }
    throw new ApiError(403, 'FORBIDDEN', 'Fleet group members are outside the permitted scope');
  }

  private async audit(
    actorUserId: string,
    action: string,
    entityType: string,
    entityId: string,
    metadata: Record<string, unknown>,
    executor: QueryExecutor = this.pool,
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

function mapGroupMember(row: GroupMemberRow): FleetGroupMember {
  if (row.member_type === 'DRIVER') {
    if (row.display_name === null || row.driver_status === null) {
      throw new Error('Driver group membership returned incomplete data');
    }
    return {
      memberType: 'DRIVER',
      driverId: row.member_id,
      displayName: row.display_name,
      status: row.driver_status,
      activeJeepneyId: row.active_jeepney_id,
      joinedAt: row.joined_at,
    };
  }
  if (row.plate_no === null || row.color_hex === null || row.jeepney_status === null) {
    throw new Error('Jeepney group membership returned incomplete data');
  }
  return {
    memberType: 'JEEPNEY',
    jeepneyId: row.member_id,
    plateNo: row.plate_no,
    colorHex: row.color_hex,
    description: row.description,
    status: row.jeepney_status,
    activeDriverId: row.active_driver_id,
    joinedAt: row.joined_at,
  };
}

function mapDriverDirectoryEntry(row: DriverDirectoryRow): DriverDirectoryEntry {
  return {
    driverId: row.driver_id,
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    status: row.status,
    userStatus: row.user_status,
    emailVerified: row.email_verified,
    operatorId: row.operator_id,
    activeJeepneyId: row.active_jeepney_id,
    groupIds: row.group_ids,
    createdAt: row.created_at,
  };
}

function mapOperatorDirectoryEntry(row: OperatorDirectoryRow): OperatorDirectoryEntry {
  return {
    operatorId: row.operator_id,
    ownerUserId: row.owner_user_id,
    email: row.email,
    displayName: row.display_name,
    status: row.status,
    userStatus: row.user_status,
    driverCount: row.driver_count,
    jeepneyCount: row.jeepney_count,
    groupCount: row.group_count,
    createdAt: row.created_at,
  };
}

function pagination(page: number, pageSize: number, total: number): PaginationResult {
  return { page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
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

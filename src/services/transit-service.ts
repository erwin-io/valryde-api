import type pg from 'pg';

import type { User } from '../domain/identity.js';
import type {
  EffectiveRouteDirection,
  LineStringGeometry,
  RecordStatus,
  RouteDirection,
  TransitRoute,
  VehicleRouteAssignment,
} from '../domain/transit.js';
import { ApiError } from '../lib/api-error.js';

interface RouteRow {
  id: string;
  route_code: string;
  public_name: string;
  description: string | null;
  route_color_hex: string;
  status: RecordStatus;
  created_at: Date;
  updated_at: Date;
}

interface DirectionRow {
  id: string;
  route_id: string;
  direction_label: string;
  origin_name: string;
  destination_name: string;
  geometry: LineStringGeometry;
  corridor_m: number;
  status: RecordStatus;
  created_at: Date;
  updated_at: Date;
}

interface AssignmentRow {
  id: string;
  jeepney_id: string | null;
  group_id: string | null;
  route_direction_id: string;
  assigned_by_user_id: string;
  active_from: Date;
  active_to: Date | null;
}

interface EffectiveRouteRow extends DirectionRow {
  assignment_id: string;
  assignment_group_id: string | null;
  assignment_active_from: Date;
}

export class TransitService {
  constructor(private readonly pool: pg.Pool) {}

  async listPublicRoutes(input: { q?: string; page: number; pageSize: number }): Promise<{
    routes: Array<TransitRoute & { directions: RouteDirection[] }>;
    total: number;
  }> {
    const query = input.q?.trim() || null;
    const routes = await this.pool.query<RouteRow>(
      `SELECT tr.* FROM transit_routes tr
       WHERE tr.status = 'ACTIVE'
         AND ($1::text IS NULL OR tr.route_code ILIKE '%' || $1 || '%'
           OR tr.public_name ILIKE '%' || $1 || '%'
           OR COALESCE(tr.description, '') ILIKE '%' || $1 || '%'
           OR EXISTS (
             SELECT 1 FROM route_directions rd
             WHERE rd.route_id = tr.id AND rd.status = 'ACTIVE'
               AND (rd.origin_name ILIKE '%' || $1 || '%'
                 OR rd.destination_name ILIKE '%' || $1 || '%')
           ))
       ORDER BY tr.route_code
       LIMIT $2 OFFSET $3`,
      [query, input.pageSize, (input.page - 1) * input.pageSize],
    );
    const count = await this.pool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM transit_routes tr
       WHERE tr.status = 'ACTIVE'
         AND ($1::text IS NULL OR tr.route_code ILIKE '%' || $1 || '%'
           OR tr.public_name ILIKE '%' || $1 || '%'
           OR COALESCE(tr.description, '') ILIKE '%' || $1 || '%'
           OR EXISTS (
             SELECT 1 FROM route_directions rd
             WHERE rd.route_id = tr.id AND rd.status = 'ACTIVE'
               AND (rd.origin_name ILIKE '%' || $1 || '%'
                 OR rd.destination_name ILIKE '%' || $1 || '%')
           ))`,
      [query],
    );
    const routeIds = routes.rows.map((row) => row.id);
    const directions = routeIds.length === 0
      ? { rows: [] as DirectionRow[] }
      : await this.pool.query<DirectionRow>(
          `${directionSelect} WHERE rd.status = 'ACTIVE' AND tr.status = 'ACTIVE'
           AND rd.route_id = ANY($1::uuid[])
           ORDER BY tr.route_code, rd.direction_label`,
          [routeIds],
        );
    return {
      routes: attachDirections(routes.rows.map(mapRoute), directions.rows.map(mapDirection)),
      total: Number(count.rows[0]?.total ?? 0),
    };
  }

  async getPublicRoute(routeId: string): Promise<TransitRoute & { directions: RouteDirection[] }> {
    const routes = await this.pool.query<RouteRow>(
      `SELECT * FROM transit_routes WHERE id = $1 AND status = 'ACTIVE'`,
      [routeId],
    );
    const route = routes.rows[0];
    if (route === undefined) throw new ApiError(404, 'NOT_FOUND', 'Transit route not found');
    const directions = await this.pool.query<DirectionRow>(
      `${directionSelect} WHERE rd.route_id = $1 AND rd.status = 'ACTIVE' AND tr.status = 'ACTIVE'
       ORDER BY rd.direction_label`,
      [routeId],
    );
    return { ...mapRoute(route), directions: directions.rows.map(mapDirection) };
  }

  async listAdminRoutes(): Promise<Array<TransitRoute & { directions: RouteDirection[] }>> {
    const routes = await this.pool.query<RouteRow>('SELECT * FROM transit_routes ORDER BY route_code');
    const directions = await this.pool.query<DirectionRow>(
      `${directionSelect} ORDER BY tr.route_code, rd.direction_label`,
    );
    return attachDirections(routes.rows.map(mapRoute), directions.rows.map(mapDirection));
  }

  async createRoute(
    actor: User,
    input: { routeCode: string; publicName: string; description?: string; routeColorHex: string },
  ): Promise<TransitRoute> {
    try {
      const result = await this.pool.query<RouteRow>(
        `INSERT INTO transit_routes(route_code, public_name, description, route_color_hex)
         VALUES (upper($1), $2, $3, upper($4)) RETURNING *`,
        [input.routeCode.trim(), input.publicName.trim(), input.description ?? null, input.routeColorHex],
      );
      const route = mapRoute(requireRow(result.rows[0]));
      await this.audit(actor.id, 'TRANSIT_ROUTE_CREATED', 'TRANSIT_ROUTE', route.id, {});
      return route;
    } catch (error) {
      if (isUniqueViolation(error)) throw new ApiError(409, 'CONFLICT', 'Route code already exists');
      throw error;
    }
  }

  async updateRoute(
    actor: User,
    routeId: string,
    input: {
      publicName?: string;
      description?: string | null;
      routeColorHex?: string;
      status?: RecordStatus;
    },
  ): Promise<TransitRoute> {
    await this.requireRoute(routeId);
    const result = await this.pool.query<RouteRow>(
      `UPDATE transit_routes SET
         public_name = COALESCE($2, public_name),
         description = CASE WHEN $3::boolean THEN $4 ELSE description END,
         route_color_hex = COALESCE(upper($5), route_color_hex),
         status = COALESCE($6::record_status, status),
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [
        routeId,
        input.publicName?.trim() ?? null,
        input.description !== undefined,
        input.description ?? null,
        input.routeColorHex ?? null,
        input.status ?? null,
      ],
    );
    const route = mapRoute(requireRow(result.rows[0]));
    await this.audit(actor.id, 'TRANSIT_ROUTE_UPDATED', 'TRANSIT_ROUTE', routeId, {
      fields: Object.keys(input),
    });
    return route;
  }

  async createDirection(
    actor: User,
    routeId: string,
    input: {
      directionLabel: string;
      originName: string;
      destinationName: string;
      geometry: LineStringGeometry;
      corridorM?: number;
    },
  ): Promise<RouteDirection> {
    await this.requireRoute(routeId);
    validateLineString(input.geometry);
    try {
      const result = await this.pool.query<DirectionRow>(
        `${directionInsert}
         VALUES ($1, $2, $3, $4, ST_SetSRID(ST_GeomFromGeoJSON($5), 4326), $6)
         RETURNING ${directionReturning}`,
        [
          routeId,
          input.directionLabel.trim(),
          input.originName.trim(),
          input.destinationName.trim(),
          JSON.stringify(input.geometry),
          input.corridorM ?? 100,
        ],
      );
      const direction = mapDirection(requireRow(result.rows[0]));
      await this.audit(actor.id, 'ROUTE_DIRECTION_CREATED', 'ROUTE_DIRECTION', direction.id, {
        routeId,
      });
      return direction;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError(409, 'CONFLICT', 'Direction label already exists for this route');
      }
      throw error;
    }
  }

  async updateDirection(
    actor: User,
    directionId: string,
    input: {
      directionLabel?: string;
      originName?: string;
      destinationName?: string;
      geometry?: LineStringGeometry;
      corridorM?: number;
      status?: RecordStatus;
    },
  ): Promise<RouteDirection> {
    await this.requireDirection(directionId, false);
    if (input.geometry !== undefined) validateLineString(input.geometry);
    const result = await this.pool.query<DirectionRow>(
      `UPDATE route_directions SET
         direction_label = COALESCE($2, direction_label),
         origin_name = COALESCE($3, origin_name),
         destination_name = COALESCE($4, destination_name),
         geometry = CASE WHEN $5::boolean
           THEN ST_SetSRID(ST_GeomFromGeoJSON($6), 4326) ELSE geometry END,
         corridor_m = COALESCE($7, corridor_m),
         status = COALESCE($8::record_status, status),
         updated_at = now()
       WHERE id = $1 RETURNING ${directionReturning}`,
      [
        directionId,
        input.directionLabel?.trim() ?? null,
        input.originName?.trim() ?? null,
        input.destinationName?.trim() ?? null,
        input.geometry !== undefined,
        input.geometry === undefined ? null : JSON.stringify(input.geometry),
        input.corridorM ?? null,
        input.status ?? null,
      ],
    );
    const direction = mapDirection(requireRow(result.rows[0]));
    await this.audit(actor.id, 'ROUTE_DIRECTION_UPDATED', 'ROUTE_DIRECTION', directionId, {
      fields: Object.keys(input),
    });
    return direction;
  }

  async assignRoute(
    actor: User,
    input: { routeDirectionId: string; jeepneyId?: string; groupId?: string },
  ): Promise<VehicleRouteAssignment> {
    if ((input.jeepneyId === undefined) === (input.groupId === undefined)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Exactly one assignment target is required');
    }
    await this.requireDirection(input.routeDirectionId, true);
    const operatorId = await this.actorOperator(actor);
    if (input.jeepneyId !== undefined) {
      await this.requireOwned('jeepneys', input.jeepneyId, operatorId);
    } else {
      await this.requireOwned('fleet_groups', requireValue(input.groupId), operatorId);
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (input.jeepneyId !== undefined) {
        await client.query('SELECT 1 FROM jeepneys WHERE id = $1 FOR UPDATE', [input.jeepneyId]);
      } else {
        await client.query('SELECT 1 FROM fleet_groups WHERE id = $1 FOR UPDATE', [input.groupId]);
        await client.query(
          `SELECT j.id
           FROM fleet_group_jeepneys fgj
           JOIN jeepneys j ON j.id = fgj.jeepney_id
           WHERE fgj.group_id = $1
           ORDER BY j.id
           FOR UPDATE OF j`,
          [input.groupId],
        );
        const conflict = await client.query(
          `SELECT target_membership.jeepney_id
           FROM fleet_group_jeepneys target_membership
           JOIN fleet_group_jeepneys other_membership
             ON other_membership.jeepney_id = target_membership.jeepney_id
            AND other_membership.group_id <> target_membership.group_id
           JOIN vehicle_route_assignments other_assignment
             ON other_assignment.group_id = other_membership.group_id
            AND other_assignment.active_to IS NULL
           WHERE target_membership.group_id = $1
           LIMIT 1`,
          [input.groupId],
        );
        if (conflict.rowCount !== 0) {
          throw new ApiError(
            409,
            'ROUTE_ASSIGNMENT_CONFLICT',
            'Group assignment would give a jeepney more than one active group route',
          );
        }
      }
      await client.query(
        `UPDATE vehicle_route_assignments SET active_to = now()
         WHERE active_to IS NULL
           AND (($1::uuid IS NOT NULL AND jeepney_id = $1) OR ($2::uuid IS NOT NULL AND group_id = $2))`,
        [input.jeepneyId ?? null, input.groupId ?? null],
      );
      const result = await client.query<AssignmentRow>(
        `INSERT INTO vehicle_route_assignments(
           jeepney_id, group_id, route_direction_id, assigned_by_user_id
         ) VALUES ($1, $2, $3, $4) RETURNING *`,
        [input.jeepneyId ?? null, input.groupId ?? null, input.routeDirectionId, actor.id],
      );
      const assignment = mapAssignment(requireRow(result.rows[0]));
      await this.audit(
        actor.id,
        'VEHICLE_ROUTE_ASSIGNED',
        input.jeepneyId === undefined ? 'FLEET_GROUP' : 'JEEPNEY',
        input.jeepneyId ?? requireValue(input.groupId),
        { routeDirectionId: input.routeDirectionId },
        client,
      );
      await client.query('COMMIT');
      return assignment;
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) {
        throw new ApiError(409, 'ROUTE_ASSIGNMENT_CONFLICT', 'An active route assignment already exists');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async getEffectiveRouteDirection(
    actor: User,
    jeepneyId: string,
  ): Promise<EffectiveRouteDirection | null> {
    await this.assertCanReadJeepney(actor, jeepneyId);
    return this.resolveEffectiveRouteDirection(jeepneyId);
  }

  async resolveEffectiveRouteDirection(jeepneyId: string): Promise<EffectiveRouteDirection | null> {
    const direct = await this.pool.query<EffectiveRouteRow>(
      `${effectiveDirectionSelect}
       WHERE assignment.jeepney_id = $1 AND assignment.active_to IS NULL`,
      [jeepneyId],
    );
    const directRow = direct.rows[0];
    if (directRow !== undefined) return mapEffectiveRoute(directRow, 'DIRECT');

    const group = await this.pool.query<EffectiveRouteRow>(
      `${effectiveDirectionSelect}
       JOIN fleet_group_jeepneys membership ON membership.group_id = assignment.group_id
       WHERE membership.jeepney_id = $1 AND assignment.active_to IS NULL
       ORDER BY assignment.active_from DESC, assignment.id`,
      [jeepneyId],
    );
    if (group.rows.length > 1) {
      throw new ApiError(
        409,
        'ROUTE_ASSIGNMENT_CONFLICT',
        'Jeepney inherits more than one active fleet-group route',
      );
    }
    const groupRow = group.rows[0];
    return groupRow === undefined ? null : mapEffectiveRoute(groupRow, 'GROUP');
  }

  private async actorOperator(actor: User): Promise<string> {
    if (!actor.roles.includes('OPERATOR')) {
      throw new ApiError(403, 'FORBIDDEN', 'An Operator account is required');
    }
    const result = await this.pool.query<{ id: string }>(
      `SELECT id FROM operators WHERE owner_user_id = $1 AND status = 'ACTIVE'`,
      [actor.id],
    );
    const id = result.rows[0]?.id;
    if (id === undefined) throw new ApiError(403, 'FORBIDDEN', 'Active operator profile required');
    return id;
  }

  private async assertCanReadJeepney(actor: User, jeepneyId: string): Promise<void> {
    if (actor.roles.includes('ADMIN')) {
      const result = await this.pool.query('SELECT 1 FROM jeepneys WHERE id = $1', [jeepneyId]);
      if (result.rowCount !== 1) throw new ApiError(404, 'NOT_FOUND', 'Jeepney not found');
      return;
    }
    if (actor.roles.includes('OPERATOR')) {
      await this.requireOwned('jeepneys', jeepneyId, await this.actorOperator(actor));
      return;
    }
    if (actor.roles.includes('DRIVER')) {
      const result = await this.pool.query(
        `SELECT 1
         FROM jeepneys j
         JOIN drivers d ON d.user_id = $2
         LEFT JOIN driver_jeepney_assignments dja
           ON dja.jeepney_id = j.id AND dja.driver_id = d.id AND dja.active_to IS NULL
         LEFT JOIN fleet_group_jeepneys fgj ON fgj.jeepney_id = j.id
         LEFT JOIN fleet_group_drivers fgd ON fgd.group_id = fgj.group_id AND fgd.driver_id = d.id
         WHERE j.id = $1 AND (j.created_by_user_id = $2 OR dja.id IS NOT NULL OR fgd.driver_id IS NOT NULL)`,
        [jeepneyId, actor.id],
      );
      if (result.rowCount !== 1) throw new ApiError(403, 'FORBIDDEN', 'Jeepney is outside driver scope');
      return;
    }
    throw new ApiError(403, 'FORBIDDEN', 'This role cannot view effective route assignments');
  }

  private async requireOwned(table: 'jeepneys' | 'fleet_groups', id: string, operatorId: string) {
    const result = await this.pool.query(`SELECT 1 FROM ${table} WHERE id = $1 AND operator_id = $2`, [
      id,
      operatorId,
    ]);
    if (result.rowCount !== 1) throw new ApiError(403, 'FORBIDDEN', 'Assignment target is outside operator scope');
  }

  private async requireRoute(id: string): Promise<void> {
    const result = await this.pool.query('SELECT 1 FROM transit_routes WHERE id = $1', [id]);
    if (result.rowCount !== 1) throw new ApiError(404, 'NOT_FOUND', 'Transit route not found');
  }

  private async requireDirection(id: string, active: boolean): Promise<void> {
    const result = await this.pool.query(
      `SELECT 1 FROM route_directions rd JOIN transit_routes tr ON tr.id = rd.route_id
       WHERE rd.id = $1 AND ($2::boolean = false OR (rd.status = 'ACTIVE' AND tr.status = 'ACTIVE'))`,
      [id, active],
    );
    if (result.rowCount !== 1) {
      throw new ApiError(
        active ? 409 : 404,
        active ? 'ROUTE_NOT_APPROVED' : 'NOT_FOUND',
        active ? 'Route and direction must be active before assignment' : 'Route direction not found',
      );
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

const directionSelect = `SELECT rd.id, rd.route_id, rd.direction_label, rd.origin_name,
  rd.destination_name, ST_AsGeoJSON(rd.geometry)::json AS geometry, rd.corridor_m,
  rd.status, rd.created_at, rd.updated_at
  FROM route_directions rd JOIN transit_routes tr ON tr.id = rd.route_id`;

const directionInsert = `INSERT INTO route_directions(
  route_id, direction_label, origin_name, destination_name, geometry, corridor_m
)`;

const directionReturning = `id, route_id, direction_label, origin_name, destination_name,
  ST_AsGeoJSON(geometry)::json AS geometry, corridor_m, status, created_at, updated_at`;

const effectiveDirectionSelect = `SELECT assignment.id AS assignment_id,
  assignment.group_id AS assignment_group_id, assignment.active_from AS assignment_active_from,
  rd.id, rd.route_id, rd.direction_label, rd.origin_name, rd.destination_name,
  ST_AsGeoJSON(rd.geometry)::json AS geometry, rd.corridor_m, rd.status,
  rd.created_at, rd.updated_at
  FROM vehicle_route_assignments assignment
  JOIN route_directions rd ON rd.id = assignment.route_direction_id`;

function mapRoute(row: RouteRow): TransitRoute {
  return {
    id: row.id,
    routeCode: row.route_code,
    publicName: row.public_name,
    description: row.description,
    routeColorHex: row.route_color_hex,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDirection(row: DirectionRow): RouteDirection {
  return {
    id: row.id,
    routeId: row.route_id,
    directionLabel: row.direction_label,
    originName: row.origin_name,
    destinationName: row.destination_name,
    geometry: row.geometry,
    corridorM: row.corridor_m,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAssignment(row: AssignmentRow): VehicleRouteAssignment {
  return {
    id: row.id,
    jeepneyId: row.jeepney_id,
    groupId: row.group_id,
    routeDirectionId: row.route_direction_id,
    assignedByUserId: row.assigned_by_user_id,
    activeFrom: row.active_from,
    activeTo: row.active_to,
  };
}

function mapEffectiveRoute(
  row: EffectiveRouteRow,
  source: EffectiveRouteDirection['source'],
): EffectiveRouteDirection {
  return {
    source,
    assignmentId: row.assignment_id,
    groupId: row.assignment_group_id,
    activeFrom: row.assignment_active_from,
    direction: mapDirection(row),
  };
}

function attachDirections(
  routes: TransitRoute[],
  directions: RouteDirection[],
): Array<TransitRoute & { directions: RouteDirection[] }> {
  return routes.map((route) => ({
    ...route,
    directions: directions.filter((direction) => direction.routeId === route.id),
  }));
}

function validateLineString(geometry: LineStringGeometry): void {
  if (geometry.coordinates.length < 2) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'LineString requires at least two positions');
  }
  for (const position of geometry.coordinates) {
    const [longitude, latitude] = position;
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Coordinates must be finite numbers');
    }
    if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Coordinates are outside WGS84 bounds');
    }
  }
}

function requireRow<T>(row: T | undefined): T {
  if (row === undefined) throw new Error('Database operation returned no row');
  return row;
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Required value is missing');
  return value;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

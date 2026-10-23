import type pg from 'pg';

import type { QueryExecutor } from '../db/tracking-context.js';
import type { User } from '../domain/identity.js';
import { ApiError } from '../lib/api-error.js';

/**
 * Private tracking visibility (Stage 13b §6): re-authorized against current Agent A tables on every
 * read. Existence semantics: any one valid path authorizes, however many group rows match.
 */
export class TrackingVisibilityService {
  constructor(private readonly pool: pg.Pool) {}

  async assertCanReadPrivateTracking(
    actor: User,
    jeepneyId: string,
    executor: QueryExecutor = this.pool,
  ): Promise<void> {
    if (actor.roles.includes('ADMIN')) {
      const result = await executor.query('SELECT 1 FROM jeepneys WHERE id = $1', [jeepneyId]);
      if (result.rowCount !== 1) throw new ApiError(404, 'NOT_FOUND', 'Jeepney not found');
      return;
    }
    if (actor.roles.includes('OPERATOR')) {
      const operator = await executor.query<{ id: string }>(
        `SELECT id FROM operators WHERE owner_user_id = $1 AND status = 'ACTIVE'`,
        [actor.id],
      );
      const operatorId = operator.rows[0]?.id;
      if (operatorId === undefined) throw new ApiError(403, 'FORBIDDEN', 'Active operator profile required');
      const owned = await executor.query('SELECT 1 FROM jeepneys WHERE id = $1 AND operator_id = $2', [
        jeepneyId,
        operatorId,
      ]);
      if (owned.rowCount !== 1) throw new ApiError(403, 'FORBIDDEN', 'Jeepney is outside operator scope');
      return;
    }
    if (actor.roles.includes('DRIVER')) {
      const result = await executor.query<{ authorized: boolean }>(
        `SELECT EXISTS (
           SELECT 1
           FROM jeepneys j
           JOIN drivers d ON d.user_id = $2
           LEFT JOIN driver_jeepney_assignments dja
             ON dja.jeepney_id = j.id AND dja.driver_id = d.id AND dja.active_to IS NULL
           LEFT JOIN fleet_group_jeepneys fgj ON fgj.jeepney_id = j.id
           LEFT JOIN fleet_group_drivers fgd ON fgd.group_id = fgj.group_id AND fgd.driver_id = d.id
           WHERE j.id = $1
             AND (j.created_by_user_id = $2 OR dja.id IS NOT NULL OR fgd.driver_id IS NOT NULL)
         ) AS authorized`,
        [jeepneyId, actor.id],
      );
      if (result.rows[0]?.authorized !== true) {
        throw new ApiError(403, 'FORBIDDEN', 'Jeepney is outside driver scope');
      }
      return;
    }
    throw new ApiError(403, 'FORBIDDEN', 'This role cannot view private vehicle tracking');
  }
}

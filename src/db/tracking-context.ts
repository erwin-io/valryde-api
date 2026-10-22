import type pg from 'pg';

import { ApiError } from '../lib/api-error.js';

/** Runs queries on the caller's pool or open transaction client; never controls the transaction. */
export type QueryExecutor = Pick<pg.Pool | pg.PoolClient, 'query'>;

// Stage 13b MVP constants (design Amendment 1 §13.2, approved with PR #17).
export const maxAffectedJeepneys = 250;
export const mutationLockTimeout = '2s';
export const mutationRetries = 3;

const transientCodes = new Set(['55P03', '40P01', '40001']);

const keySql = `hashtextextended('valryde:tracking-context:' || id::text, 0)`;

/**
 * Takes the shared jeepney advisory keys for this transaction: computed, de-duplicated and
 * acquired in bigint key order (X3), so a hash collision can serialize but never deadlock.
 * Returns the acquired keys as decimal strings.
 */
export async function lockTrackingContexts(
  executor: QueryExecutor,
  jeepneyIds: readonly string[],
): Promise<Set<string>> {
  const result = await executor.query<{ key: string }>(
    `SELECT k::text AS key, pg_advisory_xact_lock(k)
     FROM (SELECT DISTINCT ${keySql} AS k FROM unnest($1::uuid[]) AS id) keys
     ORDER BY k`,
    [jeepneyIds],
  );
  return new Set(result.rows.map((row) => row.key));
}

export async function trackingContextKeys(
  executor: QueryExecutor,
  jeepneyIds: readonly string[],
): Promise<Set<string>> {
  const result = await executor.query<{ key: string }>(
    `SELECT DISTINCT ${keySql}::text AS key FROM unnest($1::uuid[]) AS id`,
    [jeepneyIds],
  );
  return new Set(result.rows.map((row) => row.key));
}

/** Bumps the context version; the cutover instant is read after the locks were taken (X4). */
export async function bumpTrackingContexts(
  executor: QueryExecutor,
  jeepneyIds: readonly string[],
): Promise<void> {
  if (jeepneyIds.length === 0) return;
  await executor.query(
    `UPDATE jeepneys SET
       tracking_context_version = tracking_context_version + 1,
       tracking_context_changed_at = clock_timestamp()
     WHERE id = ANY($1::uuid[])`,
    [jeepneyIds],
  );
}

export interface ContextMutation<T> {
  /** Jeepneys whose tracking context this change alters. Runs once unlocked, then again under the locks. */
  affected(executor: QueryExecutor): Promise<string[]>;
  /** Business change and audit on the locked READ COMMITTED transaction. */
  apply(client: pg.PoolClient, affected: string[]): Promise<T>;
}

/**
 * The Agent A side of the shared Stage 13b protocol (§4.2, X1, X3, X7): discover, cap, lock in key
 * order, revalidate the key set, apply, bump, commit. Transient lock failures retry the whole
 * transaction; once exhausted the caller gets 503 TRACKING_CONTEXT_BUSY with nothing committed.
 */
export async function runContextMutation<T>(pool: pg.Pool, mutation: ContextMutation<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    const discovered = unique(await mutation.affected(pool));
    assertWithinCap(discovered);
    const client = await pool.connect();
    let outcome: { done: true; value: T } | { done: false };
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await client.query(`SET LOCAL lock_timeout = '${mutationLockTimeout}'`);
      const locked = await lockTrackingContexts(client, discovered);
      const current = unique(await mutation.affected(client));
      assertWithinCap(current);
      const currentKeys = await trackingContextKeys(client, current);
      if ([...currentKeys].every((key) => locked.has(key))) {
        const value = await mutation.apply(client, current);
        await bumpTrackingContexts(client, current);
        await client.query('COMMIT');
        outcome = { done: true, value };
      } else {
        // The committed affected set grew after discovery: start again with the complete set.
        await client.query('ROLLBACK');
        outcome = { done: false };
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (!isTransient(error)) throw error;
      outcome = { done: false };
    } finally {
      client.release();
    }
    if (outcome.done) return outcome.value;
    if (attempt >= mutationRetries) {
      throw new ApiError(
        503,
        'TRACKING_CONTEXT_BUSY',
        'Vehicle tracking context is busy; retry the request',
      );
    }
  }
}

function assertWithinCap(jeepneyIds: readonly string[]): void {
  if (jeepneyIds.length > maxAffectedJeepneys) {
    throw new ApiError(
      422,
      'TRACKING_CONTEXT_MUTATION_TOO_LARGE',
      `This change affects more than ${maxAffectedJeepneys} jeepneys`,
      { affectedJeepneyCount: jeepneyIds.length, maxAffectedJeepneys },
    );
  }
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function isTransient(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error &&
    typeof error.code === 'string' && transientCodes.has(error.code)
  );
}

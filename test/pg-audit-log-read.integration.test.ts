import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import type { User } from '../src/domain/identity.js';
import { PgIdentityRepository } from '../src/repositories/pg-identity-repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseSchema = process.env.TEST_DATABASE_SCHEMA ?? 'dbo';
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

interface AuditPage {
  auditLogs: Array<{
    id: string;
    actorUserId: string | null;
    action: string;
    entityType: string;
    entityId: string;
    metadata: Record<string, unknown>;
    createdAt: string;
  }>;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

describeDatabase('G8 Admin audit-log read with PostgreSQL', () => {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${databaseSchema},public`,
  });
  const repository = new PgIdentityRepository(pool);
  const config: AppConfig = {
    environment: 'test',
    host: '127.0.0.1',
    port: 3000,
    logLevel: 'silent',
    corsOrigins: [],
    databaseUrl: databaseUrl ?? 'postgresql://unused',
    databaseSsl: false,
    databaseSchema,
    jwtSecret: 'audit-read-integration-secret-at-least-32-characters',
    jwtIssuer: 'valryde-api-test',
    jwtAudience: 'valryde-test-clients',
    accessTokenTtlSeconds: 900,
    refreshTokenTtlDays: 30,
    authChallengeTtlMinutes: 30,
    authResendCooldownSeconds: 60,
    googleClientIds: [],
    email: { deliveryMode: 'disabled' },
  };
  // Isolated rows: one entity id and two actions owned by this run.
  const entityId = `g8-${randomUUID()}`;
  const otherEntityId = `g8-${randomUUID()}`;
  const userIds: string[] = [];
  let app: Awaited<ReturnType<typeof buildApp>>;
  let admin: User;
  let operator: User;
  let commuter: User;
  const inserted: string[] = [];

  beforeAll(async () => {
    app = await buildApp({ config, logger: false });
    admin = await repository.addRole((await createUser('COMMUTER')).id, 'ADMIN');
    operator = await createUser('OPERATOR');
    commuter = await createUser('COMMUTER');
    // Two rows share one timestamp so the id tiebreak is exercised.
    for (const [actor, action, at, target] of [
      [admin.id, 'G8_TEST_CREATED', '2026-01-01T00:00:00Z', entityId],
      [operator.id, 'G8_TEST_UPDATED', '2026-01-02T00:00:00Z', entityId],
      [operator.id, 'G8_TEST_UPDATED', '2026-01-02T00:00:00Z', entityId],
      [null, 'G8_TEST_UPDATED', '2026-01-03T00:00:00Z', entityId],
      [admin.id, 'G8_TEST_CREATED', '2026-01-04T00:00:00Z', otherEntityId],
    ] as const) {
      const result = await pool.query<{ id: string }>(
        `INSERT INTO audit_logs(actor_user_id, action, entity_type, entity_id, metadata, created_at)
         VALUES ($1, $2, 'G8_TEST', $3, $4::jsonb, $5) RETURNING id`,
        [actor, action, target, JSON.stringify({ step: action }), at],
      );
      inserted.push(result.rows[0]?.id ?? '');
    }
  });

  afterAll(async () => {
    await pool.query('DELETE FROM audit_logs WHERE id = ANY($1::uuid[])', [inserted]);
    await pool.query('DELETE FROM audit_logs WHERE actor_user_id = ANY($1::uuid[])', [userIds]);
    await pool.query('DELETE FROM operators WHERE owner_user_id = ANY($1::uuid[])', [userIds]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
    await app.close();
    await pool.end();
  });

  it('returns one entity history newest first with a deterministic id tiebreak', async () => {
    const response = await list(admin, { entityType: 'G8_TEST', entityId });
    expect(response.statusCode).toBe(200);
    const body = response.json<AuditPage>();
    expect(body.pagination).toEqual({ page: 1, pageSize: 20, total: 4, totalPages: 1 });
    expect(body.auditLogs.map((entry) => entry.createdAt)).toEqual([
      '2026-01-03T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    ]);
    const tied = body.auditLogs.slice(1, 3).map((entry) => entry.id);
    expect(tied).toEqual([...tied].sort().reverse());
    expect(body.auditLogs[0]).toEqual({
      id: inserted[3],
      actorUserId: null,
      action: 'G8_TEST_UPDATED',
      entityType: 'G8_TEST',
      entityId,
      metadata: { step: 'G8_TEST_UPDATED' },
      createdAt: '2026-01-03T00:00:00.000Z',
    });
  });

  it('pages without gaps or repeats', async () => {
    const pages = await Promise.all(
      [1, 2, 3].map(async (page) =>
        (await list(admin, { entityType: 'G8_TEST', entityId, page, pageSize: 2 })).json<AuditPage>(),
      ),
    );
    expect(pages.map((page) => page.pagination)).toEqual([
      { page: 1, pageSize: 2, total: 4, totalPages: 2 },
      { page: 2, pageSize: 2, total: 4, totalPages: 2 },
      { page: 3, pageSize: 2, total: 4, totalPages: 2 },
    ]);
    const ids = pages.flatMap((page) => page.auditLogs.map((entry) => entry.id));
    expect(ids).toHaveLength(4);
    expect(new Set(ids)).toEqual(new Set(inserted.slice(0, 4)));
  });

  it('filters by actor, action and a half-open time window', async () => {
    const byActor = (await list(admin, { entityType: 'G8_TEST', actorUserId: operator.id })).json<AuditPage>();
    expect(byActor.pagination.total).toBe(2);
    const byAction = (await list(admin, { entityType: 'G8_TEST', action: 'G8_TEST_CREATED' })).json<AuditPage>();
    expect(byAction.auditLogs.map((entry) => entry.entityId).sort()).toEqual([entityId, otherEntityId].sort());
    const window = (
      await list(admin, { entityType: 'G8_TEST', from: '2026-01-02T00:00:00Z', to: '2026-01-04T00:00:00Z' })
    ).json<AuditPage>();
    expect(window.auditLogs.map((entry) => entry.id).sort()).toEqual(inserted.slice(1, 4).sort());
  });

  it('is ADMIN-only', async () => {
    expect((await list(operator, { entityId })).statusCode).toBe(403);
    expect((await list(commuter, { entityId })).statusCode).toBe(403);
    const anonymous = await app.inject({ method: 'GET', url: `/api/admin/audit-logs?entityId=${entityId}` });
    expect(anonymous.statusCode).toBe(401);
  });

  it.each([
    [{ pageSize: 101 }],
    [{ page: 0 }],
    [{ entityType: 'g8_test' }],
    [{ actorUserId: 'not-a-uuid' }],
    [{ from: 'yesterday' }],
    [{ from: '2026-01-02T00:00:00Z', to: '2026-01-02T00:00:00Z' }],
  ])('rejects %o with 400 VALIDATION_ERROR', async (query) => {
    const response = await list(admin, query);
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR');
  });

  it('exposes no write method on the audit collection', async () => {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE'] as const) {
      const response = await app.inject({
        method,
        url: '/api/admin/audit-logs',
        headers: { authorization: `Bearer ${token(admin)}` },
      });
      expect([404, 405]).toContain(response.statusCode);
    }
  });

  async function createUser(role: 'COMMUTER' | 'OPERATOR'): Promise<User> {
    const user = await repository.createUser({
      email: `g8-${role.toLowerCase()}-${randomUUID()}@example.com`,
      passwordHash: null,
      displayName: `G8 ${role}`,
      role,
      emailVerifiedAt: new Date(),
    });
    userIds.push(user.id);
    return user;
  }

  function token(user: User): string {
    return app.jwt.sign({ sub: user.id, roles: user.roles, ver: user.credentialsVersion, type: 'access' });
  }

  function list(user: User, query: Record<string, string | number>) {
    const search = new URLSearchParams(
      Object.entries(query).map(([key, value]): [string, string] => [key, String(value)]),
    );
    return app.inject({
      method: 'GET',
      url: `/api/admin/audit-logs?${search.toString()}`,
      headers: { authorization: `Bearer ${token(user)}` },
    });
  }
});

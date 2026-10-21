import { randomUUID } from 'node:crypto';

import argon2 from 'argon2';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapFirstAdmin } from '../src/services/admin-bootstrap-service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

describeDatabase('first Admin bootstrap with PostgreSQL', () => {
  const testSchema = process.env.TEST_DATABASE_SCHEMA ?? 'dbo';
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${testSchema},public`,
  });
  const email = `bootstrap-${randomUUID()}@example.invalid`;
  let createdUserId: string | null = null;

  beforeAll(async () => {
    await pool.query('SELECT 1');
  });

  afterAll(async () => {
    await pool.end();
  });

  afterEach(async () => {
    const result = await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
    const userId = result.rows[0]?.id ?? createdUserId;
    if (userId === null) return;
    await pool.query(
      `DELETE FROM audit_logs
       WHERE entity_type = 'USER' AND entity_id = $1`,
      [userId],
    );
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    createdUserId = null;
  });

  it('persists one verified, audited Argon2id Admin and treats a rerun as a no-op', async (context) => {
    const existing = await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count
       FROM user_roles
       WHERE role = 'ADMIN'`,
    );
    if ((existing.rows[0]?.count ?? 0) > 0) {
      context.skip('The target database already has its real initial Admin');
      return;
    }

    const password = `${randomUUID()}-${randomUUID()}`;
    const input = {
      email,
      displayName: 'PostgreSQL Bootstrap Test',
      password,
      confirmation: 'CREATE_FIRST_ADMIN',
    };
    const created = await bootstrapFirstAdmin(pool, input);
    createdUserId = created.userId;
    expect(created.status).toBe('created');

    const persisted = await pool.query<{
      status: 'ACTIVE' | 'DISABLED';
      email_verified_at: Date | null;
      password_hash: string;
      role: string;
      audit_count: number;
      challenge_count: number;
    }>(
      `SELECT u.status, u.email_verified_at, u.password_hash, ur.role::text,
         (SELECT count(*)::integer FROM audit_logs a
          WHERE a.action = 'ADMIN_BOOTSTRAPPED' AND a.entity_id = u.id::text) AS audit_count,
         (SELECT count(*)::integer FROM auth_challenges c
          WHERE c.user_id = u.id) AS challenge_count
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       WHERE u.id = $1`,
      [created.userId],
    );
    const row = persisted.rows[0];
    expect(row).toBeDefined();
    expect(row?.status).toBe('ACTIVE');
    expect(row?.email_verified_at).not.toBeNull();
    expect(row?.role).toBe('ADMIN');
    expect(row?.password_hash.startsWith('$argon2id$')).toBe(true);
    expect(await argon2.verify(row?.password_hash ?? '', password)).toBe(true);
    expect(row?.audit_count).toBe(1);
    expect(row?.challenge_count).toBe(0);

    await expect(bootstrapFirstAdmin(pool, input)).resolves.toEqual({
      status: 'already_exists',
      userId: created.userId,
    });
    const auditCount = await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM audit_logs
       WHERE action = 'ADMIN_BOOTSTRAPPED' AND entity_id = $1`,
      [created.userId],
    );
    expect(auditCount.rows[0]?.count).toBe(1);
  });
});

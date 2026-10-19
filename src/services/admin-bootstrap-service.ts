import argon2 from 'argon2';
import type pg from 'pg';

export interface AdminBootstrapInput {
  email: string;
  displayName: string;
  password: string;
  confirmation: string;
}

export interface AdminBootstrapResult {
  status: 'created' | 'already_exists';
  userId: string;
}

interface ExistingAdminRow {
  id: string;
  email: string;
  status: 'ACTIVE' | 'DISABLED';
  email_verified_at: Date | null;
}

interface ExistingUserRow {
  id: string;
}

export class AdminBootstrapConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminBootstrapConflictError';
  }
}

export async function bootstrapFirstAdmin(
  pool: pg.Pool,
  input: AdminBootstrapInput,
): Promise<AdminBootstrapResult> {
  const email = normalizeEmail(input.email);
  const displayName = input.displayName.trim();
  validateInput(email, displayName, input.password, input.confirmation);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [8_642_100_002]);

    const adminResult = await client.query<ExistingAdminRow>(
      `SELECT u.id, u.email::text, u.status, u.email_verified_at
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       WHERE ur.role = 'ADMIN'
       ORDER BY u.created_at, u.id
       LIMIT 1`,
    );
    const existingAdmin = adminResult.rows[0];
    if (existingAdmin !== undefined) {
      if (
        existingAdmin.email.toLowerCase() === email
        && existingAdmin.status === 'ACTIVE'
        && existingAdmin.email_verified_at !== null
      ) {
        await client.query('COMMIT');
        return { status: 'already_exists', userId: existingAdmin.id };
      }
      throw new AdminBootstrapConflictError(
        'An Admin account already exists; manage additional Admin access through an audited internal process',
      );
    }

    const existingUser = await client.query<ExistingUserRow>(
      'SELECT id FROM users WHERE email = $1',
      [email],
    );
    if (existingUser.rows[0] !== undefined) {
      throw new AdminBootstrapConflictError(
        'The bootstrap email belongs to an existing non-Admin account',
      );
    }

    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO users(email, password_hash, display_name, email_verified_at)
       VALUES ($1, $2, $3, now())
       RETURNING id`,
      [email, passwordHash, displayName],
    );
    const userId = inserted.rows[0]?.id;
    if (userId === undefined) throw new Error('Admin insert returned no identifier');

    await client.query(
      `INSERT INTO user_roles(user_id, role)
       VALUES ($1, 'ADMIN')`,
      [userId],
    );
    await client.query(
      `INSERT INTO audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'ADMIN_BOOTSTRAPPED', 'USER', $2, $3::jsonb)`,
      [userId, userId, JSON.stringify({ source: 'INTERNAL_CLI' })],
    );
    await client.query('COMMIT');
    return { status: 'created', userId };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function validateInput(
  email: string,
  displayName: string,
  password: string,
  confirmation: string,
): void {
  if (confirmation !== 'CREATE_FIRST_ADMIN') {
    throw new Error('ADMIN_BOOTSTRAP_CONFIRM must equal CREATE_FIRST_ADMIN');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    throw new Error('ADMIN_BOOTSTRAP_EMAIL must be a valid email address');
  }
  if (displayName.length < 1 || displayName.length > 120) {
    throw new Error('ADMIN_BOOTSTRAP_DISPLAY_NAME must contain 1 to 120 characters');
  }
  if (password.length < 12 || password.length > 128) {
    throw new Error('ADMIN_BOOTSTRAP_PASSWORD must contain 12 to 128 characters');
  }
}

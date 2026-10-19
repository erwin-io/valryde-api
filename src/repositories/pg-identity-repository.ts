import type pg from 'pg';

import type { AuditEntry, AuthChallenge, ChallengeType, Role, User, UserStatus } from '../domain/identity.js';
import { ApiError } from '../lib/api-error.js';
import type {
  CreateChallengeInput,
  CreateRefreshSessionInput,
  CreateUserInput,
  ExternalIdentity,
  IdentityRepository,
  RefreshSessionReplacementInput,
  RotateRefreshResult,
} from './identity-repository.js';

interface UserRow {
  id: string;
  email: string;
  password_hash: string | null;
  display_name: string;
  status: UserStatus;
  email_verified_at: Date | null;
  credentials_version: number;
  roles: Role[];
  created_at: Date;
  updated_at: Date;
}

interface ChallengeRow {
  id: string;
  user_id: string;
  email: string;
  type: ChallengeType;
  token_hash: string;
  pending_email: string | null;
  expires_at: Date;
  consumed_at: Date | null;
  created_at: Date;
}

const userSelect = `
  SELECT u.id, u.email::text, u.password_hash, u.display_name, u.status,
    u.email_verified_at, u.credentials_version, u.created_at, u.updated_at,
    COALESCE(array_agg(ur.role::text ORDER BY ur.role) FILTER (WHERE ur.role IS NOT NULL), '{}') AS roles
  FROM users u
  LEFT JOIN user_roles ur ON ur.user_id = u.id
`;

function mapUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    status: row.status,
    emailVerifiedAt: row.email_verified_at,
    credentialsVersion: row.credentials_version,
    roles: row.roles,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapChallenge(row: ChallengeRow): AuthChallenge {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    type: row.type,
    tokenHash: row.token_hash,
    pendingEmail: row.pending_email,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
  };
}

export class PgIdentityRepository implements IdentityRepository {
  constructor(private readonly pool: pg.Pool) {}

  async createUser(input: CreateUserInput): Promise<User> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ id: string }>(
        `INSERT INTO users(email, password_hash, display_name, email_verified_at)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [input.email, input.passwordHash, input.displayName, input.emailVerifiedAt ?? null],
      );
      const userId = result.rows[0]?.id;
      if (userId === undefined) throw new Error('User insert returned no identifier');
      await client.query('INSERT INTO user_roles(user_id, role) VALUES ($1, $2)', [userId, input.role]);
      if (input.role === 'DRIVER') {
        await client.query('INSERT INTO drivers(user_id) VALUES ($1)', [userId]);
      } else if (input.role === 'OPERATOR') {
        await client.query('INSERT INTO operators(owner_user_id) VALUES ($1)', [userId]);
      }
      await client.query('COMMIT');
      const user = await this.findUserById(userId);
      if (user === null) throw new Error('Created user could not be loaded');
      return user;
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) {
        throw new ApiError(409, 'CONFLICT', 'An account with this email already exists');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async findUserById(id: string): Promise<User | null> {
    const result = await this.pool.query<UserRow>(
      `${userSelect} WHERE u.id = $1 GROUP BY u.id`,
      [id],
    );
    return result.rows[0] === undefined ? null : mapUser(result.rows[0]);
  }

  async findUserByEmail(email: string): Promise<User | null> {
    const result = await this.pool.query<UserRow>(
      `${userSelect} WHERE u.email = $1 GROUP BY u.id`,
      [email],
    );
    return result.rows[0] === undefined ? null : mapUser(result.rows[0]);
  }

  async listUsers(): Promise<User[]> {
    const result = await this.pool.query<UserRow>(`${userSelect} GROUP BY u.id ORDER BY u.created_at DESC`);
    return result.rows.map(mapUser);
  }

  async updateProfile(userId: string, displayName: string): Promise<User> {
    await this.requireUpdate(
      `UPDATE users SET display_name = $2, updated_at = now() WHERE id = $1`,
      [userId, displayName],
    );
    return this.requireUser(userId);
  }

  async updateStatus(userId: string, status: UserStatus): Promise<User> {
    await this.requireUpdate(
      `UPDATE users SET status = $2, credentials_version = credentials_version + 1,
       updated_at = now() WHERE id = $1`,
      [userId, status],
    );
    if (status === 'DISABLED') await this.revokeAllUserSessions(userId);
    return this.requireUser(userId);
  }

  async verifyEmail(userId: string): Promise<User> {
    await this.requireUpdate(
      `UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now()
       WHERE id = $1`,
      [userId],
    );
    return this.requireUser(userId);
  }

  async changeEmail(userId: string, email: string): Promise<User> {
    try {
      await this.requireUpdate(
        `UPDATE users SET email = $2, email_verified_at = now(),
         credentials_version = credentials_version + 1, updated_at = now() WHERE id = $1`,
        [userId, email],
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw new ApiError(409, 'CONFLICT', 'Email is already in use');
      throw error;
    }
    await this.revokeAllUserSessions(userId);
    return this.requireUser(userId);
  }

  async updatePassword(userId: string, passwordHash: string): Promise<User> {
    await this.requireUpdate(
      `UPDATE users SET password_hash = $2, credentials_version = credentials_version + 1,
       updated_at = now() WHERE id = $1`,
      [userId, passwordHash],
    );
    await this.revokeAllUserSessions(userId);
    return this.requireUser(userId);
  }

  async addRole(userId: string, role: Role): Promise<User> {
    await this.pool.query(
      'INSERT INTO user_roles(user_id, role) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, role],
    );
    return this.requireUser(userId);
  }

  async createChallenge(input: CreateChallengeInput): Promise<AuthChallenge> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE auth_challenges SET consumed_at = now()
         WHERE user_id = $1 AND type = $2 AND consumed_at IS NULL`,
        [input.userId, input.type],
      );
      const result = await client.query<ChallengeRow>(
        `INSERT INTO auth_challenges(user_id, email, type, token_hash, pending_email, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, user_id, email::text, type, token_hash, pending_email::text,
           expires_at, consumed_at, created_at`,
        [input.userId, input.email, input.type, input.tokenHash, input.pendingEmail ?? null, input.expiresAt],
      );
      await client.query('COMMIT');
      const row = result.rows[0];
      if (row === undefined) throw new Error('Challenge insert returned no row');
      return mapChallenge(row);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findActiveChallenge(userId: string, type: ChallengeType): Promise<AuthChallenge | null> {
    const result = await this.pool.query<ChallengeRow>(
      `SELECT id, user_id, email::text, type, token_hash, pending_email::text,
         expires_at, consumed_at, created_at
       FROM auth_challenges
       WHERE user_id = $1 AND type = $2 AND consumed_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`,
      [userId, type],
    );
    return result.rows[0] === undefined ? null : mapChallenge(result.rows[0]);
  }

  async invalidateChallenge(id: string): Promise<void> {
    await this.pool.query(
      'UPDATE auth_challenges SET consumed_at = COALESCE(consumed_at, now()) WHERE id = $1',
      [id],
    );
  }

  async consumeChallenge(tokenHash: string, type: ChallengeType): Promise<AuthChallenge | null> {
    const result = await this.pool.query<ChallengeRow>(
      `UPDATE auth_challenges SET consumed_at = now(), attempts = attempts + 1
       WHERE token_hash = $1 AND type = $2 AND consumed_at IS NULL AND expires_at > now()
       RETURNING id, user_id, email::text, type, token_hash, pending_email::text,
         expires_at, consumed_at, created_at`,
      [tokenHash, type],
    );
    return result.rows[0] === undefined ? null : mapChallenge(result.rows[0]);
  }

  async createRefreshSession(input: CreateRefreshSessionInput): Promise<void> {
    await this.insertRefresh(this.pool, input);
  }

  async rotateRefreshSession(
    oldTokenHash: string,
    replacement: RefreshSessionReplacementInput,
  ): Promise<RotateRefreshResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<RefreshSessionRow>(
        `SELECT id, family_id, user_id, token_hash, expires_at, revoked_at, replaced_by_id,
         user_agent, host(ip_address)::text AS ip_address
         FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
        [oldTokenHash],
      );
      const row = existing.rows[0];
      if (row === undefined) {
        await client.query('ROLLBACK');
        return { status: 'not_found' };
      }
      if (row.revoked_at !== null) {
        await client.query(
          'UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE family_id = $1',
          [row.family_id],
        );
        await client.query('COMMIT');
        return { status: 'reused' };
      }
      if (row.expires_at.getTime() <= Date.now()) {
        await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [row.id]);
        await client.query('COMMIT');
        return { status: 'expired' };
      }
      const familyReplacement: CreateRefreshSessionInput = {
        ...replacement,
        familyId: row.family_id,
        userId: row.user_id,
      };
      await this.insertRefresh(client, familyReplacement);
      await client.query(
        'UPDATE refresh_tokens SET revoked_at = now(), replaced_by_id = $2 WHERE id = $1',
        [row.id, replacement.id],
      );
      await client.query('COMMIT');
      const user = await this.findUserById(row.user_id);
      return user === null ? { status: 'not_found' } : { status: 'rotated', user };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeRefreshSession(tokenHash: string): Promise<void> {
    await this.pool.query(
      'UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE token_hash = $1',
      [tokenHash],
    );
  }

  async revokeRefreshFamily(familyId: string): Promise<void> {
    await this.pool.query(
      'UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE family_id = $1',
      [familyId],
    );
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    await this.pool.query(
      'UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE user_id = $1',
      [userId],
    );
  }

  async findExternalIdentity(
    provider: 'GOOGLE',
    providerSubject: string,
  ): Promise<ExternalIdentity | null> {
    const result = await this.pool.query<{
      user_id: string;
      provider: 'GOOGLE';
      provider_subject: string;
    }>(
      `SELECT user_id, provider, provider_subject FROM external_identities
       WHERE provider = $1 AND provider_subject = $2`,
      [provider, providerSubject],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : { userId: row.user_id, provider: row.provider, providerSubject: row.provider_subject };
  }

  async linkExternalIdentity(
    userId: string,
    provider: 'GOOGLE',
    providerSubject: string,
  ): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO external_identities(user_id, provider, provider_subject)
         VALUES ($1, $2, $3)`,
        [userId, provider, providerSubject],
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError(409, 'CONFLICT', 'This Google identity is already linked');
      }
      throw error;
    }
  }

  async writeAudit(entry: AuditEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        entry.actorUserId,
        entry.action,
        entry.entityType,
        entry.entityId,
        JSON.stringify(entry.metadata ?? {}),
      ],
    );
  }

  private async requireUpdate(sql: string, values: unknown[]): Promise<void> {
    const result = await this.pool.query(sql, values);
    if (result.rowCount !== 1) throw new ApiError(404, 'NOT_FOUND', 'User not found');
  }

  private async requireUser(userId: string): Promise<User> {
    const user = await this.findUserById(userId);
    if (user === null) throw new ApiError(404, 'NOT_FOUND', 'User not found');
    return user;
  }

  private async insertRefresh(
    executor: Pick<pg.Pool | pg.PoolClient, 'query'>,
    input: CreateRefreshSessionInput,
  ): Promise<void> {
    await executor.query(
      `INSERT INTO refresh_tokens(
         id, family_id, user_id, token_hash, expires_at, user_agent, ip_address
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.id,
        input.familyId,
        input.userId,
        input.tokenHash,
        input.expiresAt,
        input.userAgent,
        input.ipAddress,
      ],
    );
  }
}

interface RefreshSessionRow {
  id: string;
  family_id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  replaced_by_id: string | null;
  user_agent: string | null;
  ip_address: string | null;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

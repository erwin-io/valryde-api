import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { PgIdentityRepository } from '../src/repositories/pg-identity-repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

describeDatabase('PgIdentityRepository', () => {
  const testSchema = process.env.TEST_DATABASE_SCHEMA ?? 'dbo';
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${testSchema},public`,
  });
  const repository = new PgIdentityRepository(pool);
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    await pool.query('SELECT 1');
  });

  afterAll(async () => {
    await pool.end();
  });

  afterEach(async () => {
    if (createdUserIds.length === 0) return;
    const userIds = createdUserIds.splice(0);
    await pool.query('DELETE FROM operators WHERE owner_user_id = ANY($1::uuid[])', [userIds]);
    await pool.query('DELETE FROM drivers WHERE user_id = ANY($1::uuid[])', [userIds]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
  });

  it('persists identity, roles, challenges, and rotating refresh sessions', async () => {
    const hash = () => Buffer.from(randomUUID()).toString('hex').slice(0, 64).padEnd(64, '0');
    const user = await repository.createUser({
      email: `operator-${randomUUID()}@example.com`,
      passwordHash: 'test-hash',
      displayName: 'SQL Operator',
      role: 'OPERATOR',
    });
    createdUserIds.push(user.id);
    expect(user.roles).toEqual(['OPERATOR']);

    const challenge = await repository.createChallenge({
      userId: user.id,
      email: user.email,
      type: 'VERIFY_EMAIL',
      tokenHash: hash(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await repository.consumeChallenge(challenge.tokenHash, 'VERIFY_EMAIL')).not.toBeNull();
    expect(await repository.consumeChallenge(challenge.tokenHash, 'VERIFY_EMAIL')).toBeNull();

    const sessionId = randomUUID();
    const familyId = randomUUID();
    const originalTokenHash = hash();
    const replacementTokenHash = hash();
    await repository.createRefreshSession({
      id: sessionId,
      familyId,
      userId: user.id,
      tokenHash: originalTokenHash,
      expiresAt: new Date(Date.now() + 60_000),
      userAgent: 'vitest',
      ipAddress: '127.0.0.1',
    });
    const rotated = await repository.rotateRefreshSession(originalTokenHash, {
      id: randomUUID(),
      tokenHash: replacementTokenHash,
      expiresAt: new Date(Date.now() + 60_000),
      userAgent: 'vitest',
      ipAddress: '127.0.0.1',
    });
    expect(rotated.status).toBe('rotated');
    expect(rotated.user?.id).toBe(user.id);

    expect((await repository.rotateRefreshSession(originalTokenHash, {
      id: randomUUID(),
      tokenHash: 'd'.repeat(64),
      expiresAt: new Date(Date.now() + 60_000),
      userAgent: null,
      ipAddress: null,
    })).status).toBe('reused');
    expect((await repository.rotateRefreshSession(replacementTokenHash, {
      id: randomUUID(),
      tokenHash: 'e'.repeat(64),
      expiresAt: new Date(Date.now() + 60_000),
      userAgent: null,
      ipAddress: null,
    })).status).toBe('reused');
  });
});

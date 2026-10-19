import argon2 from 'argon2';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';

import {
  AdminBootstrapConflictError,
  bootstrapFirstAdmin,
} from '../src/services/admin-bootstrap-service.js';

const validInput = {
  email: '  Initial.Admin@Example.com ',
  displayName: ' Valryde Administrator ',
  password: 'a-secure-local-password',
  confirmation: 'CREATE_FIRST_ADMIN',
};

describe('bootstrapFirstAdmin', () => {
  it('atomically creates a verified Admin with an Argon2id hash and audit entry', async () => {
    const database = new FakeDatabase();

    const result = await bootstrapFirstAdmin(database.asPool(), validInput);

    expect(result).toEqual({ status: 'created', userId: database.insertedUserId });
    expect(database.statements[0]?.sql).toBe('BEGIN');
    expect(database.statements.at(-1)?.sql).toBe('COMMIT');
    expect(database.statements.some(({ sql }) => sql === 'ROLLBACK')).toBe(false);

    const userInsert = database.findStatement('INSERT INTO users');
    expect(userInsert.values?.[0]).toBe('initial.admin@example.com');
    expect(userInsert.values?.[2]).toBe('Valryde Administrator');
    expect(userInsert.sql).toContain('email_verified_at');
    const passwordHash = userInsert.values?.[1];
    expect(typeof passwordHash).toBe('string');
    expect(await argon2.verify(passwordHash as string, validInput.password)).toBe(true);
    expect((passwordHash as string).startsWith('$argon2id$')).toBe(true);

    expect(database.findStatement('INSERT INTO user_roles').values).toEqual([
      database.insertedUserId,
    ]);
    const audit = database.findStatement('INSERT INTO audit_logs');
    expect(audit.sql).toContain('ADMIN_BOOTSTRAPPED');
    expect(audit.values).toEqual([
      database.insertedUserId,
      database.insertedUserId,
      JSON.stringify({ source: 'INTERNAL_CLI' }),
    ]);
    expect(database.releaseCount).toBe(1);
  });

  it('is an idempotent no-op for the same active, verified Admin', async () => {
    const database = new FakeDatabase({
      existingAdmin: {
        id: '6de53026-fdb3-403b-baa8-0ba1b53fdceb',
        email: 'initial.admin@example.com',
        status: 'ACTIVE',
        email_verified_at: new Date(),
      },
    });

    await expect(bootstrapFirstAdmin(database.asPool(), validInput)).resolves.toEqual({
      status: 'already_exists',
      userId: '6de53026-fdb3-403b-baa8-0ba1b53fdceb',
    });
    expect(database.statements.at(-1)?.sql).toBe('COMMIT');
    expect(database.statements.some(({ sql }) => sql.includes('INSERT INTO'))).toBe(false);
  });

  it('rolls back rather than creating a second or replacing an unhealthy Admin', async () => {
    const database = new FakeDatabase({
      existingAdmin: {
        id: '8f0b0f35-2700-4690-90b1-2cfcf89c3c41',
        email: 'different@example.com',
        status: 'ACTIVE',
        email_verified_at: new Date(),
      },
    });

    await expect(bootstrapFirstAdmin(database.asPool(), validInput)).rejects.toBeInstanceOf(
      AdminBootstrapConflictError,
    );
    expect(database.statements.at(-1)?.sql).toBe('ROLLBACK');
    expect(database.statements.some(({ sql }) => sql.includes('INSERT INTO'))).toBe(false);
  });

  it('does not silently promote an existing non-Admin user', async () => {
    const database = new FakeDatabase({ existingUserId: 'd3434e91-8f65-44f0-b387-59ff61fd5d90' });

    await expect(bootstrapFirstAdmin(database.asPool(), validInput)).rejects.toThrow(
      'existing non-Admin account',
    );
    expect(database.statements.at(-1)?.sql).toBe('ROLLBACK');
    expect(database.statements.some(({ sql }) => sql.includes('INSERT INTO'))).toBe(false);
  });

  it('validates all inputs before connecting to PostgreSQL', async () => {
    const database = new FakeDatabase();

    await expect(
      bootstrapFirstAdmin(database.asPool(), { ...validInput, password: 'too-short' }),
    ).rejects.toThrow('12 to 128 characters');
    expect(database.connectCount).toBe(0);
  });

  it('requires an explicit first-Admin creation confirmation before connecting', async () => {
    const database = new FakeDatabase();

    await expect(
      bootstrapFirstAdmin(database.asPool(), { ...validInput, confirmation: '' }),
    ).rejects.toThrow('ADMIN_BOOTSTRAP_CONFIRM must equal CREATE_FIRST_ADMIN');
    expect(database.connectCount).toBe(0);
  });
});

interface Statement {
  sql: string;
  values?: readonly unknown[];
}

interface ExistingAdmin {
  id: string;
  email: string;
  status: 'ACTIVE' | 'DISABLED';
  email_verified_at: Date | null;
}

class FakeDatabase {
  readonly insertedUserId = '94ea1ae8-d074-4a08-ae2c-af79b51d2e24';
  readonly statements: Statement[] = [];
  connectCount = 0;
  releaseCount = 0;

  constructor(
    private readonly state: {
      existingAdmin?: ExistingAdmin;
      existingUserId?: string;
    } = {},
  ) {}

  asPool(): pg.Pool {
    return this as unknown as pg.Pool;
  }

  async connect() {
    this.connectCount += 1;
    return {
      query: async <Row>(sql: string, values?: readonly unknown[]) => {
        this.statements.push(values === undefined ? { sql } : { sql, values });
        if (sql.includes("WHERE ur.role = 'ADMIN'")) {
          return { rows: (this.state.existingAdmin === undefined ? [] : [this.state.existingAdmin]) as Row[] };
        }
        if (sql === 'SELECT id FROM users WHERE email = $1') {
          const rows = this.state.existingUserId === undefined ? [] : [{ id: this.state.existingUserId }];
          return { rows: rows as Row[] };
        }
        if (sql.includes('INSERT INTO users')) {
          return { rows: [{ id: this.insertedUserId }] as Row[] };
        }
        return { rows: [] as Row[] };
      },
      release: () => {
        this.releaseCount += 1;
      },
    };
  }

  findStatement(fragment: string): Statement {
    const statement = this.statements.find(({ sql }) => sql.includes(fragment));
    if (statement === undefined) throw new Error(`Statement not found: ${fragment}`);
    return statement;
  }
}

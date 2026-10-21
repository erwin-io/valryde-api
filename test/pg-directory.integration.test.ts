import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import type { Role, SelfRegistrationRole, User } from '../src/domain/identity.js';
import { PgIdentityRepository } from '../src/repositories/pg-identity-repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseSchema = process.env.TEST_DATABASE_SCHEMA ?? 'dbo';
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

interface DriverDto {
  driverId: string;
  userId: string;
  email: string;
  displayName: string;
  status: 'ACTIVE' | 'DISABLED';
  userStatus: 'ACTIVE' | 'DISABLED';
  emailVerified: boolean;
  operatorId: string | null;
  activeJeepneyId: string | null;
  groupIds: string[];
  createdAt: string;
}

interface OperatorDto {
  operatorId: string;
  ownerUserId: string;
  email: string;
  displayName: string;
  status: 'ACTIVE' | 'DISABLED';
  userStatus: 'ACTIVE' | 'DISABLED';
  driverCount: number;
  jeepneyCount: number;
  groupCount: number;
  createdAt: string;
}

interface Page {
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

describeDatabase('G1 Driver and Operator directories with PostgreSQL', () => {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${databaseSchema},public`,
  });
  const repository = new PgIdentityRepository(pool);
  const userIds: string[] = [];
  const suffix = randomUUID().slice(0, 8);
  const marker = `G1-${suffix}`;
  const config: AppConfig = {
    environment: 'test',
    host: '127.0.0.1',
    port: 3000,
    logLevel: 'silent',
    corsOrigins: [],
    databaseUrl: databaseUrl ?? 'postgresql://unused',
    databaseSsl: false,
    databaseSchema,
    jwtSecret: 'g1-directory-secret-with-at-least-32-characters',
    jwtIssuer: 'valryde-api-test',
    jwtAudience: 'valryde-test-clients',
    accessTokenTtlSeconds: 900,
    refreshTokenTtlDays: 30,
    authChallengeTtlMinutes: 30,
    authResendCooldownSeconds: 60,
    googleClientIds: [],
    email: { deliveryMode: 'disabled' },
  };

  let app: Awaited<ReturnType<typeof buildApp>>;
  let admin: User;
  let operatorA: User;
  let operatorB: User;
  let emptyOperator: User;
  let disabledOperator: User;
  let multiRoleAdmin: User;
  let driverA1: User;
  let driverA2: User;
  let driverB: User;
  let unassociatedDriver: User;
  let commuter: User;
  let operatorAId: string;
  let operatorBId: string;
  let disabledOperatorId: string;
  let driverA1Id: string;
  let driverA2Id: string;
  let driverBId: string;
  let unassociatedDriverId: string;
  let firstJeepneyId: string;
  let secondJeepneyId: string;
  let firstGroupId: string;
  let secondGroupId: string;

  beforeAll(async () => {
    app = await buildApp({ config, logger: false });
    admin = await addRole(await createUser('COMMUTER', `${marker} Admin`), 'ADMIN');
    operatorA = await createUser('OPERATOR', `${marker} Alpha Operator`);
    operatorB = await createUser('OPERATOR', `${marker} Beta Operator`);
    emptyOperator = await createUser('OPERATOR', `${marker} Empty Operator`);
    disabledOperator = await createUser('OPERATOR', `${marker} Disabled Operator`);
    multiRoleAdmin = await addRole(
      await createUser('OPERATOR', `${marker} Multi Role Admin`),
      'ADMIN',
    );
    driverA1 = await createUser('DRIVER', `${marker} Alice Driver`);
    driverA2 = await createUser('DRIVER', `${marker} Aaron Driver`);
    driverB = await createUser('DRIVER', `${marker} Bob Driver`);
    unassociatedDriver = await createUser('DRIVER', `${marker} Unassociated Driver`);
    commuter = await createUser('COMMUTER', `${marker} Commuter`);

    const operators = await pool.query<{ id: string; owner_user_id: string }>(
      'SELECT id, owner_user_id FROM operators WHERE owner_user_id = ANY($1::uuid[])',
      [[operatorA.id, operatorB.id, emptyOperator.id, disabledOperator.id]],
    );
    operatorAId = idFor(operators.rows, operatorA.id);
    operatorBId = idFor(operators.rows, operatorB.id);
    disabledOperatorId = idFor(operators.rows, disabledOperator.id);

    const drivers = await pool.query<{ id: string; user_id: string }>(
      'SELECT id, user_id FROM drivers WHERE user_id = ANY($1::uuid[])',
      [[driverA1.id, driverA2.id, driverB.id, unassociatedDriver.id]],
    );
    driverA1Id = idFor(drivers.rows, driverA1.id, 'user_id');
    driverA2Id = idFor(drivers.rows, driverA2.id, 'user_id');
    driverBId = idFor(drivers.rows, driverB.id, 'user_id');
    unassociatedDriverId = idFor(drivers.rows, unassociatedDriver.id, 'user_id');

    await pool.query(
      `UPDATE drivers SET operator_id = CASE
         WHEN id = ANY($1::uuid[]) THEN $3::uuid
         WHEN id = $2::uuid THEN $4::uuid
       END
       WHERE id = ANY($5::uuid[])`,
      [
        [driverA1Id, driverA2Id],
        driverBId,
        operatorAId,
        operatorBId,
        [driverA1Id, driverA2Id, driverBId],
      ],
    );
    await pool.query("UPDATE drivers SET status = 'DISABLED' WHERE id = $1", [driverA2Id]);
    await pool.query("UPDATE operators SET status = 'DISABLED' WHERE id = $1", [disabledOperatorId]);

    firstJeepneyId = await insertJeepney(operatorAId, operatorA.id, 'A');
    secondJeepneyId = await insertJeepney(operatorAId, operatorA.id, 'B');
    await insertJeepney(operatorBId, operatorB.id, 'C');
    firstGroupId = await insertGroup(operatorAId, 'Alpha');
    secondGroupId = await insertGroup(operatorAId, 'Beta');
    await pool.query(
      `INSERT INTO fleet_group_drivers(group_id, driver_id)
       VALUES ($1, $3), ($2, $3)`,
      [firstGroupId, secondGroupId, driverA1Id],
    );
    await pool.query(
      `INSERT INTO driver_jeepney_assignments(driver_id, jeepney_id, assigned_by_user_id)
       VALUES ($1, $2, $3)`,
      [driverA1Id, firstJeepneyId, operatorA.id],
    );
  });

  afterAll(async () => {
    if (userIds.length > 0) {
      await pool.query('DELETE FROM audit_logs WHERE actor_user_id = ANY($1::uuid[])', [userIds]);
      await pool.query(
        `DELETE FROM driver_jeepney_assignments
         WHERE assigned_by_user_id = ANY($1::uuid[])
            OR driver_id IN (SELECT id FROM drivers WHERE user_id = ANY($1::uuid[]))`,
        [userIds],
      );
      await pool.query(
        `DELETE FROM fleet_groups
         WHERE operator_id IN (SELECT id FROM operators WHERE owner_user_id = ANY($1::uuid[]))`,
        [userIds],
      );
      await pool.query('DELETE FROM jeepneys WHERE created_by_user_id = ANY($1::uuid[])', [userIds]);
      await pool.query('DELETE FROM drivers WHERE user_id = ANY($1::uuid[])', [userIds]);
      await pool.query('DELETE FROM operators WHERE owner_user_id = ANY($1::uuid[])', [userIds]);
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
    }
    await app.close();
    await pool.end();
  });

  it('scopes an Operator to its own drivers and returns approved aggregate fields only', async () => {
    const response = await get('/api/drivers', operatorA);
    expect(response.statusCode).toBe(200);
    const body = response.json<Page & { drivers: DriverDto[] }>();
    expect(body.drivers.map(({ driverId }) => driverId)).toEqual([driverA2Id, driverA1Id]);
    expect(body.drivers.map(({ driverId }) => driverId)).not.toContain(driverBId);
    expect(body.drivers.map(({ driverId }) => driverId)).not.toContain(unassociatedDriverId);
    expect(body.pagination).toEqual({ page: 1, pageSize: 20, total: 2, totalPages: 1 });

    const alice = body.drivers.find(({ driverId }) => driverId === driverA1Id);
    expect(alice).toMatchObject({
      userId: driverA1.id,
      email: driverA1.email,
      status: 'ACTIVE',
      userStatus: 'ACTIVE',
      emailVerified: true,
      operatorId: operatorAId,
      activeJeepneyId: firstJeepneyId,
    });
    expect(alice?.groupIds).toEqual([firstGroupId, secondGroupId].sort());
    expect(Object.keys(alice ?? {}).sort()).toEqual(
      [
        'activeJeepneyId',
        'createdAt',
        'displayName',
        'driverId',
        'email',
        'emailVerified',
        'groupIds',
        'operatorId',
        'status',
        'userId',
        'userStatus',
      ].sort(),
    );
    expect(JSON.stringify(body)).not.toMatch(/password|token|credentialsVersion/i);
  });

  it('rejects Admin-only scope filters from an Operator and returns an empty own scope safely', async () => {
    expect((await get(`/api/drivers?operatorId=${operatorBId}`, operatorA)).statusCode).toBe(403);
    expect((await get('/api/drivers?associated=false', operatorA)).statusCode).toBe(403);

    const empty = await get('/api/drivers', emptyOperator);
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({
      drivers: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    });
  });

  it('lets Admin list, filter, search, and paginate the global Driver directory', async () => {
    const byOperator = await get(
      `/api/drivers?operatorId=${operatorAId}&q=${encodeURIComponent(marker)}`,
      admin,
    );
    expect(byOperator.statusCode).toBe(200);
    expect(byOperator.json<{ drivers: DriverDto[] }>().drivers.map(({ driverId }) => driverId)).toEqual([
      driverA2Id,
      driverA1Id,
    ]);

    const unassociated = await get(
      `/api/drivers?associated=false&q=${encodeURIComponent(marker)}`,
      admin,
    );
    expect(unassociated.statusCode).toBe(200);
    expect(unassociated.json<{ drivers: DriverDto[] }>().drivers.map(({ driverId }) => driverId)).toEqual([
      unassociatedDriverId,
    ]);

    const emailSearch = await get(
      `/api/drivers?q=${encodeURIComponent(driverA1.email.toUpperCase())}`,
      admin,
    );
    expect(emailSearch.json<{ drivers: DriverDto[] }>().drivers.map(({ driverId }) => driverId)).toEqual([
      driverA1Id,
    ]);
    const statusSearch = await get(
      `/api/drivers?q=${encodeURIComponent(marker)}&status=DISABLED`,
      admin,
    );
    expect(statusSearch.json<{ drivers: DriverDto[] }>().drivers.map(({ driverId }) => driverId)).toEqual([
      driverA2Id,
    ]);

    const firstPage = await get(
      `/api/drivers?q=${encodeURIComponent(marker)}&page=1&pageSize=1`,
      admin,
    );
    const secondPage = await get(
      `/api/drivers?q=${encodeURIComponent(marker)}&page=2&pageSize=1`,
      admin,
    );
    expect(firstPage.json<Page>().pagination).toEqual({
      page: 1,
      pageSize: 1,
      total: 4,
      totalPages: 4,
    });
    expect(firstPage.json<{ drivers: DriverDto[] }>().drivers[0]?.displayName).toBe(
      `${marker} Aaron Driver`,
    );
    expect(secondPage.json<{ drivers: DriverDto[] }>().drivers[0]?.displayName).toBe(
      `${marker} Alice Driver`,
    );
  });

  it('uses ADMIN semantics for a multi-role ADMIN and keeps validation errors explicit', async () => {
    const response = await get(`/api/drivers?operatorId=${operatorAId}`, multiRoleAdmin);
    expect(response.statusCode).toBe(200);
    expect(response.json<{ drivers: DriverDto[] }>().drivers).toHaveLength(2);

    expect((await get('/api/drivers?page=0', admin)).statusCode).toBe(400);
    expect((await get('/api/drivers?pageSize=101', admin)).statusCode).toBe(400);
    expect((await get('/api/drivers?operatorId=not-a-uuid', admin)).statusCode).toBe(400);
  });

  it('updates activeJeepneyId after transactional reassignment', async () => {
    const assignment = await app.inject({
      method: 'POST',
      url: `/api/jeepneys/${secondJeepneyId}/driver-assignment`,
      headers: authorization(token(operatorA)),
      payload: { driverId: driverA1Id },
    });
    expect(assignment.statusCode).toBe(201);

    const response = await get('/api/drivers', operatorA);
    const alice = response
      .json<{ drivers: DriverDto[] }>()
      .drivers.find(({ driverId }) => driverId === driverA1Id);
    expect(alice?.activeJeepneyId).toBe(secondJeepneyId);
  });

  it('returns the ADMIN-only Operator directory with exact counts and disabled records', async () => {
    const response = await get(`/api/operators?q=${encodeURIComponent(marker)}`, admin);
    expect(response.statusCode).toBe(200);
    const body = response.json<Page & { operators: OperatorDto[] }>();
    expect(body.pagination.total).toBe(5);
    const operator = body.operators.find(({ operatorId }) => operatorId === operatorAId);
    expect(operator).toMatchObject({
      ownerUserId: operatorA.id,
      email: operatorA.email,
      displayName: `${marker} Alpha Operator`,
      status: 'ACTIVE',
      userStatus: 'ACTIVE',
      driverCount: 2,
      jeepneyCount: 2,
      groupCount: 2,
    });
    const disabled = body.operators.find(({ operatorId }) => operatorId === disabledOperatorId);
    expect(disabled?.status).toBe('DISABLED');
    expect(JSON.stringify(body)).not.toMatch(/password|token|credentialsVersion/i);

    const filtered = await get(
      `/api/operators?q=${encodeURIComponent(marker)}&status=DISABLED`,
      admin,
    );
    expect(filtered.json<{ operators: OperatorDto[] }>().operators.map(({ operatorId }) => operatorId)).toEqual([
      disabledOperatorId,
    ]);
  });

  it('enforces directory RBAC, authentication, and disabled-account session policy', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/drivers' })).statusCode).toBe(401);
    expect((await get('/api/drivers', driverA1)).statusCode).toBe(403);
    expect((await get('/api/drivers', commuter)).statusCode).toBe(403);
    expect((await get('/api/operators', operatorA)).statusCode).toBe(403);
    expect((await get('/api/operators', driverA1)).statusCode).toBe(403);
    expect((await get('/api/operators', commuter)).statusCode).toBe(403);

    const disabledToken = token(disabledOperator);
    await pool.query("UPDATE users SET status = 'DISABLED' WHERE id = $1", [disabledOperator.id]);
    const disabledResponse = await app.inject({
      method: 'GET',
      url: '/api/drivers',
      headers: authorization(disabledToken),
    });
    expect(disabledResponse.statusCode).toBe(401);
    expect(disabledResponse.json()).toMatchObject({ error: { code: 'SESSION_REVOKED' } });
  });

  async function createUser(role: SelfRegistrationRole, displayName: string): Promise<User> {
    const user = await repository.createUser({
      email: `${role.toLowerCase()}-${suffix}-${randomUUID()}@example.com`,
      passwordHash: null,
      displayName,
      role,
      emailVerifiedAt: new Date(),
    });
    userIds.push(user.id);
    return user;
  }

  async function addRole(user: User, role: Role): Promise<User> {
    return repository.addRole(user.id, role);
  }

  async function insertJeepney(operatorId: string, creatorId: string, label: string): Promise<string> {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO jeepneys(operator_id, created_by_user_id, plate_no, color_hex)
       VALUES ($1, $2, $3, '#123ABC') RETURNING id`,
      [operatorId, creatorId, `G1-${suffix}-${label}`],
    );
    return required(result.rows[0]?.id);
  }

  async function insertGroup(operatorId: string, label: string): Promise<string> {
    const result = await pool.query<{ id: string }>(
      'INSERT INTO fleet_groups(operator_id, name) VALUES ($1, $2) RETURNING id',
      [operatorId, `${marker} ${label} Group`],
    );
    return required(result.rows[0]?.id);
  }

  function token(user: User): string {
    return app.jwt.sign({
      sub: user.id,
      roles: user.roles,
      ver: user.credentialsVersion,
      type: 'access',
    });
  }

  function get(url: string, user: User) {
    return app.inject({ method: 'GET', url, headers: authorization(token(user)) });
  }
});

function authorization(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

function idFor<T extends { id: string }>(
  rows: T[],
  ownerId: string,
  ownerKey: keyof T = 'owner_user_id' as keyof T,
): string {
  return required(rows.find((row) => row[ownerKey] === ownerId)?.id);
}

function required(value: string | undefined): string {
  if (value === undefined) throw new Error('Expected fixture identifier was not found');
  return value;
}

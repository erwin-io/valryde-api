import argon2 from 'argon2';
import type pg from 'pg';

import {
  developmentFixtureManifest,
  fixtureIds,
  type DevelopmentFixtureManifest,
  type FixtureAccount,
} from '../dev-fixtures/fixture-manifest.js';

const requiredTables = [
  'users',
  'user_roles',
  'operators',
  'drivers',
  'transit_routes',
  'route_directions',
  'jeepneys',
  'fleet_groups',
  'driver_jeepney_assignments',
  'vehicle_route_assignments',
  'vehicle_applications',
  'gps_setup_requests',
  'gps_devices',
  'traccar_device_mappings',
] as const;

export interface DevelopmentDatabaseBoundary {
  database: string;
  host: string;
  port: number;
  schema: string;
  postgis: boolean;
  traccarTables: boolean;
}

export interface DevelopmentFixtureOptions {
  environment: string;
  expectedDatabase: string;
  schema: string;
  confirmation: string;
  password?: string;
  manifest?: DevelopmentFixtureManifest;
  allowNonLoopbackTestDatabase?: boolean;
}

export interface DevelopmentFixtureSummary {
  boundary: DevelopmentDatabaseBoundary;
  accounts: number;
  operators: number;
  drivers: number;
  routes: number;
  directions: number;
  jeepneys: number;
  groups: number;
  applications: number;
  gpsRequests: number;
}

export async function inspectDevelopmentDatabase(
  pool: pg.Pool,
  options: Pick<
    DevelopmentFixtureOptions,
    'environment' | 'expectedDatabase' | 'schema' | 'allowNonLoopbackTestDatabase'
  >,
): Promise<DevelopmentDatabaseBoundary> {
  const isolatedAutomatedTest =
    options.environment === 'test' && options.allowNonLoopbackTestDatabase === true;
  if (options.environment !== 'development' && !isolatedAutomatedTest) {
    throw new Error('Development fixtures require NODE_ENV=development');
  }
  if (options.schema !== 'dbo') {
    throw new Error('Development fixtures require DATABASE_SCHEMA=dbo');
  }
  if (!options.expectedDatabase || /(?:prod|production|live)/i.test(options.expectedDatabase)) {
    throw new Error('DEV_FIXTURE_TARGET_DATABASE must name a non-production development database');
  }

  const result = await pool.query<{
    database: string;
    host: string | null;
    port: number;
    schema: string;
    postgis: boolean;
    traccar_tables: boolean;
    required_table_count: number;
  }>(
    `SELECT
       current_database() AS database,
       inet_server_addr()::text AS host,
       inet_server_port() AS port,
       current_schema() AS schema,
       EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') AS postgis,
       EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_name IN ('tc_users', 'tc_devices', 'tc_positions')
       ) AS traccar_tables,
       (
         SELECT count(*)::integer FROM information_schema.tables
         WHERE table_schema = $1 AND table_name = ANY($2::text[])
       ) AS required_table_count`,
    [options.schema, requiredTables],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('Unable to inspect the target database');
  if (row.database !== options.expectedDatabase) {
    throw new Error(
      `Database boundary mismatch: expected ${options.expectedDatabase}, received ${row.database}`,
    );
  }
  if (
    row.host !== '127.0.0.1/32' &&
    row.host !== '::1/128' &&
    !isolatedAutomatedTest
  ) {
    throw new Error('Development fixtures refuse non-loopback PostgreSQL servers');
  }
  if (row.schema !== options.schema) {
    throw new Error(`Database search path must resolve ${options.schema} as the active schema`);
  }
  if (!row.postgis) throw new Error('The target is missing the Valryde PostGIS extension');
  if (row.traccar_tables) throw new Error('The target contains Traccar tables and is not fixture-safe');
  if (row.required_table_count !== requiredTables.length) {
    throw new Error('The target is missing required Valryde migrations');
  }
  return {
    database: row.database,
    host: row.host ?? 'unknown',
    port: row.port,
    schema: row.schema,
    postgis: row.postgis,
    traccarTables: row.traccar_tables,
  };
}

export async function seedDevelopmentFixtures(
  pool: pg.Pool,
  options: DevelopmentFixtureOptions,
): Promise<DevelopmentFixtureSummary> {
  if (options.confirmation !== 'SEED_VALRYDE_DEVELOPMENT_FIXTURES') {
    throw new Error('DEV_FIXTURE_CONFIRM must equal SEED_VALRYDE_DEVELOPMENT_FIXTURES');
  }
  if (options.password === undefined || options.password.length < 12 || options.password.length > 128) {
    throw new Error('DEV_FIXTURE_PASSWORD must contain 12 to 128 characters');
  }
  const boundary = await inspectDevelopmentDatabase(pool, options);
  const manifest = options.manifest ?? developmentFixtureManifest;
  const passwordHash = await argon2.hash(options.password, { type: argon2.argon2id });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('valryde-development-fixtures'))");
    await assertFixtureOwnership(client, manifest);
    await cleanupFixtureRows(client, manifest);
    await insertFixtures(client, manifest, passwordHash);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return summarize(boundary, manifest);
}

export async function cleanupDevelopmentFixtures(
  pool: pg.Pool,
  options: DevelopmentFixtureOptions,
): Promise<DevelopmentFixtureSummary> {
  if (options.confirmation !== 'CLEAN_VALRYDE_DEVELOPMENT_FIXTURES') {
    throw new Error('DEV_FIXTURE_CONFIRM must equal CLEAN_VALRYDE_DEVELOPMENT_FIXTURES');
  }
  const boundary = await inspectDevelopmentDatabase(pool, options);
  const manifest = options.manifest ?? developmentFixtureManifest;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('valryde-development-fixtures'))");
    await assertFixtureOwnership(client, manifest);
    await cleanupFixtureRows(client, manifest);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return summarize(boundary, manifest);
}

export async function countDevelopmentFixtureRows(
  pool: pg.Pool,
  manifest: DevelopmentFixtureManifest = developmentFixtureManifest,
): Promise<number> {
  const ids = fixtureIds(manifest);
  const result = await pool.query<{ count: number }>(
    `SELECT (
       (SELECT count(*) FROM users WHERE id = ANY($1::uuid[])) +
       (SELECT count(*) FROM operators WHERE id = ANY($1::uuid[])) +
       (SELECT count(*) FROM drivers WHERE id = ANY($1::uuid[])) +
       (SELECT count(*) FROM transit_routes WHERE id = ANY($1::uuid[])) +
       (SELECT count(*) FROM route_directions WHERE id = ANY($1::uuid[])) +
       (SELECT count(*) FROM jeepneys WHERE id = ANY($1::uuid[])) +
       (SELECT count(*) FROM fleet_groups WHERE id = ANY($1::uuid[])) +
       (SELECT count(*) FROM driver_jeepney_assignments WHERE id = ANY($1::uuid[])) +
       (SELECT count(*) FROM vehicle_route_assignments WHERE id = ANY($1::uuid[])) +
       (SELECT count(*) FROM vehicle_applications WHERE id = ANY($1::uuid[])) +
       (SELECT count(*) FROM gps_setup_requests WHERE id = ANY($1::uuid[])) +
       (SELECT count(*) FROM gps_devices WHERE id = ANY($1::uuid[])) +
       (SELECT count(*) FROM traccar_device_mappings WHERE id = ANY($1::uuid[]))
     )::integer AS count`,
    [ids],
  );
  return result.rows[0]?.count ?? 0;
}

async function assertFixtureOwnership(
  client: pg.PoolClient,
  manifest: DevelopmentFixtureManifest,
): Promise<void> {
  const accounts = Object.values(manifest.accounts);
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const accountByEmail = new Map(accounts.map((account) => [account.email, account]));
  const users = await client.query<{ id: string; email: string; display_name: string }>(
    `SELECT id, email::text, display_name FROM users
     WHERE id = ANY($1::uuid[]) OR email = ANY($2::text[])`,
    [accounts.map(({ id }) => id), accounts.map(({ email }) => email)],
  );
  for (const row of users.rows) {
    const expected = accountById.get(row.id) ?? accountByEmail.get(row.email);
    if (
      expected === undefined ||
      expected.id !== row.id ||
      expected.email !== row.email ||
      expected.displayName !== row.display_name
    ) {
      throw new Error('Fixture user identifier or email collides with non-fixture data');
    }
  }

  const names = fixtureNames(manifest);
  await assertNamedRows(
    client,
    'transit_routes',
    'route_code',
    Object.entries(names.routeCodes).map(([id, value]) => ({ id, value })),
  );
  await assertNamedRows(
    client,
    'jeepneys',
    'plate_no',
    Object.entries(names.plates).map(([id, value]) => ({ id, value })),
  );
  const allIds = fixtureIds(manifest);
  const tableIds = [
    ['operators', Object.values(manifest.operators)],
    ['drivers', Object.values(manifest.drivers)],
    ['transit_routes', Object.values(manifest.routes)],
    ['route_directions', Object.values(manifest.directions)],
    ['jeepneys', Object.values(manifest.jeepneys)],
    ['fleet_groups', Object.values(manifest.groups)],
    ['driver_jeepney_assignments', Object.values(manifest.driverAssignments)],
    ['vehicle_route_assignments', Object.values(manifest.routeAssignments)],
    ['vehicle_applications', Object.values(manifest.applications)],
    ['gps_setup_requests', Object.values(manifest.gpsRequests)],
    ['gps_devices', [manifest.gpsDevice]],
    ['traccar_device_mappings', [manifest.deviceMapping]],
  ] as const;
  for (const [table, expectedIds] of tableIds) {
    const rows = await client.query<{ id: string }>(
      `SELECT id FROM ${table} WHERE id = ANY($1::uuid[])`,
      [allIds],
    );
    const expectedSet = new Set<string>(expectedIds);
    if (rows.rows.some(({ id }) => !expectedSet.has(id))) {
      throw new Error(`Fixture identifier collides with a non-fixture ${table} row`);
    }
  }
  const externalMemberships = await client.query<{ has_external_membership: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM fleet_group_drivers
       WHERE (group_id = ANY($1::uuid[]) AND NOT (driver_id = ANY($2::uuid[])))
          OR (driver_id = ANY($2::uuid[]) AND NOT (group_id = ANY($1::uuid[])))
       UNION ALL
       SELECT 1 FROM fleet_group_jeepneys
       WHERE (group_id = ANY($1::uuid[]) AND NOT (jeepney_id = ANY($3::uuid[])))
          OR (jeepney_id = ANY($3::uuid[]) AND NOT (group_id = ANY($1::uuid[])))
     ) AS has_external_membership`,
    [Object.values(manifest.groups), Object.values(manifest.drivers), Object.values(manifest.jeepneys)],
  );
  if (externalMemberships.rows[0]?.has_external_membership) {
    throw new Error('Fixture membership is linked to non-fixture data; cleanup refused');
  }
}

async function assertNamedRows(
  client: pg.PoolClient,
  table: 'transit_routes' | 'jeepneys',
  field: 'route_code' | 'plate_no',
  expected: Array<{ id: string; value: string }>,
): Promise<void> {
  const result = await client.query<{ id: string; value: string }>(
    `SELECT id, ${field}::text AS value FROM ${table}
     WHERE id = ANY($1::uuid[]) OR ${field} = ANY($2::text[])`,
    [expected.map(({ id }) => id), expected.map(({ value }) => value)],
  );
  for (const row of result.rows) {
    const match = expected.find(({ id, value }) => id === row.id || value === row.value);
    if (match === undefined || match.id !== row.id || match.value !== row.value) {
      throw new Error(`Fixture ${table} identifier collides with non-fixture data`);
    }
  }
}

async function cleanupFixtureRows(
  client: pg.PoolClient,
  manifest: DevelopmentFixtureManifest,
): Promise<void> {
  const ids = fixtureIds(manifest);
  const userIds = Object.values(manifest.accounts).map(({ id }) => id);
  await client.query(
    'DELETE FROM audit_logs WHERE actor_user_id = ANY($1::uuid[]) OR entity_id = ANY($2::text[])',
    [userIds, ids],
  );
  await client.query('DELETE FROM traccar_device_mappings WHERE id = ANY($1::uuid[])', [ids]);
  await client.query('DELETE FROM gps_devices WHERE id = ANY($1::uuid[])', [ids]);
  await client.query('DELETE FROM gps_setup_requests WHERE id = ANY($1::uuid[])', [ids]);
  await client.query('DELETE FROM vehicle_applications WHERE id = ANY($1::uuid[])', [ids]);
  await client.query('DELETE FROM vehicle_route_assignments WHERE id = ANY($1::uuid[])', [ids]);
  await client.query('DELETE FROM driver_jeepney_assignments WHERE id = ANY($1::uuid[])', [ids]);
  await client.query('DELETE FROM fleet_group_jeepneys WHERE group_id = ANY($1::uuid[])', [ids]);
  await client.query('DELETE FROM fleet_group_drivers WHERE group_id = ANY($1::uuid[])', [ids]);
  await client.query('DELETE FROM fleet_groups WHERE id = ANY($1::uuid[])', [ids]);
  await client.query('DELETE FROM jeepneys WHERE id = ANY($1::uuid[])', [ids]);
  await client.query('DELETE FROM route_directions WHERE id = ANY($1::uuid[])', [ids]);
  await client.query('DELETE FROM transit_routes WHERE id = ANY($1::uuid[])', [ids]);
  await client.query('DELETE FROM drivers WHERE id = ANY($1::uuid[])', [ids]);
  await client.query('DELETE FROM operators WHERE id = ANY($1::uuid[])', [ids]);
  await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
}

async function insertFixtures(
  client: pg.PoolClient,
  manifest: DevelopmentFixtureManifest,
  passwordHash: string,
): Promise<void> {
  for (const account of Object.values(manifest.accounts)) {
    await insertAccount(client, account, passwordHash);
  }

  await client.query(
    `INSERT INTO operators(id, owner_user_id) VALUES
       ($1, $2), ($3, $4), ($5, $6)`,
    [
      manifest.operators.operatorA,
      manifest.accounts.operatorA.id,
      manifest.operators.operatorB,
      manifest.accounts.operatorB.id,
      manifest.operators.dualRole,
      manifest.accounts.dualRole.id,
    ],
  );
  await client.query(
    `INSERT INTO drivers(id, user_id, operator_id) VALUES
       ($1, $2, $3), ($4, $5, $6), ($7, $8, $9)`,
    [
      manifest.drivers.driverA,
      manifest.accounts.driverA.id,
      manifest.operators.operatorA,
      manifest.drivers.driverB,
      manifest.accounts.driverB.id,
      manifest.operators.operatorB,
      manifest.drivers.dualRole,
      manifest.accounts.dualRole.id,
      manifest.operators.dualRole,
    ],
  );

  const names = fixtureNames(manifest);
  await client.query(
    `INSERT INTO transit_routes(id, route_code, public_name, description, route_color_hex, status)
     VALUES
       ($1, $2, 'Fixture Route 10A', $3, '#1E88E5', 'ACTIVE'),
       ($4, $5, 'Fixture Route 20B', $3, '#43A047', 'ACTIVE')`,
    [manifest.routes.routeA, names.routeCodes[manifest.routes.routeA], manifest.marker, manifest.routes.routeB, names.routeCodes[manifest.routes.routeB]],
  );
  await client.query(
    `INSERT INTO route_directions(
       id, route_id, direction_label, origin_name, destination_name, geometry, corridor_m, status
     ) VALUES
       ($1, $2, 'Outbound', 'Cebu South', 'Cebu Center', ST_GeomFromText('LINESTRING(123.86 10.26,123.89 10.29)', 4326), 100, 'ACTIVE'),
       ($3, $2, 'Inbound', 'Cebu Center', 'Cebu South', ST_GeomFromText('LINESTRING(123.89 10.29,123.86 10.26)', 4326), 100, 'ACTIVE'),
       ($4, $5, 'Outbound', 'Cebu East', 'Cebu Center', ST_GeomFromText('LINESTRING(123.92 10.31,123.89 10.29)', 4326), 100, 'ACTIVE')`,
    [manifest.directions.routeAOutbound, manifest.routes.routeA, manifest.directions.routeAInbound, manifest.directions.routeBOutbound, manifest.routes.routeB],
  );

  await client.query(
    `INSERT INTO jeepneys(
       id, operator_id, created_by_user_id, plate_no, color_hex, description, status, approved_at
     ) VALUES
       ($1, $6, $7, $10, '#1E88E5', $15, 'ACTIVE', now()),
       ($2, $6, $7, $11, '#FDD835', $15, 'PENDING_APPROVAL', NULL),
       ($3, $6, $7, $12, '#8E24AA', $15, 'APPROVED', now()),
       ($4, $6, $7, $13, '#FB8C00', $15, 'APPROVED', now()),
       ($5, $8, $9, $14, '#43A047', $15, 'APPROVED', now())`,
    [
      manifest.jeepneys.activeA,
      manifest.jeepneys.pendingA,
      manifest.jeepneys.noAssignmentA,
      manifest.jeepneys.conflictA,
      manifest.jeepneys.operatorB,
      manifest.operators.operatorA,
      manifest.accounts.operatorA.id,
      manifest.operators.operatorB,
      manifest.accounts.operatorB.id,
      names.plates[manifest.jeepneys.activeA],
      names.plates[manifest.jeepneys.pendingA],
      names.plates[manifest.jeepneys.noAssignmentA],
      names.plates[manifest.jeepneys.conflictA],
      names.plates[manifest.jeepneys.operatorB],
      manifest.marker,
    ],
  );
  await client.query(
    `INSERT INTO fleet_groups(id, operator_id, name, description) VALUES
       ($1, $4, $6, $9), ($2, $4, $7, $9), ($3, $5, $8, $9)`,
    [
      manifest.groups.primaryA,
      manifest.groups.conflictingA,
      manifest.groups.operatorB,
      manifest.operators.operatorA,
      manifest.operators.operatorB,
      names.groups.primaryA,
      names.groups.conflictingA,
      names.groups.operatorB,
      manifest.marker,
    ],
  );
  await client.query(
    `INSERT INTO fleet_group_drivers(group_id, driver_id) VALUES ($1, $3), ($2, $4)`,
    [manifest.groups.primaryA, manifest.groups.operatorB, manifest.drivers.driverA, manifest.drivers.driverB],
  );
  await client.query(
    `INSERT INTO fleet_group_jeepneys(group_id, jeepney_id) VALUES
       ($1, $3), ($1, $4), ($2, $5)`,
    [manifest.groups.primaryA, manifest.groups.operatorB, manifest.jeepneys.activeA, manifest.jeepneys.conflictA, manifest.jeepneys.operatorB],
  );
  await client.query(
    `INSERT INTO driver_jeepney_assignments(id, driver_id, jeepney_id, assigned_by_user_id) VALUES
       ($1, $3, $5, $7), ($2, $4, $6, $8)`,
    [manifest.driverAssignments.driverA, manifest.driverAssignments.driverB, manifest.drivers.driverA, manifest.drivers.driverB, manifest.jeepneys.activeA, manifest.jeepneys.operatorB, manifest.accounts.operatorA.id, manifest.accounts.operatorB.id],
  );
  await client.query(
    `INSERT INTO vehicle_route_assignments(
       id, jeepney_id, group_id, route_direction_id, assigned_by_user_id
     ) VALUES
       ($1, $5, NULL, $9, $12),
       ($2, NULL, $6, $10, $12),
       ($3, NULL, $7, $11, $12),
       ($4, NULL, $8, $11, $13)`,
    [
      manifest.routeAssignments.directA,
      manifest.routeAssignments.primaryGroupA,
      manifest.routeAssignments.conflictingGroupA,
      manifest.routeAssignments.groupB,
      manifest.jeepneys.activeA,
      manifest.groups.primaryA,
      manifest.groups.conflictingA,
      manifest.groups.operatorB,
      manifest.directions.routeAOutbound,
      manifest.directions.routeAInbound,
      manifest.directions.routeBOutbound,
      manifest.accounts.operatorA.id,
      manifest.accounts.operatorB.id,
    ],
  );

  await client.query(
    `INSERT INTO vehicle_applications(
       id, jeepney_id, submitted_by_user_id, status, applicant_notes,
       review_notes, reviewed_by_user_id, reviewed_at
     ) VALUES
       ($1, $5, $9, 'APPROVED', $12, 'Approved fixture', $11, now()),
       ($2, $6, $9, 'PENDING', $12, NULL, NULL, NULL),
       ($3, $7, $9, 'APPROVED', $12, 'Approved fixture', $11, now()),
       ($4, $8, $10, 'APPROVED', $12, 'Approved for rejected GPS scenario', $11, now())`,
    [
      manifest.applications.activeA,
      manifest.applications.pendingA,
      manifest.applications.noAssignmentA,
      manifest.applications.operatorB,
      manifest.jeepneys.activeA,
      manifest.jeepneys.pendingA,
      manifest.jeepneys.noAssignmentA,
      manifest.jeepneys.operatorB,
      manifest.accounts.operatorA.id,
      manifest.accounts.operatorB.id,
      manifest.accounts.admin.id,
      manifest.marker,
    ],
  );
  await client.query(
    `INSERT INTO gps_setup_requests(
       id, vehicle_application_id, jeepney_id, requested_by_user_id, status,
       verification_status, scheduled_at, installed_at, rejected_reason,
       verification_checks, verified_by_user_id, verified_at
     ) VALUES
       ($1, $4, $7, $10, 'INSTALLED', 'VERIFIED', now() - interval '2 days', now() - interval '1 day', NULL,
        '{"powerOk":true,"simOk":true,"serverOk":true,"gpsFixOk":true,"notes":"synthetic development fixture"}'::jsonb, $12, now()),
       ($2, $5, $8, $10, 'PENDING', 'NOT_STARTED', NULL, NULL, NULL, '{}'::jsonb, NULL, NULL),
       ($3, $6, $9, $11, 'REJECTED', 'NOT_STARTED', NULL, NULL, 'Synthetic rejection fixture', '{}'::jsonb, NULL, NULL)`,
    [
      manifest.gpsRequests.installedA,
      manifest.gpsRequests.pendingA,
      manifest.gpsRequests.rejectedB,
      manifest.applications.activeA,
      manifest.applications.noAssignmentA,
      manifest.applications.operatorB,
      manifest.jeepneys.activeA,
      manifest.jeepneys.noAssignmentA,
      manifest.jeepneys.operatorB,
      manifest.accounts.operatorA.id,
      manifest.accounts.operatorB.id,
      manifest.accounts.admin.id,
    ],
  );
  const fixtureKind = manifest.accounts.commuter.id.startsWith('d') ? 'DEV' : 'FIXTURE';
  const imei = fixtureKind === 'DEV' ? '860000000000001' : '860000000000002';
  await client.query(
    `INSERT INTO gps_devices(id, imei, serial_number, status)
     VALUES ($1, $2, $3, 'ACTIVE')`,
    [manifest.gpsDevice, imei, `${fixtureKind}-FIXTURE-GPS-001`],
  );
  await client.query(
    `INSERT INTO traccar_device_mappings(
       id, gps_setup_request_id, gps_device_id, jeepney_id, traccar_unique_id, mapped_by_user_id
     ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [manifest.deviceMapping, manifest.gpsRequests.installedA, manifest.gpsDevice, manifest.jeepneys.activeA, `${fixtureKind.toLowerCase()}-fixture-traccar-001`, manifest.accounts.admin.id],
  );
}

async function insertAccount(
  client: pg.PoolClient,
  account: FixtureAccount,
  passwordHash: string,
): Promise<void> {
  await client.query(
    `INSERT INTO users(id, email, password_hash, display_name, email_verified_at)
     VALUES ($1, $2, $3, $4, now())`,
    [account.id, account.email, passwordHash, account.displayName],
  );
  for (const role of account.roles) {
    await client.query('INSERT INTO user_roles(user_id, role) VALUES ($1, $2)', [account.id, role]);
  }
}

function fixtureNames(manifest: DevelopmentFixtureManifest): {
  routeCodes: Record<string, string>;
  plates: Record<string, string>;
  groups: { primaryA: string; conflictingA: string; operatorB: string };
} {
  const prefix = manifest.accounts.commuter.id.startsWith('d') ? 'DEV' : 'FIXTURE';
  return {
    routeCodes: {
      [manifest.routes.routeA]: `${prefix}-10A`,
      [manifest.routes.routeB]: `${prefix}-20B`,
    },
    plates: {
      [manifest.jeepneys.activeA]: `${prefix}-ACTIVE-01`,
      [manifest.jeepneys.pendingA]: `${prefix}-PENDING-01`,
      [manifest.jeepneys.noAssignmentA]: `${prefix}-NOASSIGN-01`,
      [manifest.jeepneys.conflictA]: `${prefix}-CONFLICT-01`,
      [manifest.jeepneys.operatorB]: `${prefix}-TENANT-B-01`,
    },
    groups: {
      primaryA: `${prefix} Primary Route Group`,
      conflictingA: `${prefix} Conflicting Route Group`,
      operatorB: `${prefix} Operator B Group`,
    },
  };
}

function summarize(
  boundary: DevelopmentDatabaseBoundary,
  manifest: DevelopmentFixtureManifest,
): DevelopmentFixtureSummary {
  return {
    boundary,
    accounts: Object.keys(manifest.accounts).length,
    operators: Object.keys(manifest.operators).length,
    drivers: Object.keys(manifest.drivers).length,
    routes: Object.keys(manifest.routes).length,
    directions: Object.keys(manifest.directions).length,
    jeepneys: Object.keys(manifest.jeepneys).length,
    groups: Object.keys(manifest.groups).length,
    applications: Object.keys(manifest.applications).length,
    gpsRequests: Object.keys(manifest.gpsRequests).length,
  };
}

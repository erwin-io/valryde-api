import { fileURLToPath } from 'node:url';

import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { developmentFixtureManifest } from '../dev-fixtures/fixture-manifest.js';
import {
  cleanupDevelopmentFixtures,
  countDevelopmentFixtureRows,
  inspectDevelopmentDatabase,
  seedDevelopmentFixtures,
} from '../services/development-fixture-service.js';

type FixtureCommand = 'seed' | 'cleanup' | 'verify' | 'manifest';

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export async function runDevelopmentFixtures(command: FixtureCommand): Promise<void> {
  if (command === 'manifest') {
    process.stdout.write(`${JSON.stringify(developmentFixtureManifest, null, 2)}\n`);
    return;
  }

  const config = loadConfig();
  const pool = createPool(config);
  const common = {
    environment: config.environment,
    expectedDatabase: requiredEnvironmentVariable('DEV_FIXTURE_TARGET_DATABASE'),
    schema: config.databaseSchema,
    confirmation: process.env.DEV_FIXTURE_CONFIRM ?? '',
  };
  try {
    if (command === 'seed') {
      const summary = await seedDevelopmentFixtures(pool, {
        ...common,
        password: requiredEnvironmentVariable('DEV_FIXTURE_PASSWORD'),
      });
      process.stdout.write(
        `Development fixtures seeded in ${summary.boundary.database} on ${summary.boundary.host}:${summary.boundary.port}; ${summary.accounts} accounts and ${summary.jeepneys} jeepneys are ready.\n`,
      );
      return;
    }
    if (command === 'cleanup') {
      const summary = await cleanupDevelopmentFixtures(pool, common);
      process.stdout.write(
        `Development fixtures removed from ${summary.boundary.database}; only manifest-owned identifiers were targeted.\n`,
      );
      return;
    }
    const boundary = await inspectDevelopmentDatabase(pool, common);
    const count = await countDevelopmentFixtureRows(pool);
    process.stdout.write(
      `Development fixture boundary verified: ${boundary.database} on ${boundary.host}:${boundary.port}, schema ${boundary.schema}, tracked fixture rows ${count}.\n`,
    );
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  if (command !== 'seed' && command !== 'cleanup' && command !== 'verify' && command !== 'manifest') {
    process.stderr.write('Usage: development-fixtures <seed|cleanup|verify|manifest>\n');
    process.exitCode = 1;
  } else {
    runDevelopmentFixtures(command).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unknown development fixture failure';
      process.stderr.write(`Development fixture command failed: ${message}\n`);
      process.exitCode = 1;
    });
  }
}

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../config.js';
import { createPool } from './pool.js';

const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), '../../migrations');

export async function migrate(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config);
  const client = await pool.connect();

  try {
    await client.query('SELECT pg_advisory_lock($1)', [8_642_100_001]);
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${config.databaseSchema}"`);
    await client.query(`SET search_path TO "${config.databaseSchema}", public`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(migrationsDirectory))
      .filter((file) => file.endsWith('.sql'))
      .sort((left, right) => left.localeCompare(right));

    for (const filename of files) {
      const applied = await client.query<{ exists: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE filename = $1) AS exists',
        [filename],
      );
      if (applied.rows[0]?.exists === true) continue;

      const sql = await readFile(join(migrationsDirectory, filename), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(filename) VALUES ($1)', [filename]);
        await client.query('COMMIT');
        process.stdout.write(`Applied ${filename}\n`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [8_642_100_001]).catch(() => undefined);
    client.release();
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown migration failure';
    process.stderr.write(`Migration failed: ${message}\n`);
    process.exitCode = 1;
  });
}

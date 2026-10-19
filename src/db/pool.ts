import pg from 'pg';

import type { AppConfig } from '../config.js';

const { Pool } = pg;

export function createPool(config: AppConfig): pg.Pool {
  return new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: true } : false,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    application_name: 'valryde-api',
    options: `-c search_path=${config.databaseSchema},public`,
  });
}

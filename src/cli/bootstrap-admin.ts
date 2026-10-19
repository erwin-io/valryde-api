import { fileURLToPath } from 'node:url';

import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { bootstrapFirstAdmin } from '../services/admin-bootstrap-service.js';

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

export async function runAdminBootstrap(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config);
  try {
    const result = await bootstrapFirstAdmin(pool, {
      email: requiredEnvironmentVariable('ADMIN_BOOTSTRAP_EMAIL'),
      displayName: requiredEnvironmentVariable('ADMIN_BOOTSTRAP_DISPLAY_NAME'),
      password: requiredEnvironmentVariable('ADMIN_BOOTSTRAP_PASSWORD'),
      confirmation: requiredEnvironmentVariable('ADMIN_BOOTSTRAP_CONFIRM'),
    });
    process.stdout.write(
      result.status === 'created'
        ? 'Initial Admin account created.\n'
        : 'Initial Admin account already exists; no changes made.\n',
    );
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runAdminBootstrap().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown Admin bootstrap failure';
    process.stderr.write(`Admin bootstrap failed: ${message}\n`);
    process.exitCode = 1;
  });
}

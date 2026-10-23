// Regenerates the Agent A frontend endpoint matrix, index and OpenAPI snapshot from the running
// Fastify schema plus route preHandlers. Offline: no database connection or listener is opened.
// Usage: npx tsx scripts/generate-api-handoff.ts
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';

interface Schema {
  type?: string | string[];
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  anyOf?: Schema[];
  enum?: unknown[];
  const?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  format?: string;
  pattern?: string;
  default?: unknown;
}
interface Operation {
  operationId: string;
  summary?: string;
  description?: string;
  security?: unknown[];
  parameters?: Array<{ in: string; name: string; required?: boolean; schema: Schema }>;
  requestBody?: { content: Record<string, { schema: Schema }> };
  responses: Record<string, { content?: Record<string, { schema: Schema }> }>;
}

const outDir = 'docs/integration';
const config: AppConfig = {
  environment: 'test',
  host: '127.0.0.1',
  port: 3000,
  logLevel: 'silent',
  corsOrigins: [],
  databaseUrl: 'postgresql://127.0.0.1:1/unused',
  databaseSsl: false,
  databaseSchema: 'dbo',
  jwtSecret: 'handoff-generator-secret-with-at-least-32-characters',
  jwtIssuer: 'valryde-api',
  jwtAudience: 'valryde-clients',
  accessTokenTtlSeconds: 900,
  refreshTokenTtlDays: 30,
  authChallengeTtlMinutes: 30,
  authResendCooldownSeconds: 60,
  googleClientIds: [],
  email: { deliveryMode: 'disabled' },
};

// Intended frontend consumers (C commuter, D driver/operator, E admin); not an authorization grant.
const consumers = (path: string, guard: string): string[] => {
  if (path.startsWith('/admin/') || guard === 'ADMIN') return ['E'];
  if (path === '/health' || path.startsWith('/transit-routes') || path.startsWith('/places')) return ['C', 'D', 'E'];
  // Admin accounts come only from the bootstrap CLI, so Admin web never self-registers or uses Google.
  if (path === '/auth/register' || path === '/auth/google') return ['C', 'D'];
  if (path.startsWith('/auth/')) return ['C', 'D', 'E'];
  if (guard === 'DRIVER') return ['D'];
  if (guard === 'OPERATOR' || guard === 'DRIVER, OPERATOR') return ['D'];
  return ['D', 'E'];
};

function sourceGuards(): Map<string, { guard: string; file: string; line: number }> {
  const guards = new Map<string, { guard: string; file: string; line: number }>();
  const files = ['src/app.ts', ...readdirSync('src/routes').map((name) => join('src/routes', name))];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      const id = /operationId: '([^']+)'/.exec(line)?.[1];
      if (id === undefined) return;
      let start = index;
      while (start > 0 && !/(fastify|app)\.(get|post|put|patch|delete)\(/.test(lines[start] ?? '')) start -= 1;
      const block = lines.slice(start, index).join('\n');
      const roles = /requireRoles\(([^)]*)\)/.exec(block)?.[1];
      const guard = roles !== undefined
        ? roles.replace(/'/g, '').split(',').map((role) => role.trim()).join(', ')
        : /authenticate/.test(block) ? 'ANY_VERIFIED_ACTIVE_ROLE' : 'PUBLIC';
      guards.set(id, { guard, file: file.replace(/\\/g, '/'), line: start + 1 });
    });
  }
  return guards;
}

function describeType(schema: Schema): string {
  if (schema.anyOf !== undefined) {
    const consts = schema.anyOf.filter((option) => option.const !== undefined || option.enum !== undefined);
    if (consts.length === schema.anyOf.length) {
      return schema.anyOf.flatMap((option) => option.enum ?? [option.const]).join('/');
    }
    return schema.anyOf.map(describeType).join('|');
  }
  if (schema.enum !== undefined) return schema.enum.join('/');
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  const type = Array.isArray(schema.type) ? schema.type.join('|') : schema.type ?? 'any';
  const limits = [
    schema.format,
    schema.minLength !== undefined || schema.maxLength !== undefined
      ? `len ${schema.minLength ?? 0}–${schema.maxLength ?? '∞'}` : undefined,
    schema.minimum !== undefined || schema.maximum !== undefined
      ? `${schema.minimum ?? '−∞'}–${schema.maximum ?? '∞'}` : undefined,
    schema.minItems !== undefined || schema.maxItems !== undefined
      ? `items ${schema.minItems ?? 0}–${schema.maxItems ?? '∞'}` : undefined,
    schema.default !== undefined ? `default ${JSON.stringify(schema.default)}` : undefined,
  ].filter(Boolean);
  const inner = type === 'array' && schema.items !== undefined ? `<${describeType(schema.items)}>` : '';
  return `${type}${inner}${limits.length > 0 ? ` (${limits.join(', ')})` : ''}`;
}

const fields = (schema: Schema | undefined): string =>
  schema?.properties === undefined
    ? 'none'
    : Object.entries(schema.properties)
        .map(([name, value]) => `${name}${schema.required?.includes(name) ? '' : '?'}: ${describeType(value)}`)
        .join('; ');

const app = await buildApp({ config, logger: false });
await app.ready();
const document = app.swagger() as unknown as {
  paths: Record<string, Record<string, Operation>>;
};
await app.close();

const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const guards = sourceGuards();
const operations = Object.entries(document.paths).flatMap(([path, item]) =>
  Object.entries(item)
    .filter(([method]) => ['get', 'post', 'put', 'patch', 'delete'].includes(method))
    .map(([method, operation]) => {
      const source = guards.get(operation.operationId);
      if (source === undefined) throw new Error(`No source guard for ${operation.operationId}`);
      const success = Object.keys(operation.responses).filter((status) => status.startsWith('2'));
      const successSchema = operation.responses[success[0] ?? '']?.content?.['application/json']?.schema;
      return {
        method: method.toUpperCase(),
        path: `/api${path}`,
        operationId: operation.operationId,
        summary: operation.summary ?? '',
        description: operation.description ?? '',
        guard: source.guard,
        consumers: consumers(path, source.guard),
        pathParams: (operation.parameters ?? []).filter((p) => p.in === 'path')
          .map((p) => `${p.name}: ${describeType(p.schema)}`),
        query: (operation.parameters ?? []).filter((p) => p.in === 'query')
          .map((p) => `${p.name}${p.required === true ? '' : '?'}: ${describeType(p.schema)}`),
        body: fields(operation.requestBody?.content['application/json']?.schema),
        success: success.map((status) =>
          status === '204' ? '204 no body' : `${status} {${Object.keys(successSchema?.properties ?? {}).join(', ')}}`),
        paginated: successSchema?.properties?.pagination !== undefined,
        statuses: Object.keys(operation.responses),
        file: source.file,
        line: source.line,
      };
    }),
);

writeFileSync(join(outDir, 'AGENT_A_OPENAPI_AUDIT.json'), `${JSON.stringify(document, null, 2)}\n`);
writeFileSync(
  join(outDir, 'AGENT_A_FRONTEND_ENDPOINT_INDEX.json'),
  `${JSON.stringify({ sourceCommit: sha, operations: operations.map(({ description, summary, ...rest }) => {
    void description;
    void summary;
    return rest;
  }) }, null, 2)}\n`,
);

const pathCount = new Set(operations.map((op) => op.path)).size;
const matrix = [
  '# Agent A endpoint / DTO / RBAC matrix for C, D and E',
  '',
  `Generated by \`scripts/generate-api-handoff.ts\` from commit \`${sha}\`: ${operations.length} operations / ${pathCount} paths, read from the registered Fastify OpenAPI schemas and the route preHandlers. It describes contracts in that commit only, not a live deployment. The rules that apply to every call are in [AGENT_A_BACKEND_RELEASE_API_HANDOFF.md](AGENT_A_BACKEND_RELEASE_API_HANDOFF.md).`,
  '',
  '**All paths below include `/api`.** The [OpenAPI snapshot](AGENT_A_OPENAPI_AUDIT.json) uses server `/api` and unprefixed paths; do not prepend `/api` twice. Route guard `PUBLIC` means no JWT; `ANY_VERIFIED_ACTIVE_ROLE` means any signed-in, verified, active account; a role list means one of those roles. Service-level ownership checks apply on top of every guard. Consumer letters describe intended use, not authorization.',
  '',
  '| Endpoint | Consumers | Route guard | Success | Paginated | operationId |',
  '|---|---|---|---|---|---|',
  ...operations.map((op) =>
    `| \`${op.method} ${op.path}\` | ${op.consumers.join(',')} | ${op.guard} | ${op.success.join(', ')} | ${op.paginated ? 'yes' : 'no'} | \`${op.operationId}\` |`),
  '',
  '## Request and response contracts',
  '',
  '`?` marks an optional field. Every JSON body and query schema rejects or strips unknown properties. Paginated responses carry `pagination: {page, pageSize, total, totalPages}`. Exact nested response schemas are in the OpenAPI snapshot under the same path and method.',
  '',
  ...operations.flatMap((op) => [
    `### ${op.operationId}`,
    '',
    `- Endpoint: \`${op.method} ${op.path}\`. Guard: ${op.guard}.`,
    `- ${op.summary}. ${op.description}`,
    ...(op.pathParams.length > 0 ? [`- Path: ${op.pathParams.join('; ')}.`] : []),
    ...(op.query.length > 0 ? [`- Query: ${op.query.join('; ')}.`] : []),
    ...(op.body !== 'none' ? [`- JSON body: ${op.body}.`] : []),
    `- Success: ${op.success.join(', ')}. Declared statuses: ${op.statuses.join(', ')}.`,
    `- Source: [${op.file}:${op.line}](../../${op.file}).`,
    '',
  ]),
].join('\n');
writeFileSync(join(outDir, 'AGENT_A_FRONTEND_ENDPOINT_MATRIX.md'), matrix);
console.log(`${operations.length} operations / ${pathCount} paths from ${sha}`);

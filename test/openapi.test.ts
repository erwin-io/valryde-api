import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { openApiTagDefinitions } from '../src/openapi.js';

interface OpenApiOperation {
  tags?: string[];
  operationId?: string;
  summary?: string;
  description?: string;
  security?: Array<Record<string, string[]>>;
}

interface OpenApiDocument {
  openapi: string;
  servers?: Array<{ url: string }>;
  tags?: Array<{ name: string; description?: string }>;
  paths: Record<string, Record<string, OpenApiOperation>>;
}

const config: AppConfig = {
  environment: 'test',
  host: '127.0.0.1',
  port: 3000,
  logLevel: 'silent',
  corsOrigins: [],
  databaseUrl: 'postgresql://127.0.0.1:1/unused',
  databaseSsl: false,
  databaseSchema: 'dbo',
  jwtSecret: 'openapi-test-secret-with-at-least-32-characters',
  jwtIssuer: 'valryde-api-test',
  jwtAudience: 'valryde-test-clients',
  accessTokenTtlSeconds: 900,
  refreshTokenTtlDays: 30,
  authChallengeTtlMinutes: 30,
  authResendCooldownSeconds: 60,
  googleClientIds: [],
  email: { deliveryMode: 'disabled' },
};

describe('OpenAPI documentation', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let document: OpenApiDocument;

  beforeAll(async () => {
    app = await buildApp({ config, logger: false });
    await app.ready();
    document = app.swagger() as OpenApiDocument;
  });

  afterAll(async () => {
    await app.close();
  });

  it('publishes a serializable OpenAPI 3 document at the Swagger JSON endpoint', async () => {
    const response = await app.inject({ method: 'GET', url: '/documentation/json' });
    expect(response.statusCode).toBe(200);
    const published = response.json<OpenApiDocument>();
    expect(published.openapi).toMatch(/^3\./);
    expect(Object.keys(published.paths).length).toBeGreaterThan(0);
  });

  it('declares approved tags in display order and uses the /api server exactly once', () => {
    expect(document.tags?.map(({ name }) => name)).toEqual(
      openApiTagDefinitions.map(({ name }) => name),
    );
    expect(document.tags?.every(({ description }) => Boolean(description))).toBe(true);
    expect(document.servers).toEqual([{ url: '/api' }]);
    expect(Object.keys(document.paths).every((path) => !path.startsWith('/api/'))).toBe(true);
  });

  it('gives every implemented operation one approved tag and a unique operation ID', () => {
    const approvedTags = new Set<string>(openApiTagDefinitions.map(({ name }) => name));
    const operationIds: string[] = [];
    const operations = Object.values(document.paths).flatMap((pathItem) =>
      Object.entries(pathItem).filter(([method]) =>
        ['get', 'post', 'put', 'patch', 'delete'].includes(method),
      ),
    );

    expect(operations.length).toBeGreaterThan(0);
    for (const [, operation] of operations) {
      expect(operation.tags).toHaveLength(1);
      expect(approvedTags.has(operation.tags?.[0] ?? '')).toBe(true);
      expect(operation.tags?.[0]).not.toBe('default');
      expect(operation.summary).toBeTruthy();
      expect(operation.description).toBeTruthy();
      expect(operation.operationId).toBeTruthy();
      operationIds.push(operation.operationId ?? '');
    }
    expect(new Set(operationIds).size).toBe(operationIds.length);
  });

  it('keeps public operations public and documents JWT security on protected operations', () => {
    expect(document.paths['/health']?.get?.security).toBeUndefined();
    expect(document.paths['/auth/register']?.post?.security).toBeUndefined();
    expect(document.paths['/transit-routes']?.get?.security).toBeUndefined();
    expect(document.paths['/transit-routes/{routeId}']?.get?.security).toBeUndefined();
    expect(document.paths['/transit-routes/discover']?.get?.security).toBeUndefined();
    expect(document.paths['/places/search']?.get?.security).toEqual([{ bearerAuth: [] }]);
    expect(document.paths['/auth/me']?.get?.security).toEqual([{ bearerAuth: [] }]);
    expect(document.paths['/admin/users/']?.get?.security).toEqual([{ bearerAuth: [] }]);
  });

  it('publishes the G8 audit-log read as a protected Administration operation', () => {
    expect(document.paths['/admin/audit-logs']?.get).toMatchObject({
      operationId: 'listAuditLogsAsAdmin',
      tags: [openApiTagDefinitions[14]?.name],
      security: [{ bearerAuth: [] }],
    });
    expect(document.paths['/admin/audit-logs']?.post).toBeUndefined();
  });

  it('publishes the approved G1 directory operations as protected fleet contracts', () => {
    expect(document.paths['/drivers']?.get).toMatchObject({
      operationId: 'listDrivers',
      tags: [openApiTagDefinitions[4]?.name],
      security: [{ bearerAuth: [] }],
    });
    expect(document.paths['/operators']?.get).toMatchObject({
      operationId: 'listOperators',
      tags: [openApiTagDefinitions[4]?.name],
      security: [{ bearerAuth: [] }],
    });
  });
});

import pg from 'pg';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

// Dependency probe only: no B007/B008 tables, telemetry writes, A context or compliance implementation.
describeDatabase('read-only isolated PostGIS tracking preparation', () => {
  it('verifies longitude/latitude, metre corridors and exact inclusive distance semantics', async () => {
    const pool = new pg.Pool({ connectionString: databaseUrl });
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN READ ONLY');
        const mode = await client.query<{ transaction_read_only: string }>('SHOW transaction_read_only');
        expect(mode.rows[0]?.transaction_read_only).toBe('on');
        const point = await client.query<{ srid: number; longitude: number; latitude: number }>(
          'SELECT ST_SRID(p) AS srid, ST_X(p) AS longitude, ST_Y(p) AS latitude FROM (SELECT ST_SetSRID(ST_MakePoint(123.88,10.3),4326) AS p) q',
        );
        expect(point.rows).toEqual([{ srid: 4326, longitude: 123.88, latitude: 10.3 }]);
        const distance = await client.query<{ target_m: number; measured_m: number; within100: boolean; within150: boolean }>(`
          WITH fixture AS (
            SELECT ST_GeogFromText('LINESTRING(0 -0.01,0 0.01)') AS route,
                   ST_GeogFromText('POINT(0 0)') AS centre
          ), samples AS (
            SELECT route, target_m, ST_Project(centre,target_m,radians(90.0)) AS p
            FROM fixture CROSS JOIN unnest(ARRAY[99,100,101]) AS target_m
          )
          SELECT target_m, ST_Distance(p,route,true) AS measured_m,
                 ST_DWithin(p,route,100,true) AS within100,
                 ST_DWithin(p,route,150,true) AS within150
          FROM samples ORDER BY target_m
        `);
        expect(distance.rows).toHaveLength(3);
        for (const row of distance.rows) {
          expect(Math.abs(row.measured_m - row.target_m)).toBeLessThan(0.0001);
          expect(row.within150).toBe(true);
        }
        expect(distance.rows[0]?.within100).toBe(true);
        expect(distance.rows[2]?.within100).toBe(false);
        // Nominal100m ST_Project output can lie either side of the exact boundary by floating point.
        // Assert exact inclusive semantics with coincident points, without adding runtime tolerance.
        const boundary = await client.query<{ inclusive: boolean; numeric_inclusive: boolean }>(`
          SELECT ST_DWithin(p,p,0,true) AS inclusive,
                 ST_Distance(p,p,true) <= 0 AS numeric_inclusive
          FROM (SELECT ST_GeogFromText('POINT(0 0)') AS p) q
        `);
        expect(boundary.rows).toEqual([{ inclusive: true, numeric_inclusive: true }]);
      } finally {
        try { await client.query('ROLLBACK'); } finally { client.release(); }
      }
    } finally { await pool.end(); }
  });
});

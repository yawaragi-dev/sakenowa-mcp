import { execSync } from 'node:child_process';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findSakesByFlavor } from './find-sakes-by-flavor.js';

function dockerAvailable(): boolean {
  try { execSync('docker info', { stdio: 'ignore' }); return true; } catch { return false; }
}
const hasDocker = dockerAvailable();
if (!hasDocker) console.warn('[find-sakes-by-flavor.integration] SKIPPED: no Docker.');

describe.skipIf(!hasDocker)('find_sakes_by_flavor (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    await pool.query(`CREATE TABLE areas (area_id int primary key, name text not null)`);
    await pool.query(`CREATE TABLE breweries (brewery_id int primary key, name text not null, name_romaji text, area_id int not null references areas(area_id))`);
    await pool.query(`CREATE TABLE brands (brand_id int primary key, name text not null, name_romaji text, brewery_id int not null references breweries(brewery_id))`);
    await pool.query(`CREATE TABLE flavor_charts (brand_id int primary key references brands(brand_id), f1 numeric, f2 numeric, f3 numeric, f4 numeric, f5 numeric, f6 numeric)`);
    // area 0 = sentinel; breweries 0/15/27; one brand per brewery.
    await pool.query(`INSERT INTO areas VALUES (0,'その他'),(15,'新潟県'),(27,'大阪府')`);
    await pool.query(`INSERT INTO breweries (brewery_id,name,name_romaji,area_id) VALUES (90,'p',null,0),(100,'n',null,15),(270,'o',null,27)`);
    await pool.query(`INSERT INTO brands (brand_id,name,name_romaji,brewery_id) VALUES (1,'aromatic-niigata',null,100),(2,'aromatic-osaka',null,270),(3,'aromatic-other',null,90),(4,'mild-niigata',null,100)`);
    await pool.query(`INSERT INTO flavor_charts VALUES (1, 0.8,0,0,0,0,0),(2, 0.8,0,0,0,0,0),(3, 0.8,0,0,0,0,0),(4, 0.2,0,0,0,0,0)`);
  });
  afterAll(async () => { await pool.end(); await container.stop(); });

  it('filters by axis range and never returns an areaId-0 brand', async () => {
    // f1 >= 0.6 matches brands 1,2,3 — but 3 sits in area 0 and must be excluded.
    const result = await findSakesByFlavor({ f1Min: 0.6 }, pool);
    const ids = result.map((r) => r.sake.brandId);
    expect(ids).not.toContain(3);
    expect(ids).toEqual([1, 2]);
  });

  it('combines axis + area filters with AND semantics', async () => {
    const result = await findSakesByFlavor({ f1Min: 0.6, areaId: 15 }, pool);
    expect(result.map((r) => r.sake.brandId)).toEqual([1]);
    expect(result[0]?.flavorProfile?.f1).toBe(0.8);
  });
});

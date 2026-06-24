import { execSync } from 'node:child_process';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getTopRanked } from './get-top-ranked.js';

function dockerAvailable(): boolean {
  try { execSync('docker info', { stdio: 'ignore' }); return true; } catch { return false; }
}
const hasDocker = dockerAvailable();
if (!hasDocker) console.warn('[get-top-ranked.integration] SKIPPED: no Docker.');

describe.skipIf(!hasDocker)('get_top_ranked (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    await pool.query(`CREATE TABLE areas (area_id int primary key, name text not null)`);
    await pool.query(`CREATE TABLE breweries (brewery_id int primary key, name text not null, name_romaji text, area_id int not null references areas(area_id))`);
    await pool.query(`CREATE TABLE brands (brand_id int primary key, name text not null, name_romaji text, brewery_id int not null references breweries(brewery_id))`);
    await pool.query(`CREATE TABLE flavor_charts (brand_id int primary key references brands(brand_id), f1 numeric, f2 numeric, f3 numeric, f4 numeric, f5 numeric, f6 numeric)`);
    await pool.query(`CREATE TABLE rankings (kind text not null, area_id int, rank int not null, brand_id int not null references brands(brand_id), score numeric not null)`);
    await pool.query(`INSERT INTO areas VALUES (15,'新潟県')`);
    await pool.query(`INSERT INTO breweries (brewery_id,name,name_romaji,area_id) VALUES (100,'b',null,15)`);
    await pool.query(`INSERT INTO brands (brand_id,name,name_romaji,brewery_id) VALUES (1,'a',null,100),(2,'b',null,100)`);
    await pool.query(`INSERT INTO rankings (kind,area_id,rank,brand_id,score) VALUES
      ('overall',null,2,2,10),('overall',null,1,1,20),('area',15,1,2,15)`);
  });
  afterAll(async () => { await pool.end(); await container.stop(); });

  it('returns the overall ranking ordered by rank asc', async () => {
    const result = await getTopRanked({ scope: 'overall' }, pool);
    expect(result.map((r) => [r.sake.brandId, r.rank])).toEqual([[1, 1], [2, 2]]);
  });

  it('returns an area ranking', async () => {
    const result = await getTopRanked({ scope: 'area', areaId: 15 }, pool);
    expect(result.map((r) => r.sake.brandId)).toEqual([2]);
  });

  it('returns [] for an unknown area (not an error)', async () => {
    expect(await getTopRanked({ scope: 'area', areaId: 999 }, pool)).toEqual([]);
  });
});

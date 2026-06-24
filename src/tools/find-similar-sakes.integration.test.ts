import { execSync } from 'node:child_process';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findSimilarSakes } from './find-similar-sakes.js';

function dockerAvailable(): boolean {
  try { execSync('docker info', { stdio: 'ignore' }); return true; } catch { return false; }
}
const hasDocker = dockerAvailable();
if (!hasDocker) console.warn('[find-similar-sakes.integration] SKIPPED: no Docker.');

describe.skipIf(!hasDocker)('find_similar_sakes (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    await pool.query(`CREATE TABLE areas (area_id int primary key, name text not null)`);
    await pool.query(`CREATE TABLE breweries (brewery_id int primary key, name text not null, name_romaji text, area_id int not null references areas(area_id))`);
    await pool.query(`CREATE TABLE brands (brand_id int primary key, name text not null, name_romaji text, brewery_id int not null references breweries(brewery_id))`);
    await pool.query(`CREATE TABLE flavor_charts (brand_id int primary key references brands(brand_id), f1 numeric, f2 numeric, f3 numeric, f4 numeric, f5 numeric, f6 numeric)`);
    await pool.query(`INSERT INTO areas VALUES (15,'新潟県')`);
    await pool.query(`INSERT INTO breweries (brewery_id,name,name_romaji,area_id) VALUES (100,'b','b',15)`);
    await pool.query(`INSERT INTO brands (brand_id,name,name_romaji,brewery_id) VALUES (1,'a',null,100),(2,'b',null,100),(3,'c',null,100),(4,'d',null,100),(5,'e',null,100)`);
    // source 1 = (1,0,0,0,0,0). nearest: 2 (1.0) > 3 (~0.994) > 5 (0.707) > 4 (0).
    await pool.query(`INSERT INTO flavor_charts VALUES
      (1, 1,0,0,0,0,0), (2, 1,0,0,0,0,0), (3, 0.9,0.1,0,0,0,0), (4, 0,1,0,0,0,0), (5, 1,1,0,0,0,0)`);
  });
  afterAll(async () => { await pool.end(); await container.stop(); });

  it('returns the top-3 nearest neighbours, source excluded', async () => {
    const result = await findSimilarSakes({ brandId: 1, topK: 3 }, pool);
    expect(result.map((r) => r.sake.brandId)).toEqual([2, 3, 5]);
    expect(result.map((r) => r.sake.brandId)).not.toContain(1);
    expect(result[0]?.similarity).toBeCloseTo(1, 6);
  });
});

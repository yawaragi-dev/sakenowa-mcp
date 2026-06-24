import { execSync } from 'node:child_process';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSakeDetails } from './get-sake-details.js';

function dockerAvailable(): boolean {
  try { execSync('docker info', { stdio: 'ignore' }); return true; } catch { return false; }
}
const hasDocker = dockerAvailable();
if (!hasDocker) console.warn('[get-sake-details.integration] SKIPPED: no Docker.');

describe.skipIf(!hasDocker)('get_sake_details (integration)', () => {
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
    await pool.query(`INSERT INTO breweries (brewery_id,name,name_romaji,area_id) VALUES (100,'旭酒造','Asahi Shuzo',15)`);
    await pool.query(`INSERT INTO brands (brand_id,name,name_romaji,brewery_id) VALUES (1,'獺祭','Dassai',100),(2,'無垢','Muku',100)`);
    await pool.query(`INSERT INTO flavor_charts VALUES (1,0.8,0.6,0.4,0.3,0.5,0.7)`);
  });
  afterAll(async () => { await pool.end(); await container.stop(); });

  it('returns brand + FlavorChart (and empty flavorTags) for a known brandId', async () => {
    const result = await getSakeDetails({ brandId: 1 }, pool);
    expect(result.found).toBe(true);
    if (!result.found) throw new Error('expected found');
    expect(result.sake.brandId).toBe(1);
    expect(result.sake.area.name).toBe('新潟県');
    expect(result.flavorProfile).toEqual({ f1: 0.8, f2: 0.6, f3: 0.4, f4: 0.3, f5: 0.5, f6: 0.7 });
    expect(result.flavorTags).toEqual([]);
  });

  it('returns flavorProfile: null for a brand with no FlavorChart', async () => {
    const result = await getSakeDetails({ brandId: 2 }, pool);
    expect(result.found).toBe(true);
    if (!result.found) throw new Error('expected found');
    expect(result.flavorProfile).toBeNull();
  });

  it('returns { found: false } for an unknown brandId', async () => {
    expect(await getSakeDetails({ brandId: 99999 }, pool)).toEqual({ found: false, brandId: 99999 });
  });
});

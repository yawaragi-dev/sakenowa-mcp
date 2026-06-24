import { execSync } from 'node:child_process';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { searchSakesByName } from './search-sakes-by-name.js';

function dockerAvailable(): boolean {
  try { execSync('docker info', { stdio: 'ignore' }); return true; } catch { return false; }
}
const hasDocker = dockerAvailable();
if (!hasDocker) console.warn('[search-sakes-by-name.integration] SKIPPED: no Docker.');

describe.skipIf(!hasDocker)('search_sakes_by_name (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    await pool.query(`CREATE TABLE areas (area_id int primary key, name text not null)`);
    await pool.query(`CREATE TABLE breweries (brewery_id int primary key, name text not null, name_romaji text, area_id int not null references areas(area_id))`);
    await pool.query(`CREATE TABLE brands (brand_id int primary key, name text not null, name_romaji text, brewery_id int not null references breweries(brewery_id))`);
    await pool.query(`INSERT INTO areas VALUES (15,'新潟県'),(35,'山口県')`);
    await pool.query(`INSERT INTO breweries (brewery_id,name,name_romaji,area_id) VALUES (100,'旭酒造','Asahi Shuzo',35),(200,'朝日酒造','Asahi Shuzo',15)`);
    // name = Sakenowa Japanese name; name_romaji = enrichment. A romaji collision pair (両 "Asahi").
    await pool.query(`INSERT INTO brands (brand_id,name,name_romaji,brewery_id) VALUES
      (1,'獺祭','Dassai',100),(2,'久保田','Kubota',200),
      (3,'朝日','Asahi',100),(4,'旭','Asahi',200),(5,'朝日山','Asahiyama',200),(6,'山旭','Yamaasahi',200)`);
  });
  afterAll(async () => { await pool.end(); await container.stop(); });

  it('matches a romaji query via name_romaji and carries brewery + area', async () => {
    const result = await searchSakesByName({ query: 'dassai' }, pool);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      brandId: 1, name: '獺祭', nameRomaji: 'Dassai',
      brewery: { breweryId: 100, name: '旭酒造', nameRomaji: 'Asahi Shuzo' },
      area: { areaId: 35, name: '山口県' },
    });
  });

  it('matches the Japanese name and ranks prefix before substring', async () => {
    // "asahi" → prefix: 3,4 (Asahi), 5 (Asahiyama); substring-only: 6 (Yamaasahi).
    const ids = (await searchSakesByName({ query: 'asahi' }, pool)).map((s) => s.brandId);
    expect(ids).toEqual([3, 4, 5, 6]);
  });

  it('returns the same-romaji collision pair with distinct breweries', async () => {
    const result = await searchSakesByName({ query: 'asahi' }, pool);
    const a = result.find((s) => s.brandId === 3);
    const b = result.find((s) => s.brandId === 4);
    expect(a?.brewery.breweryId).toBe(100);
    expect(b?.brewery.breweryId).toBe(200);
  });
});

import { execSync } from 'node:child_process';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { searchSakesByName } from './search-sakes-by-name.js';

/**
 * Detect whether a usable Docker daemon is reachable. testcontainers needs one;
 * if it is absent (e.g. local dev without Docker), the whole suite is skipped
 * with an explicit logged reason rather than failing or silently passing. CI
 * (GitHub-hosted runners) has Docker, so this suite runs for real there.
 */
function dockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const hasDocker = dockerAvailable();

if (!hasDocker) {
  console.warn(
    '[search-sakes-by-name.integration] SKIPPED: Docker is not available, so a ' +
      'testcontainers Postgres cannot be started. This suite runs in CI where ' +
      'Docker is present.',
  );
}

describe.skipIf(!hasDocker)('search_sakes_by_name (integration, testcontainers Postgres)', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });

    await pool.query(`
      CREATE TABLE prefectures (
        id          int primary key,
        name_ja     text not null,
        name_romaji text not null
      )
    `);
    await pool.query(`
      CREATE TABLE breweries (
        id            int primary key,
        name_ja       text not null,
        name_romaji   text not null,
        prefecture_id int not null references prefectures(id)
      )
    `);
    await pool.query(`
      CREATE TABLE sakes (
        id          int primary key,
        name_ja     text not null,
        name_romaji text not null,
        brewery_id  int not null references breweries(id)
      )
    `);

    await pool.query(
      `INSERT INTO prefectures (id, name_ja, name_romaji) VALUES
        (15, '新潟県', 'Niigata'),
        (35, '山口県', 'Yamaguchi')`,
    );
    // Two distinct breweries whose romaji collides (旭酒造 / 朝日酒造 both
    // transliterate to "Asahi Shuzo") and live in different prefectures.
    await pool.query(
      `INSERT INTO breweries (id, name_ja, name_romaji, prefecture_id) VALUES
        (100, '旭酒造',   'Asahi Shuzo', 35),
        (200, '朝日酒造', 'Asahi Shuzo', 15),
        (300, '久保田酒造', 'Kubota Brewery', 15)`,
    );
    // Dassai (Yamaguchi), Kubota (Niigata), and a same-romaji colliding pair:
    // two distinct Sakes both romanised "Asahi" from different breweries.
    await pool.query(
      `INSERT INTO sakes (id, name_ja, name_romaji, brewery_id) VALUES
        (1, '獺祭',     'Dassai',     100),
        (2, '久保田',   'Kubota',     300),
        (3, '朝日',     'Asahi',      100),
        (4, '旭',       'Asahi',      200),
        (5, '朝日山',   'Asahiyama',  200)`,
    );
  });

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  it('finds a Sake by its romaji name, carrying brewery + prefecture', async () => {
    const result = await searchSakesByName({ query: 'dassai' }, pool);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 1,
      name_ja: '獺祭',
      name_romaji: 'Dassai',
      brewery: { id: 100, name_ja: '旭酒造', name_romaji: 'Asahi Shuzo' },
      prefecture: { id: 35, name_ja: '山口県', name_romaji: 'Yamaguchi' },
    });
  });

  it('matches case-insensitively on the Japanese name', async () => {
    const result = await searchSakesByName({ query: '久保田' }, pool);

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(2);
    expect(result[0]?.prefecture.name_romaji).toBe('Niigata');
  });

  it('ranks exact-prefix matches ahead of substring-only matches', async () => {
    // "Asahi" is an exact-prefix of sakes 3 & 4 and a substring of 5
    // ("Asahiyama"). Prefix matches sort first; within them, id ASC.
    const result = await searchSakesByName({ query: 'asahi' }, pool);

    const ids = result.map((s) => s.id);
    // 3 and 4 (prefix) precede 5 (substring); 3 before 4 by id.
    expect(ids).toEqual([3, 4, 5]);
  });

  it('returns the same-romaji colliding pair, each with its own brewery + prefecture', async () => {
    const result = await searchSakesByName({ query: 'asahi' }, pool);

    const sake3 = result.find((s) => s.id === 3);
    const sake4 = result.find((s) => s.id === 4);
    expect(sake3?.name_romaji).toBe('Asahi');
    expect(sake4?.name_romaji).toBe('Asahi');
    // Distinct breweries and prefectures disambiguate the collision.
    expect(sake3?.brewery.id).toBe(100);
    expect(sake4?.brewery.id).toBe(200);
    expect(sake3?.prefecture.name_romaji).toBe('Yamaguchi');
    expect(sake4?.prefecture.name_romaji).toBe('Niigata');
  });

  it('returns [] for an empty query', async () => {
    const result = await searchSakesByName({ query: '   ' }, pool);
    expect(result).toEqual([]);
  });

  it('clamps limit above the maximum to 50', async () => {
    const result = await searchSakesByName({ query: 'asahi', limit: 999 }, pool);
    // Only 3 rows match; clamping must not error and must still return them.
    expect(result.map((s) => s.id)).toEqual([3, 4, 5]);
  });
});

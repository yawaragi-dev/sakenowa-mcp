import { execSync } from 'node:child_process';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getTopRanked } from './get-top-ranked.js';

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
    '[get-top-ranked.integration] SKIPPED: Docker is not available, so a ' +
      'testcontainers Postgres cannot be started. This suite runs in CI where ' +
      'Docker is present.',
  );
}

describe.skipIf(!hasDocker)('get_top_ranked (integration, testcontainers Postgres)', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });

    // Slice of the documented schema needed for rankings.
    await pool.query(`
      CREATE TABLE prefectures (
        id          int primary key,
        name_ja     text not null,
        name_romaji text not null
      );
      CREATE TABLE breweries (
        id            int primary key,
        name_ja       text not null,
        name_romaji   text not null,
        prefecture_id int not null references prefectures(id)
      );
      CREATE TABLE sakes (
        id          int primary key,
        name_ja     text not null,
        name_romaji text not null,
        brewery_id  int not null references breweries(id)
      );
      CREATE TABLE rankings (
        scope         text check (scope in ('overall', 'prefecture')),
        prefecture_id int references prefectures(id),
        sake_id       int not null references sakes(id),
        rank          int not null,
        score         numeric,
        year_month    text not null
      );
      -- The spec documents PRIMARY KEY (scope, prefecture_id, sake_id), but a
      -- Postgres PRIMARY KEY column cannot be NULL, and overall rankings carry
      -- prefecture_id = NULL. Enforce the same uniqueness intent with two
      -- partial unique indexes instead — one per scope — which is the shape a
      -- real ingest must use too. The server only reads, so the exact
      -- constraint shape does not affect the query under test.
      CREATE UNIQUE INDEX rankings_overall_uq
        ON rankings (sake_id) WHERE scope = 'overall';
      CREATE UNIQUE INDEX rankings_prefecture_uq
        ON rankings (prefecture_id, sake_id) WHERE scope = 'prefecture';
    `);

    await pool.query(
      `INSERT INTO prefectures (id, name_ja, name_romaji) VALUES
        (15, '新潟県', 'Niigata'),
        (35, '山口県', 'Yamaguchi')`,
    );
    await pool.query(
      `INSERT INTO breweries (id, name_ja, name_romaji, prefecture_id) VALUES
        (100, '朝日酒造', 'Asahi', 15),
        (200, '旭酒造', 'Asahishuzo', 35)`,
    );
    await pool.query(
      `INSERT INTO sakes (id, name_ja, name_romaji, brewery_id) VALUES
        (1, '久保田', 'Kubota', 100),
        (2, '八海山', 'Hakkaisan', 100),
        (3, '獺祭', 'Dassai', 200)`,
    );

    // Overall ranking (rows out of rank order to prove ORDER BY). Prefecture
    // rankings for Niigata (15) and Yamaguchi (35). NULL score on one row
    // exercises the nullable score column.
    await pool.query(
      `INSERT INTO rankings (scope, prefecture_id, sake_id, rank, score, year_month) VALUES
        ('overall', NULL, 2, 2, 88.0, '2026-05'),
        ('overall', NULL, 1, 1, 99.5, '2026-05'),
        ('overall', NULL, 3, 3, NULL, '2026-05'),
        ('prefecture', 15, 1, 1, 99.5, '2026-05'),
        ('prefecture', 15, 2, 2, 88.0, '2026-05'),
        ('prefecture', 35, 3, 1, 95.0, '2026-05')`,
    );
  });

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  it('returns overall-scoped Sakes ordered by rank ASC', async () => {
    const result = await getTopRanked({ scope: 'overall' }, pool);

    expect(result.map((r) => r.sake.id)).toEqual([1, 2, 3]);
    expect(result.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(result[0]?.year_month).toBe('2026-05');
    expect(result[0]?.sake.name_romaji).toBe('Kubota');
    expect(result[0]?.sake.brewery.name_romaji).toBe('Asahi');
    expect(result[0]?.sake.prefecture.name_romaji).toBe('Niigata');
  });

  it('returns prefecture-scoped Sakes for the given prefecture_id', async () => {
    const result = await getTopRanked({ scope: 'prefecture', prefecture_id: 15 }, pool);
    expect(result.map((r) => r.sake.id)).toEqual([1, 2]);
  });

  it('returns [] for scope: prefecture with an unknown prefecture_id', async () => {
    const result = await getTopRanked({ scope: 'prefecture', prefecture_id: 99999 }, pool);
    expect(result).toEqual([]);
  });

  it('ignores a stray prefecture_id on scope: overall', async () => {
    // prefecture_id 35 must not scope the overall query; full overall list returns.
    const result = await getTopRanked({ scope: 'overall', prefecture_id: 35 }, pool);
    expect(result.map((r) => r.sake.id)).toEqual([1, 2, 3]);
  });

  it('clamps limit above 100 down to 100 (does not error)', async () => {
    // Only 3 overall rows exist, so the clamp is observable via no error + all rows.
    const result = await getTopRanked({ scope: 'overall', limit: 500 }, pool);
    expect(result).toHaveLength(3);
  });

  it('respects an explicit small limit', async () => {
    const result = await getTopRanked({ scope: 'overall', limit: 1 }, pool);
    expect(result.map((r) => r.sake.id)).toEqual([1]);
  });
});

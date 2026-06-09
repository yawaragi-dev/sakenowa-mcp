import { execSync } from 'node:child_process';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findSakesByFlavor } from './find-sakes-by-flavor.js';

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
    '[find-sakes-by-flavor.integration] SKIPPED: Docker is not available, so a ' +
      'testcontainers Postgres cannot be started. This suite runs in CI where ' +
      'Docker is present.',
  );
}

describe.skipIf(!hasDocker)('find_sakes_by_flavor (integration, testcontainers Postgres)', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });

    // Slice of the documented schema needed for flavor filtering.
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
      CREATE TABLE flavor_profiles (
        sake_id  int primary key references sakes(id),
        hanayaka numeric,
        hojun    numeric,
        juko     numeric,
        odayaka  numeric,
        dry      numeric,
        keikai   numeric
      );
      CREATE TABLE flavor_tags (
        id      int primary key,
        name_ja text not null
      );
      CREATE TABLE sake_flavor_tags (
        sake_id int references sakes(id),
        tag_id  int references flavor_tags(id),
        primary key (sake_id, tag_id)
      );
    `);

    // Prefecture 0 is the areaId-0 "Other" sentinel; 15 = Niigata, 27 = Osaka.
    await pool.query(
      `INSERT INTO prefectures (id, name_ja, name_romaji) VALUES
        (0, 'その他', 'Other'),
        (15, '新潟県', 'Niigata'),
        (27, '大阪府', 'Osaka')`,
    );
    await pool.query(
      `INSERT INTO breweries (id, name_ja, name_romaji, prefecture_id) VALUES
        (100, '新潟酒造', 'NiigataBrewery', 15),
        (200, '大阪酒造', 'OsakaBrewery', 27),
        (900, '海外酒造', 'ForeignBrewery', 0)`,
    );

    // Sakes:
    //  1 Niigata: tags {12,5}, profile hanayaka 0.8
    //  2 Niigata: tags {12,5,2}, profile hanayaka 0.7
    //  3 Niigata: tags {12}, profile hanayaka 0.9 (only one of the 2-tag set)
    //  4 Osaka:   tags {12,5}, profile hanayaka 0.2
    //  5 areaId-0 sentinel: tags {12,5,2}, profile hanayaka 0.85 (must NEVER appear)
    await pool.query(
      `INSERT INTO sakes (id, name_ja, name_romaji, brewery_id) VALUES
        (1, '酒一', 'SakeOne', 100),
        (2, '酒二', 'SakeTwo', 100),
        (3, '酒三', 'SakeThree', 100),
        (4, '酒四', 'SakeFour', 200),
        (5, '異国', 'Foreign', 900)`,
    );
    await pool.query(
      `INSERT INTO flavor_profiles (sake_id, hanayaka, hojun, juko, odayaka, dry, keikai) VALUES
        (1, 0.8, 0.5, 0.4, 0.3, 0.5, 0.6),
        (2, 0.7, 0.5, 0.4, 0.3, 0.5, 0.6),
        (3, 0.9, 0.5, 0.4, 0.3, 0.5, 0.6),
        (4, 0.2, 0.5, 0.4, 0.3, 0.5, 0.6),
        (5, 0.85, 0.5, 0.4, 0.3, 0.5, 0.6)`,
    );
    await pool.query(
      `INSERT INTO flavor_tags (id, name_ja) VALUES
        (2, '酸味'), (5, '旨味'), (12, '甘味')`,
    );
    await pool.query(
      `INSERT INTO sake_flavor_tags (sake_id, tag_id) VALUES
        (1, 12), (1, 5),
        (2, 12), (2, 5), (2, 2),
        (3, 12),
        (4, 12), (4, 5),
        (5, 12), (5, 5), (5, 2)`,
    );
  });

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  it('narrows correctly: matches a 2-tag intersection but not a 3-tag intersection', async () => {
    // {12,5}: sakes 1, 2, 4 carry both (5 is the sentinel, excluded).
    const two = await findSakesByFlavor({ tags: [12, 5] }, pool);
    expect(two.map((r) => r.sake.id)).toEqual([1, 2, 4]);

    // {12,5,2}: only sake 2 carries all three (5 is the sentinel, excluded).
    const three = await findSakesByFlavor({ tags: [12, 5, 2] }, pool);
    expect(three.map((r) => r.sake.id)).toEqual([2]);
  });

  it('never returns the areaId-0 sentinel Sake, even with no prefecture filter', async () => {
    // An axis filter that the sentinel Sake (hanayaka 0.85) would otherwise pass.
    const result = await findSakesByFlavor({ axes: { hanayaka: { min: 0.5 } } }, pool);
    const ids = result.map((r) => r.sake.id);
    expect(ids).not.toContain(5);
    // 1 (0.8), 2 (0.7), 3 (0.9) qualify; 4 (0.2) does not; 5 is the sentinel.
    expect(ids).toEqual([1, 2, 3]);
  });

  it('filters by an axis range with BETWEEN bounds', async () => {
    // hanayaka in [0.75, 0.85]: sake 1 (0.8) only among the non-sentinel Sakes
    // (3 is 0.9 above max; 2 is 0.7 below min; 5 is the sentinel).
    const result = await findSakesByFlavor(
      { axes: { hanayaka: { min: 0.75, max: 0.85 } } },
      pool,
    );
    expect(result.map((r) => r.sake.id)).toEqual([1]);
    expect(result[0]?.flavor_profile?.hanayaka).toBe(0.8);
  });

  it('combines axis + tags + prefecture with AND semantics and returns full shape', async () => {
    const result = await findSakesByFlavor(
      { axes: { hanayaka: { min: 0.5 } }, tags: [12, 5], prefecture_id: 15 },
      pool,
    );
    // Niigata + both tags + hanayaka >= 0.5: sakes 1 and 2 (3 lacks tag 5; 4 is Osaka).
    expect(result.map((r) => r.sake.id)).toEqual([1, 2]);
    const first = result[0];
    expect(first?.sake.brewery.name_romaji).toBe('NiigataBrewery');
    expect(first?.sake.prefecture.name_romaji).toBe('Niigata');
    expect(first?.flavor_profile?.hanayaka).toBe(0.8);
    expect(first?.flavor_tags.map((t) => t.id)).toEqual([5, 12]);
  });

  it('filters by prefecture alone, excluding other prefectures and the sentinel', async () => {
    const result = await findSakesByFlavor({ prefecture_id: 27 }, pool);
    expect(result.map((r) => r.sake.id)).toEqual([4]);
  });

  it('clamps top_k above 50 down to 50 and defaults to 10', async () => {
    // Only a handful of fixtures, so the clamp does not change the result set
    // here; assert the call succeeds and respects the filter (no crash on a
    // large/oversized top_k).
    const big = await findSakesByFlavor({ tags: [12], top_k: 200 }, pool);
    // tag 12 present on 1,2,3,4 (5 is sentinel).
    expect(big.map((r) => r.sake.id)).toEqual([1, 2, 3, 4]);

    const defaulted = await findSakesByFlavor({ tags: [12] }, pool);
    expect(defaulted.map((r) => r.sake.id)).toEqual([1, 2, 3, 4]);
  });
});

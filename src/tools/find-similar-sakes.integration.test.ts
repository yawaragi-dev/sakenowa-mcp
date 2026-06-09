import { execSync } from 'node:child_process';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findSimilarSakes } from './find-similar-sakes.js';

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
    '[find-similar-sakes.integration] SKIPPED: Docker is not available, so a ' +
      'testcontainers Postgres cannot be started. This suite runs in CI where ' +
      'Docker is present.',
  );
}

describe.skipIf(!hasDocker)('find_similar_sakes (integration, testcontainers Postgres)', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });

    // Minimal slice of the documented schema needed for similarity ranking.
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
    `);

    await pool.query(
      `INSERT INTO prefectures (id, name_ja, name_romaji) VALUES (15, '新潟県', 'Niigata')`,
    );
    await pool.query(
      `INSERT INTO breweries (id, name_ja, name_romaji, prefecture_id) VALUES (100, '酒蔵', 'Kura', 15)`,
    );

    // Five Sakes; #6 deliberately has NO FlavorProfile row (must be excluded).
    await pool.query(
      `INSERT INTO sakes (id, name_ja, name_romaji, brewery_id) VALUES
        (1, '源酒', 'Source', 100),
        (2, '相似', 'NearIdentical', 100),
        (3, '直交', 'Orthogonal', 100),
        (4, '逆相', 'Negative', 100),
        (5, '部分', 'Partial', 100),
        (6, '無味', 'NoProfile', 100)`,
    );

    // FlavorProfiles (no row for Sake 6). Cosine of each against Sake 1
    // (1,1,0,0,0,0) is hand-computed:
    //   #2 (0.9,1.0,0.05,0,0,0) → 0.99793  (near-identical)
    //   #5 (1,0,0,0,0,0)        → 0.70711  (partial overlap)
    //   #3 (0,0,1,1,0,0)        → 0.0      (orthogonal)
    //   #4 (-1,1,0,0,0,0)       → 0.0      (negative on hanayaka)
    // Expected top-3 of Sake 1: [2, 5, 3] (the 0.0 tie between 3 and 4
    // breaks by sake.id ASC → 3 ahead of 4).
    await pool.query(
      `INSERT INTO flavor_profiles (sake_id, hanayaka, hojun, juko, odayaka, dry, keikai) VALUES
        (1,  1.0, 1.0, 0.0,  0.0, 0.0, 0.0),
        (2,  0.9, 1.0, 0.05, 0.0, 0.0, 0.0),
        (3,  0.0, 0.0, 1.0,  1.0, 0.0, 0.0),
        (4, -1.0, 1.0, 0.0,  0.0, 0.0, 0.0),
        (5,  1.0, 0.0, 0.0,  0.0, 0.0, 0.0)`,
    );
  });

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  it('ranks the top-3 nearest neighbours of Sake 1 as [2, 5, 3]', async () => {
    const result = await findSimilarSakes({ sake_id: 1, top_k: 3 }, pool);

    expect(result.map((r) => r.sake.id)).toEqual([2, 5, 3]);
    expect(result[0]?.similarity).toBeCloseTo(0.99793, 4);
    expect(result[1]?.similarity).toBeCloseTo(1 / Math.sqrt(2), 6);
    expect(result[2]?.similarity).toBeCloseTo(0, 10);

    // Similarity is in [0, 1].
    for (const r of result) {
      expect(r.similarity).toBeGreaterThanOrEqual(0);
      expect(r.similarity).toBeLessThanOrEqual(1);
    }

    // Full nested shape is carried through.
    expect(result[0]?.sake.name_romaji).toBe('NearIdentical');
    expect(result[0]?.sake.brewery.name_romaji).toBe('Kura');
    expect(result[0]?.sake.prefecture.name_romaji).toBe('Niigata');
    expect(result[0]?.flavor_profile.hojun).toBe(1);
  });

  it('excludes the source Sake from its own results', async () => {
    const result = await findSimilarSakes({ sake_id: 1, top_k: 50 }, pool);
    expect(result.map((r) => r.sake.id)).not.toContain(1);
  });

  it('excludes Sakes that have no FlavorProfile row (Sake 6)', async () => {
    const result = await findSimilarSakes({ sake_id: 1, top_k: 50 }, pool);
    expect(result.map((r) => r.sake.id)).not.toContain(6);
    // 5 Sakes total, minus the source (1) and the profile-less one (6) = 4.
    expect(result).toHaveLength(4);
  });

  it('returns [] for an unknown sake_id', async () => {
    const result = await findSimilarSakes({ sake_id: 99999 }, pool);
    expect(result).toEqual([]);
  });

  it('returns [] when the source Sake has no FlavorProfile', async () => {
    const result = await findSimilarSakes({ sake_id: 6 }, pool);
    expect(result).toEqual([]);
  });
});

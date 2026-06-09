import { execSync } from 'node:child_process';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSakeDetails } from './get-sake-details.js';

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
    '[get-sake-details.integration] SKIPPED: Docker is not available, so a ' +
      'testcontainers Postgres cannot be started. This suite runs in CI where ' +
      'Docker is present.',
  );
}

describe.skipIf(!hasDocker)('get_sake_details (integration, testcontainers Postgres)', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });

    // Slice of the documented schema needed for sake details.
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

    await pool.query(
      `INSERT INTO prefectures (id, name_ja, name_romaji) VALUES (15, '新潟県', 'Niigata')`,
    );
    await pool.query(
      `INSERT INTO breweries (id, name_ja, name_romaji, prefecture_id) VALUES (100, '旭酒造', 'Asahi', 15)`,
    );

    // Sake 1: full (profile + tags). Sake 2: no FlavorProfile. Sake 3: no tags.
    await pool.query(
      `INSERT INTO sakes (id, name_ja, name_romaji, brewery_id) VALUES
        (1, '獺祭', 'Dassai', 100),
        (2, '無香', 'NoProfile', 100),
        (3, '無印', 'NoTags', 100)`,
    );
    await pool.query(
      `INSERT INTO flavor_profiles (sake_id, hanayaka, hojun, juko, odayaka, dry, keikai) VALUES
        (1, 0.8, 0.6, 0.4, 0.3, 0.5, 0.7),
        (3, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6)`,
    );
    await pool.query(
      `INSERT INTO flavor_tags (id, name_ja) VALUES (12, '甘味'), (5, '旨味')`,
    );
    await pool.query(
      `INSERT INTO sake_flavor_tags (sake_id, tag_id) VALUES (1, 12), (1, 5)`,
    );
  });

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  it('returns the full nested Sake, FlavorProfile and FlavorTags for a known id', async () => {
    const result = await getSakeDetails({ sake_id: 1 }, pool);

    expect(result.found).toBe(true);
    if (!result.found) throw new Error('expected found');
    expect(result.sake.name_romaji).toBe('Dassai');
    expect(result.sake.brewery.name_romaji).toBe('Asahi');
    expect(result.sake.prefecture.name_romaji).toBe('Niigata');
    expect(result.flavor_profile).toEqual({
      hanayaka: 0.8,
      hojun: 0.6,
      juko: 0.4,
      odayaka: 0.3,
      dry: 0.5,
      keikai: 0.7,
    });
    // Ordered by tag id ASC.
    expect(result.flavor_tags).toEqual([
      { id: 5, name_ja: '旨味' },
      { id: 12, name_ja: '甘味' },
    ]);
  });

  it('returns flavor_profile: null when the Sake has no FlavorProfile row', async () => {
    const result = await getSakeDetails({ sake_id: 2 }, pool);
    expect(result.found).toBe(true);
    if (!result.found) throw new Error('expected found');
    expect(result.flavor_profile).toBeNull();
    expect(result.flavor_tags).toEqual([]);
  });

  it('returns flavor_tags: [] when the Sake has no tags', async () => {
    const result = await getSakeDetails({ sake_id: 3 }, pool);
    expect(result.found).toBe(true);
    if (!result.found) throw new Error('expected found');
    expect(result.flavor_tags).toEqual([]);
    expect(result.flavor_profile?.keikai).toBe(0.6);
  });

  it('returns { found: false, sake_id } for an unknown id', async () => {
    const result = await getSakeDetails({ sake_id: 99999 }, pool);
    expect(result).toEqual({ found: false, sake_id: 99999 });
  });
});

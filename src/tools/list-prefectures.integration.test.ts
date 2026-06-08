import { execSync } from 'node:child_process';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listPrefectures } from './list-prefectures.js';

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
    '[list-prefectures.integration] SKIPPED: Docker is not available, so a ' +
      'testcontainers Postgres cannot be started. This suite runs in CI where ' +
      'Docker is present.',
  );
}

describe.skipIf(!hasDocker)('list_prefectures (integration, testcontainers Postgres)', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });

    // Seed a prefectures fixture INCLUDING the areaId-0 "Other" sentinel.
    await pool.query(`
      CREATE TABLE prefectures (
        id          int primary key,
        name_ja     text not null,
        name_romaji text not null
      )
    `);
    await pool.query(
      `INSERT INTO prefectures (id, name_ja, name_romaji) VALUES
        (0,  'その他', 'Other'),
        (1,  '北海道', 'Hokkaido'),
        (15, '新潟県', 'Niigata'),
        (47, '沖縄県', 'Okinawa')`,
    );
  });

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  it('excludes the areaId-0 sentinel and includes Okinawa (id 47)', async () => {
    const result = await listPrefectures({}, pool);

    const ids = result.map((p) => p.id);
    expect(ids).not.toContain(0);
    expect(ids).toContain(47);

    // Ordered by id ascending.
    expect(ids).toEqual([...ids].sort((a, b) => a - b));

    const okinawa = result.find((p) => p.id === 47);
    expect(okinawa).toEqual({ id: 47, name_ja: '沖縄県', name_romaji: 'Okinawa' });
  });
});

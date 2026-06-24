import { execSync } from 'node:child_process';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listPrefectures } from './list-prefectures.js';

function dockerAvailable(): boolean {
  try { execSync('docker info', { stdio: 'ignore' }); return true; } catch { return false; }
}
const hasDocker = dockerAvailable();
if (!hasDocker) console.warn('[list-prefectures.integration] SKIPPED: no Docker.');

describe.skipIf(!hasDocker)('list_prefectures (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    await pool.query(`CREATE TABLE areas (area_id int primary key, name text not null)`);
    await pool.query(
      `INSERT INTO areas (area_id, name) VALUES (0,'その他'),(1,'北海道'),(15,'新潟県'),(47,'沖縄県')`,
    );
  });
  afterAll(async () => { await pool.end(); await container.stop(); });

  it('excludes the areaId-0 sentinel and includes Okinawa (47)', async () => {
    const result = await listPrefectures({}, pool);
    const ids = result.map((p) => p.areaId);
    expect(ids).not.toContain(0);
    expect(ids).toContain(47);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(result.find((p) => p.areaId === 47)).toEqual({ areaId: 47, name: '沖縄県' });
  });
});

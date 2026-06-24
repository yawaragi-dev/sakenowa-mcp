import { describe, expect, it } from 'vitest';
import type { Db } from '../db.js';
import { listPrefectures } from './list-prefectures.js';

describe('listPrefectures', () => {
  it('maps area rows into { areaId, name }', async () => {
    const stub: Db = {
      query: <R>() =>
        Promise.resolve({
          rows: [
            { area_id: 1, name: '北海道' },
            { area_id: 47, name: '沖縄県' },
          ] as R[],
        }),
    };
    const result = await listPrefectures({}, stub);
    expect(result).toEqual([
      { areaId: 1, name: '北海道' },
      { areaId: 47, name: '沖縄県' },
    ]);
  });

  it('rejects rows missing the canonical columns', async () => {
    const stub: Db = { query: <R>() => Promise.resolve({ rows: [{ id: 1 }] as R[] }) };
    await expect(listPrefectures({}, stub)).rejects.toThrow();
  });
});

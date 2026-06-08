import { describe, expect, it } from 'vitest';
import type { Db } from '../db.js';
import { listPrefectures } from './list-prefectures.js';

describe('listPrefectures', () => {
  it('returns prefectures in the expected shape from a stubbed Db', async () => {
    const stub: Db = {
      query: <R>(sql: string) => {
        expect(sql).toContain('FROM prefectures');
        expect(sql).toContain('id <> 0');
        expect(sql).toContain('ORDER BY id');
        const rows = [
          { id: 1, name_ja: '北海道', name_romaji: 'Hokkaido' },
          { id: 47, name_ja: '沖縄県', name_romaji: 'Okinawa' },
        ];
        return Promise.resolve({ rows: rows as R[] });
      },
    };

    const result = await listPrefectures({}, stub);

    expect(result).toEqual([
      { id: 1, name_ja: '北海道', name_romaji: 'Hokkaido' },
      { id: 47, name_ja: '沖縄県', name_romaji: 'Okinawa' },
    ]);
  });

  it('rejects rows that do not match the Prefecture schema', async () => {
    const stub: Db = {
      query: <R>() => Promise.resolve({ rows: [{ id: 'oops' }] as R[] }),
    };

    await expect(listPrefectures({}, stub)).rejects.toThrow();
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../db.js';
import type { SakeJoinRow } from './sake-query.js';
import { DEFAULT_LIMIT, MAX_LIMIT, searchSakesByName } from './search-sakes-by-name.js';

function row(overrides: Partial<SakeJoinRow> & Pick<SakeJoinRow, 'brand_id'>): SakeJoinRow {
  return {
    name: '獺祭',
    name_romaji: 'Dassai',
    brewery_id: 100,
    brewery_name: '旭酒造',
    brewery_name_romaji: 'Asahi Shuzo',
    area_id: 35,
    area_name: '山口県',
    ...overrides,
  };
}

describe('searchSakesByName', () => {
  it('returns [] for an empty query without touching the Db', async () => {
    const query = vi.fn();
    const result = await searchSakesByName({ query: '   ' }, { query });
    expect(result).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('maps a match into the nested canonical Sake shape', async () => {
    const stub: Db = { query: <R>() => Promise.resolve({ rows: [row({ brand_id: 1 })] as R[] }) };
    const result = await searchSakesByName({ query: 'dassai' }, stub);
    expect(result).toEqual([
      {
        brandId: 1,
        name: '獺祭',
        nameRomaji: 'Dassai',
        brewery: { breweryId: 100, name: '旭酒造', nameRomaji: 'Asahi Shuzo' },
        area: { areaId: 35, name: '山口県' },
      },
    ]);
  });

  it('carries a null nameRomaji through (unenriched mirror)', async () => {
    const stub: Db = {
      query: <R>() =>
        Promise.resolve({ rows: [row({ brand_id: 2, name_romaji: null, brewery_name_romaji: null })] as R[] }),
    };
    const [sake] = await searchSakesByName({ query: 'x' }, stub);
    expect(sake?.nameRomaji).toBeNull();
    expect(sake?.brewery.nameRomaji).toBeNull();
  });

  it('passes default limit when omitted and clamps above the max', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await searchSakesByName({ query: 'k' }, { query });
    await searchSakesByName({ query: 'k', limit: 999 }, { query });
    const last = (calls: number) => (query.mock.calls[calls]?.[1] as unknown[]).at(-1);
    expect(last(0)).toBe(DEFAULT_LIMIT);
    expect(last(1)).toBe(MAX_LIMIT);
  });
});

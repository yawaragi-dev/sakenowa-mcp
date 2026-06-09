import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../db.js';
import type { SakeJoinRow } from './sake-query.js';
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  searchSakesByName,
} from './search-sakes-by-name.js';

/** Build a flat join row with sensible defaults for the fields under test. */
function row(overrides: Partial<SakeJoinRow> & Pick<SakeJoinRow, 'id'>): SakeJoinRow {
  return {
    name_ja: '獺祭',
    name_romaji: 'Dassai',
    brewery_id: 100,
    brewery_name_ja: '旭酒造',
    brewery_name_romaji: 'Asahi Shuzo',
    prefecture_id: 35,
    prefecture_name_ja: '山口県',
    prefecture_name_romaji: 'Yamaguchi',
    ...overrides,
  };
}

describe('searchSakesByName', () => {
  it('returns [] for an empty query without touching the Db', async () => {
    const query = vi.fn();
    const stub: Db = { query };

    const result = await searchSakesByName({ query: '' }, stub);

    expect(result).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns [] for a whitespace-only query without touching the Db', async () => {
    const query = vi.fn();
    const stub: Db = { query };

    const result = await searchSakesByName({ query: '   ' }, stub);

    expect(result).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('maps a single match into the nested Sake shape', async () => {
    const stub: Db = {
      query: <R>() => Promise.resolve({ rows: [row({ id: 1 })] as R[] }),
    };

    const result = await searchSakesByName({ query: 'dassai' }, stub);

    expect(result).toEqual([
      {
        id: 1,
        name_ja: '獺祭',
        name_romaji: 'Dassai',
        brewery: { id: 100, name_ja: '旭酒造', name_romaji: 'Asahi Shuzo' },
        prefecture: { id: 35, name_ja: '山口県', name_romaji: 'Yamaguchi' },
      },
    ]);
  });

  it('returns every matching row, each fully shaped', async () => {
    const stub: Db = {
      query: <R>() =>
        Promise.resolve({
          rows: [
            row({ id: 1, name_romaji: 'Dassai' }),
            row({
              id: 2,
              name_ja: '朝日',
              name_romaji: 'Dassai',
              brewery_id: 200,
              brewery_name_ja: '朝日酒造',
              brewery_name_romaji: 'Asahi Shuzo',
            }),
          ] as R[],
        }),
    };

    const result = await searchSakesByName({ query: 'dassai' }, stub);

    expect(result).toHaveLength(2);
    expect(result.map((s) => s.id)).toEqual([1, 2]);
    // The colliding pair keep their own distinct breweries.
    expect(result[0]?.brewery.id).toBe(100);
    expect(result[1]?.brewery.id).toBe(200);
  });

  it('passes the default limit through when none is supplied', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const stub: Db = { query };

    await searchSakesByName({ query: 'kubota' }, stub);

    const params = query.mock.calls[0]?.[1] as unknown[];
    expect(params[params.length - 1]).toBe(DEFAULT_LIMIT);
  });

  it('clamps limits above the maximum down to the ceiling', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const stub: Db = { query };

    await searchSakesByName({ query: 'kubota', limit: 999 }, stub);

    const params = query.mock.calls[0]?.[1] as unknown[];
    expect(params[params.length - 1]).toBe(MAX_LIMIT);
  });

  it('passes a smaller limit through unchanged', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const stub: Db = { query };

    await searchSakesByName({ query: 'kubota', limit: 3 }, stub);

    const params = query.mock.calls[0]?.[1] as unknown[];
    expect(params[params.length - 1]).toBe(3);
  });

  it('rejects rows that do not match the Sake schema', async () => {
    const stub: Db = {
      query: <R>() => Promise.resolve({ rows: [{ id: 'oops' }] as R[] }),
    };

    await expect(searchSakesByName({ query: 'x' }, stub)).rejects.toThrow();
  });
});

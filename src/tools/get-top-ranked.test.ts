import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../db.js';
import { GetTopRankedInputSchema, getTopRanked } from './get-top-ranked.js';

function rankedDb(rows: { brandId: number; rank: number }[]): Db {
  return {
    query: <R>(_sql: string, params?: unknown[]) => {
      const limit = params?.[0] as number;
      return Promise.resolve({
        rows: rows.slice(0, limit).map((r) => ({
          brand_id: r.brandId, name: `s${String(r.brandId)}`, name_romaji: null,
          brewery_id: r.brandId * 10, brewery_name: 'b', brewery_name_romaji: null,
          area_id: 15, area_name: '新潟県', rank: r.rank,
        })) as R[],
      });
    },
  };
}

describe('GetTopRankedInputSchema', () => {
  it("requires areaId when scope is 'area'", () => {
    expect(GetTopRankedInputSchema.safeParse({ scope: 'area' }).success).toBe(false);
    expect(GetTopRankedInputSchema.safeParse({ scope: 'area', areaId: 15 }).success).toBe(true);
    expect(GetTopRankedInputSchema.safeParse({ scope: 'overall' }).success).toBe(true);
  });
});

describe('getTopRanked', () => {
  it('returns overall ranked brands with rank, ordered as given', async () => {
    const result = await getTopRanked(
      { scope: 'overall' },
      rankedDb([{ brandId: 5, rank: 1 }, { brandId: 9, rank: 2 }]),
    );
    expect(result.map((r) => [r.sake.brandId, r.rank])).toEqual([
      [5, 1],
      [9, 2],
    ]);
  });

  it("passes areaId for scope 'area'", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await getTopRanked({ scope: 'area', areaId: 27 }, { query });
    expect(query.mock.calls[0]?.[1]).toEqual([10, 27]);
  });

  it('clamps limit above 100', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await getTopRanked({ scope: 'overall', limit: 999 }, { query });
    expect((query.mock.calls[0]?.[1] as unknown[])[0]).toBe(100);
  });
});

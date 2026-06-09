import { describe, expect, it } from 'vitest';
import type { Db } from '../db.js';
import { GetTopRankedInputSchema, getTopRanked } from './get-top-ranked.js';

/*
 * Unit tests against a stubbed Db. The stub holds Ranking fixtures and applies
 * the SAME contract the SQL enforces (filter by scope and — for prefecture
 * scope — prefecture_id; order by rank ASC; LIMIT). Tests assert the ranking
 * and shape the function produces, plus the input-schema constraints, not the
 * SQL string sent — matching the S1/S2/S5 style.
 */

interface RankFixture {
  sake_id: number;
  name_romaji: string;
  scope: 'overall' | 'prefecture';
  prefecture_id: number | null;
  rank: number;
  year_month: string;
}

/**
 * Build a Db stub backed by Ranking fixtures. Distinguishes the overall query
 * (one param: [limit]) from the prefecture query (two params: [limit,
 * prefecture_id]) by SQL content, mirroring how the two statements are shaped.
 */
function fixtureDb(fixtures: RankFixture[]): Db {
  return {
    query: <R>(sql: string, params?: unknown[]) => {
      const isPrefecture = sql.includes("scope = 'prefecture'");
      const limit = params?.[0] as number;
      const prefectureId = params?.[1] as number | undefined;

      const matched = fixtures
        .filter((f) =>
          isPrefecture
            ? f.scope === 'prefecture' && f.prefecture_id === prefectureId
            : f.scope === 'overall',
        )
        .sort((a, b) => a.rank - b.rank)
        .slice(0, limit)
        .map((f) => ({
          id: f.sake_id,
          name_ja: `${f.name_romaji}_ja`,
          name_romaji: f.name_romaji,
          brewery_id: f.sake_id * 10,
          brewery_name_ja: `B${String(f.sake_id)}_ja`,
          brewery_name_romaji: `B${String(f.sake_id)}`,
          prefecture_id: f.prefecture_id ?? 15,
          prefecture_name_ja: '新潟県',
          prefecture_name_romaji: 'Niigata',
          rank: f.rank,
          year_month: f.year_month,
        }));

      return Promise.resolve({ rows: matched as R[] });
    },
  };
}

const overall = (sake_id: number, name_romaji: string, rank: number): RankFixture => ({
  sake_id,
  name_romaji,
  scope: 'overall',
  prefecture_id: null,
  rank,
  year_month: '2026-05',
});

const pref = (
  sake_id: number,
  name_romaji: string,
  prefecture_id: number,
  rank: number,
): RankFixture => ({
  sake_id,
  name_romaji,
  scope: 'prefecture',
  prefecture_id,
  rank,
  year_month: '2026-05',
});

describe('GetTopRankedInputSchema', () => {
  it('rejects scope: prefecture without a prefecture_id', () => {
    const parsed = GetTopRankedInputSchema.safeParse({ scope: 'prefecture' });
    expect(parsed.success).toBe(false);
  });

  it('accepts scope: prefecture with a prefecture_id', () => {
    const parsed = GetTopRankedInputSchema.safeParse({ scope: 'prefecture', prefecture_id: 15 });
    expect(parsed.success).toBe(true);
  });

  it('accepts scope: overall with no prefecture_id', () => {
    const parsed = GetTopRankedInputSchema.safeParse({ scope: 'overall' });
    expect(parsed.success).toBe(true);
  });

  it('accepts scope: overall with a stray prefecture_id (ignored downstream)', () => {
    const parsed = GetTopRankedInputSchema.safeParse({ scope: 'overall', prefecture_id: 15 });
    expect(parsed.success).toBe(true);
  });
});

describe('getTopRanked', () => {
  it('returns overall-scoped Sakes ordered by rank ASC', async () => {
    const db = fixtureDb([
      overall(2, 'Second', 2),
      overall(1, 'First', 1),
      overall(3, 'Third', 3),
      pref(9, 'PrefOnly', 15, 1),
    ]);

    const result = await getTopRanked({ scope: 'overall' }, db);

    expect(result.map((r) => r.sake.id)).toEqual([1, 2, 3]);
    expect(result.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(result[0]?.year_month).toBe('2026-05');
    // Full nested shape carried through.
    expect(result[0]?.sake.brewery.id).toBe(10);
    expect(result[0]?.sake.prefecture.name_romaji).toBe('Niigata');
  });

  it('returns prefecture-scoped Sakes for the given prefecture_id', async () => {
    const db = fixtureDb([
      pref(1, 'NiigataTop', 15, 1),
      pref(2, 'NiigataTwo', 15, 2),
      pref(3, 'YamaguchiTop', 35, 1),
      overall(9, 'OverallOnly', 1),
    ]);

    const result = await getTopRanked({ scope: 'prefecture', prefecture_id: 15 }, db);

    expect(result.map((r) => r.sake.id)).toEqual([1, 2]);
  });

  it('returns [] for scope: prefecture with an unknown prefecture_id', async () => {
    const db = fixtureDb([pref(1, 'NiigataTop', 15, 1)]);

    const result = await getTopRanked({ scope: 'prefecture', prefecture_id: 99999 }, db);

    expect(result).toEqual([]);
  });

  it('ignores a stray prefecture_id on scope: overall', async () => {
    const db = fixtureDb([
      overall(1, 'OverallOne', 1),
      pref(5, 'PrefOnly', 15, 1),
    ]);

    // prefecture_id 15 must NOT scope the overall query to prefecture rows.
    const result = await getTopRanked({ scope: 'overall', prefecture_id: 15 }, db);

    expect(result.map((r) => r.sake.id)).toEqual([1]);
  });

  it('defaults limit to 10 and clamps requests above 100 down to 100', async () => {
    const passedLimits: number[] = [];
    const recordingDb: Db = {
      query: <R>(_sql: string, params?: unknown[]) => {
        passedLimits.push(params?.[0] as number);
        return Promise.resolve({ rows: [] as R[] });
      },
    };

    await getTopRanked({ scope: 'overall' }, recordingDb);
    await getTopRanked({ scope: 'overall', limit: 500 }, recordingDb);
    await getTopRanked({ scope: 'overall', limit: 7 }, recordingDb);

    expect(passedLimits).toEqual([10, 100, 7]);
  });

  it('carries exactly sake + rank + year_month per result (no score leak)', async () => {
    const db = fixtureDb([overall(1, 'Only', 1)]);
    const result = await getTopRanked({ scope: 'overall' }, db);
    expect(Object.keys(result[0] ?? {}).sort()).toEqual(['rank', 'sake', 'year_month']);
  });
});

import { describe, expect, it } from 'vitest';
import type { Db } from '../db.js';
import { FLAVOR_AXES } from './flavor-profile.js';
import { findSimilarSakes } from './find-similar-sakes.js';

/*
 * These unit tests exercise the query function against a stubbed Db. The stub
 * is a tiny in-memory Postgres analogue: it stores a FlavorProfile fixture and,
 * for the similarity query, computes cosine in JS applying the SAME contract
 * the SQL enforces (exclude the source, exclude profile-less Sakes, order by
 * similarity DESC then id ASC, LIMIT top_k). This keeps the tests behaviour-
 * focused — we assert the RANKING and shape the function produces, not the SQL
 * string it sends (matching the S1 style in list-prefectures.test.ts).
 */

type Vec = Record<(typeof FLAVOR_AXES)[number], number>;

interface Fixture {
  id: number;
  name: string;
  profile: Vec | null; // null = Sake without a FlavorProfile row
}

/**
 * Build a Db stub backed by a FlavorProfile fixture. The first query is treated
 * as the source-profile lookup (params: [sake_id]); the second as the
 * similarity ranking (params: [...6 axes, sourceId, topK]).
 */
function fixtureDb(fixtures: Fixture[]): Db {
  let call = 0;
  return {
    query: <R>(_sql: string, params?: unknown[]) => {
      call += 1;
      if (call === 1) {
        // Source-profile lookup by sake_id.
        const sakeId = params?.[0] as number;
        const found = fixtures.find((f) => f.id === sakeId && f.profile !== null);
        const rows = found?.profile ? [found.profile] : [];
        return Promise.resolve({ rows: rows as R[] });
      }

      // Similarity ranking.
      const source: Vec = {
        hanayaka: params?.[0] as number,
        hojun: params?.[1] as number,
        juko: params?.[2] as number,
        odayaka: params?.[3] as number,
        dry: params?.[4] as number,
        keikai: params?.[5] as number,
      };
      const sourceId = params?.[6] as number;
      const topK = params?.[7] as number;

      const srcMag = Math.sqrt(
        FLAVOR_AXES.reduce((acc, axis) => acc + source[axis] * source[axis], 0),
      );

      const scored = fixtures
        .filter((f) => f.id !== sourceId && f.profile !== null)
        .map((f) => {
          const profile = f.profile as Vec;
          const otherMag = Math.sqrt(
            FLAVOR_AXES.reduce((acc, axis) => acc + profile[axis] * profile[axis], 0),
          );
          const dot = FLAVOR_AXES.reduce(
            (acc, axis) => acc + source[axis] * profile[axis],
            0,
          );
          const denom = srcMag * otherMag;
          // NULLIF guard: zero-magnitude → NULL → row dropped.
          const similarity = denom === 0 ? null : dot / denom;
          return { f, profile, similarity };
        })
        .filter((r): r is { f: Fixture; profile: Vec; similarity: number } =>
          r.similarity !== null,
        )
        .sort((x, y) => y.similarity - x.similarity || x.f.id - y.f.id)
        .slice(0, topK)
        .map((r) => ({
          sake_id: r.f.id,
          sake_name_ja: `${r.f.name}_ja`,
          sake_name_romaji: r.f.name,
          brewery_id: r.f.id * 10,
          brewery_name_ja: `B${String(r.f.id)}_ja`,
          brewery_name_romaji: `B${String(r.f.id)}`,
          prefecture_id: 15,
          prefecture_name_ja: '新潟県',
          prefecture_name_romaji: 'Niigata',
          ...r.profile,
          similarity: r.similarity,
        }));

      return Promise.resolve({ rows: scored as R[] });
    },
  };
}

const v = (
  hanayaka: number,
  hojun: number,
  juko: number,
  odayaka: number,
  dry: number,
  keikai: number,
): Vec => ({ hanayaka, hojun, juko, odayaka, dry, keikai });

describe('findSimilarSakes', () => {
  it('ranks by cosine similarity against a hand-computed 3-sake fixture', async () => {
    // Source #1: (1,0,0,0,0,0).
    // #2 identical direction (2,0,0,0,0,0) → cosine 1.0.
    // #3 (1,1,0,0,0,0) → cosine 1/sqrt(2) ≈ 0.7071.
    const db = fixtureDb([
      { id: 1, name: 'source', profile: v(1, 0, 0, 0, 0, 0) },
      { id: 2, name: 'identical', profile: v(2, 0, 0, 0, 0, 0) },
      { id: 3, name: 'diagonal', profile: v(1, 1, 0, 0, 0, 0) },
    ]);

    const result = await findSimilarSakes({ sake_id: 1 }, db);

    expect(result.map((r) => r.sake.id)).toEqual([2, 3]);
    expect(result[0]?.similarity).toBeCloseTo(1, 10);
    expect(result[1]?.similarity).toBeCloseTo(1 / Math.sqrt(2), 10);
    // Full shape carried through.
    expect(result[0]?.sake.brewery.id).toBe(20);
    expect(result[0]?.sake.prefecture.name_romaji).toBe('Niigata');
    expect(result[0]?.flavor_profile).toEqual(v(2, 0, 0, 0, 0, 0));
  });

  it('excludes the source Sake from its own results', async () => {
    const db = fixtureDb([
      { id: 1, name: 'source', profile: v(1, 1, 1, 0, 0, 0) },
      { id: 2, name: 'other', profile: v(0, 1, 1, 0, 0, 0) },
    ]);

    const result = await findSimilarSakes({ sake_id: 1 }, db);

    expect(result.map((r) => r.sake.id)).not.toContain(1);
    expect(result.map((r) => r.sake.id)).toEqual([2]);
  });

  it('excludes Sakes without a FlavorProfile from the comparison', async () => {
    const db = fixtureDb([
      { id: 1, name: 'source', profile: v(1, 0, 0, 0, 0, 0) },
      { id: 2, name: 'has-profile', profile: v(1, 0, 0, 0, 0, 0) },
      { id: 3, name: 'no-profile', profile: null },
    ]);

    const result = await findSimilarSakes({ sake_id: 1 }, db);

    expect(result.map((r) => r.sake.id)).toEqual([2]);
  });

  it('returns [] when the source sake_id matches no FlavorProfile row', async () => {
    const db = fixtureDb([{ id: 1, name: 'source', profile: v(1, 0, 0, 0, 0, 0) }]);

    const result = await findSimilarSakes({ sake_id: 99999 }, db);

    expect(result).toEqual([]);
  });

  it('returns [] when the source Sake exists but has no FlavorProfile', async () => {
    const db = fixtureDb([
      { id: 1, name: 'source-no-profile', profile: null },
      { id: 2, name: 'other', profile: v(1, 0, 0, 0, 0, 0) },
    ]);

    const result = await findSimilarSakes({ sake_id: 1 }, db);

    expect(result).toEqual([]);
  });

  it('defaults top_k to 10 and clamps requests above 50 down to 50', async () => {
    const passedTopK: number[] = [];
    const recordingDb: Db = {
      query: <R>(_sql: string, params?: unknown[]) => {
        // Only the similarity query carries 8 params; record its top_k.
        if (params && params.length === 8) {
          passedTopK.push(params[7] as number);
        }
        // First call: source profile present so we proceed to the 2nd query.
        if (params && params.length === 1) {
          return Promise.resolve({
            rows: [v(1, 0, 0, 0, 0, 0)] as R[],
          });
        }
        return Promise.resolve({ rows: [] as R[] });
      },
    };

    await findSimilarSakes({ sake_id: 1 }, recordingDb);
    await findSimilarSakes({ sake_id: 1, top_k: 200 }, recordingDb);
    await findSimilarSakes({ sake_id: 1, top_k: 3 }, recordingDb);

    expect(passedTopK).toEqual([10, 50, 3]);
  });

  it('returns [] (no NaN rows) when the source FlavorProfile is all-zero', async () => {
    // A zero-magnitude source vector makes every cosine denominator zero; the
    // SQL NULLIF guard turns those into NULL and the rows are dropped. The
    // fixture stub mirrors that, so we expect an empty result, never NaN.
    const db = fixtureDb([
      { id: 1, name: 'zero-source', profile: v(0, 0, 0, 0, 0, 0) },
      { id: 2, name: 'other', profile: v(1, 0, 0, 0, 0, 0) },
    ]);

    const result = await findSimilarSakes({ sake_id: 1 }, db);
    expect(result).toEqual([]);
  });

  it('clamps a slightly-out-of-range similarity into [0, 1]', async () => {
    // Force the stub to emit a similarity microscopically above 1 (FP rounding
    // analogue) and verify the output schema accepts it after clamping.
    const db: Db = {
      query: <R>(_sql: string, params?: unknown[]) => {
        if (params && params.length === 1) {
          return Promise.resolve({ rows: [v(1, 0, 0, 0, 0, 0)] as R[] });
        }
        return Promise.resolve({
          rows: [
            {
              sake_id: 2,
              sake_name_ja: 'x_ja',
              sake_name_romaji: 'x',
              brewery_id: 20,
              brewery_name_ja: 'b_ja',
              brewery_name_romaji: 'b',
              prefecture_id: 15,
              prefecture_name_ja: '新潟県',
              prefecture_name_romaji: 'Niigata',
              ...v(1, 0, 0, 0, 0, 0),
              similarity: 1.0000000002,
            },
          ] as R[],
        });
      },
    };

    const result = await findSimilarSakes({ sake_id: 1 }, db);
    expect(result[0]?.similarity).toBe(1);
  });
});

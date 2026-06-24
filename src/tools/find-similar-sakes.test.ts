import { describe, expect, it } from 'vitest';
import type { Db } from '../db.js';
import { FLAVOR_AXES } from './flavor-profile.js';
import { findSimilarSakes } from './find-similar-sakes.js';

type Vec = Record<(typeof FLAVOR_AXES)[number], number>;
interface Fixture { brandId: number; profile: Vec | null; }

const v = (f1: number, f2: number, f3: number, f4: number, f5: number, f6: number): Vec => ({
  f1, f2, f3, f4, f5, f6,
});

function fixtureDb(fixtures: Fixture[]): Db {
  let call = 0;
  return {
    query: <R>(_sql: string, params?: unknown[]) => {
      call += 1;
      if (call === 1) {
        const id = params?.[0] as number;
        const found = fixtures.find((f) => f.brandId === id && f.profile !== null);
        return Promise.resolve({ rows: (found?.profile ? [found.profile] : []) as R[] });
      }
      const src: Vec = {
        f1: params?.[0] as number, f2: params?.[1] as number, f3: params?.[2] as number,
        f4: params?.[3] as number, f5: params?.[4] as number, f6: params?.[5] as number,
      };
      const sourceId = params?.[6] as number;
      const topK = params?.[7] as number;
      const mag = (x: Vec) => Math.sqrt(FLAVOR_AXES.reduce((a, ax) => a + x[ax] * x[ax], 0));
      const srcMag = mag(src);
      const scored = fixtures
        .filter((f) => f.brandId !== sourceId && f.profile !== null)
        .map((f) => {
          const p = f.profile as Vec;
          const dot = FLAVOR_AXES.reduce((a, ax) => a + src[ax] * p[ax], 0);
          const denom = srcMag * mag(p);
          return { f, p, similarity: denom === 0 ? null : dot / denom };
        })
        .filter((r): r is { f: Fixture; p: Vec; similarity: number } => r.similarity !== null)
        .sort((a, b) => b.similarity - a.similarity || a.f.brandId - b.f.brandId)
        .slice(0, topK)
        .map((r) => ({
          brand_id: r.f.brandId, name: `s${String(r.f.brandId)}`, name_romaji: null,
          brewery_id: r.f.brandId * 10, brewery_name: 'b', brewery_name_romaji: null,
          area_id: 15, area_name: '新潟県', ...r.p, similarity: r.similarity,
        }));
      return Promise.resolve({ rows: scored as R[] });
    },
  };
}

describe('findSimilarSakes', () => {
  it('ranks by cosine similarity over f1..f6 (hand-computed)', async () => {
    const db = fixtureDb([
      { brandId: 1, profile: v(1, 0, 0, 0, 0, 0) },
      { brandId: 2, profile: v(2, 0, 0, 0, 0, 0) },
      { brandId: 3, profile: v(1, 1, 0, 0, 0, 0) },
    ]);
    const result = await findSimilarSakes({ brandId: 1 }, db);
    expect(result.map((r) => r.sake.brandId)).toEqual([2, 3]);
    expect(result[0]?.similarity).toBeCloseTo(1, 10);
    expect(result[1]?.similarity).toBeCloseTo(1 / Math.sqrt(2), 10);
    expect(result[0]?.flavorProfile).toEqual(v(2, 0, 0, 0, 0, 0));
  });

  it('excludes the source brand and profile-less brands', async () => {
    const db = fixtureDb([
      { brandId: 1, profile: v(1, 0, 0, 0, 0, 0) },
      { brandId: 2, profile: v(1, 0, 0, 0, 0, 0) },
      { brandId: 3, profile: null },
    ]);
    const result = await findSimilarSakes({ brandId: 1 }, db);
    expect(result.map((r) => r.sake.brandId)).toEqual([2]);
  });

  it('returns [] when the source brand has no FlavorChart', async () => {
    const db = fixtureDb([{ brandId: 1, profile: null }, { brandId: 2, profile: v(1, 0, 0, 0, 0, 0) }]);
    expect(await findSimilarSakes({ brandId: 1 }, db)).toEqual([]);
  });

  it('defaults topK to 10 and clamps above 50', async () => {
    const passed: number[] = [];
    const db: Db = {
      query: <R>(_s: string, p?: unknown[]) => {
        if (p && p.length === 8) passed.push(p[7] as number);
        if (p && p.length === 1) return Promise.resolve({ rows: [v(1, 0, 0, 0, 0, 0)] as R[] });
        return Promise.resolve({ rows: [] as R[] });
      },
    };
    await findSimilarSakes({ brandId: 1 }, db);
    await findSimilarSakes({ brandId: 1, topK: 200 }, db);
    expect(passed).toEqual([10, 50]);
  });
});

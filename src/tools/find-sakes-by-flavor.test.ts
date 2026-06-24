import { describe, expect, it } from 'vitest';
import type { Db } from '../db.js';
import { FLAVOR_AXES } from './flavor-profile.js';
import { FindSakesByFlavorInputSchema, findSakesByFlavor } from './find-sakes-by-flavor.js';

type Vec = Record<(typeof FLAVOR_AXES)[number], number>;
interface Fixture { brandId: number; profile: Vec | null; areaId: number; }
const v = (f1: number, f2: number, f3: number, f4: number, f5: number, f6: number): Vec => ({ f1, f2, f3, f4, f5, f6 });

interface Intent { axes?: Partial<Record<(typeof FLAVOR_AXES)[number], { min: number; max: number }>>; areaId?: number; }

function matches(f: Fixture, intent: Intent): boolean {
  if (f.areaId === 0) return false;
  if (intent.areaId !== undefined && f.areaId !== intent.areaId) return false;
  if (intent.axes) {
    if (f.profile === null) return false;
    for (const ax of FLAVOR_AXES) {
      const r = intent.axes[ax];
      if (r === undefined) continue;
      if (f.profile[ax] < r.min || f.profile[ax] > r.max) return false;
    }
  }
  return true;
}

function fixtureDb(fixtures: Fixture[], intent: Intent): Db {
  return {
    query: <R>(_sql: string, params?: unknown[]) => {
      const limit = params?.[params.length - 1] as number;
      const rows = fixtures
        .filter((f) => matches(f, intent))
        .sort((a, b) => a.brandId - b.brandId)
        .slice(0, limit)
        .map((f) => ({
          brand_id: f.brandId, name: `S${String(f.brandId)}`, name_romaji: null,
          brewery_id: f.brandId * 10, brewery_name: 'b', brewery_name_romaji: null,
          area_id: f.areaId, area_name: `A${String(f.areaId)}`,
          ...(f.profile ?? { f1: null, f2: null, f3: null, f4: null, f5: null, f6: null }),
        }));
      return Promise.resolve({ rows: rows as R[] });
    },
  };
}

describe('FindSakesByFlavorInputSchema (empty-filter contract)', () => {
  it('rejects {} and tags-only (tags do not count as a filter)', () => {
    expect(FindSakesByFlavorInputSchema.safeParse({}).success).toBe(false);
    expect(FindSakesByFlavorInputSchema.safeParse({ tags: [12] }).success).toBe(false);
  });
  it('accepts an axis bound or an areaId', () => {
    expect(FindSakesByFlavorInputSchema.safeParse({ f1Min: 0.5 }).success).toBe(true);
    expect(FindSakesByFlavorInputSchema.safeParse({ areaId: 15 }).success).toBe(true);
  });
});

describe('findSakesByFlavor', () => {
  it('filters by an axis range, excluding out-of-range and profile-less brands', async () => {
    const fixtures: Fixture[] = [
      { brandId: 1, profile: v(0.8, 0, 0, 0, 0, 0), areaId: 15 },
      { brandId: 2, profile: v(0.2, 0, 0, 0, 0, 0), areaId: 15 },
      { brandId: 3, profile: null, areaId: 15 },
    ];
    const result = await findSakesByFlavor({ f1Min: 0.5, f1Max: 1 }, fixtureDb(fixtures, { axes: { f1: { min: 0.5, max: 1 } } }));
    expect(result.map((r) => r.sake.brandId)).toEqual([1]);
    expect(result[0]?.flavorProfile?.f1).toBe(0.8);
  });

  it('filters by area and always excludes the areaId-0 sentinel', async () => {
    const fixtures: Fixture[] = [
      { brandId: 1, profile: null, areaId: 15 },
      { brandId: 2, profile: null, areaId: 27 },
      { brandId: 3, profile: null, areaId: 0 },
    ];
    const result = await findSakesByFlavor({ areaId: 15 }, fixtureDb(fixtures, { areaId: 15 }));
    expect(result.map((r) => r.sake.brandId)).toEqual([1]);
  });

  it('never returns an areaId-0 brand even with no area filter', async () => {
    const fixtures: Fixture[] = [
      { brandId: 1, profile: v(0.8, 0, 0, 0, 0, 0), areaId: 0 },
      { brandId: 2, profile: v(0.8, 0, 0, 0, 0, 0), areaId: 15 },
    ];
    const result = await findSakesByFlavor({ f1Min: 0.5 }, fixtureDb(fixtures, { axes: { f1: { min: 0.5, max: 1 } } }));
    expect(result.map((r) => r.sake.brandId)).toEqual([2]);
  });

  it('clamps topK above the maximum to 50', async () => {
    const limits: number[] = [];
    const db: Db = { query: <R>(_s: string, p?: unknown[]) => { limits.push(p?.[p.length - 1] as number); return Promise.resolve({ rows: [] as R[] }); } };
    await findSakesByFlavor({ areaId: 15, topK: 999 }, db);
    expect(limits).toEqual([50]);
  });
});

import { describe, expect, it } from 'vitest';
import type { Db } from '../db.js';
import { getSakeDetails } from './get-sake-details.js';

interface Fixture {
  brand_id: number;
  name: string;
  chart: Record<string, number> | null;
}

function fixtureDb(fixtures: Fixture[]): Db {
  return {
    query: <R>(_sql: string, params?: unknown[]) => {
      const brandId = params?.[0] as number;
      const f = fixtures.find((x) => x.brand_id === brandId);
      if (f === undefined) return Promise.resolve({ rows: [] as R[] });
      const chartCols =
        f.chart === null
          ? { f1: null, f2: null, f3: null, f4: null, f5: null, f6: null }
          : f.chart;
      const row = {
        brand_id: f.brand_id,
        name: f.name,
        name_romaji: `${f.name}-romaji`,
        brewery_id: f.brand_id * 10,
        brewery_name: `B${String(f.brand_id)}`,
        brewery_name_romaji: null,
        area_id: 15,
        area_name: '新潟県',
        ...chartCols,
      };
      return Promise.resolve({ rows: [row] as R[] });
    },
  };
}

const chart = { f1: 0.8, f2: 0.6, f3: 0.4, f4: 0.3, f5: 0.5, f6: 0.7 };

describe('getSakeDetails', () => {
  it('returns the nested brand + FlavorChart for a known brandId', async () => {
    const result = await getSakeDetails({ brandId: 1 }, fixtureDb([{ brand_id: 1, name: '獺祭', chart }]));
    expect(result.found).toBe(true);
    if (!result.found) throw new Error('expected found');
    expect(result.sake.brandId).toBe(1);
    expect(result.sake.brewery.breweryId).toBe(10);
    expect(result.sake.area.name).toBe('新潟県');
    expect(result.flavorProfile).toEqual(chart);
    // No brand↔tag junction in the canonical mirror — always empty.
    expect(result.flavorTags).toEqual([]);
  });

  it('returns flavorProfile: null when the brand has no FlavorChart', async () => {
    const result = await getSakeDetails({ brandId: 2 }, fixtureDb([{ brand_id: 2, name: 'X', chart: null }]));
    expect(result.found).toBe(true);
    if (!result.found) throw new Error('expected found');
    expect(result.flavorProfile).toBeNull();
  });

  it('coerces numeric-as-string FlavorChart columns to numbers', async () => {
    const stub: Db = {
      query: <R>() =>
        Promise.resolve({
          rows: [
            {
              brand_id: 7, name: 's', name_romaji: null, brewery_id: 70, brewery_name: 'b',
              brewery_name_romaji: null, area_id: 15, area_name: '新潟県',
              f1: '0.8', f2: '0.6', f3: '0.4', f4: '0.3', f5: '0.5', f6: '0.7',
            },
          ] as R[],
        }),
    };
    const result = await getSakeDetails({ brandId: 7 }, stub);
    if (!result.found) throw new Error('expected found');
    expect(result.flavorProfile).toEqual(chart);
  });

  it('returns { found: false, brandId } for an unknown id (not an error)', async () => {
    const result = await getSakeDetails({ brandId: 99999 }, fixtureDb([{ brand_id: 1, name: 'A', chart }]));
    expect(result).toEqual({ found: false, brandId: 99999 });
  });
});

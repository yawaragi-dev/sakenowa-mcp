import { describe, expect, it } from 'vitest';
import type { Db } from '../db.js';
import { getSakeDetails } from './get-sake-details.js';

/*
 * Unit tests against a stubbed Db. The stub is a tiny in-memory Postgres
 * analogue: it answers the Sake+FlavorProfile lookup from a fixture, then the
 * FlavorTags lookup from a separate fixture. Tests assert the SHAPE the function
 * produces (found/not-found, profile present/null, tags present/empty), not the
 * SQL it sends — matching the S1/S2/S5 style.
 */

interface SakeFixture {
  id: number;
  name_romaji: string;
  // null = no FlavorProfile row for this Sake.
  profile: Record<string, number> | null;
  // FlavorTags attached to this Sake.
  tags: { id: number; name_ja: string }[];
}

/**
 * Build a Db stub. The first query is the Sake+FlavorProfile lookup
 * (params: [sake_id]); the second is the batched FlavorTags lookup
 * (params: [[sake_id]]), whose rows carry `sake_id` so the shared helper can
 * group them.
 */
function fixtureDb(fixtures: SakeFixture[]): Db {
  let call = 0;
  return {
    query: <R>(_sql: string, params?: unknown[]) => {
      call += 1;

      if (call === 1) {
        // Sake + FlavorProfile join (LEFT JOIN: axes NULL when no profile).
        const sakeId = params?.[0] as number;
        const fixture = fixtures.find((f) => f.id === sakeId);
        if (fixture === undefined) {
          return Promise.resolve({ rows: [] as R[] });
        }
        const profileCols =
          fixture.profile === null
            ? { hanayaka: null, hojun: null, juko: null, odayaka: null, dry: null, keikai: null }
            : fixture.profile;
        const row = {
          id: fixture.id,
          name_ja: `${fixture.name_romaji}_ja`,
          name_romaji: fixture.name_romaji,
          brewery_id: fixture.id * 10,
          brewery_name_ja: `B${String(fixture.id)}_ja`,
          brewery_name_romaji: `B${String(fixture.id)}`,
          prefecture_id: 15,
          prefecture_name_ja: '新潟県',
          prefecture_name_romaji: 'Niigata',
          ...profileCols,
        };
        return Promise.resolve({ rows: [row] as R[] });
      }

      // FlavorTags lookup: batched `WHERE sake_id = ANY($1)` → params is
      // [[sake_id]] and rows carry sake_id for grouping.
      const ids = (params?.[0] as number[] | undefined) ?? [];
      const rows = fixtures
        .filter((f) => ids.includes(f.id))
        .flatMap((f) => f.tags.map((t) => ({ sake_id: f.id, id: t.id, name_ja: t.name_ja })));
      return Promise.resolve({ rows: rows as R[] });
    },
  };
}

const profile = {
  hanayaka: 0.8,
  hojun: 0.6,
  juko: 0.4,
  odayaka: 0.3,
  dry: 0.5,
  keikai: 0.7,
};

describe('getSakeDetails', () => {
  it('returns the full nested Sake, FlavorProfile and FlavorTags for a known id', async () => {
    const db = fixtureDb([
      {
        id: 1,
        name_romaji: 'Dassai',
        profile,
        tags: [
          { id: 12, name_ja: '甘味' },
          { id: 5, name_ja: '旨味' },
        ],
      },
    ]);

    const result = await getSakeDetails({ sake_id: 1 }, db);

    expect(result.found).toBe(true);
    if (!result.found) throw new Error('expected found');
    expect(result.sake.id).toBe(1);
    expect(result.sake.name_romaji).toBe('Dassai');
    // Brewery + Prefecture nested inside `sake`.
    expect(result.sake.brewery.id).toBe(10);
    expect(result.sake.prefecture.name_romaji).toBe('Niigata');
    expect(result.flavor_profile).toEqual(profile);
    expect(result.flavor_tags).toEqual([
      { id: 12, name_ja: '甘味' },
      { id: 5, name_ja: '旨味' },
    ]);
  });

  it('returns flavor_profile: null when the Sake has no FlavorProfile row', async () => {
    const db = fixtureDb([
      { id: 2, name_romaji: 'NoProfile', profile: null, tags: [{ id: 3, name_ja: '辛口' }] },
    ]);

    const result = await getSakeDetails({ sake_id: 2 }, db);

    expect(result.found).toBe(true);
    if (!result.found) throw new Error('expected found');
    expect(result.flavor_profile).toBeNull();
    // Tags still returned even when the profile is missing.
    expect(result.flavor_tags).toEqual([{ id: 3, name_ja: '辛口' }]);
  });

  it('returns flavor_tags: [] when the Sake has no tags', async () => {
    const db = fixtureDb([{ id: 3, name_romaji: 'NoTags', profile, tags: [] }]);

    const result = await getSakeDetails({ sake_id: 3 }, db);

    expect(result.found).toBe(true);
    if (!result.found) throw new Error('expected found');
    expect(result.flavor_tags).toEqual([]);
    expect(result.flavor_profile).toEqual(profile);
  });

  it('returns { found: false, sake_id } for an unknown id (not an error)', async () => {
    const db = fixtureDb([{ id: 1, name_romaji: 'Dassai', profile, tags: [] }]);

    const result = await getSakeDetails({ sake_id: 99999 }, db);

    expect(result).toEqual({ found: false, sake_id: 99999 });
  });

  it('coerces numeric FlavorProfile strings (pg numeric) into numbers', async () => {
    // pg returns `numeric` columns as strings; the function must coerce them.
    const db: Db = {
      query: <R>(_sql: string, params?: unknown[]) => {
        if ((params?.length ?? 0) === 1 && _sql.includes('flavor_profiles')) {
          return Promise.resolve({
            rows: [
              {
                id: 7,
                name_ja: 's_ja',
                name_romaji: 's',
                brewery_id: 70,
                brewery_name_ja: 'b_ja',
                brewery_name_romaji: 'b',
                prefecture_id: 15,
                prefecture_name_ja: '新潟県',
                prefecture_name_romaji: 'Niigata',
                hanayaka: '0.8',
                hojun: '0.6',
                juko: '0.4',
                odayaka: '0.3',
                dry: '0.5',
                keikai: '0.7',
              },
            ] as R[],
          });
        }
        return Promise.resolve({ rows: [] as R[] });
      },
    };

    const result = await getSakeDetails({ sake_id: 7 }, db);
    expect(result.found).toBe(true);
    if (!result.found) throw new Error('expected found');
    expect(result.flavor_profile).toEqual(profile);
  });
});

import { describe, expect, it } from 'vitest';
import type { Db } from '../db.js';
import { FLAVOR_AXES } from './flavor-profile.js';
import { FindSakesByFlavorInputSchema, findSakesByFlavor } from './find-sakes-by-flavor.js';

/*
 * These unit tests exercise the query function against a stubbed Db that
 * behaves like a tiny in-memory Postgres: it holds Sake / FlavorProfile /
 * FlavorTag fixtures and re-implements the SAME contract the SQL enforces
 * (areaId-0 always excluded, axis BETWEEN ranges with 0/1 defaults, ALL tags
 * present, prefecture match, order by id ASC, LIMIT top_k). Tests assert the
 * SHAPE and the SET of matched Sakes the function produces — not the SQL string
 * it sends — matching the established S1/S5 style.
 *
 * The stub distinguishes the two queries the function issues by params:
 *  - the filter query's LAST param is the numeric top_k (limit);
 *  - the tags query's only param is an array of sake ids.
 */

type Vec = Record<(typeof FLAVOR_AXES)[number], number>;

interface Fixture {
  id: number;
  profile: Vec | null;
  tagIds: number[];
  prefectureId: number;
}

const TAG_NAMES: Record<number, string> = {
  2: '酸味',
  5: '旨味',
  12: '甘味',
  99: 'フルーティ',
};

const v = (
  hanayaka: number,
  hojun: number,
  juko: number,
  odayaka: number,
  dry: number,
  keikai: number,
): Vec => ({ hanayaka, hojun, juko, odayaka, dry, keikai });

/**
 * Decode the filter intent from the args the test passed (not from SQL). Mirrors
 * the query function's own filter semantics so the stub can answer correctly.
 */
interface FilterIntent {
  axes?: Partial<Record<(typeof FLAVOR_AXES)[number], { min: number; max: number }>>;
  tags?: number[];
  prefectureId?: number;
}

function matches(fixture: Fixture, intent: FilterIntent): boolean {
  // areaId-0 sentinel is ALWAYS excluded.
  if (fixture.prefectureId === 0) return false;

  if (intent.prefectureId !== undefined && fixture.prefectureId !== intent.prefectureId) {
    return false;
  }

  if (intent.axes) {
    if (fixture.profile === null) return false; // LEFT JOIN NULL fails BETWEEN
    for (const axis of FLAVOR_AXES) {
      const range = intent.axes[axis];
      if (range === undefined) continue;
      const value = fixture.profile[axis];
      if (value < range.min || value > range.max) return false;
    }
  }

  if (intent.tags && intent.tags.length > 0) {
    const distinct = new Set(intent.tags);
    for (const tagId of distinct) {
      if (!fixture.tagIds.includes(tagId)) return false;
    }
  }

  return true;
}

/**
 * Build a Db stub backed by fixtures. `intent` is supplied per-call so the stub
 * can apply the same filter the function would; the stub still honours the
 * top_k limit it receives as the final filter-query param and the id-array
 * param of the tags query, so the clamp test reads real behaviour.
 */
function fixtureDb(fixtures: Fixture[], intent: FilterIntent): Db {
  return {
    query: <R>(_sql: string, params?: unknown[]) => {
      const last = params?.[params.length - 1];

      // Tags query: a single array-of-ids param.
      if (params?.length === 1 && Array.isArray(params[0])) {
        const ids = params[0] as number[];
        const rows = fixtures
          .filter((f) => ids.includes(f.id))
          .flatMap((f) =>
            [...f.tagIds]
              .sort((a, b) => a - b)
              .map((tagId) => ({ sake_id: f.id, id: tagId, name_ja: TAG_NAMES[tagId] ?? '?' })),
          );
        return Promise.resolve({ rows: rows as R[] });
      }

      // Filter query: last param is the numeric top_k limit.
      const limit = last as number;
      const matched = fixtures
        .filter((f) => matches(f, intent))
        .sort((a, b) => a.id - b.id)
        .slice(0, limit)
        .map((f) => ({
          id: f.id,
          name_ja: `S${String(f.id)}_ja`,
          name_romaji: `S${String(f.id)}`,
          brewery_id: f.id * 10,
          brewery_name_ja: `B${String(f.id)}_ja`,
          brewery_name_romaji: `B${String(f.id)}`,
          prefecture_id: f.prefectureId,
          prefecture_name_ja: `P${String(f.prefectureId)}_ja`,
          prefecture_name_romaji: `P${String(f.prefectureId)}`,
          ...(f.profile ?? {
            hanayaka: null,
            hojun: null,
            juko: null,
            odayaka: null,
            dry: null,
            keikai: null,
          }),
        }));
      return Promise.resolve({ rows: matched as R[] });
    },
  };
}

describe('FindSakesByFlavorInputSchema (empty-filter contract)', () => {
  it('rejects a call with no filter family at all', () => {
    const result = FindSakesByFlavorInputSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message.toLowerCase()).toContain('empty filter');
    }
  });

  it('rejects a call carrying only an empty axes object and empty tags list', () => {
    const result = FindSakesByFlavorInputSchema.safeParse({ axes: {}, tags: [] });
    expect(result.success).toBe(false);
  });

  it('rejects top_k alone as an empty filter', () => {
    const result = FindSakesByFlavorInputSchema.safeParse({ top_k: 5 });
    expect(result.success).toBe(false);
  });

  it('accepts a call with just one filter family present', () => {
    expect(FindSakesByFlavorInputSchema.safeParse({ tags: [12] }).success).toBe(true);
    expect(FindSakesByFlavorInputSchema.safeParse({ prefecture_id: 15 }).success).toBe(true);
    expect(
      FindSakesByFlavorInputSchema.safeParse({ axes: { dry: { min: 0.5 } } }).success,
    ).toBe(true);
  });
});

describe('findSakesByFlavor', () => {
  it('filters by a single axis range (BETWEEN), excluding out-of-range and profile-less Sakes', async () => {
    const fixtures: Fixture[] = [
      { id: 1, profile: v(0.8, 0, 0, 0, 0, 0), tagIds: [], prefectureId: 15 }, // in range
      { id: 2, profile: v(0.2, 0, 0, 0, 0, 0), tagIds: [], prefectureId: 15 }, // below min
      { id: 3, profile: null, tagIds: [], prefectureId: 15 }, // no profile
    ];
    const args = { axes: { hanayaka: { min: 0.5, max: 1 } } };
    const result = await findSakesByFlavor(args, fixtureDb(fixtures, {
      axes: { hanayaka: { min: 0.5, max: 1 } },
    }));

    expect(result.map((r) => r.sake.id)).toEqual([1]);
    expect(result[0]?.flavor_profile?.hanayaka).toBe(0.8);
  });

  it('applies axis min/max defaults of 0 and 1 when a bound is omitted', async () => {
    const fixtures: Fixture[] = [
      { id: 1, profile: v(0, 0, 0, 0, 0, 0.3), tagIds: [], prefectureId: 15 },
      { id: 2, profile: v(0, 0, 0, 0, 0, 0.9), tagIds: [], prefectureId: 15 },
    ];
    // Only max supplied → min defaults to 0; keikai <= 0.5 keeps id 1 only.
    const result = await findSakesByFlavor(
      { axes: { keikai: { max: 0.5 } } },
      fixtureDb(fixtures, { axes: { keikai: { min: 0, max: 0.5 } } }),
    );
    expect(result.map((r) => r.sake.id)).toEqual([1]);
  });

  it('filters by tags requiring ALL listed ids present (AND, not OR)', async () => {
    const fixtures: Fixture[] = [
      { id: 1, profile: null, tagIds: [12, 5], prefectureId: 15 }, // has both
      { id: 2, profile: null, tagIds: [12], prefectureId: 15 }, // only one
      { id: 3, profile: null, tagIds: [12, 5, 2], prefectureId: 15 }, // superset
    ];
    const result = await findSakesByFlavor(
      { tags: [12, 5] },
      fixtureDb(fixtures, { tags: [12, 5] }),
    );
    // ids 1 and 3 have both 12 and 5; id 2 has only 12.
    expect(result.map((r) => r.sake.id)).toEqual([1, 3]);
    // Tags carried through the batched lookup, ordered by id.
    expect(result[0]?.flavor_tags).toEqual([
      { id: 5, name_ja: '旨味' },
      { id: 12, name_ja: '甘味' },
    ]);
  });

  it('filters by prefecture and always excludes the areaId-0 sentinel', async () => {
    const fixtures: Fixture[] = [
      { id: 1, profile: null, tagIds: [], prefectureId: 15 },
      { id: 2, profile: null, tagIds: [], prefectureId: 27 },
      { id: 3, profile: null, tagIds: [], prefectureId: 0 }, // sentinel
    ];
    const result = await findSakesByFlavor(
      { prefecture_id: 15 },
      fixtureDb(fixtures, { prefectureId: 15 }),
    );
    expect(result.map((r) => r.sake.id)).toEqual([1]);
  });

  it('never returns an areaId-0 Sake even when no prefecture filter is supplied', async () => {
    const fixtures: Fixture[] = [
      { id: 1, profile: v(0.8, 0, 0, 0, 0, 0), tagIds: [], prefectureId: 0 }, // sentinel, matches axis
      { id: 2, profile: v(0.8, 0, 0, 0, 0, 0), tagIds: [], prefectureId: 15 },
    ];
    const result = await findSakesByFlavor(
      { axes: { hanayaka: { min: 0.5 } } },
      fixtureDb(fixtures, { axes: { hanayaka: { min: 0.5, max: 1 } } }),
    );
    expect(result.map((r) => r.sake.id)).toEqual([2]);
  });

  it('combines all three filter families with AND semantics', async () => {
    const fixtures: Fixture[] = [
      // matches axis + tags + prefecture
      { id: 1, profile: v(0.8, 0, 0, 0, 0, 0), tagIds: [12, 5], prefectureId: 15 },
      // right prefecture + tags but axis out of range
      { id: 2, profile: v(0.1, 0, 0, 0, 0, 0), tagIds: [12, 5], prefectureId: 15 },
      // right axis + prefecture but missing a tag
      { id: 3, profile: v(0.8, 0, 0, 0, 0, 0), tagIds: [12], prefectureId: 15 },
      // right axis + tags but wrong prefecture
      { id: 4, profile: v(0.8, 0, 0, 0, 0, 0), tagIds: [12, 5], prefectureId: 27 },
    ];
    const intent: FilterIntent = {
      axes: { hanayaka: { min: 0.5, max: 1 } },
      tags: [12, 5],
      prefectureId: 15,
    };
    const result = await findSakesByFlavor(
      { axes: { hanayaka: { min: 0.5, max: 1 } }, tags: [12, 5], prefecture_id: 15 },
      fixtureDb(fixtures, intent),
    );
    expect(result.map((r) => r.sake.id)).toEqual([1]);
    expect(result[0]?.flavor_profile?.hanayaka).toBe(0.8);
    expect(result[0]?.flavor_tags.map((t) => t.id)).toEqual([5, 12]);
  });

  it('returns the full nested Sake + FlavorProfile + FlavorTags shape', async () => {
    const fixtures: Fixture[] = [
      { id: 7, profile: v(0.1, 0.2, 0.3, 0.4, 0.5, 0.6), tagIds: [99], prefectureId: 15 },
    ];
    const result = await findSakesByFlavor(
      { prefecture_id: 15 },
      fixtureDb(fixtures, { prefectureId: 15 }),
    );
    expect(result).toHaveLength(1);
    const match = result[0];
    expect(match?.sake.id).toBe(7);
    expect(match?.sake.brewery.id).toBe(70);
    expect(match?.sake.prefecture.id).toBe(15);
    expect(match?.flavor_profile).toEqual(v(0.1, 0.2, 0.3, 0.4, 0.5, 0.6));
    expect(match?.flavor_tags).toEqual([{ id: 99, name_ja: 'フルーティ' }]);
  });

  it('yields flavor_profile: null for a matched Sake with no FlavorProfile', async () => {
    const fixtures: Fixture[] = [
      { id: 1, profile: null, tagIds: [12], prefectureId: 15 },
    ];
    const result = await findSakesByFlavor(
      { prefecture_id: 15 },
      fixtureDb(fixtures, { prefectureId: 15 }),
    );
    expect(result[0]?.flavor_profile).toBeNull();
    expect(result[0]?.flavor_tags).toEqual([{ id: 12, name_ja: '甘味' }]);
  });

  it('defaults top_k to 10 and clamps requests above 50 down to 50', async () => {
    const limits: number[] = [];
    const recordingDb: Db = {
      query: <R>(_sql: string, params?: unknown[]) => {
        if (params?.length === 1 && Array.isArray(params[0])) {
          return Promise.resolve({ rows: [] as R[] });
        }
        limits.push(params?.[params.length - 1] as number);
        return Promise.resolve({ rows: [] as R[] });
      },
    };

    await findSakesByFlavor({ prefecture_id: 15 }, recordingDb);
    await findSakesByFlavor({ prefecture_id: 15, top_k: 200 }, recordingDb);
    await findSakesByFlavor({ prefecture_id: 15, top_k: 7 }, recordingDb);

    expect(limits).toEqual([10, 50, 7]);
  });

  it('issues only two queries regardless of result count (no N+1)', async () => {
    let queryCount = 0;
    const fixtures: Fixture[] = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      profile: null,
      tagIds: [12],
      prefectureId: 15,
    }));
    const base = fixtureDb(fixtures, { prefectureId: 15 });
    const countingDb: Db = {
      query: <R>(sql: string, params?: unknown[]) => {
        queryCount += 1;
        return base.query<R>(sql, params);
      },
    };

    const result = await findSakesByFlavor({ prefecture_id: 15 }, countingDb);
    expect(result).toHaveLength(5);
    expect(queryCount).toBe(2); // one filter query + one batched tags query
  });

  it('issues only one query when nothing matches (skips the tags query)', async () => {
    let queryCount = 0;
    const countingDb: Db = {
      query: <R>() => {
        queryCount += 1;
        return Promise.resolve({ rows: [] as R[] });
      },
    };
    const result = await findSakesByFlavor({ prefecture_id: 999 }, countingDb);
    expect(result).toEqual([]);
    expect(queryCount).toBe(1);
  });
});

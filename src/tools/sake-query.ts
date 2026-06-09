import type { Sake } from './sake.js';

/**
 * Canonical `Sake → Brewery → Prefecture` join, factored out because five of
 * the six v0.1.0 tools (search, details, similar, by-flavor, top-ranked) return
 * the same nested Sake shape and would otherwise each re-derive these JOINs and
 * the row→object mapping.
 *
 * A thin SQL/mapping helper, deliberately NOT a repository or query builder. It
 * is exposed as composable pieces so callers that need *extra* columns or joins
 * (e.g. find_similar_sakes adds the six FlavorProfile columns + a cosine
 * expression and a `flavor_profiles` join) can splice them in:
 *
 *   `SELECT ${SAKE_COLUMNS}, <extra cols> FROM ${SAKE_FROM} JOIN <extra> ...`
 *
 * Callers that need nothing extra use {@link SAKE_SELECT_JOIN} directly and
 * append their own WHERE / ORDER BY / LIMIT. No bind placeholders are
 * introduced, so a caller's parameter numbering is unconstrained. The base
 * table is aliased `s` (sakes), the brewery `b`, the prefecture `p`. The
 * prefecture is the Brewery's prefecture (a Sake has no prefecture of its own).
 * Columns are hard-coded from docs/specs/v0.1.0.md "Expected DB schema"; a
 * column-remapping layer is a deferred v0.2 concern.
 */

/** Flat row shape produced by {@link SAKE_COLUMNS} / {@link SAKE_SELECT_JOIN}. */
export interface SakeJoinRow {
  id: number;
  name_ja: string;
  name_romaji: string;
  brewery_id: number;
  brewery_name_ja: string;
  brewery_name_romaji: string;
  prefecture_id: number;
  prefecture_name_ja: string;
  prefecture_name_romaji: string;
}

/**
 * Aliased SELECT column list for the canonical Sake join — no leading `SELECT`,
 * no trailing comma — so callers can append further columns after it.
 */
export const SAKE_COLUMNS = `
    s.id                  AS id,
    s.name_ja             AS name_ja,
    s.name_romaji         AS name_romaji,
    b.id                  AS brewery_id,
    b.name_ja             AS brewery_name_ja,
    b.name_romaji         AS brewery_name_romaji,
    p.id                  AS prefecture_id,
    p.name_ja             AS prefecture_name_ja,
    p.name_romaji         AS prefecture_name_romaji`;

/**
 * Table + JOIN clause for the canonical Sake join — no leading `FROM` keyword,
 * so callers can append further joins after it (`FROM ${SAKE_FROM} JOIN ...`).
 */
export const SAKE_FROM = `
  sakes s
  JOIN breweries b   ON b.id = s.brewery_id
  JOIN prefectures p ON p.id = b.prefecture_id`;

/**
 * Complete `SELECT … FROM … JOIN …` for tools that need no extra columns or
 * joins. Append a `WHERE` / `ORDER BY` / `LIMIT` to finish the statement.
 */
export const SAKE_SELECT_JOIN = `
  SELECT ${SAKE_COLUMNS}
  FROM ${SAKE_FROM}
`;

/** Map one flat join row into the nested {@link Sake} shape. */
export function mapSakeRow(row: SakeJoinRow): Sake {
  return {
    id: row.id,
    name_ja: row.name_ja,
    name_romaji: row.name_romaji,
    brewery: {
      id: row.brewery_id,
      name_ja: row.brewery_name_ja,
      name_romaji: row.brewery_name_romaji,
    },
    prefecture: {
      id: row.prefecture_id,
      name_ja: row.prefecture_name_ja,
      name_romaji: row.prefecture_name_romaji,
    },
  };
}

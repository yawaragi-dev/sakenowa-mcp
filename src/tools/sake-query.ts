import type { Sake } from './sake.js';

/**
 * Canonical `Sake → Brewery → Prefecture` join, factored out because five of
 * the six v0.1.0 tools (search, details, similar, by-flavor, top-ranked) return
 * the same nested Sake shape and would otherwise each re-derive these JOINs and
 * the row→object mapping.
 *
 * This is a thin SQL/mapping helper, deliberately NOT a repository or query
 * builder. It owns exactly two things:
 *
 *  - {@link SAKE_SELECT_JOIN}: the SELECT list (aliased to a flat row) plus the
 *    FROM/JOIN clause. Callers append their own WHERE / ORDER BY / LIMIT and
 *    bind their own parameters; this fragment introduces no placeholders, so it
 *    composes cleanly regardless of a caller's parameter numbering.
 *  - {@link mapSakeRow}: turns one flat {@link SakeJoinRow} into the nested
 *    {@link Sake} shape. The Zod parse stays at each tool's output boundary, not
 *    here, so this helper carries no validation policy.
 *
 * The prefecture is the Brewery's prefecture (a Sake has no prefecture of its
 * own). Columns are hard-coded from docs/specs/v0.1.0.md "Expected DB schema";
 * a column-remapping layer is a deferred v0.2 concern.
 */

/** Flat row shape produced by {@link SAKE_SELECT_JOIN}. */
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
 * SELECT list + FROM/JOIN clause for the canonical Sake join. Aliased so every
 * field of {@link SakeJoinRow} is present exactly once. Append a `WHERE` /
 * `ORDER BY` / `LIMIT` to build a complete statement. The base table is exposed
 * as `s` (sakes), the brewery as `b`, the prefecture as `p` for callers that
 * need to reference them in their own clauses.
 */
export const SAKE_SELECT_JOIN = `
  SELECT
    s.id                  AS id,
    s.name_ja             AS name_ja,
    s.name_romaji         AS name_romaji,
    b.id                  AS brewery_id,
    b.name_ja             AS brewery_name_ja,
    b.name_romaji         AS brewery_name_romaji,
    p.id                  AS prefecture_id,
    p.name_ja             AS prefecture_name_ja,
    p.name_romaji         AS prefecture_name_romaji
  FROM sakes s
  JOIN breweries b   ON b.id = s.brewery_id
  JOIN prefectures p ON p.id = b.prefecture_id
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

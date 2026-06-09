import { z } from 'zod';
import { PrefectureSchema } from './prefecture.js';

/*
 * MERGE COORDINATION (S5 / #7 ↔ S2 / #4):
 * These Brewery and Sake schemas plus the Sake→Brewery→Prefecture join shape
 * overlap with slice S2 (`search_sakes_by_name`, #4), which OWNS the canonical
 * shared join helper by prior decision. This branch was cut from `main` before
 * S2 landed, so it defines a minimal self-contained version here following the
 * S1 module pattern (`prefecture.ts`). After S2 merges, rebase this branch to
 * adopt S2's shared Sake/Brewery schemas + join helper and delete this module.
 */

/**
 * Brewery — the company that produces Sakes (酒蔵). Matches Sakenowa's
 * `brewery` 1:1. `name_ja` is the Japanese source of truth; `name_romaji` is a
 * transliteration returned as-is. See CONTEXT.md "Brewery".
 */
export const BrewerySchema = z.object({
  id: z.number().int(),
  name_ja: z.string(),
  name_romaji: z.string(),
});

export type Brewery = z.infer<typeof BrewerySchema>;

/**
 * Sake — a sake product line (銘柄) produced by a single Brewery, identified by
 * its Sakenowa `brand_id`. The unit on which this server's tools operate. The
 * shape nests the producing Brewery and the Brewery's Prefecture. See
 * CONTEXT.md "Sake".
 */
export const SakeSchema = z.object({
  id: z.number().int(),
  name_ja: z.string(),
  name_romaji: z.string(),
  brewery: BrewerySchema,
  prefecture: PrefectureSchema,
});

export type Sake = z.infer<typeof SakeSchema>;

/**
 * SQL column list and JOINs that materialise the Sake→Brewery→Prefecture shape.
 * Kept in one small helper so it can be swapped for S2's shared join helper on
 * rebase. Columns are the documented schema names from
 * `docs/specs/v0.1.0.md` "Expected DB schema"; no column-remapping layer.
 *
 * Consumers prefix-qualify with the table aliases below: `s` (sakes),
 * `b` (breweries), `p` (prefectures).
 */
export const SAKE_SELECT_COLUMNS = `
  s.id              AS sake_id,
  s.name_ja         AS sake_name_ja,
  s.name_romaji     AS sake_name_romaji,
  b.id              AS brewery_id,
  b.name_ja         AS brewery_name_ja,
  b.name_romaji     AS brewery_name_romaji,
  p.id              AS prefecture_id,
  p.name_ja         AS prefecture_name_ja,
  p.name_romaji     AS prefecture_name_romaji
`;

export const SAKE_JOIN = `
  sakes s
  JOIN breweries b   ON b.id = s.brewery_id
  JOIN prefectures p ON p.id = b.prefecture_id
`;

/** Flat row produced by `SAKE_SELECT_COLUMNS` over the `SAKE_JOIN`. */
export interface SakeJoinRow {
  sake_id: number;
  sake_name_ja: string;
  sake_name_romaji: string;
  brewery_id: number;
  brewery_name_ja: string;
  brewery_name_romaji: string;
  prefecture_id: number;
  prefecture_name_ja: string;
  prefecture_name_romaji: string;
}

/** Nest a flat {@link SakeJoinRow} into the structured {@link Sake} shape. */
export function toSake(row: SakeJoinRow): Sake {
  return {
    id: row.sake_id,
    name_ja: row.sake_name_ja,
    name_romaji: row.sake_name_romaji,
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

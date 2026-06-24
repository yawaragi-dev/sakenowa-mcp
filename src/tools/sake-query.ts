import type { Sake } from './sake.js';

/**
 * Canonical `brands → breweries → areas` join (Sakenowa-mirror schema), factored
 * out because most tools return the same nested Sake shape. Composable: callers
 * splice extra columns onto {@link SAKE_COLUMNS} and extra joins after
 * {@link SAKE_FROM}; the bundled {@link SAKE_SELECT_JOIN} is for simple callers.
 *
 * Aliases: `s` = brands, `b` = breweries, `a` = areas. The area is the brewery's
 * area. Columns are the canonical Sakenowa names; `name_romaji` is nullable
 * (consumer enrichment). See `docs/specs/schema-audit-v0.1.1.md`.
 */

/** Flat row produced by {@link SAKE_COLUMNS}. */
export interface SakeJoinRow {
  brand_id: number;
  name: string;
  name_romaji: string | null;
  brewery_id: number;
  brewery_name: string;
  brewery_name_romaji: string | null;
  area_id: number;
  area_name: string;
}

/** Aliased SELECT column list — no leading SELECT, no trailing comma. */
export const SAKE_COLUMNS = `
    s.brand_id        AS brand_id,
    s.name            AS name,
    s.name_romaji     AS name_romaji,
    b.brewery_id      AS brewery_id,
    b.name            AS brewery_name,
    b.name_romaji     AS brewery_name_romaji,
    a.area_id         AS area_id,
    a.name            AS area_name`;

/** Table + JOIN clause — no leading FROM. */
export const SAKE_FROM = `
  brands s
  JOIN breweries b ON b.brewery_id = s.brewery_id
  JOIN areas a     ON a.area_id = b.area_id`;

/** Complete `SELECT … FROM … JOIN …` for callers needing no extra columns/joins. */
export const SAKE_SELECT_JOIN = `
  SELECT ${SAKE_COLUMNS}
  FROM ${SAKE_FROM}
`;

/** Map one flat join row into the nested {@link Sake} shape. */
export function mapSakeRow(row: SakeJoinRow): Sake {
  return {
    brandId: row.brand_id,
    name: row.name,
    nameRomaji: row.name_romaji,
    brewery: {
      breweryId: row.brewery_id,
      name: row.brewery_name,
      nameRomaji: row.brewery_name_romaji,
    },
    area: {
      areaId: row.area_id,
      name: row.area_name,
    },
  };
}

import { z } from 'zod';
import type { Db } from '../db.js';
import { SakeSchema, type Sake } from './sake.js';
import { SAKE_SELECT_JOIN, mapSakeRow, type SakeJoinRow } from './sake-query.js';
import { defineTool } from './tool-definition.js';

export const SEARCH_SAKES_BY_NAME_NAME = 'search_sakes_by_name';

export const SEARCH_SAKES_BY_NAME_DESCRIPTION =
  'Resolve a free-text name (romaji or Japanese) into matching sake brands. Matching is ' +
  'case-insensitive across the Sakenowa `name` and the optional `nameRomaji` enrichment ' +
  'column; exact-prefix matches rank ahead of substring matches. Each result carries the ' +
  'brand plus its brewery and that brewery\'s area, so you can disambiguate without a ' +
  'follow-up call. An empty query returns no results.';

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 50;

export const SearchSakesByNameInputSchema = z
  .object({
    query: z.string(),
    limit: z.number().int().positive().optional(),
  })
  .strict();

export const SearchSakesByNameOutputSchema = z.array(SakeSchema);

/**
 * Match `query` case-insensitively (ILIKE) against the canonical `name` and the
 * nullable `name_romaji` enrichment column, joined through brands → breweries →
 * areas. Exact-prefix matches sort first; ties by `brand_id ASC`. Empty query → [].
 */
export async function searchSakesByName(
  args: z.infer<typeof SearchSakesByNameInputSchema>,
  db: Db,
): Promise<Sake[]> {
  const trimmed = args.query.trim();
  if (trimmed === '') {
    return [];
  }

  const limit = Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const escaped = trimmed.replace(/([\\%_])/g, '\\$1');
  const substringPattern = `%${escaped}%`;
  const prefixPattern = `${escaped}%`;

  const sql = `
    ${SAKE_SELECT_JOIN}
    WHERE s.name ILIKE $1 ESCAPE '\\'
       OR s.name_romaji ILIKE $1 ESCAPE '\\'
    ORDER BY
      CASE
        WHEN s.name ILIKE $2 ESCAPE '\\'
          OR s.name_romaji ILIKE $2 ESCAPE '\\'
        THEN 0 ELSE 1
      END,
      s.brand_id ASC
    LIMIT $3
  `;

  const { rows } = await db.query<SakeJoinRow>(sql, [substringPattern, prefixPattern, limit]);
  return SearchSakesByNameOutputSchema.parse(rows.map(mapSakeRow));
}

export const searchSakesByNameTool = defineTool({
  name: SEARCH_SAKES_BY_NAME_NAME,
  description: SEARCH_SAKES_BY_NAME_DESCRIPTION,
  inputSchema: SearchSakesByNameInputSchema,
  outputSchema: SearchSakesByNameOutputSchema,
  structuredKey: 'sakes',
  run: searchSakesByName,
});

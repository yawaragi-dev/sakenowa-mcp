import { z } from 'zod';
import type { Db } from '../db.js';
import { SakeSchema, type Sake } from './sake.js';
import { SAKE_SELECT_JOIN, mapSakeRow, type SakeJoinRow } from './sake-query.js';

/**
 * Tool name and description advertised over MCP. The description uses the
 * domain vocabulary from CONTEXT.md (Sake, not "brand"/"label").
 */
export const SEARCH_SAKES_BY_NAME_NAME = 'search_sakes_by_name';

export const SEARCH_SAKES_BY_NAME_DESCRIPTION =
  'Resolve a free-text name (romaji or Japanese kanji/kana) into matching Sake ' +
  'records, for "tell me about X" or "find a sake like X" flows. Matching is ' +
  'case-insensitive across both the Japanese name (name_ja) and the romaji ' +
  'transliteration (name_romaji); exact-prefix matches are ranked ahead of ' +
  'substring matches. Each result carries the Sake plus its Brewery and that ' +
  "Brewery's Prefecture, so you can disambiguate same-romaji collisions (two " +
  'distinct Sakes can share a romaji name) without a follow-up call. An ' +
  'empty query returns no results.';

/** Default number of Sakes returned when `limit` is omitted. */
export const DEFAULT_LIMIT = 10;

/** Hard ceiling on `limit`; larger values are clamped down to this, not rejected. */
export const MAX_LIMIT = 50;

/**
 * Input for `search_sakes_by_name`. `limit` is optional; out-of-range values
 * are clamped in the query function rather than rejected, so a positive integer
 * is the only constraint enforced here.
 */
export const SearchSakesByNameInputSchema = z
  .object({
    query: z.string(),
    limit: z.number().int().positive().optional(),
  })
  .strict();

export const SearchSakesByNameOutputSchema = z.array(SakeSchema);

/**
 * Structured-content wrapper advertised as the tool's `outputSchema` and
 * returned as `structuredContent`. MCP clients that validate structured
 * results check the payload against this shape.
 */
export const SearchSakesByNameStructuredSchema = z.object({
  sakes: SearchSakesByNameOutputSchema,
});

/**
 * Query function for `search_sakes_by_name`. Matches `query` case-insensitively
 * (ILIKE) against both `name_ja` and `name_romaji`, joined through the canonical
 * Sake → Brewery → Prefecture shape.
 *
 * Ordering: exact-prefix matches (on either name) come before substring-only
 * matches; ties break by `sake.id ASC` for determinism. An empty/whitespace
 * query short-circuits to `[]` (not an error). `limit` defaults to
 * {@link DEFAULT_LIMIT} and is clamped to {@link MAX_LIMIT}.
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

  // ILIKE pattern operands. `%term%` matches anywhere; `term%` detects an
  // exact-prefix match for ranking. `_` and `%` in user input are treated as
  // literals via ESCAPE so they don't act as wildcards.
  const escaped = trimmed.replace(/([\\%_])/g, '\\$1');
  const substringPattern = `%${escaped}%`;
  const prefixPattern = `${escaped}%`;

  const sql = `
    ${SAKE_SELECT_JOIN}
    WHERE s.name_ja ILIKE $1 ESCAPE '\\'
       OR s.name_romaji ILIKE $1 ESCAPE '\\'
    ORDER BY
      CASE
        WHEN s.name_ja ILIKE $2 ESCAPE '\\'
          OR s.name_romaji ILIKE $2 ESCAPE '\\'
        THEN 0 ELSE 1
      END,
      s.id ASC
    LIMIT $3
  `;

  const { rows } = await db.query<SakeJoinRow>(sql, [
    substringPattern,
    prefixPattern,
    limit,
  ]);

  // Map flat join rows to the nested Sake shape, then parse at the output
  // boundary before returning.
  return SearchSakesByNameOutputSchema.parse(rows.map(mapSakeRow));
}

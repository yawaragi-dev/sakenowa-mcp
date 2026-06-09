import { z } from 'zod';
import type { Db } from '../db.js';
import { SakeSchema } from './sake.js';
import { SAKE_COLUMNS, SAKE_FROM, mapSakeRow, type SakeJoinRow } from './sake-query.js';

/**
 * Tool name and description advertised over MCP. The description uses the
 * domain vocabulary from CONTEXT.md (Sake, Prefecture, Ranking), never
 * "brand"/"area".
 */
export const GET_TOP_RANKED_NAME = 'get_top_ranked';

export const GET_TOP_RANKED_DESCRIPTION =
  'Return the top-ranked Sakes by popularity, for either the overall Ranking ' +
  '(global) or a single Prefecture\'s Ranking, using the latest monthly ' +
  'snapshot the mirror has stored. Pass scope: "overall" for the global list, ' +
  'or scope: "prefecture" with a prefecture_id for that Prefecture\'s list. ' +
  'limit defaults to 10 and is capped at 100. Results are ordered by rank ' +
  'ascending; each entry carries the Sake (with its Brewery and that ' +
  "Brewery's Prefecture nested inside), its rank, and the year_month of the " +
  'snapshot. An unknown prefecture_id yields an empty list, not an error.';

/** Default number of ranked Sakes returned when `limit` is omitted. */
export const DEFAULT_LIMIT = 10;

/** Hard ceiling on `limit`; larger values are clamped down to this, not rejected. */
export const MAX_LIMIT = 100;

/**
 * Input for `get_top_ranked`. Modelled as an object with a `superRefine` rather
 * than a discriminated union so the advertised JSON Schema has a top-level
 * `type: "object"` (the MCP SDK rejects a tool `inputSchema` whose root is a
 * `oneOf`/`anyOf`, which is what a discriminated union compiles to). The
 * refinement still enforces the spec's contract: when `scope: 'prefecture'`,
 * `prefecture_id` is REQUIRED and Zod rejects its absence. A `prefecture_id`
 * supplied with `scope: 'overall'` is accepted and ignored by the query
 * function, per spec §6 "ignore prefecture_id silently". `limit` is clamped
 * (not rejected) to `[1, 100]` in the query function.
 */
export const GetTopRankedInputSchema = z
  .object({
    scope: z.enum(['overall', 'prefecture']),
    prefecture_id: z.number().int().optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.scope === 'prefecture' && value.prefecture_id === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['prefecture_id'],
        message: "prefecture_id is required when scope is 'prefecture'",
      });
    }
  });

export type GetTopRankedInput = z.infer<typeof GetTopRankedInputSchema>;

/** A single ranked-Sake result row. */
export const RankedSakeSchema = z.object({
  sake: SakeSchema,
  rank: z.number().int(),
  year_month: z.string(),
});

export type RankedSake = z.infer<typeof RankedSakeSchema>;

export const GetTopRankedOutputSchema = z.array(RankedSakeSchema);

/**
 * Structured-content wrapper advertised as the tool's `outputSchema` and
 * returned as `structuredContent`.
 */
export const GetTopRankedStructuredSchema = z.object({
  ranked_sakes: GetTopRankedOutputSchema,
});

/** Flat row from the rankings join: the canonical Sake columns + rank columns. */
interface RankedRow extends SakeJoinRow {
  rank: number;
  year_month: string;
}

/**
 * Overall Ranking: every `rankings` row with `scope = 'overall'`, joined to the
 * canonical Sake shape, ordered by rank. The mirror stores only the latest
 * `year_month`, so no snapshot filtering is needed.
 */
const OVERALL_SQL = `
  SELECT ${SAKE_COLUMNS}, r.rank AS rank, r.year_month AS year_month
  FROM ${SAKE_FROM}
  JOIN rankings r ON r.sake_id = s.id
  WHERE r.scope = 'overall'
  ORDER BY r.rank ASC
  LIMIT $1
`;

/**
 * Prefecture Ranking: `rankings` rows scoped to one Prefecture. An unknown
 * `prefecture_id` simply matches no rows → `[]` (not an error).
 */
const PREFECTURE_SQL = `
  SELECT ${SAKE_COLUMNS}, r.rank AS rank, r.year_month AS year_month
  FROM ${SAKE_FROM}
  JOIN rankings r ON r.sake_id = s.id
  WHERE r.scope = 'prefecture' AND r.prefecture_id = $2
  ORDER BY r.rank ASC
  LIMIT $1
`;

/**
 * Query function for `get_top_ranked`. Reads `rankings` joined to the canonical
 * Sake shape, filtered by scope (and `prefecture_id` when
 * `scope: 'prefecture'`), ordered by rank ascending.
 *
 * `scope: 'overall'` ignores any `prefecture_id` silently. `scope: 'prefecture'`
 * with an unknown `prefecture_id` returns `[]` (not an error). `limit` defaults
 * to {@link DEFAULT_LIMIT} and is clamped to {@link MAX_LIMIT}.
 */
export async function getTopRanked(args: GetTopRankedInput, db: Db): Promise<RankedSake[]> {
  const limit = Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  const { rows } =
    args.scope === 'overall'
      ? await db.query<RankedRow>(OVERALL_SQL, [limit])
      : await db.query<RankedRow>(PREFECTURE_SQL, [limit, args.prefecture_id]);

  const results: RankedSake[] = rows.map((row) => ({
    sake: mapSakeRow(row),
    rank: row.rank,
    year_month: row.year_month,
  }));

  // Parse at the output boundary before returning.
  return GetTopRankedOutputSchema.parse(results);
}

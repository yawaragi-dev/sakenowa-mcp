import { z } from 'zod';
import type { Db } from '../db.js';
import { SakeSchema } from './sake.js';
import { SAKE_COLUMNS, SAKE_FROM, mapSakeRow, type SakeJoinRow } from './sake-query.js';
import { defineTool } from './tool-definition.js';

export const GET_TOP_RANKED_NAME = 'get_top_ranked';

export const GET_TOP_RANKED_DESCRIPTION =
  'Return the top-ranked sake brands by popularity from Sakenowa\'s `rankings` table, for ' +
  'either the overall ranking or a single area. Pass `scope: "overall"`, or `scope: "area"` ' +
  'with an `areaId`. `limit` defaults to 10, capped 100. Results are ordered by rank ' +
  'ascending; each carries the brand (with brewery + area) and its `rank`. An unknown ' +
  '`areaId` yields an empty list, not an error. Returns the latest ranking snapshot ' +
  'only — the canonical mirror does not retain historical monthly snapshots.';

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 100;

export const GetTopRankedInputSchema = z
  .object({
    scope: z.enum(['overall', 'area']),
    areaId: z.number().int().optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.scope === 'area' && value.areaId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['areaId'],
        message: "areaId is required when scope is 'area'",
      });
    }
  });

export type GetTopRankedInput = z.infer<typeof GetTopRankedInputSchema>;

export const RankedSakeSchema = z.object({
  sake: SakeSchema,
  rank: z.number().int(),
});

export type RankedSake = z.infer<typeof RankedSakeSchema>;

export const GetTopRankedOutputSchema = z.array(RankedSakeSchema);

interface RankedRow extends SakeJoinRow {
  rank: number;
}

const OVERALL_SQL = `
  SELECT ${SAKE_COLUMNS}, r.rank AS rank
  FROM ${SAKE_FROM}
  JOIN rankings r ON r.brand_id = s.brand_id
  WHERE r.kind = 'overall'
  ORDER BY r.rank ASC
  LIMIT $1
`;

const AREA_SQL = `
  SELECT ${SAKE_COLUMNS}, r.rank AS rank
  FROM ${SAKE_FROM}
  JOIN rankings r ON r.brand_id = s.brand_id
  WHERE r.kind = 'area' AND r.area_id = $2
  ORDER BY r.rank ASC
  LIMIT $1
`;

export async function getTopRanked(args: GetTopRankedInput, db: Db): Promise<RankedSake[]> {
  const limit = Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  const { rows } =
    args.scope === 'overall'
      ? await db.query<RankedRow>(OVERALL_SQL, [limit])
      : await db.query<RankedRow>(AREA_SQL, [limit, args.areaId]);

  const results: RankedSake[] = rows.map((row) => ({
    sake: mapSakeRow(row),
    rank: row.rank,
  }));

  return GetTopRankedOutputSchema.parse(results);
}

export const getTopRankedTool = defineTool({
  name: GET_TOP_RANKED_NAME,
  description: GET_TOP_RANKED_DESCRIPTION,
  inputSchema: GetTopRankedInputSchema,
  outputSchema: GetTopRankedOutputSchema,
  structuredKey: 'ranked_sakes',
  run: getTopRanked,
});

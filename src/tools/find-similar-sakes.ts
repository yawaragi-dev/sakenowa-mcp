import { z } from 'zod';
import type { Db } from '../db.js';
import {
  FLAVOR_AXES,
  FLAVOR_PROFILE_COLUMNS,
  FlavorProfileSchema,
  coerceFlavorProfile,
} from './flavor-profile.js';
import { SakeSchema } from './sake.js';
import { SAKE_COLUMNS, SAKE_FROM, mapSakeRow, type SakeJoinRow } from './sake-query.js';
import { defineTool } from './tool-definition.js';

export const FIND_SIMILAR_SAKES_NAME = 'find_similar_sakes';

export const FIND_SIMILAR_SAKES_DESCRIPTION =
  'Find sake brands whose 6-axis FlavorChart is most similar to a given brand — the ' +
  '"sake similar to this one" query. Similarity is cosine similarity over the Sakenowa ' +
  'FlavorChart axes f1–f6. Pass the source brand by its `brandId` and an optional `topK` ' +
  '(default 10, capped 50). Returns brands ordered by descending similarity, each with its ' +
  'brewery, area, FlavorChart and a `similarity` in [0, 1]. The source brand and any brand ' +
  'lacking a FlavorChart are excluded. An unknown `brandId` (or one with no FlavorChart) yields [].';

const DEFAULT_TOP_K = 10;
const MAX_TOP_K = 50;

export const FindSimilarSakesInputSchema = z
  .object({
    brandId: z.number().int(),
    topK: z.number().int().positive().optional(),
  })
  .strict();

export type FindSimilarSakesInput = z.infer<typeof FindSimilarSakesInputSchema>;

export const SimilarSakeSchema = z.object({
  sake: SakeSchema,
  flavorProfile: FlavorProfileSchema,
  similarity: z.number().min(0).max(1),
});

export type SimilarSake = z.infer<typeof SimilarSakeSchema>;

export const FindSimilarSakesOutputSchema = z.array(SimilarSakeSchema);

type Numeric = number | string;

interface SourceChartRow {
  f1: Numeric;
  f2: Numeric;
  f3: Numeric;
  f4: Numeric;
  f5: Numeric;
  f6: Numeric;
}

interface SimilarRow extends SakeJoinRow {
  f1: Numeric;
  f2: Numeric;
  f3: Numeric;
  f4: Numeric;
  f5: Numeric;
  f6: Numeric;
  similarity: Numeric;
}

const FLAVOR_COLUMNS = FLAVOR_AXES.join(', ');

/**
 * Cosine similarity between the source FlavorChart ($1..$6) and every other
 * brand's FlavorChart, in plain SQL. `NULLIF(...,0)` guards zero-magnitude
 * vectors. The source brand ($7) is excluded. Ties break by `brand_id ASC`.
 */
const SIMILARITY_SQL = `
  WITH scored AS (
    SELECT
      ${SAKE_COLUMNS},
      ${FLAVOR_PROFILE_COLUMNS},
      (
        fc.f1 * $1 + fc.f2 * $2 + fc.f3 * $3
        + fc.f4 * $4 + fc.f5 * $5 + fc.f6 * $6
      ) / (
        NULLIF(sqrt(fc.f1*fc.f1 + fc.f2*fc.f2 + fc.f3*fc.f3 + fc.f4*fc.f4 + fc.f5*fc.f5 + fc.f6*fc.f6), 0)
        * NULLIF(sqrt($1*$1 + $2*$2 + $3*$3 + $4*$4 + $5*$5 + $6*$6), 0)
      ) AS similarity
    FROM ${SAKE_FROM}
    JOIN flavor_charts fc ON fc.brand_id = s.brand_id
    WHERE s.brand_id <> $7
  )
  SELECT * FROM scored
  WHERE similarity IS NOT NULL
  ORDER BY similarity DESC, brand_id ASC
  LIMIT $8
`;

function clampSimilarity(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export async function findSimilarSakes(
  args: FindSimilarSakesInput,
  db: Db,
): Promise<SimilarSake[]> {
  const topK = Math.min(args.topK ?? DEFAULT_TOP_K, MAX_TOP_K);

  const source = await db.query<SourceChartRow>(
    `SELECT ${FLAVOR_COLUMNS} FROM flavor_charts WHERE brand_id = $1`,
    [args.brandId],
  );
  const sourceRow = source.rows[0];
  if (sourceRow === undefined) {
    return [];
  }
  const sourceProfile = coerceFlavorProfile(sourceRow);

  const { rows } = await db.query<SimilarRow>(SIMILARITY_SQL, [
    sourceProfile.f1,
    sourceProfile.f2,
    sourceProfile.f3,
    sourceProfile.f4,
    sourceProfile.f5,
    sourceProfile.f6,
    args.brandId,
    topK,
  ]);

  const results: SimilarSake[] = rows.map((row) => ({
    sake: mapSakeRow(row),
    flavorProfile: coerceFlavorProfile(row),
    similarity: clampSimilarity(Number(row.similarity)),
  }));

  return FindSimilarSakesOutputSchema.parse(results);
}

export const findSimilarSakesTool = defineTool({
  name: FIND_SIMILAR_SAKES_NAME,
  description: FIND_SIMILAR_SAKES_DESCRIPTION,
  inputSchema: FindSimilarSakesInputSchema,
  outputSchema: FindSimilarSakesOutputSchema,
  structuredKey: 'similar_sakes',
  run: findSimilarSakes,
});

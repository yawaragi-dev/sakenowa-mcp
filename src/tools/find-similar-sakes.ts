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

/**
 * Tool name and description advertised over MCP. The description uses the
 * domain vocabulary from CONTEXT.md — "FlavorProfile" / "6-axis flavor
 * profile", never "vector".
 */
export const FIND_SIMILAR_SAKES_NAME = 'find_similar_sakes';

export const FIND_SIMILAR_SAKES_DESCRIPTION =
  'Find Sakes whose 6-axis FlavorProfile is most similar to a given Sake — the ' +
  '"sake similar to this one" query. Similarity is the cosine similarity over ' +
  'the FlavorProfile axes (hanayaka 華やか, hojun 芳醇, juko 重厚, odayaka 穏やか, ' +
  'dry ドライ, keikai 軽快). Pass the source Sake by its numeric id (Sakenowa ' +
  'brand_id) and an optional top_k (default 10, capped at 50). Returns Sakes ' +
  'ordered by descending similarity, each with its Brewery, Prefecture, ' +
  'FlavorProfile and a similarity score in [0, 1]. The source Sake and any ' +
  'Sake lacking a FlavorProfile are excluded. An unknown id, or a source Sake ' +
  'with no FlavorProfile, yields an empty list.';

const DEFAULT_TOP_K = 10;
const MAX_TOP_K = 50;

/**
 * `find_similar_sakes` input. `top_k` is clamped (not rejected) to
 * `[1, 50]` in the query function; the schema only enforces it is a positive
 * integer when supplied.
 */
export const FindSimilarSakesInputSchema = z
  .object({
    sake_id: z.number().int(),
    top_k: z.number().int().positive().optional(),
  })
  .strict();

export type FindSimilarSakesInput = z.infer<typeof FindSimilarSakesInputSchema>;

/** A single nearest-neighbour result row. */
export const SimilarSakeSchema = z.object({
  sake: SakeSchema,
  flavor_profile: FlavorProfileSchema,
  similarity: z.number().min(0).max(1),
});

export type SimilarSake = z.infer<typeof SimilarSakeSchema>;

export const FindSimilarSakesOutputSchema = z.array(SimilarSakeSchema);

/**
 * Postgres `numeric` columns arrive over `pg` as strings; the shared
 * `coerceFlavorProfile` / `Number` normalise them to the JS numbers the output
 * schema requires.
 */
type Numeric = number | string;

/** Flat row returned by the source-profile lookup (axes may be `numeric`). */
interface SourceProfileRow {
  hanayaka: Numeric;
  hojun: Numeric;
  juko: Numeric;
  odayaka: Numeric;
  dry: Numeric;
  keikai: Numeric;
}

/** Flat row returned by the cosine-similarity query. */
interface SimilarRow extends SakeJoinRow {
  hanayaka: Numeric;
  hojun: Numeric;
  juko: Numeric;
  odayaka: Numeric;
  dry: Numeric;
  keikai: Numeric;
  similarity: Numeric;
}

const FLAVOR_COLUMNS = FLAVOR_AXES.join(', ');

/**
 * Cosine similarity between the source FlavorProfile (passed as the six
 * positional params $1..$6) and every other Sake's FlavorProfile, computed in
 * plain SQL — no `pgvector`. The formula is the explicit
 *   sim = (Σ aᵢ·bᵢ) / (sqrt(Σ aᵢ²) · sqrt(Σ bᵢ²))
 * over the six axes. `NULLIF(..., 0)` on each magnitude guards against a
 * zero-magnitude vector (all six axes 0): the division yields SQL NULL rather
 * than a divide-by-zero error, and the `WHERE similarity IS NOT NULL` filter
 * drops those rows instead of emitting NaN. The source Sake ($7) is excluded.
 * Ties on similarity break by `id ASC` for determinism.
 *
 * The Sake columns/joins and the six FlavorProfile output columns come from the
 * shared helpers; this tool splices in the cosine expression and the
 * `flavor_profiles` join.
 */
const SIMILARITY_SQL = `
  WITH scored AS (
    SELECT
      ${SAKE_COLUMNS},
      ${FLAVOR_PROFILE_COLUMNS},
      (
        fp.hanayaka * $1 + fp.hojun * $2 + fp.juko * $3
        + fp.odayaka * $4 + fp.dry * $5 + fp.keikai * $6
      ) / (
        NULLIF(
          sqrt(
            fp.hanayaka * fp.hanayaka + fp.hojun * fp.hojun + fp.juko * fp.juko
            + fp.odayaka * fp.odayaka + fp.dry * fp.dry + fp.keikai * fp.keikai
          ),
          0
        )
        * NULLIF(
          sqrt($1 * $1 + $2 * $2 + $3 * $3 + $4 * $4 + $5 * $5 + $6 * $6),
          0
        )
      ) AS similarity
    FROM ${SAKE_FROM}
    JOIN flavor_profiles fp ON fp.sake_id = s.id
    WHERE s.id <> $7
  )
  SELECT * FROM scored
  WHERE similarity IS NOT NULL
  ORDER BY similarity DESC, id ASC
  LIMIT $8
`;

/**
 * Clamp a similarity into `[0, 1]`. Cosine over non-negative Sakenowa axes is
 * already in `[0, 1]`, but axes can in principle be negative (the integration
 * fixture exercises this), and floating-point rounding can push a result a
 * hair outside the bounds; clamp defensively so the output schema (`[0, 1]`)
 * never rejects a legitimate row.
 */
function clampSimilarity(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Query function for `find_similar_sakes`. Reads the source Sake's
 * FlavorProfile, then ranks all OTHER Sakes that have a FlavorProfile by cosine
 * similarity, returning the top `top_k`.
 *
 * Returns `[]` (not an error) when the source `sake_id` matches no row, or the
 * source Sake has no FlavorProfile.
 */
export async function findSimilarSakes(
  args: FindSimilarSakesInput,
  db: Db,
): Promise<SimilarSake[]> {
  const topK = Math.min(args.top_k ?? DEFAULT_TOP_K, MAX_TOP_K);

  // Read the source FlavorProfile. No row (unknown id or no FlavorProfile) → [].
  const source = await db.query<SourceProfileRow>(
    `SELECT ${FLAVOR_COLUMNS} FROM flavor_profiles WHERE sake_id = $1`,
    [args.sake_id],
  );
  const sourceRow = source.rows[0];
  if (sourceRow === undefined) {
    return [];
  }
  const sourceProfile = coerceFlavorProfile(sourceRow);

  const { rows } = await db.query<SimilarRow>(SIMILARITY_SQL, [
    sourceProfile.hanayaka,
    sourceProfile.hojun,
    sourceProfile.juko,
    sourceProfile.odayaka,
    sourceProfile.dry,
    sourceProfile.keikai,
    args.sake_id,
    topK,
  ]);

  const results: SimilarSake[] = rows.map((row) => ({
    sake: mapSakeRow(row),
    flavor_profile: coerceFlavorProfile(row),
    similarity: clampSimilarity(Number(row.similarity)),
  }));

  // Parse at the output boundary before returning.
  return FindSimilarSakesOutputSchema.parse(results);
}

/** Registry descriptor for `find_similar_sakes`. */
export const findSimilarSakesTool = defineTool({
  name: FIND_SIMILAR_SAKES_NAME,
  description: FIND_SIMILAR_SAKES_DESCRIPTION,
  inputSchema: FindSimilarSakesInputSchema,
  outputSchema: FindSimilarSakesOutputSchema,
  structuredKey: 'similar_sakes',
  run: findSimilarSakes,
});

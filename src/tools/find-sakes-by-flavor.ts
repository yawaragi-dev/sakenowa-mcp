import { z } from 'zod';
import type { Db } from '../db.js';
import { FLAVOR_AXES, FlavorProfileSchema } from './flavor-profile.js';
import { FlavorTagSchema, type FlavorTag } from './flavor-tag.js';
import { SakeSchema } from './sake.js';
import { SAKE_COLUMNS, SAKE_FROM, mapSakeRow, type SakeJoinRow } from './sake-query.js';

/**
 * Tool name and description advertised over MCP. The description uses the
 * domain vocabulary from CONTEXT.md (Sake, FlavorProfile, FlavorAxis, FlavorTag,
 * Prefecture), never "brand"/"label"/"vector"/"area".
 */
export const FIND_SAKES_BY_FLAVOR_NAME = 'find_sakes_by_flavor';

export const FIND_SAKES_BY_FLAVOR_DESCRIPTION =
  'Filter Sakes by FlavorProfile axis ranges, FlavorTag membership, and/or ' +
  'Prefecture, combined with AND semantics across the three filter families — ' +
  'the "find me a sake that is X" query. axes constrains any of the six ' +
  'FlavorAxes (hanayaka 華やか, hojun 芳醇, juko 重厚, odayaka 穏やか, dry ドライ, ' +
  'keikai 軽快) with an optional min (default 0) and max (default 1) per axis. ' +
  'tags is a list of FlavorTag ids (e.g. 甘味 sweet, 旨味 umami) ALL of which ' +
  'must be present on the Sake. prefecture_id restricts to Sakes whose Brewery ' +
  'sits in that Prefecture. At least one of axes, tags or prefecture_id must be ' +
  'supplied. Results carry the full Sake (with its Brewery and that Brewery\'s ' +
  'Prefecture nested inside), its FlavorProfile, and its FlavorTags — so no ' +
  'follow-up get_sake_details is needed. top_k defaults to 10 and is capped at ' +
  '50; results are ordered by Sake id ascending for determinism.';

/** Default number of matched Sakes returned when `top_k` is omitted. */
export const DEFAULT_TOP_K = 10;

/** Hard ceiling on `top_k`; larger values are clamped down to this, not rejected. */
export const MAX_TOP_K = 50;

/** Lower default for a FlavorAxis range when `min` is omitted (axes are in `[0, 1]`). */
export const AXIS_MIN_DEFAULT = 0;

/** Upper default for a FlavorAxis range when `max` is omitted (axes are in `[0, 1]`). */
export const AXIS_MAX_DEFAULT = 1;

/** A single FlavorAxis range filter; each bound is independently optional. */
const AxisRangeSchema = z
  .object({
    min: z.number().optional(),
    max: z.number().optional(),
  })
  .strict();

/**
 * The optional per-axis range map. Only the axes the caller supplies are
 * constrained; the romaji axis names are the canonical identifiers (CONTEXT.md
 * "6-axis vocabulary").
 */
const AxesSchema = z
  .object({
    hanayaka: AxisRangeSchema.optional(),
    hojun: AxisRangeSchema.optional(),
    juko: AxisRangeSchema.optional(),
    odayaka: AxisRangeSchema.optional(),
    dry: AxisRangeSchema.optional(),
    keikai: AxisRangeSchema.optional(),
  })
  .strict();

/**
 * Input for `find_sakes_by_flavor`. Modelled as an object with a `superRefine`
 * (rather than a union) so the advertised JSON Schema root stays
 * `type: "object"` — the MCP SDK rejects a tool `inputSchema` whose root is a
 * `oneOf`/`anyOf`. The refinement enforces the spec's "at least one filter"
 * contract: `axes`, `tags` and `prefecture_id` are each optional, but the empty
 * combination is rejected with a clear message. An empty `axes: {}` and an
 * empty `tags: []` both count as "filter family absent" (they constrain
 * nothing), so a call carrying only those is still an empty filter. `top_k` is
 * clamped (not rejected) to `[1, 50]` in the query function.
 */
export const FindSakesByFlavorInputSchema = z
  .object({
    axes: AxesSchema.optional(),
    tags: z.array(z.number().int()).optional(),
    prefecture_id: z.number().int().optional(),
    top_k: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasAxes = value.axes !== undefined && Object.keys(value.axes).length > 0;
    const hasTags = value.tags !== undefined && value.tags.length > 0;
    const hasPrefecture = value.prefecture_id !== undefined;
    if (!hasAxes && !hasTags && !hasPrefecture) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'empty filter: supply at least one of axes, tags or prefecture_id ' +
          '(an empty axes object or empty tags list does not count as a filter)',
      });
    }
  });

export type FindSakesByFlavorInput = z.infer<typeof FindSakesByFlavorInputSchema>;

/** A single matched-Sake result row: the same shape as a `get_sake_details` hit. */
export const FlavorMatchSchema = z.object({
  sake: SakeSchema,
  flavor_profile: FlavorProfileSchema.nullable(),
  flavor_tags: z.array(FlavorTagSchema),
});

export type FlavorMatch = z.infer<typeof FlavorMatchSchema>;

export const FindSakesByFlavorOutputSchema = z.array(FlavorMatchSchema);

/**
 * Structured-content wrapper advertised as the tool's `outputSchema` and
 * returned as `structuredContent`.
 */
export const FindSakesByFlavorStructuredSchema = z.object({
  sakes: FindSakesByFlavorOutputSchema,
});

/**
 * Postgres `numeric` columns arrive over `pg` as strings; `Number` normalises
 * them to the JS numbers the FlavorProfile schema requires.
 */
type Numeric = number | string;

/**
 * Flat row from the main filter query: the canonical Sake join columns plus the
 * six FlavorProfile axes spliced in via a LEFT JOIN (NULL when the Sake has no
 * FlavorProfile row).
 */
interface MatchRow extends SakeJoinRow {
  hanayaka: Numeric | null;
  hojun: Numeric | null;
  juko: Numeric | null;
  odayaka: Numeric | null;
  dry: Numeric | null;
  keikai: Numeric | null;
}

/** Flat row from the batched FlavorTags lookup. */
interface FlavorTagRow {
  sake_id: number;
  id: number;
  name_ja: string;
}

/**
 * Build the WHERE clause fragments and bind params for the supplied filters.
 *
 * SQL strategy (all three families AND together):
 *  - areaId-0 sentinel: `p.id <> 0` is ALWAYS present, independent of whether a
 *    `prefecture_id` filter is supplied (CONTEXT.md "Flagged ambiguities") — a
 *    Sake whose Brewery sits in Prefecture 0 ("Other") must never appear.
 *  - Axis range: each supplied axis becomes `fp.<axis> BETWEEN $min AND $max`,
 *    with omitted bounds defaulting to 0 / 1. A LEFT JOIN to `flavor_profiles`
 *    means a Sake with no FlavorProfile has NULL axes; `BETWEEN` is NULL there
 *    so such a Sake is correctly excluded once any axis filter is present.
 *  - Prefecture: `p.id = $prefecture_id`.
 *  - Tags (ALL must be present): a correlated subquery over `sake_flavor_tags`
 *    with `tag_id = ANY($tags)` grouped by `sake_id` and
 *    `HAVING COUNT(DISTINCT tag_id) = <N distinct ids>`. An empty `tags: []` is
 *    treated upstream as "no tag filter" (the empty-filter refinement already
 *    rejects a call carrying nothing else), so this fragment is only emitted
 *    for a non-empty tag list.
 *
 * Bind params are appended in the order the fragments are built and the `$n`
 * placeholders are numbered to match; the caller appends the `top_k` param last.
 */
function buildFilters(args: FindSakesByFlavorInput): { clauses: string[]; params: unknown[] } {
  const clauses: string[] = ['p.id <> 0'];
  const params: unknown[] = [];
  const placeholder = (value: unknown): string => {
    params.push(value);
    return `$${String(params.length)}`;
  };

  if (args.axes !== undefined) {
    for (const axis of FLAVOR_AXES) {
      const range = args.axes[axis];
      if (range === undefined) continue;
      const min = range.min ?? AXIS_MIN_DEFAULT;
      const max = range.max ?? AXIS_MAX_DEFAULT;
      clauses.push(`fp.${axis} BETWEEN ${placeholder(min)} AND ${placeholder(max)}`);
    }
  }

  if (args.prefecture_id !== undefined) {
    clauses.push(`p.id = ${placeholder(args.prefecture_id)}`);
  }

  if (args.tags !== undefined && args.tags.length > 0) {
    // Distinct ids so a caller passing a duplicate id does not inflate the
    // required count past what any Sake can satisfy.
    const distinctTags = [...new Set(args.tags)];
    const tagsParam = placeholder(distinctTags);
    const countParam = placeholder(distinctTags.length);
    clauses.push(
      `s.id IN (
        SELECT sft.sake_id
        FROM sake_flavor_tags sft
        WHERE sft.tag_id = ANY(${tagsParam})
        GROUP BY sft.sake_id
        HAVING COUNT(DISTINCT sft.tag_id) = ${countParam}
      )`,
    );
  }

  return { clauses, params };
}

/**
 * Query function for `find_sakes_by_flavor`. Runs a constant, small number of
 * queries regardless of result count (avoiding the N+1 trap):
 *
 *  1. ONE filter query joining the canonical Sake shape to `flavor_profiles`
 *     (LEFT JOIN, so the FlavorProfile may be NULL), applying every supplied
 *     filter plus the always-on areaId-0 exclusion, ordered by `s.id ASC` and
 *     limited to `top_k`.
 *  2. ONE batched FlavorTags query for ALL matched Sake ids
 *     (`sft.sake_id = ANY($1)`), grouped in JS — so a 50-result call still
 *     issues exactly two queries, not 51. Skipped entirely when nothing matched.
 *
 * The empty-filter contract is enforced by the input schema's `superRefine`, so
 * by the time this runs at least one filter family is present.
 */
export async function findSakesByFlavor(
  args: FindSakesByFlavorInput,
  db: Db,
): Promise<FlavorMatch[]> {
  const topK = Math.min(args.top_k ?? DEFAULT_TOP_K, MAX_TOP_K);

  const { clauses, params } = buildFilters(args);
  const limitParam = `$${String(params.length + 1)}`;
  params.push(topK);

  const filterSql = `
    SELECT
      ${SAKE_COLUMNS},
      fp.hanayaka, fp.hojun, fp.juko, fp.odayaka, fp.dry, fp.keikai
    FROM ${SAKE_FROM}
    LEFT JOIN flavor_profiles fp ON fp.sake_id = s.id
    WHERE ${clauses.join('\n      AND ')}
    ORDER BY s.id ASC
    LIMIT ${limitParam}
  `;

  const { rows } = await db.query<MatchRow>(filterSql, params);

  if (rows.length === 0) {
    return FindSakesByFlavorOutputSchema.parse([]);
  }

  const sakeIds = rows.map((row) => row.id);

  // One batched tags query for every matched Sake; grouped in JS below.
  const tagsResult = await db.query<FlavorTagRow>(
    `SELECT sft.sake_id AS sake_id, ft.id AS id, ft.name_ja AS name_ja
     FROM sake_flavor_tags sft
     JOIN flavor_tags ft ON ft.id = sft.tag_id
     WHERE sft.sake_id = ANY($1)
     ORDER BY sft.sake_id ASC, ft.id ASC`,
    [sakeIds],
  );

  const tagsBySake = new Map<number, FlavorTag[]>();
  for (const tagRow of tagsResult.rows) {
    const list = tagsBySake.get(tagRow.sake_id) ?? [];
    list.push({ id: tagRow.id, name_ja: tagRow.name_ja });
    tagsBySake.set(tagRow.sake_id, list);
  }

  const results: FlavorMatch[] = rows.map((row) => {
    // The LEFT JOIN leaves every axis NULL together when there is no
    // FlavorProfile row; checking one axis is sufficient to detect that case.
    const flavorProfile =
      row.hanayaka !== null
        ? {
            hanayaka: Number(row.hanayaka),
            hojun: Number(row.hojun),
            juko: Number(row.juko),
            odayaka: Number(row.odayaka),
            dry: Number(row.dry),
            keikai: Number(row.keikai),
          }
        : null;

    return {
      sake: mapSakeRow(row),
      flavor_profile: flavorProfile,
      flavor_tags: tagsBySake.get(row.id) ?? [],
    };
  });

  // Parse at the output boundary before returning.
  return FindSakesByFlavorOutputSchema.parse(results);
}

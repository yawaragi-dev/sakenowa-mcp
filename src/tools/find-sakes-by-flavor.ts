import { z } from 'zod';
import type { Db } from '../db.js';
import {
  FLAVOR_AXES,
  FLAVOR_PROFILE_COLUMNS,
  FlavorProfileSchema,
  mapFlavorProfile,
} from './flavor-profile.js';
import { SakeSchema } from './sake.js';
import { SAKE_COLUMNS, SAKE_FROM, mapSakeRow, type SakeJoinRow } from './sake-query.js';
import { defineTool } from './tool-definition.js';

export const FIND_SAKES_BY_FLAVOR_NAME = 'find_sakes_by_flavor';

export const FIND_SAKES_BY_FLAVOR_DESCRIPTION =
  'Filter sake brands by FlavorChart axis ranges and/or area, combined with AND semantics. ' +
  'Each of the six axes f1–f6 takes an optional `f{n}Min` (default 0) and `f{n}Max` ' +
  '(default 1) — e.g. f1Min/f1Max. `areaId` restricts to brands whose brewery sits in that ' +
  'area. At least one of an axis bound or `areaId` must be supplied. NOTE: a `tags` filter ' +
  'is accepted but currently a no-op — the canonical Sakenowa mirror has no brand↔tag ' +
  'junction (see schema audit). Results carry the brand (with brewery + area) and its ' +
  'FlavorChart. `topK` defaults to 10, capped 50; ordered by brandId ascending.';

export const DEFAULT_TOP_K = 10;
export const MAX_TOP_K = 50;
export const AXIS_MIN_DEFAULT = 0;
export const AXIS_MAX_DEFAULT = 1;

const axisBound = z.number().finite().optional();

export const FindSakesByFlavorInputSchema = z
  .object({
    f1Min: axisBound,
    f1Max: axisBound,
    f2Min: axisBound,
    f2Max: axisBound,
    f3Min: axisBound,
    f3Max: axisBound,
    f4Min: axisBound,
    f4Max: axisBound,
    f5Min: axisBound,
    f5Max: axisBound,
    f6Min: axisBound,
    f6Max: axisBound,
    tags: z.array(z.number().int()).optional(),
    areaId: z.number().int().optional(),
    topK: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasAxis = FLAVOR_AXES.some(
      (axis) => value[`${axis}Min`] !== undefined || value[`${axis}Max`] !== undefined,
    );
    const hasArea = value.areaId !== undefined;
    if (!hasAxis && !hasArea) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'empty filter: supply at least one axis bound (f1Min … f6Max) or an areaId ' +
          '(a tags filter alone does not count — tags are not yet backed by the mirror)',
      });
    }
  });

export type FindSakesByFlavorInput = z.infer<typeof FindSakesByFlavorInputSchema>;

export const FlavorMatchSchema = z.object({
  sake: SakeSchema,
  flavorProfile: FlavorProfileSchema.nullable(),
});

export type FlavorMatch = z.infer<typeof FlavorMatchSchema>;

export const FindSakesByFlavorOutputSchema = z.array(FlavorMatchSchema);

type Numeric = number | string;

interface MatchRow extends SakeJoinRow {
  f1: Numeric | null;
  f2: Numeric | null;
  f3: Numeric | null;
  f4: Numeric | null;
  f5: Numeric | null;
  f6: Numeric | null;
}

/**
 * Build WHERE fragments. `a.area_id <> 0` (sentinel) is ALWAYS present. Each
 * supplied axis bound becomes `fc.<axis> BETWEEN min AND max` (defaults 0/1)
 * over a LEFT JOIN — a brand without a FlavorChart has NULL axes and is dropped
 * once any axis filter is present. `tags` is intentionally not applied (no
 * brand↔tag junction in the canonical mirror).
 */
function buildFilters(args: FindSakesByFlavorInput): { clauses: string[]; params: unknown[] } {
  const clauses: string[] = ['a.area_id <> 0'];
  const params: unknown[] = [];
  const placeholder = (value: unknown): string => {
    params.push(value);
    return `$${String(params.length)}`;
  };

  for (const axis of FLAVOR_AXES) {
    const min = args[`${axis}Min`];
    const max = args[`${axis}Max`];
    if (min === undefined && max === undefined) continue;
    const lo = min ?? AXIS_MIN_DEFAULT;
    const hi = max ?? AXIS_MAX_DEFAULT;
    clauses.push(`fc.${axis} BETWEEN ${placeholder(lo)} AND ${placeholder(hi)}`);
  }

  if (args.areaId !== undefined) {
    clauses.push(`a.area_id = ${placeholder(args.areaId)}`);
  }

  return { clauses, params };
}

export async function findSakesByFlavor(
  args: FindSakesByFlavorInput,
  db: Db,
): Promise<FlavorMatch[]> {
  const topK = Math.min(args.topK ?? DEFAULT_TOP_K, MAX_TOP_K);

  const { clauses, params } = buildFilters(args);
  const limitParam = `$${String(params.length + 1)}`;
  params.push(topK);

  const sql = `
    SELECT
      ${SAKE_COLUMNS},
      ${FLAVOR_PROFILE_COLUMNS}
    FROM ${SAKE_FROM}
    LEFT JOIN flavor_charts fc ON fc.brand_id = s.brand_id
    WHERE ${clauses.join('\n      AND ')}
    ORDER BY s.brand_id ASC
    LIMIT ${limitParam}
  `;

  const { rows } = await db.query<MatchRow>(sql, params);

  const results: FlavorMatch[] = rows.map((row) => ({
    sake: mapSakeRow(row),
    flavorProfile: mapFlavorProfile(row),
  }));

  return FindSakesByFlavorOutputSchema.parse(results);
}

export const findSakesByFlavorTool = defineTool({
  name: FIND_SAKES_BY_FLAVOR_NAME,
  description: FIND_SAKES_BY_FLAVOR_DESCRIPTION,
  inputSchema: FindSakesByFlavorInputSchema,
  outputSchema: FindSakesByFlavorOutputSchema,
  structuredKey: 'sakes',
  run: findSakesByFlavor,
});

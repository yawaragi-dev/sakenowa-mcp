import { z } from 'zod';
import type { Db } from '../db.js';
import {
  FLAVOR_PROFILE_COLUMNS,
  FlavorProfileSchema,
  mapFlavorProfile,
} from './flavor-profile.js';
import { FlavorTagSchema } from './flavor-tag.js';
import { SakeSchema } from './sake.js';
import { SAKE_COLUMNS, SAKE_FROM, mapSakeRow, type SakeJoinRow } from './sake-query.js';
import { defineTool } from './tool-definition.js';

export const GET_SAKE_DETAILS_NAME = 'get_sake_details';

export const GET_SAKE_DETAILS_DESCRIPTION =
  'Return everything the server knows about one sake brand, identified by its Sakenowa ' +
  '`brandId`. The result carries the brand (with its brewery and that brewery\'s area ' +
  'nested inside) and its 6-axis FlavorChart (`f1`–`f6`). NOTE: per-brand FlavorTags are ' +
  'not available in the canonical Sakenowa mirror (no junction table), so `flavorTags` is ' +
  'always empty for now. A brand with no FlavorChart yields `flavorProfile: null`. An ' +
  'unknown `brandId` yields an explicit `{ found: false, brandId }` result, not an error.';

export const GetSakeDetailsInputSchema = z
  .object({
    brandId: z.number().int(),
  })
  .strict();

export type GetSakeDetailsInput = z.infer<typeof GetSakeDetailsInputSchema>;

export const GetSakeDetailsOutputSchema = z.discriminatedUnion('found', [
  z.object({
    found: z.literal(false),
    brandId: z.number().int(),
  }),
  z.object({
    found: z.literal(true),
    sake: SakeSchema,
    flavorProfile: FlavorProfileSchema.nullable(),
    flavorTags: z.array(FlavorTagSchema),
  }),
]);

export type GetSakeDetailsOutput = z.infer<typeof GetSakeDetailsOutputSchema>;

type Numeric = number | string;

interface BrandWithChartRow extends SakeJoinRow {
  f1: Numeric | null;
  f2: Numeric | null;
  f3: Numeric | null;
  f4: Numeric | null;
  f5: Numeric | null;
  f6: Numeric | null;
}

const BRAND_WITH_CHART_SQL = `
  SELECT
    ${SAKE_COLUMNS},
    ${FLAVOR_PROFILE_COLUMNS}
  FROM ${SAKE_FROM}
  LEFT JOIN flavor_charts fc ON fc.brand_id = s.brand_id
  WHERE s.brand_id = $1
`;

/**
 * Reads the brand (with brewery + area + optional FlavorChart). Returns
 * `{ found: false, brandId }` when no brand matches (not an error). `flavorTags`
 * is always `[]` — the canonical Sakenowa mirror has no brand↔tag junction
 * (see docs/specs/schema-audit-v0.1.1.md).
 */
export async function getSakeDetails(
  args: GetSakeDetailsInput,
  db: Db,
): Promise<GetSakeDetailsOutput> {
  const result = await db.query<BrandWithChartRow>(BRAND_WITH_CHART_SQL, [args.brandId]);
  const row = result.rows[0];
  if (row === undefined) {
    return GetSakeDetailsOutputSchema.parse({ found: false, brandId: args.brandId });
  }

  return GetSakeDetailsOutputSchema.parse({
    found: true,
    sake: mapSakeRow(row),
    flavorProfile: mapFlavorProfile(row),
    flavorTags: [],
  });
}

export const getSakeDetailsTool = defineTool({
  name: GET_SAKE_DETAILS_NAME,
  description: GET_SAKE_DETAILS_DESCRIPTION,
  inputSchema: GetSakeDetailsInputSchema,
  outputSchema: GetSakeDetailsOutputSchema,
  structuredKey: 'details',
  run: getSakeDetails,
});

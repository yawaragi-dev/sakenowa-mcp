import { z } from 'zod';
import type { Db } from '../db.js';
import {
  FLAVOR_PROFILE_COLUMNS,
  FlavorProfileSchema,
  mapFlavorProfile,
} from './flavor-profile.js';
import { FlavorTagSchema } from './flavor-tag.js';
import { fetchFlavorTagsBySake } from './flavor-tag-query.js';
import { SakeSchema } from './sake.js';
import { SAKE_COLUMNS, SAKE_FROM, mapSakeRow, type SakeJoinRow } from './sake-query.js';
import { defineTool } from './tool-definition.js';

/**
 * Tool name and description advertised over MCP. The description uses the
 * domain vocabulary from CONTEXT.md (Sake, FlavorProfile, FlavorTag), never
 * "brand"/"label"/"vector".
 */
export const GET_SAKE_DETAILS_NAME = 'get_sake_details';

export const GET_SAKE_DETAILS_DESCRIPTION =
  'Return everything the server knows about one Sake, identified by its numeric ' +
  'id (Sakenowa brand_id) — the "tell me about this sake" query. The result ' +
  'carries the Sake (with its Brewery and that Brewery\'s Prefecture nested ' +
  'inside), its 6-axis FlavorProfile (hanayaka 華やか, hojun 芳醇, juko 重厚, ' +
  'odayaka 穏やか, dry ドライ, keikai 軽快), and its FlavorTags (discrete ' +
  'categorical tags such as 甘味 sweet or 旨味 umami). A Sake with no ' +
  'FlavorProfile yields flavor_profile: null; a Sake with no tags yields an ' +
  'empty flavor_tags list. An unknown id yields an explicit not-found result ' +
  '({ found: false, sake_id }), not an error.';

/** Input for `get_sake_details`. */
export const GetSakeDetailsInputSchema = z
  .object({
    sake_id: z.number().int(),
  })
  .strict();

export type GetSakeDetailsInput = z.infer<typeof GetSakeDetailsInputSchema>;

/**
 * Output is a discriminated union on `found`: a missing Sake is an explicit
 * result (`{ found: false, sake_id }`), never an MCP error (spec §3, "Error
 * handling"). The found branch nests Brewery + Prefecture inside `sake` (the
 * canonical shape set by S2/S5), so brewery/prefecture are not repeated at the
 * top level — this reconciles issue #5's loose `{ sake, ..., brewery,
 * prefecture }` wording with the established nested convention.
 */
export const GetSakeDetailsOutputSchema = z.discriminatedUnion('found', [
  z.object({
    found: z.literal(false),
    sake_id: z.number().int(),
  }),
  z.object({
    found: z.literal(true),
    sake: SakeSchema,
    flavor_profile: FlavorProfileSchema.nullable(),
    flavor_tags: z.array(FlavorTagSchema),
  }),
]);

export type GetSakeDetailsOutput = z.infer<typeof GetSakeDetailsOutputSchema>;

/**
 * Postgres `numeric` columns arrive over `pg` as strings, and the LEFT JOIN
 * leaves the axes `null` when a Sake has no FlavorProfile; `mapFlavorProfile`
 * normalises both.
 */
type Numeric = number | string;

/**
 * Flat row from the Sake + FlavorProfile lookup. The FlavorProfile columns are
 * `null` when the LEFT JOIN finds no `flavor_profiles` row.
 */
interface SakeWithProfileRow extends SakeJoinRow {
  hanayaka: Numeric | null;
  hojun: Numeric | null;
  juko: Numeric | null;
  odayaka: Numeric | null;
  dry: Numeric | null;
  keikai: Numeric | null;
}

/**
 * Sake + FlavorProfile in one query: the canonical Sake join (Brewery +
 * Prefecture) with the six FlavorProfile axes spliced in via a LEFT JOIN, so a
 * Sake without a FlavorProfile still returns its row (axes NULL).
 */
const SAKE_WITH_PROFILE_SQL = `
  SELECT
    ${SAKE_COLUMNS},
    ${FLAVOR_PROFILE_COLUMNS}
  FROM ${SAKE_FROM}
  LEFT JOIN flavor_profiles fp ON fp.sake_id = s.id
  WHERE s.id = $1
`;

/**
 * Query function for `get_sake_details`. Reads the Sake (with Brewery,
 * Prefecture and an optional FlavorProfile), then its FlavorTags via the shared
 * batched lookup (a one-element id list here).
 *
 * Returns `{ found: false, sake_id }` when no Sake matches the id (not an
 * error). A found Sake with no FlavorProfile yields `flavor_profile: null`; one
 * with no tags yields `flavor_tags: []`.
 */
export async function getSakeDetails(
  args: GetSakeDetailsInput,
  db: Db,
): Promise<GetSakeDetailsOutput> {
  const sakeResult = await db.query<SakeWithProfileRow>(SAKE_WITH_PROFILE_SQL, [args.sake_id]);
  const row = sakeResult.rows[0];
  if (row === undefined) {
    return GetSakeDetailsOutputSchema.parse({ found: false, sake_id: args.sake_id });
  }

  const tagsBySake = await fetchFlavorTagsBySake(db, [args.sake_id]);

  return GetSakeDetailsOutputSchema.parse({
    found: true,
    sake: mapSakeRow(row),
    flavor_profile: mapFlavorProfile(row),
    flavor_tags: tagsBySake.get(args.sake_id) ?? [],
  });
}

/** Registry descriptor for `get_sake_details`. */
export const getSakeDetailsTool = defineTool({
  name: GET_SAKE_DETAILS_NAME,
  description: GET_SAKE_DETAILS_DESCRIPTION,
  inputSchema: GetSakeDetailsInputSchema,
  outputSchema: GetSakeDetailsOutputSchema,
  structuredKey: 'details',
  run: getSakeDetails,
});

import { z } from 'zod';

/**
 * The six FlavorAxes of a FlavorProfile, in canonical order. Romaji names are
 * the canonical identifiers (never `f1..f6`, which is a Sakenowa storage
 * detail). See CONTEXT.md "6-axis vocabulary".
 */
export const FLAVOR_AXES = [
  'hanayaka',
  'hojun',
  'juko',
  'odayaka',
  'dry',
  'keikai',
] as const;

export type FlavorAxis = (typeof FLAVOR_AXES)[number];

/**
 * FlavorProfile — the continuous 6-tuple attached to a Sake along the Sakenowa
 * aroma/body/dryness axes (`hanayaka`, `hojun`, `juko`, `odayaka`, `dry`,
 * `keikai`). Each axis is a float; Sakenowa publishes them in `[0, 1]`. Used
 * for similarity ("sake similar to this one"), NOT for hard filters like
 * "sweet" or "umami" (those are FlavorTags). See CONTEXT.md "FlavorProfile".
 */
export const FlavorProfileSchema = z.object({
  hanayaka: z.number(),
  hojun: z.number(),
  juko: z.number(),
  odayaka: z.number(),
  dry: z.number(),
  keikai: z.number(),
});

export type FlavorProfile = z.infer<typeof FlavorProfileSchema>;

/**
 * SQL select-list fragment for the six FlavorProfile axes, qualified to the
 * `flavor_profiles` alias `fp`. Compose after a base column list:
 *   `SELECT ${SAKE_COLUMNS}, ${FLAVOR_PROFILE_COLUMNS} FROM … LEFT JOIN flavor_profiles fp …`
 * Each axis returns under its own romaji name, so a row satisfies
 * {@link FlavorProfileColumns}.
 */
export const FLAVOR_PROFILE_COLUMNS = FLAVOR_AXES.map((axis) => `fp.${axis}`).join(', ');

/**
 * The six axis columns as they arrive over `pg`: a `numeric` column comes back
 * as a string, and a LEFT JOIN that matched no `flavor_profiles` row leaves
 * every axis `null`. {@link mapFlavorProfile} / {@link coerceFlavorProfile}
 * normalise both representations.
 */
export interface FlavorProfileColumns {
  hanayaka: number | string | null;
  hojun: number | string | null;
  juko: number | string | null;
  odayaka: number | string | null;
  dry: number | string | null;
  keikai: number | string | null;
}

/**
 * Coerce the six axis columns into a {@link FlavorProfile}, turning pg's
 * `numeric`-as-string into the numbers the schema requires. Assumes the
 * FlavorProfile is present — use {@link mapFlavorProfile} when it may be absent.
 */
export function coerceFlavorProfile(row: FlavorProfileColumns): FlavorProfile {
  return {
    hanayaka: Number(row.hanayaka),
    hojun: Number(row.hojun),
    juko: Number(row.juko),
    odayaka: Number(row.odayaka),
    dry: Number(row.dry),
    keikai: Number(row.keikai),
  };
}

/**
 * Map the six axis columns to a {@link FlavorProfile}, or `null` when the Sake
 * has no FlavorProfile. A LEFT JOIN leaves every axis `null` together, so a
 * `null` first axis signals an absent profile.
 */
export function mapFlavorProfile(row: FlavorProfileColumns): FlavorProfile | null {
  return row.hanayaka === null ? null : coerceFlavorProfile(row);
}

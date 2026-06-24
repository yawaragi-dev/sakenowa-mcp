import { z } from 'zod';

/**
 * The six FlavorChart axes, in canonical Sakenowa order. Sakenowa's
 * `flavor_charts` table stores them as `f1`–`f6` (NUMERIC in [0,1]); the romaji
 * labels (hanayaka…keikai) are display-only and not used on the wire.
 */
export const FLAVOR_AXES = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'] as const;

export type FlavorAxis = (typeof FLAVOR_AXES)[number];

/**
 * FlavorChart — the 6-axis flavor vector attached to a brand in Sakenowa's
 * `flavor_charts` table. Each axis is a float in `[0, 1]`.
 */
export const FlavorProfileSchema = z.object({
  f1: z.number(),
  f2: z.number(),
  f3: z.number(),
  f4: z.number(),
  f5: z.number(),
  f6: z.number(),
});

export type FlavorProfile = z.infer<typeof FlavorProfileSchema>;

/**
 * SQL select-list fragment for the six axes, qualified to the `flavor_charts`
 * alias `fc`. Compose after a base column list.
 */
export const FLAVOR_PROFILE_COLUMNS = FLAVOR_AXES.map((axis) => `fc.${axis}`).join(', ');

/** The six axis columns as they arrive over `pg` (numeric-as-string, or null on a LEFT JOIN miss). */
export interface FlavorProfileColumns {
  f1: number | string | null;
  f2: number | string | null;
  f3: number | string | null;
  f4: number | string | null;
  f5: number | string | null;
  f6: number | string | null;
}

/** Coerce the six axis columns into a {@link FlavorProfile} (assumes present). */
export function coerceFlavorProfile(row: FlavorProfileColumns): FlavorProfile {
  return {
    f1: Number(row.f1),
    f2: Number(row.f2),
    f3: Number(row.f3),
    f4: Number(row.f4),
    f5: Number(row.f5),
    f6: Number(row.f6),
  };
}

/** Map the six axis columns to a {@link FlavorProfile}, or `null` when absent (LEFT JOIN leaves all axes null). */
export function mapFlavorProfile(row: FlavorProfileColumns): FlavorProfile | null {
  return row.f1 === null ? null : coerceFlavorProfile(row);
}

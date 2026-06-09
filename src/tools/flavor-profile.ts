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

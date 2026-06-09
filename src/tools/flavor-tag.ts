import { z } from 'zod';

/**
 * FlavorTag — a discrete categorical tag attached to a Sake from Sakenowa's
 * 117-tag vocabulary (e.g. `甘味` sweet, `旨味` umami, `酸味` acidic, `フルーティ`
 * fruity). Used for hard filters that the continuous 6-axis FlavorProfile cannot
 * answer; a Sake has zero or more FlavorTags. See CONTEXT.md "FlavorTag".
 *
 * Only `id` and the Japanese name are mirrored — there is no `name_romaji` for
 * tags, so (unlike Sake / Brewery / Prefecture) this schema carries `name_ja`
 * alone.
 */
export const FlavorTagSchema = z.object({
  id: z.number().int(),
  name_ja: z.string(),
});

export type FlavorTag = z.infer<typeof FlavorTagSchema>;

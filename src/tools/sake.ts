import { z } from 'zod';
import { BrewerySchema } from './brewery.js';
import { PrefectureSchema } from './prefecture.js';

/**
 * Sake — a sake product line (銘柄, *meigara*) produced by a single Brewery
 * (see CONTEXT.md). Sakenowa calls this `brand`; this server renames it to Sake
 * to avoid colliding with the colloquial English "brand" (= the company).
 *
 * Each Sake carries its full Brewery and that Brewery's Prefecture so consumers
 * can disambiguate without a follow-up call — necessary because `name_romaji`
 * is not unique across Sakes (see CONTEXT.md "Same-romaji collisions"). The
 * nested `prefecture` is the Brewery's Prefecture, not a property of the Sake
 * itself.
 */
export const SakeSchema = z.object({
  id: z.number().int(),
  name_ja: z.string(),
  name_romaji: z.string(),
  brewery: BrewerySchema,
  prefecture: PrefectureSchema,
});

export type Sake = z.infer<typeof SakeSchema>;

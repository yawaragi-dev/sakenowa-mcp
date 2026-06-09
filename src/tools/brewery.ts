import { z } from 'zod';

/**
 * Brewery — the company that produces Sakes (酒蔵, *sakagura*). Matches
 * Sakenowa's `brewery` 1:1 (see CONTEXT.md). A Brewery is located in exactly
 * one Prefecture.
 *
 * `name_ja` is the original Japanese (source of truth); `name_romaji` is a
 * Latin-alphabet transliteration produced by the consumer's ingest, returned
 * as-is. Neither is guaranteed unique — distinct Japanese names can share a
 * romaji (see CONTEXT.md "Same-romaji collisions").
 */
export const BrewerySchema = z.object({
  id: z.number().int(),
  name_ja: z.string(),
  name_romaji: z.string(),
});

export type Brewery = z.infer<typeof BrewerySchema>;

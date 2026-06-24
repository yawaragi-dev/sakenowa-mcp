import { z } from 'zod';

/**
 * The company that produces sake brands — Sakenowa's `breweries` table.
 * `name` is the Sakenowa-published Japanese name; `nameRomaji` is a nullable
 * consumer-enrichment column (null until the consumer's romaji ingest runs).
 */
export const BrewerySchema = z.object({
  breweryId: z.number().int(),
  name: z.string(),
  nameRomaji: z.string().nullable(),
});

export type Brewery = z.infer<typeof BrewerySchema>;

import { z } from 'zod';
import { BrewerySchema } from './brewery.js';
import { PrefectureSchema } from './prefecture.js';

/**
 * A sake product line — Sakenowa calls it a "brand" (`brands` table, PK
 * `brand_id`). The canonical Sakenowa-mirror shape; v0.1.0 wrongly assumed a
 * `sakes` table with `sake_id`/`name_ja`. `name` is the Sakenowa-published
 * name; `nameRomaji` is nullable consumer enrichment. The nested `brewery` and
 * `area` are the producing brewery and that brewery's area.
 */
export const SakeSchema = z.object({
  brandId: z.number().int(),
  name: z.string(),
  nameRomaji: z.string().nullable(),
  brewery: BrewerySchema,
  area: PrefectureSchema,
});

export type Sake = z.infer<typeof SakeSchema>;

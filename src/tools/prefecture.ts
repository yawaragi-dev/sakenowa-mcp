import { z } from 'zod';

/**
 * Prefecture — a Japanese administrative region, one of the 47 prefectures
 * (e.g. Niigata, Yamaguchi). Sakenowa calls this `area`; this server renames
 * it to Prefecture per CONTEXT.md.
 *
 * `name_ja` is the original Japanese (source of truth); `name_romaji` is a
 * Latin-alphabet transliteration produced by the consumer's ingest, returned
 * as-is.
 */
export const PrefectureSchema = z.object({
  id: z.number().int(),
  name_ja: z.string(),
  name_romaji: z.string(),
});

export type Prefecture = z.infer<typeof PrefectureSchema>;

import { z } from 'zod';

/**
 * A Japanese administrative region — one of Sakenowa's `areas` (the canonical
 * Sakenowa-mirror table; v0.1.0 wrongly assumed a `prefectures` table). Sakenowa
 * publishes only the Japanese `name`; there is no romaji for areas.
 * `areaId = 0` is the "その他" (Other) sentinel and is excluded from results.
 */
export const PrefectureSchema = z.object({
  areaId: z.number().int(),
  name: z.string(),
});

export type Prefecture = z.infer<typeof PrefectureSchema>;

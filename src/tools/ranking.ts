import { z } from 'zod';

/**
 * A brand's position in a Sakenowa popularity ranking (`rankings` table).
 * `kind` is `'overall'` or `'area'`; `areaId` is null for overall. There is no
 * `year_month` column in the canonical mirror.
 */
export const RankingSchema = z.object({
  kind: z.enum(['overall', 'area']),
  areaId: z.number().int().nullable(),
  brandId: z.number().int(),
  rank: z.number().int(),
  score: z.number(),
});

export type Ranking = z.infer<typeof RankingSchema>;

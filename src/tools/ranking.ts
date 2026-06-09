import { z } from 'zod';

/**
 * Ranking — a single Sake's position-and-score within a popularity list, for a
 * specific month. Scope is either *overall* (global top 100) or a single
 * Prefecture (regional top N). A Sake has zero or more Rankings. The
 * `year_month` records which monthly snapshot the position came from; the mirror
 * stores only the latest snapshot, never historical. See CONTEXT.md "Ranking".
 *
 * `prefecture_id` is `null` when `scope` is `'overall'` and the owning
 * Prefecture's id when `scope` is `'prefecture'`. `score` is nullable because
 * the mirror's `score` column is `numeric` (nullable) per the spec's Expected DB
 * schema.
 */
export const RankingSchema = z.object({
  scope: z.enum(['overall', 'prefecture']),
  prefecture_id: z.number().int().nullable(),
  sake_id: z.number().int(),
  rank: z.number().int(),
  score: z.number().nullable(),
  year_month: z.string(),
});

export type Ranking = z.infer<typeof RankingSchema>;

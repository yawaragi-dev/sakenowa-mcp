import { z } from 'zod';

/**
 * A discrete flavor tag from Sakenowa's `flavor_tags` vocabulary (`tag_id`,
 * `name`). NOTE: the canonical Sakenowa mirror has NO brand↔tag junction table,
 * so the per-brand tag association is currently unavailable — see
 * `docs/specs/schema-audit-v0.1.1.md`.
 */
export const FlavorTagSchema = z.object({
  tagId: z.number().int(),
  name: z.string(),
});

export type FlavorTag = z.infer<typeof FlavorTagSchema>;

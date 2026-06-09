import type { Db } from '../db.js';
import type { FlavorTag } from './flavor-tag.js';

/** Flat row from the `sake_flavor_tags` × `flavor_tags` junction join. */
interface FlavorTagRow {
  sake_id: number;
  id: number;
  name_ja: string;
}

/**
 * Fetch the FlavorTags for the given Sake ids in a single query (no N+1),
 * grouped by Sake id and ordered by tag id within each Sake. Sakes with no tags
 * are simply absent from the returned map — callers default to `[]`. The
 * single-Sake case is just a one-element id list. An empty id list issues no
 * query and returns an empty map.
 */
export async function fetchFlavorTagsBySake(
  db: Db,
  sakeIds: number[],
): Promise<Map<number, FlavorTag[]>> {
  const tagsBySake = new Map<number, FlavorTag[]>();
  if (sakeIds.length === 0) {
    return tagsBySake;
  }

  const { rows } = await db.query<FlavorTagRow>(
    `SELECT sft.sake_id AS sake_id, ft.id AS id, ft.name_ja AS name_ja
     FROM sake_flavor_tags sft
     JOIN flavor_tags ft ON ft.id = sft.tag_id
     WHERE sft.sake_id = ANY($1)
     ORDER BY sft.sake_id ASC, ft.id ASC`,
    [sakeIds],
  );

  for (const row of rows) {
    const list = tagsBySake.get(row.sake_id) ?? [];
    list.push({ id: row.id, name_ja: row.name_ja });
    tagsBySake.set(row.sake_id, list);
  }
  return tagsBySake;
}

import { z } from 'zod';
import type { Db } from '../db.js';
import { PrefectureSchema, type Prefecture } from './prefecture.js';

/**
 * Tool name and description advertised over MCP. The description uses the
 * domain vocabulary from CONTEXT.md (Prefecture, not "area"/"region").
 */
export const LIST_PREFECTURES_NAME = 'list_prefectures';

export const LIST_PREFECTURES_DESCRIPTION =
  "Enumerate Japan's 47 Prefectures (e.g. Niigata, Yamaguchi) so you can suggest " +
  'valid Prefecture filter targets to the user. Each Prefecture has a numeric id, ' +
  'a Japanese name (name_ja) and a romaji transliteration (name_romaji). The ' +
  '"Other" sentinel (id 0, for breweries with no assigned Prefecture) is excluded.';

/** `list_prefectures` takes no input. */
export const ListPrefecturesInputSchema = z.object({}).strict();

export const ListPrefecturesOutputSchema = z.array(PrefectureSchema);

interface PrefectureRow {
  id: number;
  name_ja: string;
  name_romaji: string;
}

/**
 * Query function for `list_prefectures`. Returns the 47 real Prefectures
 * ordered by id, excluding the `areaId: 0` "Other" sentinel (see CONTEXT.md
 * "Flagged ambiguities").
 */
export async function listPrefectures(
  _args: z.infer<typeof ListPrefecturesInputSchema>,
  db: Db,
): Promise<Prefecture[]> {
  const { rows } = await db.query<PrefectureRow>(
    'SELECT id, name_ja, name_romaji FROM prefectures WHERE id <> 0 ORDER BY id',
  );

  // Parse at the output boundary before returning.
  return ListPrefecturesOutputSchema.parse(rows);
}

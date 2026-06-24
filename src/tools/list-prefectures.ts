import { z } from 'zod';
import type { Db } from '../db.js';
import { PrefectureSchema, type Prefecture } from './prefecture.js';
import { defineTool } from './tool-definition.js';

export const LIST_PREFECTURES_NAME = 'list_prefectures';

export const LIST_PREFECTURES_DESCRIPTION =
  "Enumerate Japan's areas (prefectures) from the Sakenowa `areas` table so you can " +
  'suggest valid area filter targets. Each entry has a numeric `areaId` and a Japanese ' +
  '`name` (e.g. 北海道, 沖縄県). The "その他" (Other) sentinel, `areaId` 0, is excluded.';

export const ListPrefecturesInputSchema = z.object({}).strict();

export const ListPrefecturesOutputSchema = z.array(PrefectureSchema);

interface AreaRow {
  area_id: number;
  name: string;
}

/** Returns the real areas ordered by id, excluding the `areaId: 0` "Other" sentinel. */
export async function listPrefectures(
  _args: z.infer<typeof ListPrefecturesInputSchema>,
  db: Db,
): Promise<Prefecture[]> {
  const { rows } = await db.query<AreaRow>(
    'SELECT area_id, name FROM areas WHERE area_id <> 0 ORDER BY area_id',
  );
  return ListPrefecturesOutputSchema.parse(
    rows.map((row) => ({ areaId: row.area_id, name: row.name })),
  );
}

export const listPrefecturesTool = defineTool({
  name: LIST_PREFECTURES_NAME,
  description: LIST_PREFECTURES_DESCRIPTION,
  inputSchema: ListPrefecturesInputSchema,
  outputSchema: ListPrefecturesOutputSchema,
  structuredKey: 'prefectures',
  run: listPrefectures,
});

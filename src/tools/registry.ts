import { findSakesByFlavorTool } from './find-sakes-by-flavor.js';
import { findSimilarSakesTool } from './find-similar-sakes.js';
import { getSakeDetailsTool } from './get-sake-details.js';
import { getTopRankedTool } from './get-top-ranked.js';
import { listPrefecturesTool } from './list-prefectures.js';
import { searchSakesByNameTool } from './search-sakes-by-name.js';
import type { ToolDefinition } from './tool-definition.js';

/**
 * Every MCP tool the server advertises and dispatches, in advertisement order.
 * Adding a tool: implement its module's `defineTool(...)` export and add it
 * here — `server.ts` itself needs no change.
 */
export const TOOLS: readonly ToolDefinition[] = [
  listPrefecturesTool,
  searchSakesByNameTool,
  findSimilarSakesTool,
  getSakeDetailsTool,
  getTopRankedTool,
  findSakesByFlavorTool,
];

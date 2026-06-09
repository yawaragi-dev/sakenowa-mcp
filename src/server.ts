import { readFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Db } from './db.js';
import type { Logger } from './logger.js';
import {
  FIND_SIMILAR_SAKES_DESCRIPTION,
  FIND_SIMILAR_SAKES_NAME,
  FindSimilarSakesInputSchema,
  FindSimilarSakesStructuredSchema,
  findSimilarSakes,
} from './tools/find-similar-sakes.js';
import {
  GET_SAKE_DETAILS_DESCRIPTION,
  GET_SAKE_DETAILS_NAME,
  GetSakeDetailsInputSchema,
  GetSakeDetailsStructuredSchema,
  getSakeDetails,
} from './tools/get-sake-details.js';
import {
  GET_TOP_RANKED_DESCRIPTION,
  GET_TOP_RANKED_NAME,
  GetTopRankedInputSchema,
  GetTopRankedStructuredSchema,
  getTopRanked,
} from './tools/get-top-ranked.js';
import {
  LIST_PREFECTURES_DESCRIPTION,
  LIST_PREFECTURES_NAME,
  ListPrefecturesInputSchema,
  ListPrefecturesStructuredSchema,
  listPrefectures,
} from './tools/list-prefectures.js';
import {
  SEARCH_SAKES_BY_NAME_DESCRIPTION,
  SEARCH_SAKES_BY_NAME_NAME,
  SearchSakesByNameInputSchema,
  SearchSakesByNameStructuredSchema,
  searchSakesByName,
} from './tools/search-sakes-by-name.js';

// Single source of version truth: read package.json rather than duplicating
// the version here (npm always ships package.json alongside dist/). Resolves
// to the repo-root package.json from both src/ (tsx) and dist/.
const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

export const SERVER_NAME = '@yawaragi/sakenowa-mcp';
export const SERVER_VERSION = packageJson.version;

/** Convert a Zod schema into the JSON Schema shape MCP advertises. */
function jsonSchema(schema: Parameters<typeof zodToJsonSchema>[0]): Record<string, unknown> {
  return zodToJsonSchema(schema, { target: 'jsonSchema7' });
}

/** Shared `isError` MCP response for a failed tool call. */
function toolError(text: string) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text }],
  };
}

/** Shared `isError` MCP response for arguments that fail Zod parsing. */
function invalidArguments(message: string) {
  return toolError(`Invalid arguments: ${message}`);
}

/**
 * Build the MCP server with all tools wired to the given `Db`. The transport
 * is connected separately by the caller, so tests can connect an in-memory
 * transport instead of stdio.
 */
export function createServer(db: Db, logger: Logger): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => {
    logger.debug('tools/list requested');
    return {
      tools: [
        {
          name: LIST_PREFECTURES_NAME,
          description: LIST_PREFECTURES_DESCRIPTION,
          inputSchema: jsonSchema(ListPrefecturesInputSchema),
          outputSchema: jsonSchema(ListPrefecturesStructuredSchema),
        },
        {
          name: SEARCH_SAKES_BY_NAME_NAME,
          description: SEARCH_SAKES_BY_NAME_DESCRIPTION,
          inputSchema: jsonSchema(SearchSakesByNameInputSchema),
          outputSchema: jsonSchema(SearchSakesByNameStructuredSchema),
        },
        {
          name: FIND_SIMILAR_SAKES_NAME,
          description: FIND_SIMILAR_SAKES_DESCRIPTION,
          inputSchema: jsonSchema(FindSimilarSakesInputSchema),
          outputSchema: jsonSchema(FindSimilarSakesStructuredSchema),
        },
        {
          name: GET_SAKE_DETAILS_NAME,
          description: GET_SAKE_DETAILS_DESCRIPTION,
          inputSchema: jsonSchema(GetSakeDetailsInputSchema),
          outputSchema: jsonSchema(GetSakeDetailsStructuredSchema),
        },
        {
          name: GET_TOP_RANKED_NAME,
          description: GET_TOP_RANKED_DESCRIPTION,
          inputSchema: jsonSchema(GetTopRankedInputSchema),
          outputSchema: jsonSchema(GetTopRankedStructuredSchema),
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;

    if (name === LIST_PREFECTURES_NAME) {
      const parsed = ListPrefecturesInputSchema.safeParse(rawArgs ?? {});
      if (!parsed.success) {
        return invalidArguments(parsed.error.message);
      }
      try {
        const prefectures = await listPrefectures(parsed.data, db);
        logger.debug(`list_prefectures returned ${String(prefectures.length)} rows`);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(prefectures) }],
          structuredContent: { prefectures },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`list_prefectures failed: ${message}`);
        return toolError(`Failed to list prefectures: ${message}`);
      }
    }

    if (name === SEARCH_SAKES_BY_NAME_NAME) {
      const parsed = SearchSakesByNameInputSchema.safeParse(rawArgs ?? {});
      if (!parsed.success) {
        return invalidArguments(parsed.error.message);
      }
      try {
        const sakes = await searchSakesByName(parsed.data, db);
        logger.debug(`search_sakes_by_name returned ${String(sakes.length)} rows`);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(sakes) }],
          structuredContent: { sakes },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`search_sakes_by_name failed: ${message}`);
        return toolError(`Failed to search sakes: ${message}`);
      }
    }

    if (name === FIND_SIMILAR_SAKES_NAME) {
      const parsed = FindSimilarSakesInputSchema.safeParse(rawArgs ?? {});
      if (!parsed.success) {
        return invalidArguments(parsed.error.message);
      }
      try {
        const similarSakes = await findSimilarSakes(parsed.data, db);
        logger.debug(`find_similar_sakes returned ${String(similarSakes.length)} rows`);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(similarSakes) }],
          structuredContent: { similar_sakes: similarSakes },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`find_similar_sakes failed: ${message}`);
        return toolError(`Failed to find similar sakes: ${message}`);
      }
    }

    if (name === GET_SAKE_DETAILS_NAME) {
      const parsed = GetSakeDetailsInputSchema.safeParse(rawArgs ?? {});
      if (!parsed.success) {
        return invalidArguments(parsed.error.message);
      }
      try {
        const details = await getSakeDetails(parsed.data, db);
        logger.debug(`get_sake_details found=${String(details.found)}`);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(details) }],
          structuredContent: { details },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`get_sake_details failed: ${message}`);
        return toolError(`Failed to get sake details: ${message}`);
      }
    }

    if (name === GET_TOP_RANKED_NAME) {
      const parsed = GetTopRankedInputSchema.safeParse(rawArgs ?? {});
      if (!parsed.success) {
        return invalidArguments(parsed.error.message);
      }
      try {
        const rankedSakes = await getTopRanked(parsed.data, db);
        logger.debug(`get_top_ranked returned ${String(rankedSakes.length)} rows`);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(rankedSakes) }],
          structuredContent: { ranked_sakes: rankedSakes },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`get_top_ranked failed: ${message}`);
        return toolError(`Failed to get top ranked sakes: ${message}`);
      }
    }

    return toolError(`Unknown tool: ${name}`);
  });

  return server;
}

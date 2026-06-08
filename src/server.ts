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
  LIST_PREFECTURES_DESCRIPTION,
  LIST_PREFECTURES_NAME,
  ListPrefecturesInputSchema,
  ListPrefecturesStructuredSchema,
  listPrefectures,
} from './tools/list-prefectures.js';

// Single source of version truth: read package.json rather than duplicating
// the version here (npm always ships package.json alongside dist/). Resolves
// to the repo-root package.json from both src/ (tsx) and dist/.
const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

export const SERVER_NAME = '@yawaragi/sakenowa-mcp';
export const SERVER_VERSION = packageJson.version;

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
          inputSchema: zodToJsonSchema(ListPrefecturesInputSchema, {
            target: 'jsonSchema7',
          }) as Record<string, unknown>,
          outputSchema: zodToJsonSchema(ListPrefecturesStructuredSchema, {
            target: 'jsonSchema7',
          }) as Record<string, unknown>,
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;

    if (name !== LIST_PREFECTURES_NAME) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
      };
    }

    const parsed = ListPrefecturesInputSchema.safeParse(rawArgs ?? {});
    if (!parsed.success) {
      return {
        isError: true,
        content: [
          { type: 'text' as const, text: `Invalid arguments: ${parsed.error.message}` },
        ],
      };
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
      return {
        isError: true,
        content: [
          { type: 'text' as const, text: `Failed to list prefectures: ${message}` },
        ],
      };
    }
  });

  return server;
}

import { readFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Db } from './db.js';
import type { Logger } from './logger.js';
import { TOOLS } from './tools/registry.js';

// Single source of version truth: read package.json rather than duplicating
// the version here (npm always ships package.json alongside dist/). Resolves
// to the repo-root package.json from both src/ (tsx) and dist/.
const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

export const SERVER_NAME = '@yawaragi/sakenowa-mcp';
export const SERVER_VERSION = packageJson.version;

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
 * Build the MCP server. Every tool is advertised and dispatched generically
 * from the {@link TOOLS} registry — adding a tool needs no change here. The
 * transport is connected separately by the caller, so tests can connect an
 * in-memory transport instead of stdio.
 */
export function createServer(db: Db, logger: Logger): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  const toolsByName = new Map(TOOLS.map((tool) => [tool.name, tool]));

  server.setRequestHandler(ListToolsRequestSchema, () => {
    logger.debug('tools/list requested');
    return {
      tools: TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputJsonSchema,
        outputSchema: tool.outputJsonSchema,
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;

    const tool = toolsByName.get(name);
    if (tool === undefined) {
      return toolError(`Unknown tool: ${name}`);
    }

    const parsed = tool.inputSchema.safeParse(rawArgs ?? {});
    if (!parsed.success) {
      return invalidArguments(parsed.error.message);
    }

    try {
      const result = await tool.run(parsed.data, db);
      logger.debug(`${tool.name} succeeded`);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        structuredContent: { [tool.structuredKey]: result },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`${tool.name} failed: ${message}`);
      return toolError(`Tool "${tool.name}" failed: ${message}`);
    }
  });

  return server;
}

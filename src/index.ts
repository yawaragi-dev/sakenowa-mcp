#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createPool } from './db.js';
import { createMcpHttpServer } from './http.js';
import { createLogger } from './logger.js';
import { createServer } from './server.js';
import { resolveTransportConfig } from './transport.js';

function failStartup(message: string): never {
  // Fail loud on stderr, exit non-zero — never write to stdout (stdio framing).
  process.stderr.write(`[sakenowa-mcp] error: ${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const logger = createLogger();

  const databaseUrl = process.env['DATABASE_URL'];
  if (databaseUrl === undefined || databaseUrl.trim() === '') {
    failStartup(
      'DATABASE_URL is not set. Provide a Postgres connection string pointing at ' +
        'a Sakenowa-mirrored database (read-only role recommended).',
    );
  }

  let transport;
  try {
    transport = resolveTransportConfig(process.env);
  } catch (error) {
    failStartup(error instanceof Error ? error.message : String(error));
  }

  const pool = createPool(databaseUrl);

  if (transport.kind === 'stdio') {
    const server = createServer(pool, logger);
    await server.connect(new StdioServerTransport());
    logger.info('sakenowa-mcp server started on stdio transport');
    return;
  }

  // http — a long-running server; a fresh stateless MCP server per request,
  // all sharing the one Postgres pool.
  const httpServer = createMcpHttpServer(() => createServer(pool, logger), transport, logger);
  await new Promise<void>((resolve) => {
    httpServer.listen(transport.port, transport.host, resolve);
  });
  logger.info(
    `sakenowa-mcp server started on http transport at ` +
      `http://${transport.host}:${String(transport.port)}${transport.path}`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`[sakenowa-mcp] fatal: ${message}\n`);
  process.exit(1);
});

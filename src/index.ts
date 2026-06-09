#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createPool } from './db.js';
import { createLogger } from './logger.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const logger = createLogger();

  const databaseUrl = process.env['DATABASE_URL'];
  if (databaseUrl === undefined || databaseUrl.trim() === '') {
    // Fail loud on stderr, exit non-zero — never write to stdout.
    process.stderr.write(
      '[sakenowa-mcp] error: DATABASE_URL is not set. ' +
        'Provide a Postgres connection string pointing at a Sakenowa-mirrored ' +
        'database (read-only role recommended).\n',
    );
    process.exit(1);
  }

  const pool = createPool(databaseUrl);
  const server = createServer(pool, logger);
  const transport = new StdioServerTransport();

  await server.connect(transport);
  logger.info('sakenowa-mcp server started on stdio transport');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`[sakenowa-mcp] fatal: ${message}\n`);
  process.exit(1);
});

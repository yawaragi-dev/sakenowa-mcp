import { type Server as HttpServer, createServer as createNodeHttpServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Logger } from './logger.js';

/** Resolved HTTP transport settings (the `http` arm of `TransportConfig`). */
export interface HttpTransportConfig {
  host: string;
  port: number;
  path: string;
}

/**
 * Create a Node HTTP server that serves MCP over the Streamable HTTP transport.
 *
 * Stateless: a fresh MCP `Server` + transport is created per request (the
 * transport is constructed without a `sessionIdGenerator`, which the SDK treats
 * as stateless mode), which suits a read-only Postgres wrapper with no
 * per-connection state and avoids JSON-RPC id collisions between concurrent
 * callers. `enableJsonResponse` returns a plain `application/json` JSON-RPC
 * response rather than an SSE stream (the Sakenowa tools are short synchronous
 * reads — no streaming needed). The Postgres pool is owned by the caller and
 * shared across requests via `makeMcpServer`.
 *
 * The returned server is NOT yet listening; the caller calls `.listen(...)`.
 */
export function createMcpHttpServer(
  makeMcpServer: () => Server,
  config: HttpTransportConfig,
  logger: Logger,
): HttpServer {
  return createNodeHttpServer((req, res) => {
    void handleRequest(req, res, makeMcpServer, config, logger);
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  makeMcpServer: () => Server,
  config: HttpTransportConfig,
  logger: Logger,
): Promise<void> {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (pathname !== config.path) {
    respondError(res, 404, -32601, `Not found: ${pathname} (MCP is served at ${config.path})`);
    return;
  }

  // Parse a POST body up front so a malformed request reads as a client error
  // (400 / JSON-RPC parse error) rather than a server fault.
  let body: unknown;
  if (req.method === 'POST') {
    const raw = await readRawBody(req);
    if (raw !== '') {
      try {
        body = JSON.parse(raw);
      } catch {
        respondError(res, 400, -32700, 'Parse error: request body is not valid JSON');
        return;
      }
    }
  }

  try {
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    const server = makeMcpServer();
    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport as Transport);
    await transport.handleRequest(req, res, body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`http request failed: ${message}`);
    if (!res.headersSent) {
      respondError(res, 500, -32603, 'Internal server error');
    }
  }
}

/** Buffer the request body as a UTF-8 string. */
async function readRawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Write a JSON-RPC error envelope with the given HTTP status. */
function respondError(res: ServerResponse, status: number, code: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }));
}

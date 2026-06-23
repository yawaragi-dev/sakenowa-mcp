/**
 * Transport selection. The server speaks MCP over one of two transports, chosen
 * by the `MCP_TRANSPORT` env var:
 *
 *   stdio (default)  — one server per child process, for Claude Desktop / IDE
 *                      consumers. Bit-for-bit the v0.1.0 behaviour.
 *   http             — a long-running Streamable HTTP server, for consumers that
 *                      can't keep a child process alive (e.g. serverless).
 *
 * This module only RESOLVES the configuration (pure, unit-testable); wiring the
 * chosen transport lives in `index.ts` (stdio) and `http.ts` (http).
 */

export const DEFAULT_HTTP_PORT = 3030;
export const DEFAULT_HTTP_HOST = '0.0.0.0';
export const DEFAULT_HTTP_PATH = '/mcp';

export type TransportConfig =
  | { kind: 'stdio' }
  | { kind: 'http'; host: string; port: number; path: string };

/**
 * Resolve the transport configuration from the environment. Throws a clear
 * error for an unknown `MCP_TRANSPORT` or an out-of-range `MCP_HTTP_PORT`; the
 * caller turns that into a stderr message + non-zero exit.
 */
export function resolveTransportConfig(env: NodeJS.ProcessEnv): TransportConfig {
  const raw = env['MCP_TRANSPORT']?.trim();

  if (raw === undefined || raw === '' || raw === 'stdio') {
    return { kind: 'stdio' };
  }

  if (raw === 'http') {
    return {
      kind: 'http',
      host: nonEmpty(env['MCP_HTTP_HOST']) ?? DEFAULT_HTTP_HOST,
      port: parsePort(env['MCP_HTTP_PORT']),
      path: normalizePath(env['MCP_HTTP_PATH']),
    };
  }

  throw new Error(
    `Unknown MCP_TRANSPORT "${raw}". Set MCP_TRANSPORT to "stdio" (default) or "http".`,
  );
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

function parsePort(raw: string | undefined): number {
  const value = nonEmpty(raw);
  if (value === undefined) {
    return DEFAULT_HTTP_PORT;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid MCP_HTTP_PORT "${raw}". Expected an integer in 1–65535.`);
  }
  return port;
}

function normalizePath(raw: string | undefined): string {
  const value = nonEmpty(raw);
  if (value === undefined) {
    return DEFAULT_HTTP_PATH;
  }
  return value.startsWith('/') ? value : `/${value}`;
}

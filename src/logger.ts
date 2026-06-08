/**
 * Tiny stderr-only logger.
 *
 * The MCP stdio transport reserves stdout exclusively for protocol framing;
 * any stray byte on stdout corrupts the JSON-RPC stream. Every diagnostic in
 * this server therefore goes to stderr, gated by `MCP_LOG_LEVEL`.
 */

const LEVELS = ['silent', 'error', 'info', 'debug'] as const;

export type LogLevel = (typeof LEVELS)[number];

function resolveLevel(raw: string | undefined): LogLevel {
  if (raw !== undefined && (LEVELS as readonly string[]).includes(raw)) {
    return raw as LogLevel;
  }
  return 'error';
}

function rank(level: LogLevel): number {
  return LEVELS.indexOf(level);
}

export interface Logger {
  error(message: string): void;
  info(message: string): void;
  debug(message: string): void;
}

/**
 * Build a logger from an explicit level. Defaults to reading `MCP_LOG_LEVEL`
 * from the environment, falling back to `error`.
 */
export function createLogger(level: LogLevel = resolveLevel(process.env['MCP_LOG_LEVEL'])): Logger {
  const threshold = rank(level);

  function write(at: LogLevel, message: string): void {
    if (threshold >= rank(at) && threshold > rank('silent')) {
      process.stderr.write(`[sakenowa-mcp] ${at}: ${message}\n`);
    }
  }

  return {
    error: (message) => {
      write('error', message);
    },
    info: (message) => {
      write('info', message);
    },
    debug: (message) => {
      write('debug', message);
    },
  };
}

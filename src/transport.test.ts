import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HTTP_HOST,
  DEFAULT_HTTP_PATH,
  DEFAULT_HTTP_PORT,
  resolveTransportConfig,
} from './transport.js';

describe('resolveTransportConfig', () => {
  it('defaults to stdio when MCP_TRANSPORT is unset', () => {
    expect(resolveTransportConfig({})).toEqual({ kind: 'stdio' });
  });

  it('defaults to stdio for an empty/whitespace MCP_TRANSPORT', () => {
    expect(resolveTransportConfig({ MCP_TRANSPORT: '   ' })).toEqual({ kind: 'stdio' });
  });

  it('selects stdio explicitly', () => {
    expect(resolveTransportConfig({ MCP_TRANSPORT: 'stdio' })).toEqual({ kind: 'stdio' });
  });

  it('selects http with default host/port/path', () => {
    expect(resolveTransportConfig({ MCP_TRANSPORT: 'http' })).toEqual({
      kind: 'http',
      host: DEFAULT_HTTP_HOST,
      port: DEFAULT_HTTP_PORT,
      path: DEFAULT_HTTP_PATH,
    });
  });

  it('applies http host/port/path overrides', () => {
    expect(
      resolveTransportConfig({
        MCP_TRANSPORT: 'http',
        MCP_HTTP_HOST: '127.0.0.1',
        MCP_HTTP_PORT: '8080',
        MCP_HTTP_PATH: '/rpc',
      }),
    ).toEqual({ kind: 'http', host: '127.0.0.1', port: 8080, path: '/rpc' });
  });

  it('normalises a path that lacks a leading slash', () => {
    expect(
      resolveTransportConfig({ MCP_TRANSPORT: 'http', MCP_HTTP_PATH: 'mcp' }),
    ).toMatchObject({ path: '/mcp' });
  });

  it('throws on an unknown MCP_TRANSPORT value', () => {
    expect(() => resolveTransportConfig({ MCP_TRANSPORT: 'grpc' })).toThrow(
      /Unknown MCP_TRANSPORT/,
    );
  });

  it('throws on an out-of-range or non-numeric MCP_HTTP_PORT', () => {
    expect(() =>
      resolveTransportConfig({ MCP_TRANSPORT: 'http', MCP_HTTP_PORT: '70000' }),
    ).toThrow(/Invalid MCP_HTTP_PORT/);
    expect(() =>
      resolveTransportConfig({ MCP_TRANSPORT: 'http', MCP_HTTP_PORT: 'abc' }),
    ).toThrow(/Invalid MCP_HTTP_PORT/);
  });
});

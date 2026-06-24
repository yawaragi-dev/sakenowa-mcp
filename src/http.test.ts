import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { Db } from './db.js';
import { createMcpHttpServer } from './http.js';
import { createLogger } from './logger.js';
import { createServer } from './server.js';

/**
 * In-process smoke for the Streamable HTTP transport, mirroring the stdio smoke.
 * No Docker/DB needed: tools/list and a stubbed-Db tool call exercise the full
 * HTTP path (the pg pool is never queried because the Db is a stub).
 */

function dbReturning(rows: unknown[]): Db {
  return { query: <R>() => Promise.resolve({ rows: rows as R[] }) };
}

describe('createMcpHttpServer (Streamable HTTP transport)', () => {
  let stop: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (stop) await stop();
    stop = undefined;
  });

  async function start(db: Db, path = '/mcp'): Promise<{ port: number; path: string }> {
    const httpServer = createMcpHttpServer(
      () => createServer(db, createLogger('silent')),
      { host: '127.0.0.1', port: 0, path },
      createLogger('silent'),
    );
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    stop = () => new Promise<void>((resolve) => httpServer.close(() => { resolve(); }));
    return { port: (httpServer.address() as AddressInfo).port, path };
  }

  async function post(port: number, path: string, body: unknown): Promise<Response> {
    return fetch(`http://127.0.0.1:${String(port)}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(body),
    });
  }

  it('advertises all six tools over a POST tools/list (as JSON)', async () => {
    const { port, path } = await start(dbReturning([]));

    const res = await post(port, path, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');

    const json = (await res.json()) as { result: { tools: { name: string }[] } };
    expect(json.result.tools.map((t) => t.name).sort()).toEqual([
      'find_sakes_by_flavor',
      'find_similar_sakes',
      'get_sake_details',
      'get_top_ranked',
      'list_prefectures',
      'search_sakes_by_name',
    ]);
  });

  it('dispatches a tool call over HTTP and returns the structured envelope', async () => {
    const { port, path } = await start(
      dbReturning([{ area_id: 47, name: '沖縄県' }]),
    );

    const res = await post(port, path, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'list_prefectures', arguments: {} },
    });
    const json = (await res.json()) as { result: { structuredContent: unknown } };
    expect(json.result.structuredContent).toEqual({
      prefectures: [{ areaId: 47, name: '沖縄県' }],
    });
  });

  it('returns a JSON-RPC error for a path other than the configured one', async () => {
    const { port } = await start(dbReturning([]));

    const res = await post(port, '/not-mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { message: string } };
    expect(json.error.message).toContain('Not found');
  });
  it('returns a 400 JSON-RPC parse error for a malformed body', async () => {
    const { port, path } = await start(dbReturning([]));
    const res = await fetch(`http://127.0.0.1:${String(port)}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: '{ not json',
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: number; message: string } };
    expect(json.error.code).toBe(-32700);
    expect(json.error.message).toContain('Parse error');
  });
});

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import type { Db } from './db.js';
import { createLogger } from './logger.js';
import { createServer } from './server.js';

function emptyDb(): Db {
  return { query: <R>() => Promise.resolve({ rows: [] as R[] }) };
}

async function connectedClientWithDb(db: Db): Promise<Client> {
  const server = createServer(db, createLogger('silent'));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

function connectedClient(): Promise<Client> {
  return connectedClientWithDb(emptyDb());
}

/** A Db stub whose single query resolves with the given rows. */
function dbReturning(rows: unknown[]): Db {
  return { query: <R>() => Promise.resolve({ rows: rows as R[] }) };
}

/** A Db stub whose query rejects, to exercise the dispatch error path. */
function dbThrowing(message: string): Db {
  return { query: () => Promise.reject(new Error(message)) };
}

/** Narrow the SDK's loose content union to the text items these tools return. */
function textOf(result: unknown): string {
  const content = (result as { content?: { text?: string }[] }).content;
  return content?.[0]?.text ?? '';
}

describe('createServer tools/list', () => {
  it('advertises every tool with a non-empty description and an outputSchema', async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();

    for (const tool of tools) {
      expect((tool.description ?? '').length).toBeGreaterThan(0);
      expect(tool.outputSchema).toBeDefined();
    }

    await client.close();
  });

  it('uses canonical Sakenowa field names in tool descriptions', async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    const desc = (name: string) => tools.find((t) => t.name === name)?.description ?? '';

    // Canonical Sakenowa naming (areas / brandId / FlavorChart axes f1–f6), not
    // the old prefectures / sake_id / romaji-axis vocabulary.
    expect(desc('list_prefectures')).toContain('area');
    expect(desc('get_sake_details')).toContain('brandId');
    expect(desc('find_similar_sakes')).toContain('FlavorChart');
    expect(desc('find_sakes_by_flavor')).toContain('f1');
    expect(desc('get_top_ranked')).toContain('area');

    await client.close();
  });

  it('advertises exactly the six tools shipped in v0.1.0', async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'find_sakes_by_flavor',
        'find_similar_sakes',
        'get_sake_details',
        'get_top_ranked',
        'list_prefectures',
        'search_sakes_by_name',
      ].sort(),
    );

    await client.close();
  });
});

describe('createServer tools/call (generic dispatch)', () => {
  it('dispatches a tool and returns the structured-content envelope', async () => {
    const client = await connectedClientWithDb(
      dbReturning([
        { area_id: 1, name: '北海道' },
        { area_id: 47, name: '沖縄県' },
      ]),
    );

    const result = await client.callTool({ name: 'list_prefectures', arguments: {} });

    expect(result.isError).toBeFalsy();
    // structuredContent is keyed by the tool's structuredKey.
    expect(result.structuredContent).toEqual({
      prefectures: [
        { areaId: 1, name: '北海道' },
        { areaId: 47, name: '沖縄県' },
      ],
    });
    // The text content mirrors the same result as JSON.
    expect(JSON.parse(textOf(result))).toEqual([
      { areaId: 1, name: '北海道' },
      { areaId: 47, name: '沖縄県' },
    ]);

    await client.close();
  });

  it('returns an MCP error (not a throw) for an unknown tool', async () => {
    const client = await connectedClientWithDb(emptyDb());

    const result = await client.callTool({ name: 'no_such_tool', arguments: {} });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Unknown tool');

    await client.close();
  });

  it('returns an MCP error for arguments that fail Zod parsing', async () => {
    const client = await connectedClientWithDb(emptyDb());

    // get_sake_details requires an integer sake_id; {} fails the strict schema.
    const result = await client.callTool({ name: 'get_sake_details', arguments: {} });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Invalid arguments');

    await client.close();
  });

  it('wraps a query-function failure as an MCP error naming the tool', async () => {
    const client = await connectedClientWithDb(dbThrowing('connection refused'));

    const result = await client.callTool({ name: 'list_prefectures', arguments: {} });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Tool "list_prefectures" failed');
    expect(textOf(result)).toContain('connection refused');

    await client.close();
  });
});

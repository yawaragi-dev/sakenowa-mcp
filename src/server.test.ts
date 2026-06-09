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
  it('advertises list_prefectures with a domain-vocabulary description', async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();

    const listPrefectures = tools.find((t) => t.name === 'list_prefectures');
    expect(listPrefectures).toBeDefined();

    const description = listPrefectures?.description ?? '';
    expect(description.length).toBeGreaterThan(0);
    // Uses CONTEXT.md vocabulary: "Prefecture", not "area"/"region".
    expect(description).toContain('Prefecture');
    expect(description.toLowerCase()).not.toContain('area');

    await client.close();
  });

  it('advertises search_sakes_by_name with a domain-vocabulary description', async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();

    const search = tools.find((t) => t.name === 'search_sakes_by_name');
    expect(search).toBeDefined();
    expect(search?.outputSchema).toBeDefined();

    const description = search?.description ?? '';
    expect(description.length).toBeGreaterThan(0);
    // Uses CONTEXT.md vocabulary: "Sake", never "brand"/"label".
    expect(description).toContain('Sake');
    expect(description.toLowerCase()).not.toContain('brand');
    expect(description.toLowerCase()).not.toContain('label');

    await client.close();
  });

  it('advertises find_similar_sakes with FlavorProfile vocabulary (not "vector")', async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();

    const findSimilar = tools.find((t) => t.name === 'find_similar_sakes');
    expect(findSimilar).toBeDefined();
    expect(findSimilar?.outputSchema).toBeDefined();

    const description = findSimilar?.description ?? '';
    // Uses CONTEXT.md vocabulary: "FlavorProfile", never "vector".
    expect(description).toContain('FlavorProfile');
    expect(description.toLowerCase()).not.toContain('vector');

    await client.close();
  });

  it('advertises get_sake_details with FlavorProfile/FlavorTag vocabulary', async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();

    const details = tools.find((t) => t.name === 'get_sake_details');
    expect(details).toBeDefined();
    expect(details?.outputSchema).toBeDefined();

    const description = details?.description ?? '';
    expect(description.length).toBeGreaterThan(0);
    // Uses CONTEXT.md vocabulary. "brand_id" is the legitimate Sakenowa field
    // name, but the colloquial standalone "brand"/"label" must not appear, and
    // FlavorProfile must never be called a "vector".
    expect(description).toContain('Sake');
    expect(description).toContain('FlavorProfile');
    expect(description).toContain('FlavorTag');
    expect(description.toLowerCase()).not.toContain('label');
    expect(description.toLowerCase()).not.toContain('vector');

    await client.close();
  });

  it('advertises get_top_ranked with Ranking/Prefecture vocabulary', async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();

    const topRanked = tools.find((t) => t.name === 'get_top_ranked');
    expect(topRanked).toBeDefined();
    expect(topRanked?.outputSchema).toBeDefined();

    const description = topRanked?.description ?? '';
    expect(description.length).toBeGreaterThan(0);
    // Uses CONTEXT.md vocabulary: "Ranking"/"Prefecture", never "area".
    expect(description).toContain('Ranking');
    expect(description).toContain('Prefecture');
    expect(description.toLowerCase()).not.toContain('area');

    await client.close();
  });

  it('advertises find_sakes_by_flavor with FlavorProfile/FlavorTag/Prefecture vocabulary', async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();

    const byFlavor = tools.find((t) => t.name === 'find_sakes_by_flavor');
    expect(byFlavor).toBeDefined();
    expect(byFlavor?.outputSchema).toBeDefined();

    const description = byFlavor?.description ?? '';
    expect(description.length).toBeGreaterThan(0);
    // Uses CONTEXT.md vocabulary: Sake / FlavorProfile / FlavorTag / Prefecture,
    // never "brand"/"label"/"vector"/"area".
    expect(description).toContain('Sake');
    expect(description).toContain('FlavorProfile');
    expect(description).toContain('FlavorTag');
    expect(description).toContain('Prefecture');
    expect(description.toLowerCase()).not.toContain('label');
    expect(description.toLowerCase()).not.toContain('vector');
    expect(description.toLowerCase()).not.toContain('area');

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
        { id: 1, name_ja: '北海道', name_romaji: 'Hokkaido' },
        { id: 47, name_ja: '沖縄県', name_romaji: 'Okinawa' },
      ]),
    );

    const result = await client.callTool({ name: 'list_prefectures', arguments: {} });

    expect(result.isError).toBeFalsy();
    // structuredContent is keyed by the tool's structuredKey.
    expect(result.structuredContent).toEqual({
      prefectures: [
        { id: 1, name_ja: '北海道', name_romaji: 'Hokkaido' },
        { id: 47, name_ja: '沖縄県', name_romaji: 'Okinawa' },
      ],
    });
    // The text content mirrors the same result as JSON.
    expect(JSON.parse(textOf(result))).toEqual([
      { id: 1, name_ja: '北海道', name_romaji: 'Hokkaido' },
      { id: 47, name_ja: '沖縄県', name_romaji: 'Okinawa' },
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

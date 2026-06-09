import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import type { Db } from './db.js';
import { createLogger } from './logger.js';
import { createServer } from './server.js';

function emptyDb(): Db {
  return { query: <R>() => Promise.resolve({ rows: [] as R[] }) };
}

async function connectedClient(): Promise<Client> {
  const server = createServer(emptyDb(), createLogger('silent'));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
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

  it('advertises exactly the tools shipped so far', async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['find_similar_sakes', 'list_prefectures', 'search_sakes_by_name'].sort(),
    );

    await client.close();
  });
});

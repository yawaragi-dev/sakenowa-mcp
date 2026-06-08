import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import type { Db } from './db.js';
import { createLogger } from './logger.js';
import { createServer } from './server.js';

function emptyDb(): Db {
  return { query: <R>() => Promise.resolve({ rows: [] as R[] }) };
}

describe('createServer tools/list', () => {
  it('advertises list_prefectures with a domain-vocabulary description', async () => {
    const server = createServer(emptyDb(), createLogger('silent'));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const { tools } = await client.listTools();

    const listPrefectures = tools.find((t) => t.name === 'list_prefectures');
    expect(listPrefectures).toBeDefined();

    const description = listPrefectures?.description ?? '';
    expect(description.length).toBeGreaterThan(0);
    // Uses CONTEXT.md vocabulary: "Prefecture", not "area"/"region".
    expect(description).toContain('Prefecture');
    expect(description.toLowerCase()).not.toContain('area');

    await client.close();
    await server.close();
  });

  it('only advertises list_prefectures in this slice', async () => {
    const server = createServer(emptyDb(), createLogger('silent'));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['list_prefectures']);

    await client.close();
    await server.close();
  });
});

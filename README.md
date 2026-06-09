# `@yawaragi/sakenowa-mcp`

A [Model Context Protocol](https://modelcontextprotocol.io) server that turns well-defined queries over a Postgres mirror of [Sakenowa](https://sakenowa.com) sake data into MCP tool calls.

Connect it to Claude Desktop, the AI SDK's MCP client, or any other MCP consumer, point it at a Postgres that has a Sakenowa-mirrored schema, and the consumer can ask for sake recommendations, similarity search, prefecture filters, and the latest popularity rankings.

The server is **read-only**, **stateless**, and intentionally domain-pure — no LLM calls, no cross-beverage heuristics, no user identity, no business logic. The OSS asset's value is its independence: any consumer that mirrors Sakenowa data into Postgres can plug this in.

> **Status:** v0.1.0 released — all six tools below are implemented and on npm. See [`CHANGELOG.md`](./CHANGELOG.md) for release notes and [`docs/specs/v0.1.0.md`](./docs/specs/v0.1.0.md) for the full contract.

## What's in v0.1.0

Six MCP tools over the Sakenowa data shape:

- `list_prefectures` — Japan's 47 prefectures.
- `search_sakes_by_name` — resolve a free-text name (romaji or kanji) to one or more Sake records.
- `get_sake_details` — full record for one Sake, including its 6-axis flavor profile, tags, brewery, and prefecture.
- `find_similar_sakes` — cosine similarity over the 6-axis flavor profile.
- `find_sakes_by_flavor` — filter by axis ranges, tag membership, and / or prefecture.
- `get_top_ranked` — latest overall or per-prefecture popularity ranking.

Full input / output shapes and SQL intent: [`docs/specs/v0.1.0.md`](./docs/specs/v0.1.0.md).

## Use

```bash
pnpm add -g @yawaragi/sakenowa-mcp   # or npm i -g / yarn global add
```

The server reads `DATABASE_URL` from the environment and serves MCP over stdio.

### Claude Desktop config

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent on your platform:

```json
{
  "mcpServers": {
    "sakenowa": {
      "command": "npx",
      "args": ["-y", "@yawaragi/sakenowa-mcp"],
      "env": {
        "DATABASE_URL": "postgresql://user:pass@host:5432/your_sakenowa_mirror"
      }
    }
  }
}
```

Restart Claude Desktop. The six tools become available in any chat.

### AI SDK (Vercel) consumers

```ts
import { experimental_createMCPClient as createMCPClient } from 'ai';
import { Experimental_StdioMCPTransport } from 'ai/mcp-stdio';

const mcp = await createMCPClient({
  transport: new Experimental_StdioMCPTransport({
    command: 'npx',
    args: ['-y', '@yawaragi/sakenowa-mcp'],
    env: { DATABASE_URL: process.env.SAKENOWA_DB_URL! },
  }),
});

const tools = await mcp.tools();
// pass `tools` to generateText / generateObject / streamText
```

## Getting a Sakenowa-mirrored Postgres

This server reads from Postgres; it does **not** fetch from Sakenowa's API at query time and does **not** ship an ingest pipeline. You bring the data.

The expected schema is documented in [`docs/specs/v0.1.0.md`](./docs/specs/v0.1.0.md). Any ingest that produces tables matching that shape works.

### Recommended indexes

At the Sakenowa scale (~5k sakes, 47 prefectures, 117 tags) every query is a small scan that runs in single-digit milliseconds, so indexes are optional to *start*. As the mirror grows, add these on the **consumer's** Postgres so the server's queries stay fast (Postgres does **not** auto-index foreign keys):

| Index | Keeps fast |
|---|---|
| `breweries(prefecture_id)`, `sakes(brewery_id)` | the Sake → Brewery → Prefecture join used by most tools |
| `sake_flavor_tags(tag_id)` | the `find_sakes_by_flavor` tag-intersection (the PK `(sake_id, tag_id)` already covers `sake_id` lookups, not `tag_id`) |
| `rankings(scope, prefecture_id, rank)` | `get_top_ranked`'s filter + order |
| `flavor_profiles(sake_id)` | already the primary key per the schema; covers `find_similar_sakes` and detail joins |
| `pg_trgm` GIN on `sakes(name_ja, name_romaji)` *(optional)* | `search_sakes_by_name` only if it must scale past a few thousand rows (it uses substring `ILIKE`, which can't use a btree index) |

## Configuration

| Variable | Required? | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | — | Postgres connection string (read-only role recommended) |
| `MCP_LOG_LEVEL` | no | `error` | `silent` / `error` / `info` / `debug`. Anything other than `silent` writes to stderr only. |

## Attribution

Sake data exposed through this server comes from [Sakenowa](https://sakenowa.com). Their data is free under an attribution-only licence. **Any application or surface that displays this data to users must render the appropriate Sakenowa attribution.** "Flavor Chart" is a registered trademark of Sakenowa; refer to the 6-axis visualisation as "flavor chart (Sakenowa)" on first mention.

Attribution is the consumer's responsibility — the MCP server returns the data; the application using the server renders the attribution.

## Contributing

The implementation is being built slice-by-slice; the GitHub issues track open work, each labelled `ready-for-agent` once fully specified. Read [`AGENTS.md`](./AGENTS.md) for the project conventions before opening a PR.

## License

MIT. See [`LICENSE`](./LICENSE).

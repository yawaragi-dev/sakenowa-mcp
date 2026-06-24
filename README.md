# `@yawaragi/sakenowa-mcp`

A [Model Context Protocol](https://modelcontextprotocol.io) server that turns well-defined queries over a Postgres mirror of [Sakenowa](https://sakenowa.com) sake data into MCP tool calls.

Connect it to Claude Desktop, the AI SDK's MCP client, or any other MCP consumer, point it at a Postgres that has a Sakenowa-mirrored schema, and the consumer can ask for sake recommendations, similarity search, prefecture filters, and the latest popularity rankings.

The server is **read-only**, **stateless**, and intentionally domain-pure — no LLM calls, no cross-beverage heuristics, no user identity, no business logic. The OSS asset's value is its independence: any consumer that mirrors Sakenowa data into Postgres can plug this in.

> **Status:** v0.1.0 — the six read-only tools below, served over **stdio** (default) or **Streamable HTTP** (`MCP_TRANSPORT=http`). See [`CHANGELOG.md`](./CHANGELOG.md) for release notes and [`docs/specs/v0.1.0.md`](./docs/specs/v0.1.0.md) for the full contract.

## What's in v0.1.0

Six MCP tools over the canonical Sakenowa data shape (`areas`, `brands`, `flavor_charts`, …):

- `list_prefectures` — Japan's areas (prefectures) as `{ areaId, name }`.
- `search_sakes_by_name` — resolve a free-text name (romaji or Japanese) to brand records.
- `get_sake_details` — full record for one brand by `brandId`: its 6-axis FlavorChart (`f1`–`f6`), brewery, and area. (Per-brand flavor tags are not yet backed by the canonical mirror.)
- `find_similar_sakes` — cosine similarity over the 6-axis FlavorChart (`brandId`, `topK`).
- `find_sakes_by_flavor` — filter by axis ranges (`f1Min`/`f1Max` … `f6Min`/`f6Max`) and / or `areaId`.
- `get_top_ranked` — latest overall or per-area popularity ranking (`scope: 'overall' | 'area'`, `areaId`).

Full input / output shapes and the expected DB schema: [`docs/specs/v0.1.0.md`](./docs/specs/v0.1.0.md). The canonical schema and how it was derived: [`docs/specs/schema-audit-v0.1.1.md`](./docs/specs/schema-audit-v0.1.1.md).

### Naming & schema notes

- **Tool inputs and JSON outputs are camelCase** (`brandId`, `areaId`, `topK`, `f1Min`, `nameRomaji`) — an LLM-friendly API surface. The **database columns are snake_case** (`brand_id`, `area_id`, `name_romaji`) — Sakenowa's own shape. The two don't have to match; the server maps between them.
- **`name_romaji` is optional / consumer-provided.** Sakenowa's API publishes only Japanese names; romaji is an enrichment column a consumer adds (e.g. via an LLM step). It is nullable: tools return `nameRomaji: null` when absent, and `search_sakes_by_name` simply won't match romaji queries on an un-enriched mirror (it still matches the Japanese `name`).
- **`flavorProfile` is nullable** — a brand with no `flavor_charts` row returns `flavorProfile: null` (a valid result, not an error).

## Use

```bash
pnpm add -g @yawaragi/sakenowa-mcp   # or npm i -g / yarn global add
```

The server reads `DATABASE_URL` from the environment and serves MCP over **stdio** by default, or over **Streamable HTTP** when `MCP_TRANSPORT=http`.

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

### HTTP consumer config

For consumers that can't keep a child process alive — a serverless web app, a long-lived service calling MCP over the network — run the server in HTTP mode. It speaks the [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports) over a single JSON-RPC `POST` endpoint.

Run it (e.g. on Railway / Fly / Render, or any Node host):

```bash
MCP_TRANSPORT=http \
DATABASE_URL="postgresql://user:pass@host:5432/your_sakenowa_mirror" \
  npx -y @yawaragi/sakenowa-mcp
# listening on http://0.0.0.0:3030/mcp  (override with MCP_HTTP_PORT / MCP_HTTP_HOST / MCP_HTTP_PATH)
```

Smoke-test it (note the `Accept` header — the transport requires both content types):

```bash
curl -X POST http://localhost:3030/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Point an HTTP MCP client at the URL — for example the [AI SDK's MCP client](https://sdk.vercel.ai/cookbook/node/mcp-tools) over a `StreamableHTTPClientTransport` configured with `https://your-host/mcp`.

> **Security:** the server binds **plain HTTP with no authentication** — that's the OSS contract (stateless, no auth, no business logic). Put auth and TLS in front of it at deploy time (Cloudflare Tunnel, a reverse proxy with a bearer token, a platform's auto-TLS, etc.). Never expose the raw endpoint to an untrusted network.

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
| `pg_trgm` GIN on `brands(name, name_romaji)` *(optional)* | `search_sakes_by_name` only if it must scale past a few thousand rows (it uses substring `ILIKE`, which can't use a btree index) |

## Configuration

| Variable | Required? | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | — | Postgres connection string (read-only role recommended) |
| `MCP_LOG_LEVEL` | no | `error` | `silent` / `error` / `info` / `debug`. Anything other than `silent` writes to stderr only. |
| `MCP_TRANSPORT` | no | `stdio` | `stdio` or `http`. An unknown value fails loud on stderr with a non-zero exit. |
| `MCP_HTTP_PORT` | no | `3030` | Port for HTTP mode. Ignored under stdio. |
| `MCP_HTTP_HOST` | no | `0.0.0.0` | Bind host for HTTP mode. Ignored under stdio. |
| `MCP_HTTP_PATH` | no | `/mcp` | JSON-RPC endpoint path for HTTP mode. Ignored under stdio. |

## Attribution

Sake data exposed through this server comes from [Sakenowa](https://sakenowa.com). Their data is free under an attribution-only licence. **Any application or surface that displays this data to users must render the appropriate Sakenowa attribution.** "Flavor Chart" is a registered trademark of Sakenowa; refer to the 6-axis visualisation as "flavor chart (Sakenowa)" on first mention.

Attribution is the consumer's responsibility — the MCP server returns the data; the application using the server renders the attribution.

## Contributing

The implementation is being built slice-by-slice; the GitHub issues track open work, each labelled `ready-for-agent` once fully specified. Read [`AGENTS.md`](./AGENTS.md) for the project conventions before opening a PR.

## License

MIT. See [`LICENSE`](./LICENSE).

# Changelog

All notable changes to `@yawaragi/sakenowa-mcp` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.1.0 - 2026-06-25

First public release: a read-only, stateless MCP server over a
Sakenowa-mirrored Postgres, served over **stdio** (default) or **Streamable
HTTP**. No LLM calls, no cross-beverage heuristics, no user identity, no
business logic — consumers bring the data and decide what to do with the
results.

### Tools

Six read-only MCP tools over the Sakenowa data shape:

- **`list_prefectures`** — Japan's 47 Prefectures (excludes the `areaId: 0`
  "Other" sentinel).
- **`search_sakes_by_name`** — resolve a free-text name (romaji or kanji) to
  Sake records, case-insensitive across both names, exact-prefix matches ranked
  ahead of substring matches.
- **`get_sake_details`** — the full record for one Sake: its 6-axis
  FlavorProfile, FlavorTags, Brewery, and Prefecture. Unknown id returns an
  explicit `{ found: false }` result, not an error.
- **`find_similar_sakes`** — cosine similarity over the 6-axis FlavorProfile
  (plain SQL, no `pgvector`).
- **`find_sakes_by_flavor`** — filter by FlavorProfile axis ranges, FlavorTag
  membership (all listed tags required), and/or Prefecture, combined with AND
  semantics.
- **`get_top_ranked`** — latest overall or per-Prefecture popularity ranking.

### Transports

Selected at startup by `MCP_TRANSPORT` (default `stdio`):

- **stdio** — one server per child process, for Claude Desktop / IDE consumers.
- **http** — a long-running Streamable HTTP server (`MCP_TRANSPORT=http`), for
  consumers that can't keep a child process alive (e.g. a serverless web app).
  Stateless, returns plain `application/json` JSON-RPC. The same six tools and
  query layer serve both transports. Binds **plain HTTP with no auth** — auth
  and TLS are the consumer's responsibility at deploy time.

### Configuration

- `DATABASE_URL` (required) — Postgres connection string for a Sakenowa-mirrored
  schema (read-only role recommended). Missing at startup → explanatory error on
  stderr and a non-zero exit.
- `MCP_LOG_LEVEL` (optional, default `error`) — `silent` | `error` | `info` |
  `debug`. Anything other than `silent` writes to stderr only; stdout is
  reserved for MCP protocol framing.
- `MCP_TRANSPORT` (optional, default `stdio`) — `stdio` | `http`. An unknown
  value fails loud on stderr with a non-zero exit.
- `MCP_HTTP_PORT` (3030) / `MCP_HTTP_HOST` (0.0.0.0) / `MCP_HTTP_PATH` (/mcp) —
  HTTP mode only; ignored under stdio.

### Schema — canonical Sakenowa-API naming

The tool SQL and Zod inputs/outputs use the **canonical Sakenowa-mirror** shape —
the table/column names any Sakenowa-mirrored Postgres naturally has, verified
against a real mirror (yawaragi's `pnpm ingest` Supabase project): `areas`
(`area_id`, `name`), `brands` (`brand_id`, `name`, nullable `name_romaji`),
`breweries` (`brewery_id`, …), `flavor_charts` (`brand_id`, `f1`–`f6`),
`flavor_tags` (`tag_id`, `name`), `rankings` (`kind`, `area_id`, `rank`,
`brand_id`, `score`). Tool inputs are camelCase (`brandId`, `areaId`, `topK`,
`f1Min`…). Full audit: [`docs/specs/schema-audit-v0.1.1.md`](./docs/specs/schema-audit-v0.1.1.md).

### Limitations / known gaps (v0.1.0)

- **Flavor tags are not backed by the canonical mirror.** There is no brand↔tag
  junction table, so `get_sake_details.flavorTags` is always `[]` and
  `find_sakes_by_flavor`'s `tags` filter is a no-op (accepted, ignored). Both
  tool descriptions say so.
- **Rankings are latest-snapshot only.** The canonical `rankings` table retains
  no history, so `get_top_ranked` has no `year_month` and returns only the
  current snapshot.
- **`flavorProfile` is nullable.** A brand with no `flavor_charts` row returns
  `flavorProfile: null` — a valid result, not an error.
- **`name_romaji` is consumer-provided and may be null.** Sakenowa publishes only
  Japanese names; romaji is an enrichment column. `search_sakes_by_name` matches
  romaji only on a mirror that has populated it (it always matches the Japanese
  `name`).

### Not in this release

Deliberately out of scope (see `AGENTS.md` and the spec): an ingest pipeline,
caching/rate-limiting, authentication, TLS, SSE/streaming responses, per-request
HTTP sessions, LLM-based reasoning, cross-beverage flavor mappings, a
`get_brewery_details` tool, and a `list_flavor_tags` tool.

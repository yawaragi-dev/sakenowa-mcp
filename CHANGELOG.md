# Changelog

All notable changes to `@yawaragi/sakenowa-mcp` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.1.0

First public release: a read-only, stateless MCP server over a
Sakenowa-mirrored Postgres, served on the **stdio** transport. No LLM calls, no
cross-beverage heuristics, no user identity, no business logic — consumers bring
the data and decide what to do with the results.

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

### Configuration

- `DATABASE_URL` (required) — Postgres connection string for a Sakenowa-mirrored
  schema (read-only role recommended). Missing at startup → explanatory error on
  stderr and a non-zero exit.
- `MCP_LOG_LEVEL` (optional, default `error`) — `silent` | `error` | `info` |
  `debug`. Anything other than `silent` writes to stderr only; stdout is
  reserved for MCP protocol framing.

### Expected database schema

The server reads (never writes) the following tables: `prefectures`,
`breweries`, `sakes`, `flavor_profiles`, `flavor_tags`, `sake_flavor_tags`,
`rankings`. The full shape is documented in
[`docs/specs/v0.1.0.md`](./docs/specs/v0.1.0.md). The schema expectations are
part of the public contract.

### Not in this release

Deliberately out of scope for v0.1.0 (see `AGENTS.md` and the spec): an ingest
pipeline, Streamable HTTP transport, caching/rate-limiting, authentication,
LLM-based reasoning, cross-beverage flavor mappings, a `get_brewery_details`
tool, and a `list_flavor_tags` tool.

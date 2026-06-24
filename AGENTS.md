# Agent instructions — `@yawaragi/sakenowa-mcp`

You are working on a stand-alone open-source Model Context Protocol (MCP) server that exposes read-only tools over a Postgres mirror of [Sakenowa](https://sakenowa.com) sake data.

This project is **deliberately decoupled** from the Yawaragi application that originated it. Anyone with a Sakenowa-mirrored Postgres can run this server and connect it to Claude Desktop, the AI SDK's MCP client, or any other MCP consumer. The OSS asset's value is its independence — do not let it pick up dependencies, conventions, or constraints that belong to a specific consumer.

## What this project is

A small, focused MCP server with one job: turn well-defined Sakenowa queries into MCP tool calls. The tool surface is intentionally narrow.

- **Stack:** TypeScript strict, `@modelcontextprotocol/sdk`, `pg` (or a thin wrapper) for Postgres, Zod for runtime validation, Vitest for tests.
- **Package manager:** pnpm for development. The published package itself is consumer-agnostic — npm / yarn / pnpm users all install it the same way.
- **Transport:** stdio (default) or Streamable HTTP, selected by `MCP_TRANSPORT`. stdio is for Claude Desktop / IDE consumers; HTTP is for consumers that can't keep a child process alive. See `docs/specs/v0.1.0.md`.
- **Connection:** consumer provides `DATABASE_URL` to a Postgres that contains a Sakenowa-mirrored schema. This repo does not run its own ingest — see `docs/specs/v0.1.0.md`.
- **Read-only.** No mutations, no writes, no migrations shipped with the server. The schema is owned by whoever ingested the data.
- **Schema is canonical Sakenowa-API.** The tool SQL and the wire contract use the table/column names a Sakenowa-mirrored Postgres actually has — `areas`/`area_id`, `brands`/`brand_id`, `breweries`/`brewery_id`, `flavor_charts`/`f1..f6`, `flavor_tags`/`tag_id`, `rankings`/`kind`/`area_id` — with camelCase tool inputs (`brandId`, `areaId`, `topK`, `f1Min`…). Authoritative reference: `docs/specs/schema-audit-v0.1.1.md`. (`CONTEXT.md` describes an earlier domain rename — Sake/Prefecture/FlavorProfile — that the wire contract no longer uses; treat the audit + code as the source of truth.) NOTE: the canonical mirror has no brand↔tag junction, so per-brand flavor tags are currently unavailable.
- **The active spec** for the current release lives under `docs/specs/`. v0.1.0 is `docs/specs/v0.1.0.md`.

## What this project is NOT

- Not a Next.js app, not a UI, not a web service in the application sense. (It can *speak* MCP over HTTP, but it's still a transport for the same read-only tools — no routes, no UI, no business logic, no auth.)
- Not coupled to any specific consumer. There is no `@yawaragi/*` import allowed here.
- Not an LLM application. No `@anthropic-ai/*`, no `ai` (Vercel AI SDK), no model calls. Tools return Sakenowa data; consumers decide what to do with it.
- Not a hand-curated heuristic engine. Cross-beverage mappings, taste-profile inferences, recommendation weighting, prompt scaffolding — all live in the consuming app, never here.
- Not authenticated. No user identity, no Clerk, no cookies, no session state. Anyone connecting to the configured Postgres gets the same answers.
- Not multilingual. The server speaks English in tool descriptions and error messages. The data it returns includes Japanese (`name_ja`, kanji) verbatim, because Japanese is part of the data, not a translation.
- Not aware of any legal regime. JMStV, GDPR, age gating, attribution-rendering rules — those are consumer concerns.

## Conventions

- **File names:** kebab-case. Modules: one purpose each.
- **Co-located tests:** `foo.ts` + `foo.test.ts` next to each other. Integration tests that need a live Postgres get an `.integration.test.ts` suffix.
- **Zod everywhere at boundaries.** Tool inputs are parsed with Zod schemas before reaching the query layer. Tool outputs are parsed before being returned.
- **Pure query functions.** Each tool calls a function whose signature is `(args, dbClient) → Promise<Result>` — no global DB singleton inside business logic, so tests pass a stub or testcontainers client.
- **No global state.** No module-level mutable variables; no caches in v0.1.0. If caching becomes necessary later, it's an opt-in concern.

## Forbidden

- Do NOT import from `next/*`, `@clerk/*`, `@yawaragi/*`, `ai` (Vercel AI SDK), `@anthropic-ai/sdk`, or any vendor SDK that isn't strictly required for a read-only DB or MCP transport.
- Do NOT write to the database. No INSERT, UPDATE, DELETE, ALTER, or migration scripts.
- Do NOT fetch from Sakenowa's HTTP API at query time. The server reads from Postgres only. If Postgres is empty, that's the consumer's ingest problem, not ours.
- Do NOT log query arguments or results to stdout / stderr in production code paths. (Test-mode logging is fine.) MCP servers communicate over stdio — extra stdout output corrupts the protocol.
- Do NOT introduce business logic. If a feature needs LLM reasoning, hand-curated tables, or rendering policy, it belongs in the consuming app.
- Do NOT add tools that aren't in the current release's spec doc. v0.1.0 ships exactly the six tools in `docs/specs/v0.1.0.md`.
- Do NOT introduce a bundler, framework, monorepo workspace, or any tooling beyond what's listed in "Stack" without a documented reason.
- Do NOT break stdio MCP framing. Logging, errors, and any non-MCP output must go to stderr only and must be controllable by env (e.g. `MCP_LOG_LEVEL=silent` for production).

## Commands

After v0.1.0 scaffold (MCP-S1):

- `pnpm install` — install deps
- `pnpm dev` — run the server in stdio mode against `DATABASE_URL` (useful for Claude Desktop config testing)
- `pnpm test` — run unit tests
- `pnpm test:integration` — run integration tests against a testcontainers Postgres (requires Docker)
- `pnpm build` — emit TypeScript to `dist/`
- `pnpm typecheck` — strict TS check, no emit
- `pnpm lint` — ESLint
- `pnpm publish` — npm publish (maintainer only)

## Working style

- Read `docs/specs/v0.1.0.md` before touching code.
- Use `CONTEXT.md`'s domain language; do not invent synonyms.
- Prefer small, focused PRs that close one slice issue at a time. The issue tree on GitHub describes the slice plan.
- Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and where possible `pnpm test:integration` locally before opening a PR.
- The audience for this project's docs and code is external — write for a contributor who has never used the consuming app. Do not back-reference Yawaragi-specific constraints; if a rule belongs here, restate it here.

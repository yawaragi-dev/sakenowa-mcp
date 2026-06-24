# Schema audit — canonical Sakenowa-mirror vs. v0.1.0 tool surface

> Resolves #17. Drives the rename in #18 and the doc alignment in #19.

## Methodology

Audited on **2026-06-24** against two authoritative sources: (1) the actual
migration files of `yawaragi-dev/yawaragi` (`supabase/migrations/0001..0011_*.sql`)
— a real Sakenowa-mirrored Postgres populated by yawaragi's `pnpm ingest`
pipeline — and (2) the exact tool inputs/outputs asserted by yawaragi's
cross-repo integration test (`src/lib/ai/mcp/mcp-live.integration.test.ts`,
PR #154). The integration test is treated as the binding contract for tool
**input** field names; the migrations are binding for **table/column** names.
v0.1.0's tool SQL + Zod schemas were written against a *guessed* schema
(`prefectures`/`sakes`/`sake_id`/`name_ja`/romaji axis columns) that does not
exist in a canonical Sakenowa mirror — this audit records the gap.

## Canonical table inventory

The OSS contract is "anyone with a Sakenowa-mirrored Postgres can run this
server", so the canonical schema is the **Sakenowa Data API**'s own shape, not a
consumer's domain rename. Columns marked *(consumer)* are ingest bookkeeping the
tools must NOT depend on (`source`, `confidence`, `content_hash`, `updated_at`,
`superseded_at`).

### `areas`  (was `prefectures`)
- `area_id INTEGER PK CHECK (area_id >= 0)` — Sakenowa id (was `id`)
- `name TEXT NOT NULL` — Japanese name, e.g. `北海道` (was `name_ja`)
- **No romaji column.** Areas are not romaji-enriched.
- Sentinel: `area_id = 0` = `その他` (Other / non-Japanese producers) — seeded as a real row; excluded from geographic results.

### `brands`  (was `sakes`)
- `brand_id INTEGER PK CHECK (brand_id > 0)` — Sakenowa id (was `id`)
- `name TEXT NOT NULL` — Sakenowa's published name
- `name_kanji TEXT NOT NULL` — *(consumer)* yawaragi-added; **not canonical Sakenowa** → tools must not require it
- `brewery_id INTEGER NOT NULL` → FK `breweries(brewery_id)`
- `name_romaji TEXT` — **nullable** romaji (consumer LLM enrichment; null until enriched)

### `breweries`
- `brewery_id INTEGER PK CHECK (brewery_id > 0)`
- `name TEXT NOT NULL`, `name_kanji TEXT NOT NULL` *(consumer)*
- `area_id INTEGER` → FK `areas(area_id)`; CHECK `>= 0` (admits the `0` sentinel + placeholder rows)
- `name_romaji TEXT` — nullable

### `flavor_charts`  (was `flavor_profiles`)
- `brand_id INTEGER PK` → FK `brands(brand_id)`
- `f1..f6 NUMERIC(5,4) NOT NULL CHECK (0..1)` — the six axes are **`f1`–`f6`**, NOT romaji (`hanayaka` etc. are display labels only; CONTEXT.md already calls `f1..f6` the storage identifier)

### `flavor_tags`
- `tag_id INTEGER PK CHECK (tag_id > 0)` — (was `id`)
- `name TEXT NOT NULL` — (was `name_ja`)
- **There is NO brand↔tag junction table** (`sake_flavor_tags` does not exist). Sakenowa exposes per-brand tag ids via its `/flavor-tags` endpoint, but yawaragi's mirror does not (yet) ingest the association. See Open Questions.

### `rankings`
- `kind TEXT NOT NULL CHECK (kind IN ('overall','area'))` — (was `scope` with `'prefecture'`)
- `area_id INTEGER` (NULL for `overall`; CHECK consistent with `kind`) — (was `prefecture_id`)
- `rank INTEGER NOT NULL CHECK (rank > 0)`
- `brand_id INTEGER NOT NULL` → FK `brands(brand_id)`
- `score NUMERIC NOT NULL`
- No `year_month` column. Uniqueness is `(kind, area_id, rank)`.

## Tool input contract (from the integration test — binding)

| Tool | v0.1.0 input | Canonical input (per test) |
|---|---|---|
| `list_prefectures` | `{}` | `{}` |
| `search_sakes_by_name` | `{ query, limit? }` | `{ query, limit? }` (unchanged) |
| `get_sake_details` | `{ sake_id }` | **`{ brandId }`** |
| `find_similar_sakes` | `{ sake_id, top_k? }` | **`{ brandId, topK? }`** |
| `find_sakes_by_flavor` | `{ axes:{hanayaka:{min,max}…}, tags?, prefecture_id?, top_k? }` | **`{ f1Min?, f1Max?, …, f6Min?, f6Max?, tags?, areaId?, topK? }`** (flat, `f1..f6`) |
| `get_top_ranked` | `{ scope:'overall'\|'prefecture', prefecture_id?, limit? }` | **`{ scope:'overall'\|'area', areaId?, limit? }`** |

Inputs realign to **Sakenowa-canonical camelCase** (`brandId`, `areaId`, `topK`,
`f{n}Min/Max`). `query`, `limit`, `scope`, `tags` stay (sakenowa-mcp's own
contract). `top_k` → `topK` only where the test uses it (`find_similar_sakes`,
`find_sakes_by_flavor`); `search`/`get_top_ranked` keep `limit`.

## Output realignment

Outputs become canonical camelCase, mapped from the real columns (the test
asserts values, not field names, so this is a free design choice taken for
consistency with the inputs):

- **Area** `{ areaId, name }` (no romaji)
- **Brewery** `{ breweryId, name, nameRomaji: string|null }`
- **Brand** `{ brandId, name, nameRomaji: string|null, brewery, area }`
- **FlavorChart** `{ f1, f2, f3, f4, f5, f6 }` (numbers; the SQL reads `f1..f6` directly — no romaji mapping)
- **FlavorTag** `{ tagId, name }`
- ranked row: brand fields + `{ rank }`

## Divergence matrix (one row per tool)

| Tool | v0.1.0 queries | Canonical | Fix |
|---|---|---|---|
| `list_prefectures` | `SELECT id,name_ja,name_romaji FROM prefectures WHERE id<>0` | `SELECT area_id,name FROM areas WHERE area_id<>0` | rename table+cols; drop romaji |
| `search_sakes_by_name` | ILIKE `sakes.name_ja/name_romaji` + join `breweries`,`prefectures` | ILIKE `brands.name/name_kanji/name_romaji` + join `breweries`,`areas` | rename tables+cols |
| `get_sake_details` | input `sake_id`; join `flavor_profiles`(romaji) + `sake_flavor_tags` | input `brandId`; join `flavor_charts`(f1..6); **tags → `[]`** (no junction) | rename input+tables+cols; tags empty |
| `find_similar_sakes` | input `sake_id,top_k`; cosine over `flavor_profiles.hanayaka…` | input `brandId,topK`; cosine over `flavor_charts.f1…f6` | rename input + axis cols |
| `find_sakes_by_flavor` | nested `axes`+`prefecture_id`+`tags`+`top_k` | flat `f{n}Min/Max`+`areaId`+`topK`; **tags accepted but no-op** (no junction) | restructure input; rename tables/cols; tags no-op |
| `get_top_ranked` | `scope 'prefecture'`,`prefecture_id`; `rankings.scope`,`year_month` | `scope 'area'`,`areaId`; `rankings.kind`,`area_id`; **no `year_month`** | rename input+cols; drop year_month |

## Zod input audit

- `sake_id` → **RENAME** `brandId` (get_sake_details, find_similar_sakes)
- `top_k` → **RENAME** `topK` (find_similar_sakes, find_sakes_by_flavor)
- `prefecture_id` → **RENAME** `areaId` (find_sakes_by_flavor, get_top_ranked)
- `axes:{<romaji>:{min,max}}` → **RESTRUCTURE** flat `f1Min/f1Max…f6Min/f6Max`
- `scope` enum `'prefecture'` → **RENAME** value `'area'` (get_top_ranked)
- `query` (search), `limit` (search, get_top_ranked), `tags` (find_sakes_by_flavor) → **KEEP**

## Open questions for the maintainer

1. **Brand↔tag association is absent from the canonical mirror.** There is no
   `sake_flavor_tags`/`brand_flavor_tags` table; Sakenowa's per-brand tag ids
   (`/flavor-tags`) aren't ingested. This audit's rename makes
   `get_sake_details.flavorTags` always `[]` and `find_sakes_by_flavor`'s `tags`
   filter a **no-op** (accepted, documented, but cannot narrow). Options:
   (a) accept the gap for v0.1.x and document it; (b) define a canonical
   junction (e.g. `brand_flavor_tags(brand_id, tag_id)`) and require consumers
   to ingest it. **Chosen for this PR: (a)** — flagged in CHANGELOG. Revisit when
   the mirror gains the association.
2. **`name` vs `name_kanji`.** `brands`/`breweries` carry both (both NOT NULL),
   but only `name` is canonical Sakenowa; `name_kanji` is a consumer addition.
   This rename surfaces `name` (+ nullable `name_romaji`) and ignores
   `name_kanji`. Confirm `name` is the right display field.
3. **`name_romaji` is nullable** (null until the consumer runs LLM enrichment).
   Tools return it as `string | null`; `search_sakes_by_name` ILIKEs all three
   name columns so a romaji query still matches an enriched mirror.

## Recommended approach

Align the v0.1.x tool surface to **Sakenowa-API-canonical** naming
(`areas`/`brands`/`brand_id`/`area_id`/`f1..f6`, camelCase inputs) — the shape
any Sakenowa mirror naturally has. Because v0.1.0 was never published, this folds
into the single 0.1.0 first release (no separate 0.1.1). The binding success
signal is yawaragi's `pnpm test:mcp-integration` going green.

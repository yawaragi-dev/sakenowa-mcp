# Domain context — `@yawaragi/sakenowa-mcp`

A Model Context Protocol server that turns well-defined queries over a Sakenowa-mirrored Postgres into MCP tool calls. This document defines the domain language used in code, schemas, and tool descriptions.

## Language

**Sake**:
A sake product line (銘柄, *meigara*) produced by a single Brewery — e.g. "Dassai", "Kubota Senju". The unit on which all of this server's tools operate. Sakenowa's data refers to this as `brand`; we rename to `Sake` because "brand" collides with the colloquial English meaning ("the brand" = the company). Code, schemas, and tool descriptions exposed to consumers say `sake`. The underlying Sakenowa-identified field is `brand_id`.
_Avoid_: Brand, Label, Meigara, Product

**Brewery**:
The company that produces Sakes (酒蔵, *sakagura*). Matches Sakenowa's `brewery` 1:1.
_Avoid_: Sakagura, Kuramoto, House, Producer

**Prefecture**:
A Japanese administrative region — one of the 47 prefectures (e.g. Niigata, Yamaguchi). Sakenowa calls this `area`; we rename for precision and to reserve "Region" for any future broader climate grouping.
_Avoid_: Area, Region

**FlavorProfile**:
The continuous 6-tuple attached to a Sake along the Sakenowa aroma/body/dryness axes. Axes are `hanayaka`, `hojun`, `juko`, `odayaka`, `dry`, `keikai` (each a float in `[0, 1]`). Used for vector similarity ("sake similar to this one") and positioning, **not** for hard filters like "sweet" or "umami". Sakenowa's `flavorChart` (f1..f6).
_Avoid_: FlavorChart, TasteVector, FlavorMap

**FlavorAxis**:
One of the six fixed axes of a FlavorProfile, identified by romaji name: `hanayaka` (華やか), `hojun` (芳醇), `juko` (重厚), `odayaka` (穏やか), `dry` (ドライ), `keikai` (軽快). Closed enum — never extended. English labels are *approximations only*, not canonical identifiers.
_Avoid_: f1..f6 (storage detail only), flavor dimension, taste axis

**FlavorTag**:
A discrete categorical tag attached to a Sake from Sakenowa's 117-tag vocabulary (e.g. `甘味` sweet, `旨味` umami, `酸味` acidic, `フルーティ` fruity). Used for hard filters that the 6-axis FlavorProfile cannot answer. A Sake has zero or more FlavorTags.
_Avoid_: Tag (too generic), FlavorLabel, FlavorAttribute

**Ranking**:
A single Sake's position-and-score within a popularity list, for a specific month. Scope is either *overall* (global top 100) or a single Prefecture (regional top N). A Sake has zero or more Rankings: it may appear in overall, in its Brewery's Prefecture, in both, or in neither. The `year_month` records which monthly snapshot the position came from. The mirror stores only the latest snapshot — never historical.
_Avoid_: Rank, Position, PopularityRank

## Relationships

- A **Sake** is produced by exactly one **Brewery**
- A **Brewery** produces zero or more **Sakes**
- A **Brewery** is located in exactly one **Prefecture**
- A **Sake** has exactly one **FlavorProfile**
- A **Sake** has zero or more **FlavorTags**
- A **Sake** has zero or more **Rankings** (at most one *overall*, at most one per its Brewery's Prefecture, both for the current month only)

## 6-axis vocabulary

Authoritative table for the six FlavorAxes. Romaji + kanji are canonical identifiers; English approximations are user-facing labels in tool descriptions only.

| Axis | Romaji   | Kanji   | English approximation | Caveat                                  |
|------|----------|---------|-----------------------|------------------------------------------|
| f1   | hanayaka | 華やか   | fragrant / floral     | not "perfumed"; aromatic-ester-driven    |
| f2   | hojun    | 芳醇    | mellow / rich         | not "creamy"; umami-and-aroma depth      |
| f3   | juko     | 重厚    | heavy / full-bodied   | not "tannic"; weight + amino acid        |
| f4   | odayaka  | 穏やか   | mild / calm           | restrained aroma, not "neutral"          |
| f5   | dry      | ドライ   | dry                   | closest 1:1; tracks SMV broadly          |
| f6   | keikai   | 軽快    | light / crisp         | refreshing finish, low residual          |

These axes derive from Sakenowa's NLP of >1M Japanese-language reviews; the vocabulary reflects Japanese palate descriptors and does not always map cleanly to Western flavor language.

The Sakenowa Data API returns numeric `f1..f6` only; the labels above come from Sakenowa's accompanying type docs (verified 2026-05-22 against [https://muro.sakenowa.com/sakenowa-data](https://muro.sakenowa.com/sakenowa-data)).

When this server exposes flavor axes through MCP tool inputs or descriptions, use the romaji name (`hanayaka`, etc.) as the canonical identifier and include the kanji in the human-readable description.

## Naming convention

Sakenowa entities that carry a human-readable label (**Sake**, **Brewery**, **Prefecture**, **FlavorTag**) have two name columns:

- **`name_ja`** — the original Japanese (kanji/kana). Source of truth.
- **`name_romaji`** — Latin-alphabet transliteration. Display + search convenience. Mixed-case for display.

This server does **not** generate `name_romaji`. The ingest pipeline that populates the Postgres schema is responsible for whatever romaji it produces (LLM-generated, hand-curated, etc.). The server reads whichever values the mirror contains and returns them as-is.

## Flagged ambiguities

Things consumers and contributors hit repeatedly. Document, don't hide.

- **`areaId: 0` sentinel ("その他" / Other).** Sakenowa exposes a Prefecture row with id `0` and name "Other" for breweries with no assigned prefecture. Keep it as a Prefecture row so foreign-keys don't dangle, but exclude it from any geographic ranking or filter logic exposed through tools. Treating it as a real prefecture surfaces nonsense results.
- **Sweet, umami, and acidic are NOT FlavorAxes.** Sakenowa's 6-axis FlavorProfile measures aroma/body/dryness, not the canonical sommelier dimensions. Sweet ≈ inverse of `dry` *but* has its own discrete FlavorTag (`甘味`, id:12). Umami and acidic live only as FlavorTags (`旨味` id:5, `酸味` id:2). A "sweet sake" query must filter by FlavorTag, not by FlavorProfile. A "sake similar to this one" query uses FlavorProfile, not tags.
- **FlavorTag and FlavorAxis overlap semantically.** `辛口` (dry) is both an axis (`dry`/f5) and a tag (id:3). `フルーティ` (fruity) overlaps with `hanayaka` (f1). When both surfaces disagree, prefer the tag for hard filters and the axis for similarity. Tools should pick one or the other based on the query intent — never expose the redundancy.
- **Same-romaji collisions are possible across Breweries and Sakes.** Two distinct Japanese names (e.g. 旭酒造 / 朝日酒造) may transliterate to the same `name_romaji`. Search must disambiguate using Prefecture, `name_ja`, or both. `name_romaji` is not unique.
- **Placeholder rows in the mirror.** Sakenowa's data has small numbers of placeholder Brewery rows (empty names, ~48 observed) and foreign-producer rows (areaId-0, ~33 observed). They are part of the canonical mirror; tools should not silently filter them out unless the tool's purpose explicitly excludes them (e.g. a "top sakes from Niigata" query naturally won't return areaId-0 producers).

# Radical and component lookup — design (issue #71)

Status: Draft (2026-11-16), v0.3.0 stretch item 6. Written unattended. Every non-obvious call is a
**Ruling** (`what — why — cost if wrong`). Nothing is built yet. The issue has no comments, so the issue
body and the stretch brief ("licence check for any data source first") are the requirements.

## Intent

A learner meets 鯖 or 锈 in a text, can't read it and can't type it. They know it has 魚 or 钅 on the
left. They should be able to pick that radical, or the parts they can see, and watch the list of
characters shrink until theirs is in it. A character's entry page already links its radical, and that
link should also lead to "all characters with this radical".

## Licence check (done first)

Facts checked on 2026-11-16 from this machine. edrdg.org, unicode.org and creativecommons.org cannot
be reached from it. raw.githubusercontent.com and `git ls-remote` on github.com can.

**Already bundled. No new data needed for radicals.**

- **Unihan** (`plugins/data/unihan/Unihan.zip`, Unicode 18.0.0, 2026-07-31, Unicode License v3). The
  importer reads `kRSUnicode` and keeps only the radical number (`dict/unihan.go`). It stores a
  `radical` link from each zh character to the entry of its Kangxi radical (`dict/lexicon_import.go`).
  `kTotalStrokes` is stored as `attrs.strokes`.
- **KANJIDIC2** (CC BY-SA 4.0, EDRDG). Its classical `rad_value` becomes the same kind of `radical` link
  for ja, and `stroke_count` becomes `attrs.strokes`.
- `dict/kangxi.go` maps the numbers 1–214 to the unified radical characters.
  `GET /api/entries/{id}/chars` lists the characters under a radical entry. The entry page shows a
  "Radical" link and, on a radical's own entry, "Characters under this radical".
- **Decomposition in Unihan: there is none.** The bundled 18.0 archive has no `kIDS` field and no other
  decomposition field. All of its field names were counted. `Unihan_RadicalStrokeCounts.txt` holds only
  Adobe radical-stroke data.

**Candidates for components**

| Source | Licence as published | Covers | Verdict |
|---|---|---|---|
| Unihan (bundled) | Unicode License v3 | radical number + residual strokes, no decomposition | **Use** (radicals, radical forms) |
| KANJIDIC2 (bundled) | CC BY-SA 4.0 | classical radical, strokes; no components | **Use** (ja radicals) |
| **KanjiVG** (tag `r20260714`, commit `d95a976`) | CC BY-SA 3.0. Stated in the README, in a full `COPYING` and in every SVG header ("© Ulrich Apel … link to kanjivg.tagaini.net") | ~6,700 kanji, nested `kvg:element` groups | **Bundle** a derived ja component index, CC BY-SA 3.0, credited |
| KRADFILE / RADKFILE (EDRDG) | CC BY-SA (EDRDG licence page). The version could not be read here: a crate cites 3.0, other EDRDG files are 4.0 | ~12,000 kanji, 253 parts | **Not now.** Licence family is fine, but the canonical download and statement cannot be reached here. A later option for the owner |
| Make Me a Hanzi `dictionary.txt` (decomposition) | LGPL (COPYING). Derived from Unihan and cjklib, whose decomposition provenance was not verified | ~9,500 hanzi | **Local-only** |
| cjkvi-ids `ids.txt` | "follows CHISE terms"; other files GPLv2 | full CJK | **Local-only** |
| CHISE IDS | GPL-2.0-or-later | full CJK | **Local-only** |
| hanzi-writer-data (bundled stroke data) | Arphic Public License | strokes and medians, no decomposition | n/a |

Ruling: bundle only the KanjiVG-derived index — it is the one decomposition source whose licence was
verified at its source (README, COPYING, per-file header), and CC BY-SA sits with the bundled EDRDG data —
cost if wrong: one pack directory to remove.
Ruling: no GPL or LGPL decomposition data in the repository or the image, not even unmodified — the
brief rules copyleft data in a Docker image conservatively, and Make Me a Hanzi's upstream chain is
unverified — cost: Chinese gets no bundled component picker (radicals still work).
Ruling: KRADFILE is not bundled in this item, even though its licence family fits — the canonical file and
EDRDG's current statement cannot be fetched or checked from here, and a mirror is not provenance — cost: ja
components come from KanjiVG's graphical elements rather than EDRDG's curated 253 parts. Recorded as an owner
follow-up.
Ruling: the derived file is licensed CC BY-SA 3.0 (the same version, not upgraded to 4.0) and carries KanjiVG's
`COPYING` as `LICENSE` — §4(b) would allow a later version, but the same version is the obvious and safe
reading — cost: none.

## Goals

- `/search/parts`: a Kangxi radical table grouped by stroke count, a component picker, and a stroke-count
  filter. The result grid narrows on every pick. Parts that would empty the result are disabled.
- Works in ja and zh workspaces (zh-TW too: the primary subtag). Radicals come from existing data.
  Components come from installed **components** packs. ja has a bundled one; zh has one only if a
  local-only pack is installed.
- Entry page: "All characters with this radical" on a character's radical, and "Browse by stroke count"
  on a radical entry.
- KanjiVG credited on the Sources page, in `docs/sources.md`, the wiki and the README.

## Non-goals

Handwriting (#70). Residual-stroke ordering (see below). SKIP or four-corner codes. Editing
decompositions per user. Offline caching of the lookup. A components picker inside the text search box.
Languages without a character universe.

## The radical table (shared rule, `docs/contracts/radicals/kangxi.json`)

There are 214 rows: `{ "n": 85, "c": "水", "s": 4, "forms": { "all": ["氵","氺"], "zh": [], "ja": [] } }`.
`c` is the character from `dict/kangxi.go`. `s` is the classical Kangxi stroke count of the radical,
which is fixed by the numbering: 1–6 → 1, 7–29 → 2, 30–60 → 3, 61–94 → 4, 95–117 → 5, 118–146 → 6,
147–166 → 7, 167–175 → 8, 176–186 → 9, 187–194 → 10, 195–200 → 11, 201–204 → 12, 205–208 → 13,
209–210 → 14, 211 → 15, 212–213 → 16, 214 → 17. `forms` holds the alternative shapes a learner sees:

- `all`: positional forms, e.g. 亻 刂 忄 扌 攵 氵 灬 爫 牜 犭 王 礻 罒 艹 衤 覀 辶 阝 (163 and 170) ⺼月 (130) 飠 釒 糹 訁 镸.
- `zh`: the simplified forms, which Unihan marks `N'.0`: 讠 贝 车 钅 长 门 韦 页 风 飞 饣 马 鱼 鸟 卤 麦 黄 黾 齐 齿 龙 龟 纟 见 丬.
- `ja`: the Japanese forms, which Unihan marks `N''.0`, plus the standard shapes: 斉 歯 竜 亀 戸 青 黄 黒.

Ruling: radical stroke counts follow the Kangxi numbering, not `kTotalStrokes` of the radical character —
the table is ordered and grouped by them, and they differ in exactly one place (禸: Unihan 4, Kangxi 5) —
cost: a learner counting 禸 as 4 looks one group further.
Ruling: the forms are hand-curated from an analysis of the bundled Unihan file: every character with residual
0 under radical N. Independent characters such as 甲 申 由 under 田 are left out, and 王 and 月 are added —
the forms are display labels and search aliases only, never data a lookup depends on — cost: a missing alias
is a small fixture change.
Ruling: simplified radical forms classify under the Kangxi number (语 is under 149 言, shown with 讠) — that is
how Unihan's `kRSUnicode` works (the apostrophe marks the form), and the stored links already do this —
cost: none.

A Go package `server/internal/radicals` owns the table (it moves out of `dict/kangxi.go`) with
`Char(n)`, `Number(char)` (the canonical character or any form → n) and `Strokes(n)`. A Go test checks
it against the fixture, and the web module `lib/radicals/kangxi.ts` loads the same JSON.

## Data on the wire

**`GET /api/characters` gains `k`.** `k` is the Kangxi number of the character's radical link, and is
omitted when the character has none. It is resolved in the universe query as the first live form of the
`radical` link's target, mapped with `radicals.Number`. `charactersFormat` goes from 2 to 3, so old ETags
die. A database seeded before this release already has the links, so no re-seed is needed.
Ruling: the radical rides on the existing universe list, and the client filters — the page needs the
universe anyway (glyph, strokes, reading, gloss), the list is already ETag- and gzip-cached and loaded once per
session, and filtering ~13k rows in memory is instant — cost: ~1 byte more per row on the stats map's payload.

**New `GET /api/components?language=` (public).** It returns the union of all active components packs
for that language, keyed by glyph:

```json
{ "language": "ja", "parts": [{ "c": "言", "s": 7, "n": 142 }],
  "chars": { "語": ["言","口","吾","五","二"] } }
```

`n` is how many characters in the packs contain the part. `s` is 0 when no pack gives a stroke count.
The response uses the same ETag, gzip and `private, max-age=0, must-revalidate` handling as
`/api/characters`. It is cached in memory per language and rebuilt when the packs' `updated_at` changes.
A language without packs returns `{"language":"ja","parts":[],"chars":{}}` with 200. A malformed
language returns 400.

**New `GET /api/component-packs` (public).** It lists the installed packs (id, name, version, language,
license, attribution, notice) for the Sources page. It has the same shape as `/api/frequency-packs`.

Ruling: components are keyed by glyph, not by entry id — packs import independently of the dictionaries
(any order, survives a re-seed that renumbers nothing), and a zh cell matches through its glyph or any of its
variants `v` — cost: the client joins by string.
Ruling: both new routes are public, like `/api/characters` and the other credit lists. They hold no
per-user data, so there is nothing to isolate. Tests show that an anonymous caller and two different
users get the same bytes — cost: none.
Ruling: the service worker leaves both routes as `bypass` (the default) — `/api/characters` is not cached
either, and caching a 100 KB body for each credential is not worth it for a lookup aid — cost: no radical lookup
offline.

## Storage and the components pack type

The manifest gains a new `type: "components"` with one `format: "components-tsv"`. The pack directory
holds:

- `components.tsv`: one character per line, `語<TAB>言 口 吾 五 二`. `#` starts a comment line.
- An optional `parts.tsv`: `言<TAB>7` (stroke count 1–64).

Validation follows the other packs (`pack_limits`). The character must be exactly one Han code point
(`lexicon.isHan`). A part must be one code point, not the character itself. Parts are deduplicated,
with at most 32 per character. A malformed line is an error that names its line number. The file is
capped like `freq.csv`.

A migration with the next free number adds:

```sql
CREATE TABLE component_packs (pack_id TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT NOT NULL,
  language TEXT NOT NULL, license TEXT NOT NULL, attribution TEXT NOT NULL, notice TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE components (pack_id TEXT NOT NULL, char TEXT NOT NULL, parts TEXT NOT NULL, -- JSON array
  PRIMARY KEY (pack_id, char));
CREATE TABLE component_parts (pack_id TEXT NOT NULL, part TEXT NOT NULL, strokes INTEGER NOT NULL,
  PRIMARY KEY (pack_id, part));
```

A new package `server/internal/components` provides Import (it replaces the pack's rows in one
transaction), List and Index(language). It is modelled on `server/internal/freq`. `packs.go` gets the
type in Import, uninstall, the admin list and the type order. Settings, Data lists the type as
"Character components". The data is shared lookup data, not per-user data, so the account backup is
unchanged. An admin's full backup already holds the whole database.
Ruling: own tables rather than lexicon attrs or a new link type — links are part of the sync wire (Android
contract) and attrs show on entries, while components are a lookup index — cost: one migration.
Ruling: migration numbering is decided at build time (other stretch branches may also take 036) — cost: a
rename at merge.

## The bundled pack `plugins/data/kanjivg-components` (ja)

`scripts/prepare-kanjivg-components.mjs <kanjivg-checkout> <out-dir>` reads `kanji/<5-hex>.svg`. It
skips variant files whose names contain `-`, and anything that is not a CJK ideograph. For each kanji it
collects every nested `kvg:element` except the kanji itself, deduplicated in document order. Split parts
(`kvg:part`) count once. A part's stroke count is the number of paths in the part's own KanjiVG file
when there is one, otherwise the most common path count among its unsplit groups.
`scripts/fetch-kanjivg-components.sh` clones tag `r20260714` with `--depth 1`, checks commit `d95a976…`,
refuses to run without `KANJIVG_LICENCE_CHECKED=<YYYY-MM-DD>` (the same pattern as Jiten), and writes
`manifest.json` (`license: "CC BY-SA 3.0"`, attribution "KanjiVG © Ulrich Apel
(https://kanjivg.tagaini.net); component index derived by qinqin"), a `notice` (what was derived and how,
under the same licence), `LICENSE` (KanjiVG `COPYING`), `ATTRIBUTION.md`, `components.tsv` and
`parts.tsv`. That is roughly 6,700 lines and 150 KB. It is a manual maintainer action, never run in CI.
Ruling: every nested element counts as a part (語 → 言 口 吾 五 二) — learners pick what they see at any depth
— cost: some noise parts (二 inside 五), which the "common parts" threshold mostly hides.

**zh, local-only.** `scripts/prepare-ids-components.mjs <ids.txt> <out-dir> --id --license --attribution
[--unihan Unihan_IRGSources.txt]` turns IDS lines (`U+XXXX<TAB>字<TAB>IDS`, the CHISE and cjkvi format) into a
components-tsv pack under the gitignored `plugins/data-local/`. It expands every part recursively from the
same table, with a cycle guard, and drops IDCs (U+2FF0–U+2FFF, U+31EF), `&…;` entities and `？`. Stroke
counts come from `kTotalStrokes` when `--unihan` is given. The script is local tooling only. The
pack's own manifest carries whatever licence its source has. `check-sources.mjs` lists the example id
`zh-components` as local-only.

## The lookup rule (shared, `docs/contracts/radicals/lookup.json`)

A pure module `apps/web/src/lib/radicals/lookup.ts` does the work. Its inputs are the universe rows
`{i,c,s,k,v}`, the components map and a selection `{ r?: number, p: string[], s?: number }`.

- A cell matches `r` when `k === r`. It matches part `x` when its glyph or any variant has `x` among its
  parts. All chosen parts must match (AND). It matches `s` when its total strokes equal `s`.
- With an empty selection there are no results. The page shows the pickers only.
- Results are ordered by total strokes ascending (unknown strokes last), then by code point. They are
  grouped by stroke count.
- **Available parts** are the parts that occur in at least one current result and are not chosen yet.
  The other parts are disabled. **Available strokes** are the distinct stroke counts of the results
  when `s` is ignored.
- Radicals and parts are separate questions. `r` is the one classifying radical; parts are "contains". A
  part that is also a radical (氵) is matched by containment only.
- The picker lists parts with `n ≥ 10`, grouped by `s`, with `s = 0` in a final "?" group. "Show all
  parts" lifts the threshold. A text box takes any typed character: a radical form (氵 → `r=85`), or a part.

Ruling: total strokes, never residual strokes — residual = total − radical strokes is wrong for simplified
radical forms (语: 9 − 7 = 2, but 讠 leaves 7), Unihan's residual is not kept, and KANJIDIC2 has none — cost:
users of printed radical indexes look in a longer group.
Ruling: no results until something is picked; at most 300 cells, then "Show all N" — 13k cells would be slow and
useless — cost: one extra click on huge radicals (水 has more than 600 characters in zh).
Ruling: the `n ≥ 10` threshold is a constant in the contract fixture — it keeps KanjiVG's ~1,500 elements to a
pickable few hundred — cost: tuning later.

## UI

`/search` gets a link, "Find a character by radical or part", when the workspace language is ja or zh.
`/search/parts` is a private page, like `/search`. Its URL holds the state: `?r=85&p=口&p=木&s=8`, so
reloads and entry-page links work. It has a radical table in 17 stroke groups: each tile shows the
radical and its language's forms, `aria-pressed`, and a number tooltip. It has a parts picker (shown
only when the language has parts), stroke chips, a "Clear" button, and a live `role="status"` line ("23
characters"). The result grid uses the stats map's glyph styling, and each cell links to `/entry/{id}`.
Without dictionary data it shows the existing dictionary hint. In other languages it says "Radical lookup
is available in Chinese and Japanese workspaces". The page component stays thin: state, URL and
lookup sit in `lib/radicals/*.ts`.

Entry page: if a character's `radicalWritten` maps to a number, a link "All characters with this
radical" points to `/search/parts?r=N`. A radical's own entry (written is a table character) gets
"Browse by stroke count" next to "Characters under this radical".

## Risks

- KanjiVG elements are graphical, not etymological, and the noise parts are visible with "Show all".
  Acceptable for a narrowing aid.
- Parallel stretch branches (#75 packs, #72 search page) touch `manifest.go`, `packs.go`, the search
  page and the migrations, so expect merge conflicts. Keep each edit small.
- If the KanjiVG clone is blocked where the plan runs, the code and tests still ship with a fixture
  pack. The bundled pack is then an owner follow-up, and the Execution record must say so.
- The radical number map relies on the radical entry's first form being the canonical table character.
  The import guarantees that (`radicalEntryID`), and the test covers it.

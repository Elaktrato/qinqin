# Starter data sources

The repository bundles four upstream dictionaries, one frequency list and
four level lists under `plugins/data/` so that a fresh clone or Docker image
seeds offline (`qinqin seed`):

**Japanese**

| Pack | Provides | License | Upstream |
|---|---|---|---|
| **KANJIDIC2** (`kanjidic2`) | Kanji readings, meanings, stroke counts, radicals | CC BY-SA 4.0 (EDRDG) | https://www.edrdg.org/wiki/index.php/KANJIDIC_Project |
| **JMdict** (`jmdict`) | Japanese–English words and meanings; its priority and usually-kana tags rank homophones in the Reader | CC BY-SA 4.0 (EDRDG) | https://www.edrdg.org/ |
| **Jiten frequency list** (`jiten-frequency`) | Japanese word frequency ranks that order lookup results | CC BY-SA 4.0 (Jitensoft) | https://jiten.moe/frequency-dictionaries |
| **JLPT (kanji)** (`jlpt-kanji`), from kanjiapi.dev | Kanji by JLPT level N5–N1 | MIT (© 2023 Iridium Szreter) | https://github.com/onlyskin/kanjiapi.dev |
| **JLPT (vocabulary)** (`jlpt-words`), from open-anki-jlpt-decks | Words by JLPT level N5–N1 | MIT (© 2020 Jamie Sinclair); upstream chain in "Level lists" | https://github.com/jamsinclair/open-anki-jlpt-decks |

**Chinese**

| Pack | Provides | License | Upstream |
|---|---|---|---|
| **CC-CEDICT** (`cedict`) | Mandarin–English words and meanings | CC BY-SA 4.0 | https://cc-cedict.org |
| **Unihan** (`unihan`) | Radical-stroke counts, simplified/traditional variant mappings, character definitions | Unicode License v3 | https://www.unicode.org/reports/tr38/ |
| **HSK 3.0 (characters)** (`hsk30-chars`) and **HSK 3.0 (words)** (`hsk30-words`), from ivankra/hsk30 | The 3,000 HSK 3.0 characters by reading level; the 11,092 HSK 3.0 words, levels 1–6 and 7–9 | MIT as stated upstream, copyright of the underlying list uncertain (see "Level lists") | https://github.com/ivankra/hsk30 |

Each pack directory carries its `manifest.json` (including `license` and
`attribution`), the full license text (`LICENSE`), and credits
(`ATTRIBUTION.md`). The dictionary files are redistributed **unmodified**;
the download-and-bundle procedure lives in `scripts/fetch-seeds.sh`. The level
lists are converted (see "Level lists").

The dictionary licenses apply only to the dictionary data. The
API exposes each active dictionary's `license` and `attribution` via
`GET /api/dictionaries`, and the web app surfaces those credits in its
sources view.

## Frequency data

**Jiten** (<https://jiten.moe>, published by Jitensoft) builds word
frequency lists from the Japanese media it analyses (anime and drama
subtitles, novels, visual novels, games, manga and more). The bundled pack is
its **global** list. The publisher states the licence on
<https://jiten.moe/frequency-dictionaries> ("All frequency lists are licensed
under CC BY-SA 4.0.") and in article 6.1 of its terms,
<https://jiten.moe/terms> (version 2026-08-08: frequency lists "licensed under
CC BY-SA 4.0. Within that licence, commercial use is permitted, subject to
attribution and share-alike."); both checked on 2026-11-12.

`scripts/fetch-jiten-frequency.sh` (called by `fetch-seeds.sh`) downloads the
published Yomitan-format file once and writes `plugins/data/jiten-frequency/`:
**unmodified ranks** converted to `freq.csv.gz` (`term,reading,rank`), the
CC BY-SA 4.0 text and the attribution, with exact duplicate rows kept once.
The converted file is shared under the same licence. Refreshing the snapshot
is a one-off **manual** maintainer action, never run in CI or at app runtime:
re-read the two pages above first, then run the script with
`JITEN_LICENCE_CHECKED=<YYYY-MM-DD> JITEN_TERMS_VERSION=<version>` (it refuses
to run without them). Its one request to Jiten is the published file's
download link, the same request the page's "Yomitan" download button makes;
it does not query, iterate or proxy Jiten's API, and the app never contacts
Jiten: lookups use the snapshot only.
In short: a refresh is a single manual download of the published file (see
article 5(b) of the terms), never automated in CI.
`GET /api/frequency-packs` exposes each installed frequency pack's `license`
and `attribution`, and the Sources page lists them. An opt-in test seeds the
real bundle and checks lookups against it (about a minute):
`QINQIN_REAL_DATA_TESTS=1 go test ./cmd/qinqin -run RealPacks -v` (from `server/`).

## Character fields used by the map

The importers keep a few per-character attributes for the character map
(`GET /api/characters`):

- **KANJIDIC2**: `<grade>` (school grade, 1–10), `<freq>` (newspaper rank,
  1–2501) and the first stroke count. Every KANJIDIC2 kanji carries
  `src = kd2`, which defines the Japanese universe. Its `<jlpt>` field (the
  pre-2010 scale of four levels) is not imported; JLPT N5–N1 comes from the
  `jlpt-kanji` level list, and a re-seed removes the `jlpt` attr an older import
  stored.
- **Unihan**: `kTotalStrokes` (first count), `kTGHZ2013` (in the standard
  characters list), `kGB0` (GB2312 row: rows 16–55 are level 1, 56–87 level 2) and
  `kGradeLevel` (Hong Kong primary grade). `kGB0` and `kGradeLevel` come from the
  optional `OtherMappings` and `DictionaryLikeData` members of `Unihan.zip`.

Each importer owns exactly these keys (KANJIDIC2 also the retired `jlpt`) and
replaces them on re-seed; CC-CEDICT owns none.

## Level lists

The character map groups by, and entries carry badges from, installed level
schemes. Four are bundled, generated by `scripts/prepare-level-packs.mjs` from
upstream files pinned by commit (the download commands are in the script's
header; each pack's `ATTRIBUTION.md` records the commit and the SHA-256 of the
inputs). Re-running the script on the same files reproduces the packs byte for
byte.

### Japanese

- **JLPT (kanji)** (`jlpt-kanji`, unit `character`): `jlpt.tsv` of
  [kanjiapi.dev](https://github.com/onlyskin/kanjiapi.dev), **MIT licence,
  Copyright 2023 Iridium Szreter** (the full text is the pack's `LICENSE`). Levels
  N5 (79 kanji), N4 (166), N3 (367), N2 (367), N1 (1,232), easiest first. The
  Japan Foundation and JEES have published no kanji list since the 2010
  revision of the test, so this, like every N5–N1 list, is an unofficial
  reconstruction; it was chosen over KANJIDIC2's pre-2010 four-level field,
  which is no longer imported.
- **JLPT (vocabulary)** (`jlpt-words`, unit `word`): `src/n5.csv` …
  `src/n1.csv` of
  [open-anki-jlpt-decks](https://github.com/jamsinclair/open-anki-jlpt-decks),
  **MIT licence, Copyright (c) 2020 Jamie Sinclair** (the full text is the
  pack's `LICENSE`). Its README says: "Original deck data was taken from
  https://github.com/chyyran/jlpt-anki-decks, which were based on decks from
  tanos.co.uk". The tanos.co.uk lists are Jonathan Waller's unofficial JLPT
  lists, described as published under Creative Commons Attribution (CC BY);
  that description was not verified here (the site could not be reached).
  Like the kanji lists, they are reconstructions, not official JLPT lists.
  The `expression` column gives the forms: variants split on ";", notes in
  parentheses and affix tildes removed (～円 → 円), grammar patterns with an
  inner tilde dropped (4 pieces), a する verb reduced to its noun (コピーする →
  コピー), each form kept once at its easiest level: N5 716, N4 658, N3 2,069,
  N2 1,725, N1 2,631 forms. The `reading` column is not used, because the
  importer resolves written forms only. Against the bundled JMdict 168 forms
  do not resolve and are skipped at seed time (N5 19, N4 16, N3 18, N2 66,
  N1 49), mostly kana spellings of words JMdict writes with kanji (けんか,
  よい, にぎやか) and set phrases (いってきます). The seed line reports 208
  unknown forms: those 168 plus 40 iteration marks 々 in resolved words
  (時々), for which no character level is derived.

### Chinese

- **HSK 3.0 (characters)** (`hsk30-chars`, unit `character`): `hsk30-chars.csv`
  of [ivankra/hsk30](https://github.com/ivankra/hsk30), the 3,000 characters
  by reading level (the level at which a character first appears in the word
  list): HSK 1–6 with 300 each, HSK 7–9 with 1,200.
- **HSK 3.0 (words)** (`hsk30-words`, unit `word`): `hsk30.csv` of the same repository,
  the 11,092 words, levels HSK 1–6 and HSK 7–9, in simplified characters.
  Variant rows (爸爸|爸, 有（一）点儿) contribute each cleaned variant upstream
  lists; forms upstream marks as mere examples of a prefix or suffix (第二 for
  第) are left out; 11,059 forms in all. On the map this word scheme shows the
  characters its words are written with, each at its lowest level. A
  one-character word (好) links to the character entry, as CC-CEDICT gives
  single characters as characters. Words with no dictionary entry are skipped
  at seed time and reported ("unknown forms skipped").

Licence of both HSK packs: the hsk30 repository states the **MIT licence**
(Copyright (c) 2023 Ivan Krasilnikov, (c) 2021 Shawky, (c) 2021 Pleco Inc.;
the full text is each pack's `LICENSE`). Its README is candid about the data:
it is "largely derived from" elkmovie/hsk30 and
shawkynasr/HSK-official-Query-System, "both also under MIT license and
claiming copyright -- of course, somewhat questionably, as the original work
they *copy* is PRC's government work", and "Depending on PRC law specifics
might be public domain". The underlying list is the HSK 3.0 standard
published by the PRC Ministry of Education in March 2021. The project bundles
it on that basis, under the MIT terms stated upstream, and claims nothing
beyond them; neither the JLPT nor the HSK packs are official releases, and
the project is not affiliated with either test.

The hand-written CC0 samples `hsk-mini` and `jlpt-mini` live in `plugins/samples/`,
outside the default seed root (their badges would duplicate the real lists); the
seed tests use them, and the map hides them when they are seeded explicitly.

## Local-only data

Data whose licence is unclear or restrictive is never committed. It can live
in `plugins/data-local/`, which `.gitignore` excludes: `qinqin seed` with no
`--packs` imports `plugins/data` and then `plugins/data-local` when that
directory exists (or name the roots: `--packs plugins/data,plugins/data-local`).
The app works without anything there; frequency packs only reorder lookup
results. A level pack added there appears as a grouping on the character map;
see "Level packs" below.

Under Docker the image holds only its bundled packs (`/opt/qinqin/packs`):
`docker compose exec qinqin qinqin seed` does not see the host's
`plugins/data-local` unless it is mounted. Add a volume such as
`./plugins/data-local:/opt/qinqin/local:ro` to the service and seed with
`docker compose exec qinqin qinqin seed --packs /opt/qinqin/packs,/opt/qinqin/local`.

A frequency pack is a directory with a `manifest.json` and its data:

- a Yomitan frequency dictionary: put the `.zip` as downloaded (or its
  unpacked `index.json` and `term_meta_bank_*.json`) in the directory, with
  `"format": "yomitan-freq"`;
- a CSV: `freq.csv` or `freq.csv.gz` with the header `term,reading,rank`
  (an empty reading applies to any reading), with `"format": "freq-csv"`.

```json
{
  "id": "my-freq",
  "name": "My frequency list",
  "version": "2026-11-12",
  "type": "frequency",
  "language": "ja",
  "license": "as stated by its publisher",
  "attribution": "who made it, with a link",
  "format": "yomitan-freq"
}
```

`license` and `attribution` are required. Then run `qinqin seed`. Packs keep
the order they were first imported in, and the first pack with data for a word
decides its frequency ordering, so with the default roots the bundled Jiten
list comes first.

Researched and **not bundled** (no redistribution; use locally only, if their
terms allow it):

- **BCCWJ** frequency lists (NINJAL): licensed for research and education only.
- **JPDB** frequency lists: built from scraped data; no licence from the source.
- **SUBTLEX-CH**: terms of use unclear.
- **Leiden Weibo corpus** frequencies: non-commercial licence.
- **wordfreq** (zh) and **jieba** word counts: provenance of the underlying
  counts unclear.

## Stroke-order data

Stroke-order animation data (`hanzi-writer-data`, derived from the
Make Me a Hanzi dataset) is licensed under the **Arphic Public License**.
The web frontend bundles it and credits it on its Sources page. The full
license text is committed at `apps/web/static/ARPHICPL.TXT` (copied verbatim
from the `hanzi-writer-data` package) and is served by the app at
[`/ARPHICPL.TXT`](/ARPHICPL.TXT).

Attribution: [Make Me a Hanzi](https://github.com/skishore/makemeahanzi),
[hanzi-writer-data](https://www.npmjs.com/package/hanzi-writer-data).

## Reader text sources

The Reader (see the README) imports public-domain works on user request. Nothing
from these sources is bundled; each imported book stores its source link,
attribution, and a licence note, which the Reader shows.

- **Aozora Bunko** (<https://www.aozora.gr.jp/>) — only works in the public domain
  are listed or importable: the catalog's work copyright flag **and** person
  copyright flag must both say no copyright, and a row that does not is skipped
  (fail closed). The catalog is used under CC BY 4.0, as stated on aozora.gr.jp,
  and each book keeps its 底本 (source edition) credit.
- **Project Gutenberg** (<https://www.gutenberg.org/>) — Chinese and Japanese text
  ebooks from the catalog. The catalog CSV has no rights column, so each imported
  book carries the note "Distributed by Project Gutenberg as public domain in the
  USA; copyright status elsewhere may differ." A book is fetched only when a user
  imports it, one book per request, with requests rate limited and cached.
- **Wikisource** was considered and left out of v1 pending a licence check.

## Conversion library

Traditional/simplified conversion in the Reader runs in the browser with
[`opencc-js`](https://github.com/nk2028/opencc-js), whose package metadata gives
the licence as `MIT AND Apache-2.0`: the library code is MIT, and its conversion
dictionaries are generated from [`opencc-data`](https://github.com/nk2028/opencc-data)
under the Apache License, Version 2.0. It is bundled in the web build and loaded
only when a script conversion is selected. The Sources page credits it, and both
licence texts are committed at `apps/web/static/OPENCC-JS-LICENSE.TXT` and
`apps/web/static/OPENCC-APACHE-2.0.TXT` (copied verbatim from the `opencc-js`
package; a web test keeps them identical) and served by the app at
[`/OPENCC-JS-LICENSE.TXT`](/OPENCC-JS-LICENSE.TXT) and
[`/OPENCC-APACHE-2.0.TXT`](/OPENCC-APACHE-2.0.TXT).

## Level packs

A levels pack is a directory with a `manifest.json` (`"type": "levels"`, `language`,
`"format": "json"`, plus `id`, `name`, `version`, `license`, `attribution`) and a
`levels.json`: `{"unit": "word" | "character", "levels": [{"name": "1", "entries": [...]}]}`.
An entry is a written form (`"風"`) or an object with an optional reading
(`{"form": "風", "reading": "かぜ"}`): for a word unit the reading picks, among
the words written with the form, the one read so; without a match the form
alone decides. Packs with plain strings keep working unchanged.
Entries must already exist in an imported dictionary; unknown ones are skipped and
reported. Put one under `plugins/data-local/` and run `qinqin seed`. The map
offers every installed scheme except the samples (`hsk-mini`, `jlpt-mini`, in
`plugins/samples/`).

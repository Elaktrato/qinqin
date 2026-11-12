# Starter data sources

The repository bundles four upstream dictionaries under `plugins/data/` so
that a fresh clone or Docker image seeds offline (`qinqin seed`):

| Pack | Provides | License | Upstream |
|---|---|---|---|
| **CC-CEDICT** (`cedict`) | Mandarin–English words and meanings | CC BY-SA 4.0 | https://cc-cedict.org |
| **Unihan** (`unihan`) | Radical-stroke counts, simplified/traditional variant mappings, character definitions | Unicode License v3 | https://www.unicode.org/reports/tr38/ |
| **JMdict** (`jmdict`) | Japanese–English words and meanings; its priority and usually-kana tags rank homophones in the Reader | CC BY-SA 4.0 (EDRDG) | https://www.edrdg.org/ |
| **KANJIDIC2** (`kanjidic2`) | Kanji readings, meanings, stroke counts, radicals | CC BY-SA 4.0 (EDRDG) | https://www.edrdg.org/wiki/index.php/KANJIDIC_Project |

Each pack directory carries its `manifest.json` (including `license` and
`attribution`), the full license text (`LICENSE`), and credits
(`ATTRIBUTION.md`). The files are redistributed **unmodified**; the
download-and-bundle procedure lives in `scripts/fetch-seeds.sh`.

The dictionary licenses apply only to the dictionary data. The
API exposes each active dictionary's `license` and `attribution` via
`GET /api/dictionaries`, and the web app surfaces those credits in its
sources view.

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

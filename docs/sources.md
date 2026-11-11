# Starter data sources

The repository bundles four upstream dictionaries under `plugins/data/` so
that a fresh clone or Docker image seeds offline (`qinqin seed`):

| Pack | Provides | License | Upstream |
|---|---|---|---|
| **CC-CEDICT** (`cedict`) | Mandarin–English words and meanings | CC BY-SA 4.0 | https://cc-cedict.org |
| **Unihan** (`unihan`) | Radical-stroke counts, simplified/traditional variant mappings, character definitions | Unicode License v3 | https://www.unicode.org/reports/tr38/ |
| **JMdict** (`jmdict`) | Japanese–English words and meanings | CC BY-SA 4.0 (EDRDG) | https://www.edrdg.org/ |
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

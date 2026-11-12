# Seed packs

`qinqin seed --data <dir> --packs plugins/data` imports every pack under this
directory. A pack is a directory with a `manifest.json` (id, name, version,
`type` dictionary|levels|sentences|frequency, `language`, `license`, `attribution`,
`format`) plus the data file its format reads.

Committed (small, hand-written, CC0 — samples, not the official lists):

| Pack | Type | Language | Shows |
|------|------|----------|-------|
| `zh-mini` | dictionary | zh | pinyin → bopomofo, traditional variants |
| `hsk-mini` | levels | zh | word levels with derived character levels |
| `ja-mini` | dictionary | ja | kana readings, romaji search |
| `jlpt-mini` | levels | ja | an N5 sample |
| `es-demo` | dictionary | es | a runtime-added, data-only language (no code pack) |

Committed too (the starter bundle: compressed upstream files as shipped, and
the converted Jiten list, with `LICENSE` and `ATTRIBUTION.md` in each
directory):

| Pack | Type | Language | Contents |
|------|------|----------|----------|
| `cedict` | dictionary | zh | CC-CEDICT words (`dictionary.txt.gz`) |
| `unihan` | dictionary | zh | radical-stroke counts, variants, definitions (`Unihan.zip`) |
| `jmdict` | dictionary | ja | JMdict words (`jmdict.xml.gz`) |
| `kanjidic2` | dictionary | ja | KANJIDIC2 kanji (`kanjidic2.xml.gz`) |
| `jiten-frequency` | frequency | ja | Jiten global word frequency ranks, converted to `freq.csv.gz` (`term,reading,rank`, ranks unmodified) |

The importers read the compressed files directly, so a fresh clone or the
Docker image seeds with no network and no decompression step. Run
`scripts/fetch-seeds.sh` to refresh the bundle; it rewrites these pack
directories in the bundled layout and removes any legacy decompressed
payloads (`dictionary.txt`, `jmdict.xml`, `kanjidic2.xml`). The Jiten pack
alone is refreshed by `scripts/fetch-jiten-frequency.sh`, a manual
maintainer step: re-check Jiten's licence first and pass
`JITEN_LICENCE_CHECKED=<YYYY-MM-DD> JITEN_TERMS_VERSION=<version>` (both
scripts require them). That conversion needs `python3`; building, running
and testing the app do not.

A slow test seeds this whole directory and checks lookups against the real
data; it is opt-in: `QINQIN_REAL_DATA_TESTS=1 go test ./cmd/qinqin -run RealPacks -v`
(from `server/`).

Data with an unclear or restrictive licence is never committed here: it goes
in the gitignored `plugins/data-local/`, which `qinqin seed` also imports
when it exists (see `docs/sources.md`, "Local-only data").

Seeding is idempotent: re-running replaces each pack's own rows and touches
nothing else. Dictionaries (including the character data) import before level
packs — the seed command orders them — because levels only link to entries
that already exist; unknown forms are skipped and reported.

CC-CEDICT import policy: malformed lines are skipped, logged (first ten) and
counted; a file where more than 5% of entry lines are malformed is rejected as
the wrong file. Pinyin that cannot be converted is kept as written and counted
(no bopomofo is derived for it). Homograph lines for one written form
(行 xíng / háng) merge into one entry with all their readings and senses.

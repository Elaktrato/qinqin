# Seed packs

`qinqin seed --data <dir> --packs plugins/data` imports every pack under this
directory. A pack is a directory with a `manifest.json` (id, name, version,
`type` dictionary|levels|sentences, `language`, `license`, `attribution`,
`format`) plus the data file its format reads.

Committed (small, hand-written, CC0 — samples, not the official lists):

| Pack | Type | Language | Shows |
|------|------|----------|-------|
| `zh-mini` | dictionary | zh | pinyin → bopomofo, traditional variants |
| `hsk-mini` | levels | zh | word levels with derived character levels |
| `ja-mini` | dictionary | ja | kana readings, romaji search |
| `jlpt-mini` | levels | ja | an N5 sample |
| `es-demo` | dictionary | es | a runtime-added, data-only language (no code pack) |

Not committed (large; fetched by `scripts/fetch-seeds.sh` into `cedict/`,
`unihan/`, `jmdict/`, `kanjidic2/`): CC-CEDICT, Unihan, JMdict, KANJIDIC2.

Seeding is idempotent: re-running replaces each pack's own rows and touches
nothing else. Dictionaries (including the character data) import before level
packs — the seed command orders them — because levels only link to entries
that already exist; unknown forms are skipped and reported.

CC-CEDICT import policy: malformed lines are skipped, logged (first ten) and
counted; a file where more than 5% of entry lines are malformed is rejected as
the wrong file. Pinyin that cannot be converted is kept as written and counted
(no bopomofo is derived for it). Homograph lines for one written form
accumulate their senses; the entry keeps the last line's reading.

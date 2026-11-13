# Seed packs

`qinqin seed --data <dir> --packs plugins/data` imports every pack under this
directory. A pack is a directory with a `manifest.json` (id, name, version,
`type` dictionary|levels|sentences|frequency, `language`, `license`, `attribution`,
`format`) plus the data file its format reads.

Committed (small, hand-written, CC0 — a sample):

| Pack | Type | Language | Shows |
|------|------|----------|-------|
| `es-demo` | dictionary | es | a runtime-added, data-only language (no code pack) |

The other hand-written samples live in `plugins/samples/`, outside the default
seed root. The DICTIONARIES `zh-mini` (pinyin → bopomofo, traditional
variants) and `ja-mini` (kana readings, romaji search) are keyed by written
form, so next to CC-CEDICT and JMdict they would add a second,
part-of-speech-less card for the same words, ranked first. The LEVEL packs
`hsk-mini` (word levels with derived character levels) and `jlpt-mini` (an N5
sample) would add a second, duplicate badge next to the bundled JLPT kanji list
(and a locally installed HSK 3.0 or JLPT vocabulary); the map hides them even when seeded. Seed them explicitly
(for a small demo database, or alongside the full bundle) with
`qinqin seed --packs plugins/samples` (or `--packs plugins/data,plugins/samples`).
The seed tests use them as small fixtures.

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

Committed level list, JLPT kanji only (converted, with the upstream `LICENSE` and an
`ATTRIBUTION.md`):

| Pack | Type | Language | Scheme | Contents | Licence |
|------|------|----------|--------|----------|---------|
| `jlpt-kanji` | levels | ja | JLPT (kanji) | kanji by JLPT level, unit `character`: N5 79, N4 166, N3 367, N2 367, N1 1,232 (kanjiapi.dev `jlpt.tsv`, provenance not stated upstream; unofficial, as every N5–N1 list is; omits 172 jōyō kanji such as 分 可 無 的, and its N1 holds 247 jinmeiyō name kanji) | MIT, © 2023 Iridium Szreter |

Level pack format: `levels.json` is `{"unit": "word" | "character", "levels":
[{"name": "N5", "entries": [...]}]}`, levels easiest first. An entry is a
written form (`"外"`) or `{"form": "風", "reading": "かぜ"}`; the optional
reading makes a word-unit import prefer the word that has both the form and
the reading (風 かぜ rather than the usually-kana 振り ふり, also written 風)
and falls back to the form alone when no word has both. Plain-string packs
are unchanged. The optional local `jlpt-words` pack carries the readings of its source.

JLPT vocabulary is NOT bundled. Its upstream licence chain could not be verified,
so it is an optional, local-only pack that you generate yourself (see the steps
below); the repository holds no JLPT vocabulary data. The reason: open-anki-jlpt-decks
labels itself MIT (© 2020 Jamie Sinclair), but its README says "Original deck
data was taken from https://github.com/chyyran/jlpt-anki-decks, which were
based on decks from tanos.co.uk"; the tanos.co.uk lists (Jonathan Waller) are
described as Creative Commons Attribution, which was not verified here (the
site was unreachable). Expressions are cleaned (variants split on ";", notes
in parentheses and affix tildes removed, patterns dropped, a する verb with a
stem of two or more characters reduced to its noun: 勉強する → 勉強, 関する
stays) and each form with its reading kept at its easiest level; kana
spellings of words JMdict writes with kanji (けんか, よい) do not resolve and
are skipped at seed time (168 of 8,008 entries against the bundled JMdict).

Generating JLPT vocabulary locally (one level pack, `jlpt-words` "JLPT
(vocabulary)": N5 728, N4 668, N3 2,134, N2 1,784, N1 2,694 entries), from the
repository root:

```bash
mkdir /tmp/jlpt-vocab && cd /tmp/jlpt-vocab
base=https://raw.githubusercontent.com/jamsinclair/open-anki-jlpt-decks/1ad66734417aca9dbcca6b2d5ee440cb13ab3ba0
for n in n5 n4 n3 n2 n1; do curl -fsSLo $n.csv $base/src/$n.csv; done
curl -fsSLo LICENSE $base/LICENSE
cd -
node scripts/prepare-level-packs.mjs --jlpt-vocab /tmp/jlpt-vocab   # writes plugins/data-local/
qinqin seed --packs plugins/data,plugins/data-local
```

The converter fails with a clear message if one of the six files is missing.
Under Docker, mount `plugins/data-local` as for HSK 3.0 below. Once seeded, the
map's "Group by" and the Sources page pick it up like any installed scheme. The
generated `ATTRIBUTION.md` quotes the README chain, names the pinned upstream
commit, records the SHA-256 of the input files and says "not bundled, local use
only"; do not commit or redistribute the output (`plugins/data-local/` is
gitignored).

HSK 3.0 is NOT bundled. Its licence status is unclear, so it is an optional,
local-only pack that you generate yourself (see the steps below); the repository
holds no HSK 3.0 data. The reason: the ivankra/hsk30 README says "Code
(`*.ipynb`) is MIT licensed" and that the data "is largely derived from"
elkmovie/hsk30 (an OCR of the Ministry of Education's 2021 HSK 3.0 document)
and shawkynasr/HSK-official-Query-System (a copy of the HSK website's
database), "both also under MIT license and claiming copyright -- of course,
somewhat questionably, as the original work they *copy* is PRC's government
work (notice on website: 版权所有：中华人民共和国教育部). Depending on PRC law
specifics might be public domain." The `LICENSE` file is MIT (© Ivan
Krasilnikov, Shawky, Pleco Inc.), but the copyright status of the ministry's
list is uncertain.

Generating HSK 3.0 locally (two level packs, `hsk30-chars` "HSK 3.0
(characters)" and `hsk30-words` "HSK 3.0 (words)"), from the repository root:

```bash
mkdir /tmp/hsk30 && cd /tmp/hsk30
base=https://raw.githubusercontent.com/ivankra/hsk30/4ff9e3915ce87baaecd7ebe263085573a4ea3192
curl -fsSLo hsk30.csv       $base/hsk30.csv
curl -fsSLo hsk30-chars.csv $base/hsk30-chars.csv
curl -fsSLo hsk30-LICENSE   $base/LICENSE
cd -
node scripts/prepare-level-packs.mjs --hsk /tmp/hsk30       # writes plugins/data-local/
qinqin seed --packs plugins/data,plugins/data-local
```

The converter fails with a clear message if one of the three files is missing.
Under Docker, put the output on a host directory, mount it (for example
`./plugins/data-local:/opt/qinqin/local:ro`) and run
`docker compose exec qinqin qinqin seed --packs /opt/qinqin/packs,/opt/qinqin/local`
(see the README). Once seeded, the map's "Group by" and the Sources page pick it
up like any installed scheme. Each generated `ATTRIBUTION.md` quotes the README,
names the pinned upstream commit, records the SHA-256 of the input files and
says "not bundled, local use only"; do not commit or redistribute the output
(`plugins/data-local/` is gitignored). A one-character HSK word (好) links to
the character entry, since CC-CEDICT gives single characters as characters,
not words.

`scripts/prepare-level-packs.mjs <upstream-dir>` rebuilds the `jlpt-kanji`
directory byte for byte from the pinned upstream files (the download commands
are in its header).

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

The `kanjidic2` and `unihan` importers also store grade, frequency, stroke,
GB2312 and standard-list attributes for the character map (see
`docs/sources.md`); a database seeded earlier needs a re-seed to fill them. The
KANJIDIC2 `<jlpt>` field (the pre-2010 four-level scale) is not imported: a
re-seed drops it from entries an older import wrote, and JLPT levels come from
`jlpt-kanji`.

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

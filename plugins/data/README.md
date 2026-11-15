# Seed packs

`qinqin seed --data <dir> --packs plugins/data` imports every pack under this
directory. A pack is a directory with a `manifest.json` (id, name, version,
`type` dictionary|levels|sentences|frequency, `language`, `license`, `attribution`,
`format`, and an optional `notice`) plus the data file its format reads.

Manifest fields:

| Field | Required | Meaning |
|---|---|---|
| `id`, `name`, `version` | yes | identity of the pack |
| `type` | yes | `dictionary`, `levels`, `sentences`, `frequency` or `grammar` |
| `language` | yes | language tag (`ja`, `zh`, `es`, ...) |
| `format` | yes | how the data file is read |
| `license` | yes | the licence as the publisher states it |
| `attribution` | yes | who made it, with a link where there is one |
| `notice` | no | longer caveats shown on the Sources page, for dictionary, frequency and levels packs: plain text, paragraphs separated by a blank line, links only as `[text](https://…)` (https only), no bidi embedding, override or isolate characters, at most 4,000 bytes. The server rejects a pack whose notice breaks these rules, and `node scripts/check-sources.mjs` checks the committed manifests. A sentences pack's notice is validated the same way but not stored or shown anywhere: put sentence-source caveats in its `attribution` or `ATTRIBUTION.md` |

`license` and `attribution` are checked for every pack here and in
`plugins/samples/`, and every pack in this directory must be named in
`docs/sources.md` (`node scripts/check-sources.mjs`, run in CI). Changing a
`notice` needs a re-seed (`qinqin seed`) to reach an existing database;
`qinqin serve` logs a warning for each installed pack whose stored licence,
attribution or notice differs from its manifest.

Committed (small, hand-written, CC0 — a sample):

| Pack | Type | Language | Shows |
|------|------|----------|-------|
| `es-demo` | dictionary | es | a runtime-added, data-only language (no code pack) |
| `zh-grammar-demo` | grammar | zh | ten A1 lessons with 40 exercises, written for qinqin, CC0; demo content not reviewed by a native speaker |

Grammar pack format (`format: json`): `lessons.json` is `{"levels": [{"id",
"name", "schemeLevels": [{"scheme": "<levels pack id>", "level": "<level name>"}]}],
"lessons": [{"id", "level", "title", "summary", "pattern": [...], "body": [...],
"examples": [{"id", "text", "reading", "translation", "focus", "distractors": [...]}]}]}`.
Lesson text is plain text. `focus` (a part of `text`) and at least two
`distractors` that are wrong in that sentence give a fill-the-gap exercise.
The full limits are enforced by `server/internal/grammar/schema.go`.

The other hand-written samples live in `plugins/samples/`, outside the default
seed root. The DICTIONARIES `zh-mini` (pinyin → bopomofo, traditional
variants) and `ja-mini` (kana readings, romaji search) are keyed by written
form, so next to CC-CEDICT and JMdict they would add a second,
part-of-speech-less card for the same words, ranked first. The LEVEL packs
`hsk-mini` (word levels with derived character levels) and `jlpt-mini` (an N5
sample) would add a second, duplicate badge next to the bundled HSK 3.0 and
JLPT kanji lists (and a locally installed JLPT vocabulary); the map hides them even when seeded. Seed them explicitly
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

Committed level lists (converted; each with an `ATTRIBUTION.md`, and the
upstream `LICENSE` where upstream has one; `jlpt-kanji` also carries the
KANJIDIC2 licence as `LICENSE-KANJIDIC2`):

| Pack | Type | Language | Scheme | Contents | Licence |
|------|------|----------|--------|----------|---------|
| `hsk-chars` | levels | zh | HSK 3.0 (characters) | the official HSK character list, unit `character`: the characters to recognise (认读字) per level, HSK 1 246, HSK 2 125, HSK 3 284, HSK 4 441, HSK 5 431, HSK 6 413, HSK 7–9 1,148 (3,088, none repeated; the 1,200 characters to write, 书写字, assign no level) | no reuse licence granted (CTI Legal Notice: source must be indicated, reasonable good-faith quoting only); included with attribution at the project owner's decision; legal status not verified (no `LICENSE` file) |
| `hsk-words` | levels | zh | HSK 3.0 (words) | the official HSK word list, unit `word`, each entry with its pinyin as reading: HSK 1 300, HSK 2 198, HSK 3 497, HSK 4 997, HSK 5 1,591, HSK 6 1,792, HSK 7–9 5,584 (from the syllabus's 11,000 rows: 300/200/500/1,000/1,600/1,800/5,600; 41 homographs repeating an easier row's form and pinyin, 本1/本2 běn, are kept once) | no reuse licence granted (CTI Legal Notice: source must be indicated, reasonable good-faith quoting only); included with attribution at the project owner's decision; legal status not verified (no `LICENSE` file) |
| `jlpt-kanji` | levels | ja | JLPT kanji (approximate) | kanji by approximate JLPT level, unit `character`: N5 80, N4 166, N3 377, N2 369, N1 1,395. Base: kanjiapi.dev `jlpt.tsv` (2,211 kanji, levels kept; provenance not stated upstream; unofficial, as every N5–N1 list is; its N1 holds 247 jinmeiyō name kanji). Gap fill: 176 kanji it omits (分 可 無 的 …) placed from KANJIDIC2's old JLPT level (19) or school grade (157), see `docs/sources.md` | MIT, © 2023 Iridium Szreter; derived levels CC BY-SA 4.0, EDRDG |

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
Under Docker, put the output on a host directory, mount it (for example
`./plugins/data-local:/opt/qinqin/local:ro`) and run
`docker compose exec qinqin qinqin seed --packs /opt/qinqin/packs,/opt/qinqin/local`
(see the README). Once seeded, the
map's "Group by" and the Sources page pick it up like any installed scheme. The
generated `ATTRIBUTION.md` quotes the README chain, names the pinned upstream
commit, records the SHA-256 of the input files and says "not bundled, local use
only"; do not commit or redistribute the output (`plugins/data-local/` is
gitignored).

HSK 3.0 words (`hsk-words`) and characters (`hsk-chars`) come from the official syllabus 《HSK 考试大纲》 /
Syllabus for the Chinese Proficiency Test, published 2025-11 and effective
2026-07, issued by 中外语言交流合作中心 (CLEC) and distributed by CTI at
https://www.chinesetest.cn. No reuse licence is granted: the site's Legal
Notice (https://www.chinesetest.cn/legal-notice) says its content is
copyrighted by CTI or the content providers, requires the source to be
indicated, and permits reproduction only as reasonable, good-faith quoting for
informative public use; the PDF carries a copy-protection flag. The packs
hold only the vocabulary (word) list and the list of characters to recognise
(认读字), as plain lists with levels (and the words' pinyin as lookup
readings), and none of the syllabus's other content (grammar points,
descriptions, the lists of characters to write, explanatory text). They are
included with attribution at the project owner's decision; the legal status
of including these lists has not been verified (see each pack's
`ATTRIBUTION.md`). Its part "HSK 词汇大纲" is a table: serial number, level
(1–6, 7-9), word, pinyin, part of speech; its part "HSK 汉字大纲" numbers
the characters to recognise (认读字) per level and the characters to write
(书写字). One command rebuilds both packs; keep the
inputs OUTSIDE the repository (they are gitignored as well, and must never be
committed):

```bash
mkdir /tmp/hsk-syllabus && cd /tmp/hsk-syllabus
curl -fsSLo syllabus.pdf 'https://hsk.cn-bj.ufileos.com/3.0/%E6%96%B0%E7%89%88HSK%E8%80%83%E8%AF%95%E5%A4%A7%E7%BA%B21219.pdf'
pdftotext -tsv syllabus.pdf syllabus.tsv     # poppler-utils
cd -
node scripts/prepare-hsk-syllabus.mjs /tmp/hsk-syllabus/syllabus.tsv --pdf /tmp/hsk-syllabus/syllabus.pdf
```

The converter reads the word boxes of `pdftotext -tsv` (the `-layout` text
misplaces cells of this table), drops the 汉考国际 watermark and the page
numbers, checks that the serial numbers run 1–11,000 with no gap or
duplicate, and fails naming the rows otherwise. A level cell such as
"1（4）" keeps its first level; a homograph number (本1, 本2) is removed; the
pinyin becomes the entry's reading (the first of "shéi/shuí"), which the
importer compares toneless with CC-CEDICT's pinyin. With `--pdf` the PDF's
SHA-256 goes into `ATTRIBUTION.md`, and a re-run reproduces the pack byte for
byte. For `hsk-chars` it reads the numbered columns ("1. 爱"), checks that
each list numbers 1..N, drops the watermark by glyph height (汉, 考, 国 and
际 are also listed characters), gives each character the level of the 认读字
list that introduces it, and checks that every 书写字 character is recognised
at or below its level. This edition lists 3,088 characters to recognise,
not the "3,000" (300 per level, 1,200 for HSK 7–9) often quoted from the 2021
standard. The 3,088 characters all resolve at seed time, and
they agree with the levels derived from the words on all but 3 (店, 留, 饺).
On the map, the word scheme shows the characters its words are written
with, each at the lowest level of a word that uses it; a one-character word
(好) links to the character entry, since CC-CEDICT gives single characters as
characters. Against the bundled CC-CEDICT, 2 of the 10,959 forms do not
resolve and are skipped at seed time ("unknown forms skipped"): 精彩纷呈 and
口哨儿 (HSK 7–9); the words' 3,088 distinct characters all resolve (HSK 1 248,
HSK 2 123, HSK 3 284, HSK 4 441, HSK 5 431, HSK 6 413, HSK 7–9 1,148, each at
its lowest level).

The older ivankra/hsk30 packs (`hsk30-chars`, `hsk30-words`), which
`scripts/prepare-level-packs.mjs --hsk` can still generate into the
gitignored `plugins/data-local/`, are superseded by the official word and
character lists.

`scripts/prepare-level-packs.mjs <upstream-dir>` rebuilds the `jlpt-kanji`
directory byte for byte from the pinned kanjiapi.dev files (the download
commands are in its header) and the bundled `kanjidic2/kanjidic2.xml.gz`;
`--calibrate <upstream-dir>` prints the evaluation of its gap-fill thresholds.

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
`jlpt-kanji` (whose generator uses the field only to place kanji kanjiapi.dev
omits).

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

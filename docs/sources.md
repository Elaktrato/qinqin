# Starter data sources

The app's **Sources page** (`/sources`) is the live source of truth for
credits. It is public: anyone can open it without signing in. It is built at runtime from three places: the installed packs'
manifests (`license`, `attribution` and the optional `notice`, served by
`GET /api/dictionaries`, `/api/frequency-packs` and `/api/schemes`), the
`sources` that a web plugin declares in its manifest, and the app's own
credits (`apps/web/src/lib/sources/coreCredits.ts`). This file is the human
overview of the same material: the per-language tables and the notes on
licences, provenance and how each pack is made. It is not generated, so keep
it in step by hand.

`node scripts/check-sources.mjs` (run in CI) checks that the two agree: every
pack under `plugins/data` and `plugins/samples` has a manifest with a
non-empty `license` and `attribution`; every bundled pack's `id` appears in
backticks in this file; every pack id this file names in a table row or a
"- **Name** (`id`" list item exists (or is one of the optional local-only
packs listed in the script); and every manifest `notice` follows the server's
rules. To credit something new, see "Credits and the Sources page" in the
README.

The repository bundles four upstream dictionaries, one frequency list and
three level lists (HSK 3.0 characters, HSK 3.0 words, JLPT kanji) under `plugins/data/` so that a fresh clone or Docker image
seeds offline (`qinqin seed`):

**Japanese**

| Pack | Provides | License | Upstream |
|---|---|---|---|
| **KANJIDIC2** (`kanjidic2`) | Kanji readings, meanings, stroke counts, radicals | CC BY-SA 4.0 (EDRDG) | https://www.edrdg.org/wiki/index.php/KANJIDIC_Project |
| **JMdict** (`jmdict`) | Japanese–English words and meanings; its priority and usually-kana tags rank homophones in the Reader | CC BY-SA 4.0 (EDRDG) | https://www.edrdg.org/ |
| **Jiten frequency list** (`jiten-frequency`) | Japanese word frequency ranks that order lookup results | CC BY-SA 4.0 (Jitensoft) | https://jiten.moe/frequency-dictionaries |
| **Jōyō kanji by school grade** (`joyo-grades`), derived from KANJIDIC2 | The 2,136 jōyō kanji by school grade (Grade 1–6, Secondary) | CC BY-SA 4.0 (EDRDG) | https://www.edrdg.org/wiki/index.php/KANJIDIC_Project |
| **JLPT kanji (approximate)** (`jlpt-kanji`), from kanjiapi.dev and KANJIDIC2 | Kanji by approximate JLPT level N5–N1 | MIT (© 2023 Iridium Szreter); derived levels CC BY-SA 4.0 (EDRDG) | https://github.com/onlyskin/kanjiapi.dev |

Optional, local only (not bundled): **JLPT vocabulary** (`jlpt-words`, from open-anki-jlpt-decks); see "Japanese" under "Level lists".

**Other**

The hand-written CC0 demo dictionary `es-demo` (Spanish–English, in
`plugins/data/`) shows a runtime-added, data-only language; its data is
original to the project.

**Chinese**

| Pack | Provides | License | Upstream |
|---|---|---|---|
| **CC-CEDICT** (`cedict`) | Mandarin–English words and meanings | CC BY-SA 4.0 | https://cc-cedict.org |
| **Unihan** (`unihan`) | Radical-stroke counts, simplified/traditional variant mappings, character definitions | Unicode License v3 | https://www.unicode.org/reports/tr38/ |
| **通用规范汉字表 (2013) levels** (`tgh-chars`), derived from the `kTGH` field of Unihan | The 8,105 characters of the State Council's table in three levels (一级 3,500, 二级 3,000, 三级 1,605) | Unicode License v3 | https://www.unicode.org/reports/tr38/ |
| **HSK 3.0 (characters)** (`hsk-chars`), from the official syllabus (CLEC/CTI), edition 2025-11/2026-07 | Characters by HSK level (the characters to recognise, 认读字), HSK 1–6 and HSK 7–9 | No reuse licence granted; the CTI [Legal Notice](https://www.chinesetest.cn/legal-notice) allows only reasonable, good-faith quoting with the source indicated; included with attribution at the project owner's decision; legal status not verified | https://www.chinesetest.cn |
| **HSK 3.0 (words)** (`hsk-words`), from the official syllabus (CLEC/CTI), edition 2025-11/2026-07 | Words by HSK level, HSK 1–6 and HSK 7–9 | No reuse licence granted; the CTI [Legal Notice](https://www.chinesetest.cn/legal-notice) allows only reasonable, good-faith quoting with the source indicated; included with attribution at the project owner's decision; legal status not verified | https://www.chinesetest.cn |

Each pack directory carries its `manifest.json` (including `license`,
`attribution` and, where the pack needs more than a line, a `notice`), the full license text (`LICENSE`; `jlpt-kanji` also
`LICENSE-KANJIDIC2` for its derived levels), and credits
(`ATTRIBUTION.md`); `joyo-grades` and `tgh-chars` carry copies of the KANJIDIC2 and Unihan licences; `hsk-words` and `hsk-chars` have no `LICENSE`, as no
reuse licence is granted for them; their `ATTRIBUTION.md` gives the CTI Legal
Notice terms instead. The dictionary files are redistributed **unmodified**;
the download-and-bundle procedure lives in `scripts/fetch-seeds.sh`. The level
lists are converted (see "Level lists").

The dictionary licenses apply only to the dictionary data. The
API exposes each installed pack's `license`, `attribution` and `notice`
(`GET /api/dictionaries`, `/api/frequency-packs`, `/api/schemes`), and the
Sources page renders them.

The longer caveats the Sources page shows for a pack (for example the
approximate JLPT levels, or the HSK terms below) live in that pack's
`notice` in its `manifest.json`, not in the web app: edit the manifest, and
re-run `qinqin seed` so the stored copy follows. The same holds after
upgrading past migration 024, which adds every stored notice empty: until
the next seed the Sources page shows no notes, and `qinqin serve` logs
`pack <id>: stored license/attribution/notice differs from <manifest>; run
"qinqin seed" to refresh` for each pack whose stored licence, attribution or
notice no longer matches its manifest. The notice is plain text
with blank-line paragraphs and `[text](https://…)` links, at most 4,000
bytes (see `plugins/data/README.md`). The sections below keep the full
background; the wording of a licence status (as the publisher states it,
unverified facts marked unverified) must stay the same in both places.

## Grammar lessons

- **Chinese grammar demo (A1)** (`zh-grammar-demo`, type `grammar`; bundled):
  ten short beginner lessons with 40 example sentences, readings,
  translations and exercise answers, **written for qinqin by the project and
  released under CC0 1.0** (`plugins/data/zh-grammar-demo`, with `LICENSE` and
  `ATTRIBUTION.md`). Nothing is taken from a textbook, a syllabus or another
  grammar resource; the A1 levels are the author's own estimates (the link to
  "HSK 1" is a rough orientation only). It is **demo content that has not been
  reviewed by a native speaker**; errors are possible.

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
schemes (the map reads each scheme's per-level characters from
`GET /api/schemes/{id}/characters`). Five are bundled: two derived from bundled dictionaries (below) and HSK 3.0 characters and
words, generated by `scripts/prepare-hsk-syllabus.mjs` from the official syllabus (see "Chinese:
HSK 3.0" below), and the approximate JLPT kanji, generated by `scripts/prepare-level-packs.mjs` from
upstream files pinned by commit and the bundled KANJIDIC2 (the download commands are in the script's
header; each pack's `ATTRIBUTION.md` records the commit and the SHA-256 of the
inputs). Re-running the script on the same files reproduces the packs byte for
byte.

### Japanese

- **Jōyō kanji by school grade** (`joyo-grades`, unit `character`; bundled):
  Grade 1 80, Grade 2 160, Grade 3 200, Grade 4 202, Grade 5 193, Grade 6 191
  and Secondary (KANJIDIC2 grade 8) 1,110, 2,136 kanji in all, generated by
  `scripts/prepare-standard-levels.mjs` from the bundled KANJIDIC2 (CC BY-SA
  4.0, EDRDG; the pack is a derived work under the same licence, its `LICENSE`
  is KANJIDIC2's). Jinmeiyō kanji (grades 9 and 10: 651 and 212) are left out.
  Within a level kanji follow KANJIDIC2's newspaper frequency (none last), then
  code point. A test checks the set against Unihan `kJoyoKanji` (2,136 rows
  with the value `2010`, UAX #38). The map's "Group by" does not offer this
  pack: the built-in "Grade" grouping covers it; badges and search filters use
  it (level sessions do not support character packs yet, issue #57). Evidence (checked 2026-11-15): the
  KANJIDIC2 grade counts above (2020 学年別漢字配当表); the 常用漢字表 and
  学習指導要領 are government notices, outside copyright under Japanese
  Copyright Act art. 13 (2), which supports the derived pack but is not needed
  as a source. Wikipedia's tables (CC BY-SA 4.0) were not used: editor-compiled
  and redundant with KANJIDIC2.
- **JLPT kanji (approximate)** (`jlpt-kanji`, unit `character`): an
  approximation built by qinqin. The Japan Foundation and JEES have published
  no kanji list since the 2010 revision of the test, so every N5–N1 list is an
  unofficial reconstruction; this one is labelled approximate in the app.
  Levels N5 (80 kanji), N4 (166), N3 (377), N2 (369), N1 (1,395), easiest
  first, 2,387 in all.
  - Base list: `jlpt.tsv` of [kanjiapi.dev](https://github.com/onlyskin/kanjiapi.dev),
    **MIT licence, Copyright 2023 Iridium Szreter** (the full text is the pack's
    `LICENSE`); kanjiapi.dev does not say where it comes from. Its 2,211 kanji
    keep their level (N5 79, N4 166, N3 367, N2 367, N1 1,232).
  - Gap fill: kanjiapi.dev leaves 172 of the 2,136 jōyō kanji in no level,
    among them the common 分, 可, 無 and 的. The script places each kanji it
    omits from three KANJIDIC2 fields (**CC BY-SA 4.0, EDRDG**; the licence text
    is the pack's `LICENSE-KANJIDIC2`, and the derived levels are under it):
    (a) a pre-2010 four-level JLPT level (`<jlpt>`): 4 → N5, 3 → N4, 1 → N1,
    2 → N3 at newspaper frequency rank (`<freq>`) 521 or better, else N2 (19
    kanji, e.g. 分 N5, 可 無 的 身 N3, 畑 坊 N2, 里 寿 吾 N1); (b) otherwise a
    jōyō kanji (`<grade>` 1–8) by school grade: grade 1 → N5, 2 → N4, 3–4 → N3,
    5 → N2, 6 and 8 → N1, and N1 with no frequency rank (157 kanji, e.g. 岡 阪
    N3, 誰 闇 俺 N1); (c) anything else (jinmeiyō name kanji, kanji with no
    grade) stays under "Not in this scheme". Every jōyō kanji now has a level;
    kanjiapi.dev's N1 still holds 247 jinmeiyō kanji such as 伊, 智, 弘 and 彦.
  - Calibration: the thresholds were fitted on kanjiapi.dev's own list (80% of
    its kanji; those whose code point is a multiple of 5 held out). On the
    held-out kanji the old-level mapping agrees with kanjiapi.dev on 83% and
    the grade rule on 63% of the jōyō kanji; frequency-rank thresholds were
    tried for (b) and did worse (54%). Every kanji of kanjiapi.dev's list also
    has an old KANJIDIC2 level, so the grade rule was calibrated on kanji
    with an old level, while it only places kanji without one: 151 of its
    157 are grade-8 kanji, mostly the 2010 jōyō additions such as 誰, 頃, 俺
    and 闇, all put at N1. Its accuracy on those is unmeasured (the reference
    list cannot measure it) and probably lower for the common ones.
    KANJIDIC2's frequency rank is newspaper data from before 2010 and
    under-ranks them (74 of the 151 have no rank). A derived level is a rough
    guide. The numbers are recorded next to the constants in the script, and
    `node scripts/prepare-level-packs.mjs --calibrate <upstream-dir>` prints
    them again.
  - KANJIDIC2's `<jlpt>` field is still not imported as a scheme of its own.
- **JLPT vocabulary** (`jlpt-words`, unit `word`; optional, local only, NOT
  bundled): `src/n5.csv` … `src/n1.csv` of
  [open-anki-jlpt-decks](https://github.com/jamsinclair/open-anki-jlpt-decks),
  labelled **MIT licence, Copyright (c) 2020 Jamie Sinclair** (the full text is
  the pack's `LICENSE`). It is not bundled because its upstream licence chain
  could not be verified. Its README says: "Original deck data was taken from
  https://github.com/chyyran/jlpt-anki-decks, which were based on decks from
  tanos.co.uk". The tanos.co.uk lists are Jonathan Waller's unofficial JLPT
  lists, described as published under Creative Commons Attribution (CC BY);
  that description was not verified here (the site could not be reached).
  Like the kanji lists, they are reconstructions, not official JLPT lists.
  The `expression` column gives the forms: variants split on ";", notes in
  parentheses and affix tildes removed (～円 → 円), grammar patterns with an
  inner tilde dropped (4 pieces), a する verb whose stem has two or more
  characters reduced to its noun (勉強する → 勉強; 関する and 愛する stay
  whole, as JMdict lists them). Each kanji form carries the `reading` column
  (`{"form": "風", "reading": "かぜ"}`), so the importer picks the word read
  so: without it, a form-only lookup put 風 on the usually-kana 振り (ふり)
  and 外 on 他 (ほか). Each form with its reading is kept once, at its
  easiest level: N5 728, N4 668, N3 2,134, N2 1,784, N1 2,694 entries.
  Against the bundled JMdict 168 forms do not resolve and are skipped at
  seed time (N5 19, N4 16, N3 18, N2 66, N1 49), mostly kana spellings of
  words JMdict writes with kanji (けんか, よい, にぎやか) and set phrases
  (いってきます).

  To generate and install it locally (from the repository root):

  ```bash
  mkdir /tmp/jlpt-vocab && cd /tmp/jlpt-vocab
  base=https://raw.githubusercontent.com/jamsinclair/open-anki-jlpt-decks/1ad66734417aca9dbcca6b2d5ee440cb13ab3ba0
  for n in n5 n4 n3 n2 n1; do curl -fsSLo $n.csv $base/src/$n.csv; done
  curl -fsSLo LICENSE $base/LICENSE
  cd -
  node scripts/prepare-level-packs.mjs --jlpt-vocab /tmp/jlpt-vocab   # writes plugins/data-local/
  qinqin seed --packs plugins/data,plugins/data-local
  ```

  The converter stops with a clear message if a file is missing and writes only
  into the gitignored `plugins/data-local/`; the generated `ATTRIBUTION.md`
  states "not bundled, local use only". Under Docker, mount `plugins/data-local`
  and seed both roots as described in "Local-only data". The map's "Group by"
  and the Sources page pick it up like any installed scheme.

### Chinese: 通用规范汉字表 levels

- **通用规范汉字表 (2013) levels** (`tgh-chars`, unit `character`; bundled):
  Level 1 (一级) serial 1–3,500, Level 2 (二级) 3,501–6,500, Level 3 (三级)
  6,501–8,105 (3,500 / 3,000 / 1,605), in table order, generated by
  `scripts/prepare-standard-levels.mjs` from the `kTGH` field (`2013:<n>`) of
  `Unihan_OtherMappings.txt` in the bundled Unihan (Unicode License v3; its
  `LICENSE` is Unihan's). The serials run 1–8,105 without a gap. The table is a
  State Council document (国发〔2013〕23号,
  https://www.gov.cn/zwgk/2013-08/19/content_2469793.htm); PRC Copyright Law
  art. 5 (https://www.ncac.gov.cn/xxfb/flfg/flfg_532/202103/t20210309_50530.html) excludes "法律、法规，国家机关的决议、决定、命令和其他具有立法、行政、
  司法性质的文件". On the map a section's count also includes variant forms of listed characters (shown as "incl. N variant forms"). The map keeps its built-in "Common" grouping (GB2312 rows), a
  different split. No 小学/初中/高中 split is bundled (see "Local-only data").
  Evidence checked 2026-11-15. All 8,105 characters resolve to character
  entries at seed time (the seed line reports 0 unknown forms); that check is the
  opt-in real-pack Go test (`QINQIN_REAL_DATA_TESTS=1`, about 4 minutes), not part
  of the default test run.

### Chinese: HSK 3.0

- **HSK 3.0 (words)** (`hsk-words`, unit `word`; bundled): the word list
  ("HSK 词汇大纲") of the official syllabus 《HSK 考试大纲》 / Syllabus for the
  Chinese Proficiency Test, **edition published 2025-11, effective 2026-07**,
  issued by 中外语言交流合作中心 (Center for Language Education and
  Cooperation, CLEC) and distributed by Chinese Testing International (CTI)
  via https://www.chinesetest.cn (PDF:
  https://hsk.cn-bj.ufileos.com/3.0/%E6%96%B0%E7%89%88HSK%E8%80%83%E8%AF%95%E5%A4%A7%E7%BA%B21219.pdf,
  406 pages).
- **Licence and terms** (both HSK packs): no reuse licence is granted. The
  syllabus is published by 中外语言交流合作中心 (CLEC) and distributed by CTI
  at https://www.chinesetest.cn. The site's
  [Legal Notice](https://www.chinesetest.cn/legal-notice) says that the
  site's content is copyrighted by CTI or the content providers, that whoever
  reproduces it must indicate the source ("Source: www.chinesetest.cn",
  "reproduced from (or quoted from) the Chinese Test Service Website"), and
  that reproducing or quoting it is permitted only as reasonable, good-faith
  quoting for news or informative, free public information. The syllabus PDF
  carries a copy-protection flag (copy: no, change: no). The project includes
  only the vocabulary (word) list and the list of characters to recognise
  (认读字), as plain lists of words and characters with their levels (and the
  words' pinyin as lookup readings); it does not include the syllabus's other
  content (grammar points, task and topic descriptions, the lists of
  characters to write, explanatory text). It includes these lists with
  attribution at the project owner's decision; the legal status of including
  these lists has not been verified (this is not a legal opinion), and no
  licence or public-domain status is claimed. The packs therefore have no `LICENSE` file. Their `manifest.json`
  (`license`: "See CTI Legal Notice; no reuse licence granted"; `attribution`
  starting "Source: www.chinesetest.cn — reproduced from the Chinese Test
  Service Website (CTI); syllabus published by CLEC") and `ATTRIBUTION.md`
  record the publisher, the edition and these terms, and each pack's `notice`
  repeats the terms on the Sources page. The Sources page and the character map
  show that attribution wherever the lists are used.
- **Conversion:** `scripts/prepare-hsk-syllabus.mjs` reads the PDF's
  `pdftotext -tsv` word boxes and keeps each row's level, word and pinyin:
  11,000 rows, serial numbers 1–11,000 with none missing or repeated, HSK 1
  300, HSK 2 200, HSK 3 500, HSK 4 1,000, HSK 5 1,600, HSK 6 1,800, HSK 7–9
  5,600. A level cell such as "1（4）" (apparently the levels of the
  parenthesised parts of speech) keeps its first level; homograph numbers
  (本1, 本2) are removed, and the 41 homographs whose form and pinyin repeat
  an easier row are kept once, leaving 10,959 entries (HSK 1 300, HSK 2 198,
  HSK 3 497, HSK 4 997, HSK 5 1,591, HSK 6 1,792, HSK 7–9 5,584). Each entry
  carries its pinyin as the reading, so the importer prefers the CC-CEDICT
  word with that pinyin (compared toneless). The PDF and any text extracted
  from it are never committed (`.gitignore` lists them); only the pack is.
- **Use:** words carry an "HSK 3.0 (words)" badge with their level; the map's
  "HSK 3.0 (words)" grouping shows the characters the words are written with,
  each at the lowest level of a word using it (3,088 characters: HSK 1 248,
  HSK 2 123, HSK 3 284, HSK 4 441, HSK 5 431, HSK 6 413, HSK 7–9 1,148). These
  derived character levels agree with the syllabus's own character list
  (`hsk-chars`, below) on all but 3 characters. A one-character word (好) links to the character entry, as
  CC-CEDICT gives single characters as characters. Against the bundled
  CC-CEDICT, 2 forms are skipped at seed time ("unknown forms skipped"):
  精彩纷呈 and 口哨儿.

- **HSK 3.0 (characters)** (`hsk-chars`, unit `character`; bundled): the
  character list ("HSK 汉字大纲") of the same syllabus and edition, under the
  same terms (see "Licence and terms" above). The section
  (PDF pages 356–384) has one numbered list of characters to recognise
  (认读字) per level and lists of characters to write (书写字). A
  character's level is the level of the 认读字 list that introduces it:
  HSK 1 246, HSK 2 125, HSK 3 284, HSK 4 441, HSK 5 431, HSK 6 413,
  HSK 7–9 1,148, 3,088 characters, none listed twice. This edition lists
  3,088 characters to recognise, not the "3,000" (300 per level for HSK 1–6,
  1,200 for HSK 7–9) often quoted from the 2021 standard; the count is the
  syllabus's own, not an extraction error. The 书写字 lists
  (HSK 1–2 100, HSK 3 150, HSK 4 150, HSK 5 150, HSK 6 150, HSK 7–9 500,
  1,200 in all) assign no level; each lists only characters recognised at or
  below its level. Each list numbers 1..N with no gap or repeat (the
  converter checks it), and the 汉考国际 watermark is dropped by glyph
  height, not by character, since 汉, 考, 国 and 际 are listed characters.
  Compared with the levels derived from `hsk-words` (each character at the
  lowest level of a word written with it), the two cover the same 3,088
  characters and agree on all but 3: 店 (list HSK 2, word 商店 HSK 1),
  留 (list HSK 2, words HSK 3) and 饺 (list HSK 3, word 饺子 HSK 1). All
  3,088 resolve to character entries at seed time.

The ivankra/hsk30 packs (`hsk30-chars`, `hsk30-words`, an MIT-labelled
community compilation of the 2021 standard) are superseded by the official
word and character lists;
`scripts/prepare-level-packs.mjs --hsk` still generates them into the
gitignored `plugins/data-local/` for local use only.

The JLPT lists are not official releases; the HSK 3.0 word and character
lists are the official syllabus's. The project is not affiliated with either test.

The hand-written CC0 samples `hsk-mini` and `jlpt-mini` live in `plugins/samples/`,
outside the default seed root (their badges would duplicate the real lists); the
seed tests use them, and the map hides them when they are seeded explicitly.

## Audio

Pronunciation audio is an `audio` pack: an `index.tsv` (word, reading, file,
licence and credit per recording) plus the clip files, imported by
`qinqin seed` into content-addressed files under `<data>/audio/` and shown on
the entry page and after the reveal in study. Every recording is credited on the
Sources page and next to the play button. Without any pack, or without a device
voice, the app shows no play button and works as before.

The licence rule applies unchanged. No audio file, and no index built from a
third party's data, is ever committed: packs live in the gitignored
`plugins/data-audio/` (clear licence, fetched by script, also baked into the
Docker image) or `plugins/data-local/` (unclear or restrictive, never
distributed). Evidence, checked 2026-11-15 (sites that were unreachable that
day are marked unverified):

| Source | Evidence | Verdict |
|---|---|---|
| **Kanji alive** example-word audio (ja; 10,156 clips in the zip, 10,187 claimed by the README; male/female native speakers, 6–12 words per kanji for 1,235 kanji) | https://github.com/kanjialive/kanji-data-media `LICENSE.md` at e1e24d3: "This work by Kanji alive is licensed under a Creative Commons Attribution 4.0 International License"; the README names only two fonts as exceptions. Audio: https://media.kanjialive.com/examples_audio/audio-opus.zip (68,687,036 bytes, Last-Modified 2026-09-04). Word ↔ file mapping in `language-data/ka_data.csv` (`kname`, `examples`). | **BUNDLE-eligible** (licence); not committed to git (size), see Rulings |
| **Wikimedia Commons** pronunciation files (zh, ja) | Licence per file, machine-readable through the API (`prop=imageinfo&iiprop=extmetadata`: `LicenseShortName`, `LicenseUrl`, `Artist`). Samples: `File:Zh-nǐ.ogg` "CC BY 2.0 fr" (Wei Gao, Vion Nicolas); `File:Zh-shi4.ogg` "CC BY-SA 2.0 uk", noted "not a native Mandarin speaker"; `File:Zh-ma1.ogg` missing. | **LOCAL-ONLY** tool with a per-file licence allow-list (see Rulings) |
| **Lingua Libre** (cmn 4,108, jpn 5,616 files on Commons) | Files carry CC BY-SA 4.0, CC BY 4.0 or CC0 per Commons metadata; the default "CC BY-SA 4.0" comes from a snippet of the RecordWizard manual (site 503, unverified). | **LOCAL-ONLY** through the same Commons tool |
| **hugolpz/audio-cmn** (1,707 syllables, ~8k HSK words) | README: "CC-by-sa. See table upper for authors."; no version; refers to an unreachable Shtooka readme; GitHub shows no licence. | **LOCAL-ONLY** (version unverified) |
| **cjhoward/cedict-tts** | Audio "CC0 1.0 Universal", but "Baidu Speech-generated TTS MP3s"; Baidu's output terms unchecked. | **LOCAL-ONLY** |
| **Tatoeba** audio | https://tatoeba.org/en/downloads: "If the license field is empty, you may not reuse the audio outside the Tatoeba project"; others vary (incl. NC/ND). Sentences, not words. | Out of scope (sentences); LOCAL-ONLY if ever |
| **Forvo** | Proprietary licence since 2019 (https://en.wikipedia.org/wiki/Forvo); API non-profit plan "No commercial use" (https://api.forvo.com/). | **REJECT** |
| **JapanesePod101** (Yomitan's default) | No public licence found. | **REJECT** |
| davinfifield/mp3-chinese-pinyin-sound | Unlicense, but no speaker or source named. | **REJECT** (provenance) |
| Tone Perfect (MSU) | "© Michigan State University", access on request. | **REJECT** |
| **eSpeak NG** (engine GPL-3.0+) | Output not addressed by the project; poor Mandarin/Japanese quality. | **REJECT** for packs (quality) |
| **Piper** voices: zh_CN-huayan (dataset licence "unknown" in MODEL_CARD), ja_JP-hi_fi_captain ("by-nc-sa/4.0") | huggingface.co/rhasspy/piper-voices MODEL_CARDs. | **REJECT** |
| **Coqui XTTS-v2** | "Coqui Public Model License" (non-commercial). | **REJECT** |
| **Kokoro-82M** | "Apache-licensed model"; trained partly on synthetic audio from closed TTS providers; Mandarin voices graded D, Japanese C. | **REJECT** for v1 (quality, provenance caveat) |
| Browser / OS speech (Web Speech API, Android TextToSpeech) | Nothing is distributed: the user's own device voices speak at runtime. | **USE** as fallback |

### Kanji alive (`kanjialive-audio`)

- **Provides:** 10,156 Opus clips of common example words (6-12 per kanji, 1,235
  kanji, male and female native Japanese speakers) with their readings; Japanese
  entries whose written form and reading match one play it.
- **Licence:** Creative Commons Attribution 4.0 International. The repository's
  `LICENSE.md` (pinned commit `e1e24d39fc43e839948a8c7e99743b0994dedad5`) says
  "This work by Kanji alive is licensed under a Creative Commons Attribution 4.0
  International License"; its only exceptions are two fonts, not the audio. The
  pack ships the CC BY 4.0 legal code as `LICENSE` and credits Kanji alive in
  `ATTRIBUTION.md`, its manifest and, per recording, on the entry page.
- **Obtaining it:** `scripts/fetch-audio-kanjialive.sh` downloads the list
  (`language-data/ka_data.csv`), the licence file and `audio-opus.zip`
  (68,687,036 bytes) from the pinned sources, refuses on any SHA-256 mismatch and
  writes `plugins/data-audio/kanjialive-audio`. It needs `curl`, `sha256sum`,
  `unzip` and Node 22 or newer (the Docker stage runs Alpine's Node 22). Nothing it fetches is committed.
- **Docker:** the image builds the pack in its own stage (`--build-arg WITH_AUDIO=1`,
  the default, the same way as `WITH_OCR`). Any build that has to run that stage
  downloads about 69 MB from `media.kanjialive.com` and the data repository, and
  the image grows by about 70 MB; a warm Docker layer cache skips the download until
  the Dockerfile, the scripts or the build args change, but CI without a cache (and
  every fresh release build) fetches each time. The build fails if a pinned checksum
  no longer matches, so a moved or changed upstream file stops it instead of
  shipping something unchecked. To see such a break early, the `audio-stage`
  workflow builds only that stage (`docker build --target audio`, no push) on pull
  requests that touch the Dockerfile, the workflows or the audio scripts, and every
  Monday.
- **When it fails (offline, upstream gone, pin moved):** build with
  `--build-arg WITH_AUDIO=0`. The image then has an empty `/opt/qinqin/audio`,
  `qinqin seed` still works and Japanese entries fall back to the device voice.
  To adopt a new upstream snapshot after reading its licence again, pass the new
  pins as build args (`KANJIALIVE_COMMIT`, `KANJIALIVE_CSV_SHA256`,
  `KANJIALIVE_LICENSE_SHA256`, `KANJIALIVE_ZIP_SHA256`, `KANJIALIVE_ZIP_BYTES`,
  `KANJIALIVE_EXPECTED_CLIPS`, `KANJIALIVE_SNAPSHOT`) and then update the defaults in
  `scripts/fetch-audio-kanjialive.sh`. Idea, not built: a maintainer-run mirror of
  the zip (set `KANJIALIVE_ZIP_URL`; the checksum still has to match) would take
  release builds off `media.kanjialive.com`; it would have to carry the CC BY 4.0
  attribution and licence text with the file.
- **How the file mapping was checked (2026-11-15):** the README of the data
  repository does not state the file naming. In the downloaded data the n-th
  example word of a kanji (column `examples`, a JSON list) is the file
  `<kname>_06_<a..l>.opus`: all 1,235 kanji have exactly as many files as example
  words (10,156 of 10,156 found, none left over), and the file size follows the
  length of the word's reading (correlation 0.78 over all clips, 0.21 when each
  kanji's files are rotated by one position, about 0 for a random pairing). This
  is evidence from the data, not from listening.
- **Owner to-do:** nobody has listened to the clips yet. Before relying on the
  mapping, play about ten clips from different kanji and check each against the
  word and reading in `index.tsv` (for example the first rows for `述`, file
  `jutsu-no(beru)_06_a.opus` should say 述語, じゅつご). A mismatch means the
  suffix order differs from the list order; `exampleRows` in
  `scripts/prepare-audio-kanjialive.mjs` is the one place to change.

### Wikimedia Commons and Lingua Libre (`commons-audio-zh`, `commons-audio-ja`, local-only)

Never bundled: the licence is per file, coverage is uneven and the set keeps
changing. `node scripts/fetch-audio-commons.mjs --lang zh --category <Commons
category>` (or `--lang ja`) builds the pack under `plugins/data-local/` from the
public Commons API, at most one request per second with a User-Agent naming the
tool, and `qinqin seed` imports it next to the others. It keeps a file only when
its Commons `LicenseShortName` is CC0, public domain, CC BY or CC BY-SA 2.0 to
4.0 (national ports such as `CC BY 2.0 fr` included); every other licence
(non-commercial, no-derivatives, GFDL, unknown) is skipped and counted. Each kept
clip's licence, credit (the `Artist` field with its HTML removed) and file page
go into the index, and are shown with the play button and under "Per-recording
credits" on the Sources page. `Zh-<pinyin>.ogg` files become syllable clips;
Lingua Libre recordings become word clips without a reading (they match the word
under any reading), and a recording whose title contains digits or Latin letters
is skipped, because it does not say the bare word. Several of these files carry
a note that the speaker is not a native Mandarin speaker; the credit shows the
Commons description, not a quality judgement.

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

### Local level lists (TBCL, curriculum tables)

`scripts/prepare-local-levels.mjs` turns a TSV you prepared yourself into a
levels pack under `plugins/data-local/<id>/` (it refuses any other directory
unless `--force-dir`, writes no `LICENSE`, and records the input's SHA-256 in
`ATTRIBUTION.md`). Input: UTF-8, header `level<TAB>form[<TAB>reading]`; levels
are ordered by first appearance and a form repeated keeps its first level;
a pinyin or kana reading is kept, a zhuyin reading is dropped with a warning
(the importer matches toneless pinyin). Nothing from these sources is ever
committed or used as a test fixture.

- **TBCL words** (`tbcl-words`) and **TBCL characters** (`tbcl-chars`): the
  臺灣華語文能力基準 of 國家教育研究院 (NAER), the basis of the TOCFL levels
  (3,100 characters, 14,425 words), https://bcoct.naer.edu.tw/TBCL/ . Footer
  "Copyright © 2019 國家教育研究院 版權所有"; no licence or 授權 text, and not on
  data.gov.tw (checked 2026-11-15); local only. Download the 詞語表 / 漢字表
  from the site, export it to TSV with LibreOffice, keep the columns 等級,
  詞語 (or 漢字), 漢語拼音, rename the header to `level`, `form`, `reading`,
  then:
  `node scripts/prepare-local-levels.mjs --id tbcl-words --name "TBCL words" --language zh --unit word --license "NAER, all rights reserved; local use" --attribution "國家教育研究院 臺灣華語文能力基準, https://bcoct.naer.edu.tw/TBCL/" tbcl-words.tsv`
  (`--unit character` for `tbcl-chars`). Re-check the terms before any
  bundling.
- **Mainland curriculum characters** (`cn-curriculum-chars`): the 识字写字教学基本字表
  and 常用字表 of the 义务教育语文课程标准 (2022), published as a book by 北京师范大学出版社;
  no reuse licence found, and whether PRC Copyright Law art. 5 covers a 课程标准 is
  unverified; local only. Type or paste the appendix lists into a TSV with one level per row
  group (`level<TAB>form`, `--unit character`).
- **Rejected:** the old TOCFL 華語八千詞 list (withdrawn by TOCFL on 2021-06-30, no
  licence ever stated, https://tocfl.edu.tw/assets/files/8000zhuyin_recall.pdf) and
  grade splits copied from textbooks (publisher copyright).

## Stroke-order data

Stroke-order animation data (`hanzi-writer-data`, derived from the
Make Me a Hanzi dataset) is licensed under the **Arphic Public License**.
The web frontend bundles it and credits it on its Sources page (a core
credit in `apps/web/src/lib/sources/coreCredits.ts`). The full
license text is committed at `apps/web/static/ARPHICPL.TXT` (copied verbatim
from the `hanzi-writer-data` package) and is served by the app at
[`/ARPHICPL.TXT`](/ARPHICPL.TXT).

Attribution: [Make Me a Hanzi](https://github.com/skishore/makemeahanzi),
[hanzi-writer-data](https://www.npmjs.com/package/hanzi-writer-data).

## Reader text sources

The Reader (see the README) imports public-domain works on user request. Nothing
from these sources is bundled; each imported book stores its source link,
attribution, and a licence note, which the Reader shows. The Reader plugin
credits both sources, and `opencc-js` below, on the Sources page through the
`sources` in its manifest (`apps/web/src/lib/plugins/reader/manifest.ts`).

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
only when a script conversion is selected. The Sources page credits it (a
`sources` entry of the Reader plugin's manifest), and both
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
the words written with the form, the one read so (kana as written or
folded to hiragana; pinyin toneless, so "hángrén" matches CC-CEDICT's
"háng rén"); without a match the form alone decides. Packs with plain strings keep working unchanged.
Entries must already exist in an imported dictionary; unknown ones are skipped and
reported. Put one under `plugins/data-local/` and run `qinqin seed`. The map
offers every installed scheme except the samples (`hsk-mini`, `jlpt-mini`, in
`plugins/samples/`).

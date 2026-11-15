# Level packs: Jōyō, TOCFL and mainland curriculum (issue #42) — design

Status: proposed, 2026-11-15. Autonomous design (nobody was available to answer
questions); every decision is a "Ruling" below so the owner can undo it.

## Goal

Badges, map groupings and level sessions for three more scheme families, under
the project's licence rule: data with an unclear or restrictive licence is
fetched locally, gitignored (`plugins/data-local/`) and never bundled; the app
works without it. Bundle only what a publisher licenses as CC BY-SA 4.0 or more
permissively, with the licence text and attribution beside it.

The level machinery already exists and is generic: a `levels` pack
(`manifest.json` + `levels.json`) imported by `qinqin seed` gets badges
(`Badges.svelte`), a "Group by" option on the character map
(`lib/study/charGroups.ts`), level sessions on `/study`, search filters and a
Sources-page credit. So #42 is data and tooling, plus two small UI rulings.

Note: the repository has no `LICENSE` file of its own. Compatibility below is
judged against the bundling bar above (as for CC-CEDICT, JMdict, KANJIDIC2),
not against a project licence.

## Licence evidence (all checked 2026-11-15)

| Candidate | Evidence | Verdict |
|---|---|---|
| Jōyō by school grade, from the bundled **KANJIDIC2** `<grade>` | Already bundled under CC BY-SA 4.0 (EDRDG), `plugins/data/kanjidic2/LICENSE`. Bundled file reflects the 2020 学年別漢字配当表: grade counts 80/160/200/202/193/191 (= 1,026) plus 1,110 at grade 8 (= 2,136 jōyō); grade 9 (651) and 10 (212) are jinmeiyō. Counted from `kanjidic2.xml.gz` today. | **BUNDLE** (derived pack, CC BY-SA 4.0) |
| Unihan `kJoyoKanji` (cross-check only) | Bundled Unihan 18.0.0 (Unicode License v3). UAX #38 (https://www.unicode.org/reports/tr38/): "The year that corresponds to the Jōyō Kanji (常用漢字) table in which the ideograph appears"; 2,136 values `2010` in the bundled file. | Used in a test, not as data |
| MEXT 常用漢字表 (内閣告示 2010) / 学年別漢字配当表 (学習指導要領, 文部科学省告示) | Japanese Copyright Act art. 13 (2): no copyright in "国若しくは地方公共団体の機関…が発する告示、訓令、通達その他これらに類するもの" (text via https://scrapbox.io/Chosakukenho/第二章_著作者の権利). Supports the derived pack; not needed as a source. | Not used (KANJIDIC2 suffices) |
| Wikipedia jōyō / grade tables | CC BY-SA 4.0, but compiled by editors and redundant with KANJIDIC2. | Not used |
| **TOCFL 華語八千詞** (old official list) | Withdrawn: TOCFL (SC-TOP) stopped providing it on 2021-06-30; TOCFL levels now follow NAER's TBCL (https://tocfl.edu.tw/assets/files/8000zhuyin_recall.pdf). No licence was ever stated. | **REJECT** |
| **TBCL 臺灣華語文能力基準** (NAER, the current TOCFL basis: 3,100 characters, 14,425 words) | https://bcoct.naer.edu.tw/TBCL/ footer: "Copyright © 2019 國家教育研究院 版權所有"; no licence or 授權 text; not on data.gov.tw (NAER's data.gov.tw sets are other topics under the Open Government Data License, which does not cover TBCL). `/standsys/` returned 403. | **LOCAL-ONLY** |
| **通用规范汉字表** (2013) levels, from the bundled **Unihan** `kTGH` | Unihan (Unicode License v3) `kTGH`: "…the Tōngyòng Guīfàn Hànzìbiǎo (通用规范汉字表) table in which the ideograph appears, … its one- to four-digit index number in that list" (UAX #38). Bundled file: 8,105 values, serials 1–8,105 without gaps; 一级 1–3,500, 二级 3,501–6,500, 三级 6,501–8,105 (3,500 / 3,000 / 1,605). The table itself is a State Council document (国发〔2013〕23号, https://www.gov.cn/zwgk/2013-08/19/content_2469793.htm); PRC Copyright Law art. 5: "本法不适用于：（一）法律、法规，国家机关的决议、决定、命令和其他具有立法、行政、司法性质的文件…" (via https://www.12371.cn/2020/06/22/ARTI1592755505338467.shtml). | **BUNDLE** (derived pack, Unicode License v3) |
| 义务教育语文课程标准（2022年版）字表 (识字写字教学基本字表 300, 常用字表 2,500/3,500) | Issued by 教育部 but published as a book by 北京师范大学出版社; no reuse licence found; whether art. 5 covers a 课程标准 is unverified. | **LOCAL-ONLY** |
| 小学/初中/高中 grade splits from textbooks (人教版 etc.) | Publisher copyright, no licence. | **REJECT** |

## What ships

### Bundled pack `joyo-grades` (Japanese, unit `character`)

- Levels, easiest first: `Grade 1` … `Grade 6`, `Secondary` (KANJIDIC2 grade 8).
  2,136 kanji. Jinmeiyō (9, 10) are left out: they are not jōyō.
- Within a level: KANJIDIC2 newspaper frequency rank (none last), then code point.
- `manifest.json`: `id` `joyo-grades`, `name` "Jōyō kanji by school grade",
  `license` "CC BY-SA 4.0", `attribution` "School grades (学年別漢字配当表 2020
  and the jōyō table) as recorded in KANJIDIC2 (CC BY-SA 4.0, © EDRDG),
  https://www.edrdg.org/wiki/index.php/KANJIDIC_Project; converted by qinqin",
  `version` `kanjidic2@<bundled version>`; files `LICENSE` (copy of
  KANJIDIC2's), `ATTRIBUTION.md`.
- Ruling: derive from the bundled KANJIDIC2, not from MEXT or Wikipedia — it is
  already bundled under CC BY-SA 4.0 and reflects the 2020 revision — cost if
  wrong: a KANJIDIC2 error carries into badges; a test cross-checks the set
  against Unihan `kJoyoKanji`.
- Ruling: hide `joyo-grades` from the map's "Group by" — the built-in "Grade"
  grouping already shows exactly these sections, and the owner decided on
  2026-11-14 that grade lists stay in the core — cost if wrong: one option
  missing; removing the id from a set re-adds it. Badges, level sessions and
  search filters still use it.

### Bundled pack `tgh-chars` (Chinese, unit `character`)

- Levels: `Level 1` (一级, 3,500), `Level 2` (二级, 3,000), `Level 3` (三级,
  1,605), entries in table order (serial). Name "通用规范汉字表 (2013) levels".
- `license` "Unicode License v3", `attribution` "Levels of the 通用规范汉字表
  (State Council, 2013) from the kTGH field of the Unicode Unihan database
  (Unicode License v3), https://www.unicode.org/reports/tr38/; converted by
  qinqin"; `LICENSE` copy of Unihan's.
- `notice`: the table is a State Council document (国发〔2013〕23号); qinqin
  takes only the serial from Unihan and splits it at 3,500 and 6,500.
- Ruling: bundle it as the mainland baseline — Unicode-licensed input,
  state-document source — cost if wrong: one pack to purge (same procedure as
  the 2026-11-13 HSK purge).
- Ruling: keep the built-in "Common" grouping alongside — it groups by GB2312
  rows, a different split — cost: two similar options on the map.
- Ruling: no 小学/初中/高中 split is bundled; level 1 (3,500) is the
  常用字 the curriculum builds on, and the curriculum's own lists stay local —
  cost: no grade-level schemes out of the box.

### Local-only: a generic list converter

One script, `scripts/prepare-local-levels.mjs`, turns a user-prepared TSV into
a levels pack under `plugins/data-local/<id>/`. It covers TBCL words, TBCL
characters and the curriculum tables, and any other list the user may use
privately.

```
node scripts/prepare-local-levels.mjs --id tbcl-words --name "TBCL words" \
  --language zh --unit word --license "NAER, all rights reserved; local use" \
  --attribution "國家教育研究院 臺灣華語文能力基準, https://coct.naer.edu.tw" \
  <list.tsv> [<local-packs-dir>]
```

- Input: UTF-8 TSV with header `level<TAB>form[<TAB>reading]`. Levels are
  ordered by first appearance; a form repeated keeps its first (easiest)
  level. Reading optional: pinyin (marked or numbered) or kana is kept; a
  reading containing zhuyin (U+3100–U+312F, U+31A0–U+31BF) is dropped with one
  summary warning (Ruling below).
- Output: `manifest.json`, `levels.json`, `ATTRIBUTION.md` ("not bundled, local
  use only", the input's SHA-256). No `LICENSE` (none granted).
- Refuses a target outside a directory named `data-local` unless `--force-dir`
  is given, so a typo cannot write into `plugins/data/`.
- `docs/sources.md` gets steps per source: TBCL (download from coct.naer.edu.tw,
  export the 詞語表/漢字表 to TSV with LibreOffice, keep columns 等級, 詞語,
  漢語拼音), curriculum tables (type or paste the appendix lists per level).
- Ruling: a generic TSV converter instead of per-source parsers — we cannot pin
  or test files we may not fetch or commit, and TBCL's download page refused us
  (403) — cost: users do one spreadsheet export by hand.
- Ruling: zhuyin readings are dropped with a warning in v1 (keep pinyin) — the
  levels importer compares toneless pinyin and `internal/pinyin` converts only
  pinyin → zhuyin, not back; TBCL also has a 漢語拼音 column — cost: a
  zhuyin-only list falls back to form-only matching for homographs.
- Ruling: suggested ids `tbcl-words`, `tbcl-chars`, `cn-curriculum-chars` are
  added to `LOCAL_ONLY_PACKS` in `scripts/check-sources.mjs` so `sources.md`
  may name them — cost: none.

## Generation of the bundled packs

`scripts/prepare-standard-levels.mjs [<packs-dir>]` reads only bundled files
(`kanjidic2/kanjidic2.xml.gz`, and `unihan/Unihan.zip` member
`Unihan_OtherMappings.txt`, which holds both `kTGH` and `kJoyoKanji`; read
with `unzip -p` via `child_process`, as no zip library is a dependency) and
writes `joyo-grades` and `tgh-chars`.
Deterministic: same inputs, same bytes. It reuses `parseKanjidic2` and the
pack writer from `prepare-level-packs.mjs` (export `writePack` and make its
`license` optional so the local converter writes no `LICENSE`;
`parseKanjidic2` already returns `grade` and `freq`, `null` when absent).

- Ruling: a new script rather than more modes in the 1,120-line
  `prepare-level-packs.mjs` — those modes fetch pinned upstream files, these
  read only bundled data — cost: one more script to know about.
- Ruling: no network, no `--hsk`-style local mode in this script — both inputs
  are in the repo — cost: none.

## App changes

- `charGroups.ts`: `HIDDEN_GROUPING_PACK_IDS = new Set(['joyo-grades'])`
  next to the sample ids; `groupOptions` skips them. Nothing else in the web
  app changes: badges, sessions, filters and the Sources page read schemes.
- `docs/sources.md`, `README.md` ("Bundled data" table, layout table),
  `plugins/data/README.md`: rows for both packs; local-only section for the
  converter. `check-sources.mjs` passes.
- Server: none. Character units resolve against the KANJIDIC2 (ja) and Unihan
  (zh) character entries the bundled dictionaries already create; the seed
  line reports any unknown forms, expected 0 for both packs.

## Degradation

Without any local pack the app shows the bundled schemes only; local packs
appear after `qinqin seed` like `jlpt-words` does. A missing or malformed
local TSV fails the converter with a message naming the line; nothing is
written.

## Testing

- `scripts/prepare-standard-levels.test.mjs`: tiny KANJIDIC2/Unihan fixtures
  → exact `levels.json`; boundaries 3,500/3,501 and 6,500/6,501; jinmeiyō
  excluded; deterministic bytes; notice valid.
- Real-data assertions (run in CI, data is bundled): `joyo-grades` has 2,136
  kanji and equals Unihan's `kJoyoKanji` 2010 set; `tgh-chars` 3,500/3,000/1,605.
- `scripts/prepare-local-levels.test.mjs`: header, ordering, duplicates,
  refusal outside `data-local`, missing column errors.
- `charGroups.test.ts`: `joyo-grades` hidden, `tgh-chars` shown.
- Go: seed test over the real bundle (existing opt-in `RealPacks`) gains
  0-skipped checks for both packs.

## History scan (review gate)

No restricted data may reach git. Before review, all must print nothing:
`git ls-files plugins/data-local`;
`git log --all --name-only --format= | grep -Ei 'tbcl|curriculum|课程标准|八千|8000'`;
`git log --all -p -- ':(glob)plugins/**/levels.json' scripts/testdata ':(glob)scripts/*.test.mjs' | grep -E '^\+.*(臺灣華語文能力基準|识字写字教学基本字表)'`
(data and fixtures only; docs and READMEs may name the sources). Test fixtures are
hand-written and contain no rows copied from TBCL or a 课程标准.

## Risks

- KANJIDIC2 could drift from MEXT; mitigated by the `kJoyoKanji` cross-check.
- The art. 5 / art. 13 readings are background, not a legal opinion; the
  bundled packs rest on the KANJIDIC2 and Unicode licences.
- TBCL terms may later be published openly (e.g. on data.gov.tw); then a
  bundled pack becomes possible — re-check, do not assume.

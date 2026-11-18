# Data and licences

qinqin bundles dictionaries and level lists so a fresh install seeds offline: by itself on the first start ([auto-seed](Admin-deploying#the-auto-seed-on-the-first-start)), or with `qinqin seed`. Every sense, frequency rank and level badge keeps its source, licence and attribution. Two places are the licence reference, and this page only summarises them:

- the app's **Sources** page (`/sources`, open to everyone, signed in or not), built from what the server has actually installed;
- [`docs/sources.md`](https://github.com/Elaktrato/qinqin/blob/develop/docs/sources.md) in the repository: attributions, upstream links, pinned versions and the redistribution decision for every source.

Nothing here is legal advice. Installing and removing packs: [Data packs on the server](Admin-data-packs).

## Bundled packs

The image ships these under `/opt/qinqin/packs` (source: `plugins/data/`):

| Pack | Provides | Licence |
|---|---|---|
| [CC-CEDICT](https://cc-cedict.org) (`cedict`) | Mandarin–English words and meanings | CC BY-SA 4.0 |
| [Unihan](https://www.unicode.org/reports/tr38/) (`unihan`) | Radical-stroke counts, variant mappings, character definitions | Unicode License v3 |
| [JMdict](https://www.edrdg.org/) (`jmdict`) | Japanese–English words and meanings | CC BY-SA 4.0 (EDRDG) |
| [KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project) (`kanjidic2`) | Kanji readings, meanings, stroke counts, radicals | CC BY-SA 4.0 (EDRDG) |
| [Jiten frequency list](https://jiten.moe/frequency-dictionaries) (`jiten-frequency`) | Japanese word frequency ranks (converted to CSV, ranks unmodified) | CC BY-SA 4.0 (Jitensoft) |
| [KanjiVG](https://kanjivg.tagaini.net) (`kanjivg-components`) | The parts each kanji is drawn from (6,312 kanji), derived from KanjiVG r20260714, for the radical and part lookup | CC BY-SA 3.0 (© Ulrich Apel); the derived index under the same licence |
| HSK 3.0 characters (`hsk-chars`) | The official characters to recognise (认读字) per level, HSK 1–6 and 7–9 (3,088 characters) | No reuse licence granted; see "The HSK lists" |
| HSK 3.0 words (`hsk-words`) | The official word list, HSK 1–6 and 7–9 (11,000 rows, 10,959 entries; edition 2025-11, effective 2026-07) | No reuse licence granted; see "The HSK lists" |
| Jōyō grades (`joyo-grades`) | The 2,136 jōyō kanji by school grade (Grade 1–6, Secondary), derived from KANJIDIC2 | CC BY-SA 4.0 (EDRDG) |
| 通用规范汉字表 (`tgh-chars`) | The 2013 standard characters list in three levels (3,500 / 3,000 / 1,605), derived from Unihan's `kTGH` | Unicode License v3 |
| JLPT kanji (`jlpt-kanji`) | Approximate N5–N1 kanji levels: kanjiapi.dev's list (of unstated provenance) plus levels derived from KANJIDIC2 for the 176 kanji it omits (分, 可, 無, 的 …) | MIT (© 2023 Iridium Szreter) and CC BY-SA 4.0 (EDRDG) |
| Spanish–English demo dictionary (`es-demo`) | A hand-written sample | CC0 1.0 |
| Chinese grammar demo (A1) (`zh-grammar-demo`) | Demo grammar lessons written for qinqin | CC0 1.0 |

The dictionary files are redistributed **unmodified**; the Jiten list is a conversion of the published file with unmodified ranks; the level lists are converted from pinned upstream files by `scripts/prepare-level-packs.mjs` and `scripts/prepare-standard-levels.mjs` and, for HSK, from the official syllabus by `scripts/prepare-hsk-syllabus.mjs`.

**Built into the image, not committed:**

- **Stroke-order data** (`hanzi-writer-strokes`): `hanzi-writer-data`, derived from the Make Me a Hanzi dataset, **Arphic Public License**; built by `scripts/prepare-strokes-pack.mjs` (into the image, or locally into the gitignored `plugins/data-strokes/`). It is a pack like the others: listed in the Sources page's stroke data section, and an administrator can uninstall it.
- **Kanji alive example-word audio** (`kanjialive-audio`): 10,156 Japanese clips, CC BY 4.0, fetched and checksum-checked at build time ([AI providers and offline OCR](Admin-AI-and-OCR#audio-in-the-image)).

**Credited on the Sources page as part of the app:** the stroke player `hanzi-writer`, the FSRS library `ts-fsrs`, the Reader's script converter `opencc-js` (MIT code with Apache-2.0 dictionary data; both licence texts ship as `/OPENCC-JS-LICENSE.TXT` and `/OPENCC-APACHE-2.0.TXT`), the interface font Figtree (SIL Open Font License 1.1, shipped unmodified with its licence text `/FIGTREE-OFL.TXT`, never loaded from another host), and the icon set. Every data package a client downloads carries the licence texts of its packs ([Data packs on the server](Admin-data-packs#licence-texts-in-packages)).

## The HSK lists

The official syllabus 《HSK 考试大纲》 (Syllabus for the Chinese Proficiency Test, published 2025-11, effective 2026-07) is issued by 中外语言交流合作中心 (CLEC) and distributed by Chinese Testing International (CTI) at [chinesetest.cn](https://www.chinesetest.cn). **No reuse licence is granted**: the site's [Legal Notice](https://www.chinesetest.cn/legal-notice) says its content is copyrighted by CTI or the content providers, requires the source to be indicated ("Source: www.chinesetest.cn"), and permits reproduction only as reasonable, good-faith quoting for informative public use; the PDF carries a copy-protection flag.

The project includes only the word list and the list of characters to recognise, as plain lists with their levels (and the words' pinyin as lookup readings), and none of the syllabus's other content (grammar points, descriptions, the lists of characters to write, explanatory text). The Sources page and the character map show the required source line. The inclusion is a decision of the project owner; **its legal status has not been verified** (no legal opinion). The PDF and any text extracted from it are never committed; `scripts/prepare-hsk-syllabus.mjs` converts its `pdftotext -tsv` output (steps in the script's header). The older community-compiled hsk30 packs that `prepare-level-packs.mjs --hsk` generates locally are superseded by the official lists.

## JLPT levels and vocabulary

The JLPT has published no official kanji list since 2010, so the kanji levels are approximate and labelled that way.

**JLPT vocabulary is not bundled**: its upstream licence chain could not be verified (open-anki-jlpt-decks is labelled MIT, but says its data came from other decks based on the tanos.co.uk lists, described as CC BY; that page could not be reached). You can generate it for your own server as a local-only pack, from the repository root:

```sh
mkdir /tmp/jlpt-vocab && cd /tmp/jlpt-vocab
base=https://raw.githubusercontent.com/jamsinclair/open-anki-jlpt-decks/1ad66734417aca9dbcca6b2d5ee440cb13ab3ba0
for n in n5 n4 n3 n2 n1; do curl -fsSLo $n.csv $base/src/$n.csv; done
curl -fsSLo LICENSE $base/LICENSE
cd -
node scripts/prepare-level-packs.mjs --jlpt-vocab /tmp/jlpt-vocab   # writes plugins/data-local/
qinqin seed --packs plugins/data,plugins/data-local
```

Under Docker mount `plugins/data-local` and name it in `--packs` ([Data packs on the server](Admin-data-packs)). The character map's "Group by" and the Sources page pick it up once installed.

## Local-only packs

Data with an unclear or restrictive licence is never committed or bundled. Put it in the gitignored `plugins/data-local/` folder; `qinqin seed` imports it after the bundled packs. A pack is a folder with a `manifest.json` (`license` and `attribution` are required) plus its data file ([Data pack format](Data-pack-format)). Details: `plugins/data/README.md` and `docs/sources.md`, "Local-only data".

## Radicals and character components

The radical lookup uses data already bundled: Unihan's radical numbers (Chinese) and KANJIDIC2's classical radicals (Japanese). The parts come from **components packs**. The bundled Japanese one is derived from KanjiVG: for each kanji, the elements of its stroke-order drawing; it carries KanjiVG's licence text. Chinese decompositions (CHISE IDS and cjkvi-ids: GPL; Make Me a Hanzi: LGPL with an unverified chain) are **not bundled**; an operator can prepare a local-only pack with `scripts/prepare-ids-components.mjs` into `plugins/data-local/`. EDRDG's KRADFILE is a later option once its current licence statement has been checked.

## Frequency order and starter decks

"Most frequent first" and the starter decks (Top 500/1000/2000) are computed at request time from the frequency packs installed on the server. Japanese uses the bundled Jiten list (attribution shown on every starter deck). For Chinese no word frequency list with a clearly compatible licence was found (checked 2026-11-16): wordfreq's Chinese data includes word lists of unknown provenance, jieba's counts have no stated source, SUBTLEX-CH has unclear terms and the Leiden Weibo corpus is non-commercial, so these are local-only packs an operator may add. Unihan's and KANJIDIC2's character counts are character data, not word ranks, and are not used for this.

## Hanzi and kanji font packs

Font packs (Sans, Serif and Kai faces: Noto Sans/Serif SC, TC and JP, LXGW WenKai, Klee One, all SIL Open Font License 1.1) are never committed or built into the image. An administrator builds one with `npm --prefix scripts/fonts ci` and then `node scripts/prepare-font-pack.mjs --source <id> --out plugins/data-fonts/<id>`, from a pinned upstream file whose hash and licence text the script checks, and installs it like any pack (upload in Settings → Data, or `qinqin seed --packs plugins/data-fonts`). The slices are modified versions under the OFL, so they are renamed `qinqin <Face> <SC|TC|JP>`; each pack carries the original licence text and an attribution, and the Sources page credits it. Details: `docs/sources.md`, "Hanzi and kanji font packs".

## Credits and the Sources page

The Sources page is public because the CTI Legal Notice asks that the source be shown where the content is, and every credit should be reachable by anyone; its API calls (`GET /api/dictionaries`, `/api/frequency-packs`, `/api/schemes` and the other pack lists) are public too. It is built from data, not hard-coded text:

- **Packs**: each installed pack's manifest `license`, `attribution` and optional `notice`. The notice is plain text: paragraphs separated by a blank line, links only as `[text](https://…)` (https only; anything else stays plain text), at most 4,000 bytes. The server validates it on import (`server/internal/dict/notice.go`) and the page renders it with `apps/web/src/lib/sources/notice.ts` (no HTML).
- **Plugins**: a web plugin lists the third-party material it ships or fetches in the optional `sources` array of its manifest (`PluginManifest.sources` in `apps/web/src/lib/plugins/index.ts`), each a `SourceCredit` with `name` and optional `url`, `license`, `attribution`, `notice`, `licenseTexts` and `lang` (`apps/web/src/lib/sources/credits.ts`). The page shows them under "Plugins".
- **Core**: material built into the app itself, shared by several features, is listed once in `apps/web/src/lib/sources/coreCredits.ts`. A licence text that ships with the app goes into `apps/web/static/` and is named in the credit's `licenseTexts`.

**Adding a credit:** for a pack, set `license` and `attribution` (and a `notice` if one line is not enough) in its `manifest.json` and add a row to `docs/sources.md`; for a plugin, add an entry to its manifest's `sources`; for the app itself, add it to `coreCredits.ts`. `node scripts/check-sources.mjs` keeps packs and docs honest (every pack has a non-empty `license` and `attribution`, every bundled pack is named in `docs/sources.md`, every pack the docs name exists, every `notice` is valid); CI runs it with the scripts' tests (`node --test scripts/*.test.mjs`).

## Related

[Dictionary data model](Dictionary-data-model), [Searching and entries](Searching-and-entries), [Stats and heatmap](Stats-and-heatmap).

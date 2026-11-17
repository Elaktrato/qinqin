# Data and licences

qinqin bundles dictionaries and level lists so a fresh install seeds offline (`qinqin seed`). Every sense, frequency rank and level badge keeps its source, licence and attribution. The app's **Sources** page (`/sources`, open to everyone, signed in or not) is the live source of truth; it is built from the installed packs' manifests, the plugins' declared sources, and the app's own credits. The human overview is `docs/sources.md` in the repository. Nothing here is legal advice.

## Bundled packs

| Pack | Provides | Licence |
|---|---|---|
| CC-CEDICT | Mandarin to English words | CC BY-SA 4.0 |
| Unihan | Radical-stroke counts, variants, character definitions | Unicode License v3 |
| JMdict | Japanese to English words | CC BY-SA 4.0 (EDRDG) |
| KANJIDIC2 | Kanji readings, meanings, strokes, radicals | CC BY-SA 4.0 (EDRDG) |
| Jiten frequency list | Japanese word frequency ranks, ranks unmodified | CC BY-SA 4.0 (Jitensoft) |
| HSK 3.0 characters and words (`hsk-chars`, `hsk-words`) | The official character and word lists by level | No reuse licence granted; see below |
| Jōyō grades (`joyo-grades`) | The 2,136 jōyō kanji by school grade, derived from KANJIDIC2 | CC BY-SA 4.0 (EDRDG) |
| 通用规范汉字表 (`tgh-chars`) | The standard characters list in three levels, derived from Unihan | Unicode License v3 |
| JLPT kanji (`jlpt-kanji`) | Approximate N5 to N1 kanji levels from kanjiapi.dev plus levels derived from KANJIDIC2 | MIT and CC BY-SA 4.0 |
| KanjiVG components (`kanjivg-components`) | The parts each kanji is drawn from, for the radical and part lookup, derived from KanjiVG | CC BY-SA 3.0 (© Ulrich Apel); the derived index under the same licence |
| Hanzi Writer stroke data (`hanzi-writer-strokes`) | Stroke-order animation data for Chinese and Japanese characters (`hanzi-writer-data`, from the Make Me a Hanzi dataset), built into the image as a pack, not committed | Arphic Public License |

The dictionary files are redistributed unmodified. Stroke-order data is a pack like the others: it is listed in the Sources page's stroke data section with its licence and attribution, an administrator can uninstall it, and a repository checkout builds it with `node scripts/prepare-strokes-pack.mjs --out plugins/data-strokes/hanzi-writer-strokes` (after `npm --prefix apps/web ci`). Also credited on the Sources page: the stroke player `hanzi-writer`, the FSRS library, the script converter `opencc-js`, and Kanji alive example-word audio (CC BY 4.0, Japanese clips) in the published image.

## The HSK lists

No reuse licence is granted by the publisher (Chinese Testing International). Its Legal Notice requires the source to be indicated and permits reasonable, good-faith quoting. The project includes only the word list and the characters-to-recognise list with levels (and word pinyin as lookup readings), none of the syllabus's other content, and shows the required source line on the Sources page and the character map. The inclusion is a decision of the project owner; **its legal status has not been verified** (no legal opinion). The official PDF and any text extracted from it are never committed.

## JLPT levels

The JLPT has published no official kanji list since 2010, so the kanji levels are approximate and labelled that way. **JLPT vocabulary is not bundled**: its upstream licence chain could not be verified. It is an optional pack you can generate for local use only.

## Local-only packs

Data with an unclear or restrictive licence is never committed or bundled. Put it in the gitignored `plugins/data-local/` folder; `qinqin seed` imports it after the bundled packs. A pack is a directory with a `manifest.json` (`id`, `name`, `version`, `type`, `language`, `format`, `license`, `attribution`; `license` and `attribution` are required) plus its data file. Level packs use `"type": "levels"` and a `levels.json`; frequency packs use `yomitan-freq` or `freq-csv`. Under Docker, mount the folder and pass it with `--packs` ([Backup, recovery and the command line](Admin-backup-and-recovery)). Details: `plugins/data/README.md` and `docs/sources.md`.

Administrators can also install a dictionary pack as a zip in Settings, Data.

## Radicals and character components

The radical lookup uses data already bundled: Unihan's radical numbers (Chinese) and KANJIDIC2's classical radicals (Japanese). The parts come from **components packs**. The bundled Japanese one is derived from KanjiVG (tag r20260714, CC BY-SA 3.0, © Ulrich Apel, https://kanjivg.tagaini.net): for each kanji, the elements of its stroke-order drawing. It carries KanjiVG's licence text and is credited on the Sources page. Chinese decompositions (CHISE IDS and cjkvi-ids: GPL; Make Me a Hanzi: LGPL with an unverified chain) are **not bundled**; an operator can prepare a local-only pack with `scripts/prepare-ids-components.mjs` into `plugins/data-local/`. EDRDG's KRADFILE is a later option once its current licence statement has been checked.

## Frequency order and starter decks

"Most frequent first" and the starter decks (Top 500/1000/2000) are computed at request time from the frequency packs installed on the server; nothing extra is bundled for them. Japanese uses the bundled Jiten list (CC BY-SA 4.0, with attribution, shown on every starter deck). For Chinese no word frequency list with a clearly compatible licence was found (checked 2026-11-16): wordfreq's Chinese data includes word lists of unknown provenance, jieba's counts have no stated source, SUBTLEX-CH has unclear terms and the Leiden Weibo corpus is non-commercial, so these are local-only packs an operator may add for their own server. Unihan's character readings counts and KANJIDIC2's newspaper ranks are character data, not word ranks, and are not used here.

## Data packages carry their licences

The server turns installed packs into data packages that clients download (see [API overview](API-Overview#data-packages)). Every package holds a `NOTICE.md` (per source pack: name, version, licence, attribution, notice) and the pack's own licence files verbatim under `LICENSES/<pack id>/` (`LICENSE*`, `LICENCE*`, `ATTRIBUTION*`, `NOTICE*`, `COPYING*`, kept at import). A package contains exactly what the server has installed, so nothing reaches a client that the server does not already serve. Packs installed by an older release have no licence files stored; until an administrator runs `qinqin seed` once their packages carry only the licence name and attribution (the catalogue says `licenseTexts: false`).

## Adding a credit

Packs: `license`, `attribution` and an optional `notice` (plain text, links only as `[text](https://...)`, at most 4,000 bytes) in the manifest, plus a row in `docs/sources.md`. `node scripts/check-sources.mjs` (run in CI) keeps manifests and docs in agreement.

## Related

[Searching and entries](Searching-and-entries), [Stats and heatmap](Stats-and-heatmap).

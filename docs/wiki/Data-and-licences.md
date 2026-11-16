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

The dictionary files are redistributed unmodified. Also credited on the Sources page: stroke-order data (`hanzi-writer-data`, from the Make Me a Hanzi dataset, Arphic Public License), the FSRS library, the script converter `opencc-js`, and Kanji alive example-word audio (CC BY 4.0, Japanese clips) in the published image.

## The HSK lists

No reuse licence is granted by the publisher (Chinese Testing International). Its Legal Notice requires the source to be indicated and permits reasonable, good-faith quoting. The project includes only the word list and the characters-to-recognise list with levels (and word pinyin as lookup readings), none of the syllabus's other content, and shows the required source line on the Sources page and the character map. The inclusion is a decision of the project owner; **its legal status has not been verified** (no legal opinion). The official PDF and any text extracted from it are never committed.

## JLPT levels

The JLPT has published no official kanji list since 2010, so the kanji levels are approximate and labelled that way. **JLPT vocabulary is not bundled**: its upstream licence chain could not be verified. It is an optional pack you can generate for local use only.

## Local-only packs

Data with an unclear or restrictive licence is never committed or bundled. Put it in the gitignored `plugins/data-local/` folder; `qinqin seed` imports it after the bundled packs. A pack is a directory with a `manifest.json` (`id`, `name`, `version`, `type`, `language`, `format`, `license`, `attribution`; `license` and `attribution` are required) plus its data file. Level packs use `"type": "levels"` and a `levels.json`; frequency packs use `yomitan-freq` or `freq-csv`. Under Docker, mount the folder and pass it with `--packs` ([Backup, recovery and the command line](Admin-backup-and-recovery)). Details: `plugins/data/README.md` and `docs/sources.md`.

Administrators can also install a dictionary pack as a zip in Settings, Data.

## Adding a credit

Packs: `license`, `attribution` and an optional `notice` (plain text, links only as `[text](https://...)`, at most 4,000 bytes) in the manifest, plus a row in `docs/sources.md`. `node scripts/check-sources.mjs` (run in CI) keeps manifests and docs in agreement.

## Related

[Searching and entries](Searching-and-entries), [Stats and heatmap](Stats-and-heatmap).

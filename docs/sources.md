# Starter data sources

Licensing of qinqin itself is in [`LICENSING.md`](../LICENSING.md): the code is MIT, content the project
writes (the grammar packs, the lemmatizer rules, the qinqin themes) is CC BY 4.0, and everything below
keeps its own licence.

The app's **Sources page** (`/sources`) is the live source of truth for
credits. It is public: anyone can open it without signing in. It is built at runtime from three places: the installed packs'
manifests (`license`, `attribution` and the optional `notice`, served by
`GET /api/dictionaries`, `/api/frequency-packs`, `/api/schemes`,
`/api/component-packs` and `/api/lemma-packs`), the
`sources` that a core feature declares (`FeatureDef.sources`), and the app's own
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
rules. To credit something new, see "Credits and the Sources page" on the wiki
page `docs/wiki/Data-and-licences.md`.

The repository bundles four upstream dictionaries, one frequency list and
four level lists (HSK 3.0 characters, HSK 3.0 words, JLPT kanji, the estimated JLPT words) under `plugins/data/` so that a fresh clone or Docker image
seeds offline (`qinqin seed`):

**Japanese**

| Pack | Provides | License | Upstream |
|---|---|---|---|
| **KANJIDIC2** (`kanjidic2`) | Kanji readings, meanings, stroke counts, radicals | CC BY-SA 4.0 (EDRDG) | https://www.edrdg.org/wiki/index.php/KANJIDIC_Project |
| **JMdict** (`jmdict`) | Japanese–English words and meanings; its priority and usually-kana tags rank homophones in the Reader | CC BY-SA 4.0 (EDRDG) | https://www.edrdg.org/ |
| **Jiten frequency list** (`jiten-frequency`) | Japanese word frequency ranks that order lookup results | CC BY-SA 4.0 (Jitensoft) | https://jiten.moe/frequency-dictionaries |
| **Jōyō kanji by school grade** (`joyo-grades`), derived from KANJIDIC2 | The 2,136 jōyō kanji by school grade (Grade 1–6, Secondary) | CC BY-SA 4.0 (EDRDG) | https://www.edrdg.org/wiki/index.php/KANJIDIC_Project |
| **JLPT kanji (approximate)** (`jlpt-kanji`), from kanjiapi.dev and KANJIDIC2 | Kanji by approximate JLPT level N5–N1 | MIT (© 2023 Iridium Szreter); derived levels CC BY-SA 4.0 (EDRDG) | https://github.com/onlyskin/kanjiapi.dev |
| **JLPT words (approximate)** (`jlpt-words`), estimated by qinqin from the Jiten ranks, JMdict, `jlpt-kanji` and a reviewed core list | 9,999 words by estimated JLPT level ≈ N5–≈ N1 (no official list since 2010) | CC BY-SA 4.0 (an adaptation of the Jiten ranks and JMdict; kanjiapi.dev's MIT notice kept; the core list CC BY 4.0, qinqin contributors) | this repository, `scripts/prepare-jlpt-words.mjs` |
| **KanjiVG components** (`kanjivg-components`), derived from KanjiVG r20260714 | The parts each kanji is drawn from (6,312 kanji), for the radical and part lookup | CC BY-SA 3.0 (© Ulrich Apel); the derived index under the same licence | https://kanjivg.tagaini.net |

Optional, local only (not bundled): **Chinese components** (`zh-components`) for the radical and part lookup; see "Character components".

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

Each bundled upstream pack directory carries its `manifest.json` (including `license`,
`attribution` and, where the pack needs more than a line, a `notice`), the full license text (`LICENSE`; `jlpt-kanji` also
`LICENSE-KANJIDIC2` for its derived levels), and credits
(`ATTRIBUTION.md`); `es-demo` is an exception: it has only its
`manifest.json` and `dictionary.json` (a tiny demo dictionary written for this
project; its licence and attribution are in the manifest); `joyo-grades` and `tgh-chars` carry copies of the KANJIDIC2 and Unihan licences; `hsk-words` and `hsk-chars` have no `LICENSE`, as no
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

- **Chinese grammar (HSK-aligned)** (`zh-grammar`, type `grammar`; bundled):
  grammar lessons level by level (≈ HSK 1 to 7–9), each syllabus grammar point
  taught with 4–8 example sentences, readings, translations and exercise
  answers, **written for qinqin by the project and released under CC BY 4.0**
  (credit: "qinqin contributors, CC BY 4.0", https://github.com/Elaktrato/qinqin; `plugins/data/zh-grammar`, with `LICENSE` and `ATTRIBUTION.md`). Topic
  coverage follows the grammar outline (语法大纲) of the 《HSK 考试大纲》 /
  Syllabus for the Chinese Proficiency Test (CLEC/CTI, edition 2025-11,
  effective 2026-07;
  https://hsk.cn-bj.ufileos.com/3.0/%E6%96%B0%E7%89%88HSK%E8%80%83%E8%AF%95%E5%A4%A7%E7%BA%B21219.pdf),
  used as a **topic index only**: the lesson grouping and order, explanations,
  examples and exercises are qinqin's own, and no syllabus text is reproduced.
  The syllabus grants no reuse licence. The levels are qinqin's estimates, not
  official HSK levels. It **has not been reviewed by a native speaker**; errors
  are possible.
- **Japanese grammar (≈ JLPT levels)** (`ja-grammar`, type `grammar`; bundled):
  grammar lessons in five levels (≈ N5 to N1), each grammar point taught with
  4–8 example sentences, kana readings, translations and exercise answers,
  **written for qinqin by the project and released under CC BY 4.0**
  (credit: "qinqin contributors, CC BY 4.0", https://github.com/Elaktrato/qinqin; `plugins/data/ja-grammar`, with `LICENSE` and `ATTRIBUTION.md`). The JLPT
  publishes no grammar list; the choice and order of points per level are
  qinqin's own (`docs/superpowers/specs/2026-11-21-ja-grammar-pack-design.md`),
  not taken from JLPT preparation books or other published lists. The levels
  are qinqin's estimates, not official JLPT levels. It **has not been reviewed
  by a native speaker**; errors are possible.

## Courses

- **Chinese course (≈ HSK 1–4)** (`zh-course`, type `course`; bundled) and **Japanese course (≈ JLPT N5–N3)**
  (`ja-course`, type `course`; bundled): the course skeletons (sections, units, themes, the placement of the
  grammar lessons, the characters each unit introduces, checkpoints) and the reading texts with their English
  translations, **written for qinqin by the project and released under CC BY 4.0** (credit: "qinqin contributors,
  CC BY 4.0", https://github.com/Elaktrato/qinqin; `plugins/data/zh-course` and `plugins/data/ja-course`, each with
  `LICENSE`, `ATTRIBUTION.md` and `REVIEW.md`). The selection and order are qinqin's own, not taken from a textbook,
  a course or a syllabus. The packs contain **no level-list words**: each server fills the units from its installed
  `hsk-words` or `jlpt-words` list, which keep their own licences (above). The content was **reviewed by agents
  acting as native-speaker teachers, not yet by a person** (`REVIEW.md`); errors are possible.

## Writing-system trainer data (kana, Hangul, Cyrillic)

The writing-system trainer (#204, kana study #63) ships three small data files in the web build,
`apps/web/src/lib/features/scripts/data/kana.json`, `hangul.json` and `cyrillic.json`, with their own
`ATTRIBUTION.md` next to them. They are written by the qinqin project and released under **CC BY 4.0** like the
project's other written content (`LICENSING.md`; issue #204 asked for CC0, the owner decided on 2026-11-26 that
there is no exception). Nothing in them is copied from another
source: the charts are tables of facts about writing systems (modified Hepburn, Revised Romanization, a plain
Cyrillic transliteration), the example words are common words with an English gloss, and the keyboard keys are
layout facts (Korean 2-set, Russian ЙЦУКЕН). The Sources page lists them under the feature (`FeatureDef.sources`).

Licence checks done at the time of writing (2026-11-26), for sources that were looked at and **not bundled**:

- **KanjiVG** (kana stroke order): CC BY-SA **3.0** (project README and `COPYING`), below the project's usual
  floor of CC BY-SA 4.0. The owner accepted it on 2026-11-26: the `kanjivg-strokes` pack (see "Stroke-order data")
  gives the kana trainer its write mode, and `kanjivg-components` stays.
- **Lingua Libre / Wikimedia Commons** (sound recordings): the licence is per file (often CC BY-SA 4.0, some
  CC BY-SA 3.0 or CC0). Nothing was downloaded; each file would have to be checked at download time. The trainer
  speaks with the device voice meanwhile.

## Lemmatizer rules

- **Japanese lemmatizer rules** (`ja-lemma`, type `lemma-rules`; bundled): the
  rule table that turns inflected Japanese (食べました, 勉強しています,
  しちゃった) into dictionary forms for the Reader and lookups, **written for
  qinqin by the project and released under CC BY 4.0**
  (credit: "qinqin contributors, CC BY 4.0"; `plugins/data/ja-lemma`, with `LICENSE` and `ATTRIBUTION.md`; issues #165,
  #177, #176). The same table is built into the server
  (`server/internal/lemma/tables/ja.json`) and is the contract fixture
  `docs/contracts/lemma/ja.rules.json`; the pack serves it to clients as the
  data package `lemma-rules.ja-lemma`. Installed lemma-rules packs are credited
  on the Sources page (`GET /api/lemma-packs`).

## Starter sets (Starter mode, #214)

`server/internal/starter/sets/starter-zh.json` and `starter-ja.json` (embedded in
the server) are short word lists for Starter mode: a written form, an optional
reading, a one-word English gloss and the picture each word should have in an
images pack. The **project wrote them**: the choice and order of words, the
glosses and the picture pairing. They copy no third-party text; the dictionary
entries and the pictures they point at stay under their own licences (see
"Pictures"), and each file's `license` is **CC BY 4.0** (credit "qinqin contributors, CC BY 4.0";
the owner decided on 2026-11-26 against a CC0 exception, `LICENSING.md`). They hold 146 (Chinese) and 145 (Japanese) words (#275; the owner's
target was about 150), each with the picture the server serves for it. They were
**reviewed by agents acting as native-speaker teachers, not yet by a person**: two
teacher agents per language and an adjudicator read every word, its dictionary entry
and its picture (notes: `server/internal/starter/sets/REVIEW.md`); `humanReviewed` stays
`false` until the owner has read them, and each file's `attribution` says so.
Licence confirmed by the owner on 2026-11-26.

## Counters and measure words (Practice, #179)

`server/internal/counters/table/counters-ja.json` (embedded in the server) is the Japanese counters table of the
counter drills: 32 counters, what each counts, the numbers asked, the readings of number + counter with their sound
changes (the rule in `docs/contracts/counters/`, the irregular readings in the table) and 161 example nouns.
`measures-zh.json` corrects the Chinese measure words the measure-word drill reads from the installed CC-CEDICT's
`CL:` notes (nouns left out, lists reordered or extended, question glosses). The **project wrote both** (CC BY 4.0,
credit "qinqin contributors, CC BY 4.0"; JMdict lists no counter per noun, so nothing is taken from it, and no
commercial list was copied). The Chinese measure words are CC-CEDICT's (CC BY-SA 4.0), derived when a drill asks and
never bundled separately. Both files were **reviewed by agents acting as teachers, not yet by a person** (two Japanese
teachers and an adjudicator for the table and its readings, two Chinese teachers for a sample of 161 derived nouns;
notes: `server/internal/counters/table/REVIEW.md`); `humanReviewed` stays `false`. Credited on the Sources page under
Practice.

## Look-alike character sets (Practice, #228)

`apps/web/src/lib/features/practice/lookAlikes/data/look-alikes-zh.json` and `look-alikes-ja.json` (bundled in the web
app, loaded when the drill needs them) are the sets of the look-alike drill: 53 Chinese sets (simplified, traditional
and both) and 56 Japanese sets (kana, kana/kanji and kanji), each character with its readings, a short meaning, an
example word, and per set a note and the strokes that make the difference. The **project wrote them** (CC BY 4.0,
credit "qinqin contributors, CC BY 4.0"); no third-party list was copied, and nothing is derived from the KanjiVG
component index (CC BY-SA 3.0), Unihan or a dictionary. The bopomofo is the server's own conversion of the pinyin; the
stroke counts and marks were checked against the Hanzi Writer stroke data (Arphic Public License; read in a test, not
copied). The answer draws the highlights on the installed strokes packs at run time. **Reviewed by agents acting as
teachers, not yet by a person** (two Chinese and two Japanese teachers and an adjudicator; notes:
`lookAlikes/data/REVIEW.md`); `humanReviewed` stays `false`. Credited on the Sources page under Practice.

## Topic labels (courses, #220)

`server/internal/topics/labels/zh.json` and `ja.json` (embedded in the server) give words their **topics** (49
themes such as food, family, travel, `docs/contracts/topics/topics.json`), so a course can fill its units by theme.
The **project wrote them**, and they are shared under **CC BY-SA 4.0** (not the project's usual CC BY 4.0): they
are adapted in part from OpenMoji's emoji groups and keyed to CC-CEDICT and JMdict words whose senses the agents read,
all CC BY-SA 4.0. Credit: "qinqin contributors, CC BY-SA 4.0", with CC-CEDICT (MDBG and the CC-CEDICT community) or
JMdict (EDRDG) and OpenMoji, as each file's `attribution` gives it:

- Words of HSK 1–4 (the bundled `hsk-words` list, used only to choose which words to label; no levels are copied)
  and ≈ N5–N3 (the estimated JLPT word list of #219) were labelled by an agent from their CC-CEDICT or JMdict senses
  and reviewed by two agents acting as native-speaker teachers of the language; a third decided where they disagreed.
  Each label keeps its confidence, review state, reviewers and their notes. **Reviewed by agents, not yet by a person**
  (`humanReviewed: false`).
- Other words with an OpenMoji picture (#216) get the topic of the picture's emoji group and subgroup, through the
  project's table `scripts/topics/openmoji-topics.tsv` (basis `picture`, not teacher-reviewed). The concept → group
  table `scripts/topics/openmoji-groups.tsv` comes from OpenMoji 17.0.0 `openmoji.json` (CC BY-SA 4.0); the labels
  files hold no emoji ids and no dictionary glosses.

They are built by `scripts/build-topic-labels.mjs` from the committed batches (`scripts/topics/`); the agent step is
`scripts/topic-agents.mjs`, the coverage report `scripts/topic-coverage.mjs`. The Sources page credits them under
"Built into the app".

## Example sentences (Tatoeba)

The example sentences on entry pages and in "Fill the gap" and "Build the
sentence" cards come from **Tatoeba** (<https://tatoeba.org>), a collection of
sentences and translations written by its contributors. Two packs are bundled
in `plugins/data/` (issue #133): the repository holds the tool that makes
them, `server/tools/tatoeba`, and the packs generated from the pinned export of
**2026-11-21** (licence re-read 2026-11-25, see the spec
`docs/superpowers/specs/2026-11-26-v080-data-sources.md`).
Sizes: Mandarin 32,810 sentences under 20,226 words, 12.8 MB raw (3.4 MB
gzip); Japanese 55,871 sentences under 28,100 words, about 21 MB raw. A full
`qinqin seed` of `plugins/data` took 3 min 20 s on the development machine.
`scripts/check-sources.mjs` ties both packs to the pin through its
`GENERATED_PACKS` list.

| Pack | Provides | License | Upstream |
|---|---|---|---|
| **Tatoeba example sentences (Mandarin)** (`zh-sentences-tatoeba`) | Mandarin sentences with an English translation and generated pinyin, filed under the CC-CEDICT words they contain | Sentence text CC BY 2.0 FR; some sentences CC0 1.0 (as stated by Tatoeba; re-checked at every pin); generated readings CC BY-SA 4.0 (CC-CEDICT) | https://tatoeba.org/en/downloads |
| **Tatoeba example sentences (Japanese)** (`ja-sentences-tatoeba`) | Japanese sentences (including the Tanaka corpus) with an English translation and, where certain, generated kana readings, filed under JMdict words | Sentence text CC BY 2.0 FR; some sentences CC0 1.0 (as stated by Tatoeba; re-checked at every pin); generated readings CC BY-SA 4.0 (JMdict, EDRDG) | https://tatoeba.org/en/downloads |

- **Licence.** Tatoeba states that sentence text is CC BY 2.0 FR and that the
  sentences in its `sentences_CC0` export are CC0 1.0; both fit the project's
  rule. The tool keeps a sentence only when it is in the export's sentence file,
  and marks it CC0 only when the CC0 file lists the same id, language and text;
  its English translation must pass the same test. The export's column layout is
  checked strictly: a new column (which could carry licence information) stops
  the build. **Audio is not used** (see "Audio": Tatoeba's recordings have
  varying licences).
- **Attribution.** Tatoeba asks that reused sentences credit Tatoeba with a link
  and, for CC BY, the sentence's author (wording to re-read at each pin; not
  verified from this environment). Each pack carries `credits.tsv`: for every
  sentence its Tatoeba id, page (`https://tatoeba.org/en/sentences/show/<id>`),
  licence and owner (the Tatoeba username listed for it, which is not always the
  original author), and the same for its translation (columns `sentence`, `url`,
  `licence`, `owner`, `translation`, `translation_url`, `translation_licence`,
  `translation_owner`). The same credits travel with the pack data and the app
  shows them: every sentence in `sentences.json` carries its own credit: its Tatoeba `id`,
  its owner `by`, the translation's id `tid` and the translation's owner `tby`
  (no separate credits list; a sentence under several words repeats them). The
  importer stores them with the sentence (migration 054), the entry API serves them as `credit` (`source`,
  `id`, `owner`, `url`, `translationId`, `translationOwner`, `translationUrl`),
  and the app shows, under every Tatoeba sentence (entry page examples and the
  answer side of sentence cards), a small "Tatoeba · <owner>" linked to
  `https://tatoeba.org/sentences/show/<id>` and "translation <owner>" linked to
  the translation's page; the Share text carries the same credit and links. The
  per-sentence credit is therefore available offline and one click from the
  sentence itself. The manifest `attribution` and the Sources page `notice` still
  link the published copy of `credits.tsv`
  (`https://github.com/Elaktrato/qinqin/blob/main/plugins/data/<pack id>/credits.tsv`),
  the aggregate list. The offline data package of a sentence pack carries the
  same credit on every sentence row (`credit_id`, `credit_owner`, `credit_tr_id`,
  `credit_tr_owner`, package format 2; owner decision of 2026-11-26: no
  compatibility with the old shape), and a link is the source's page of the id.
  `ATTRIBUTION.md` gives the export date, archive hashes, licence check and what
  was changed; `LICENSE` gives the CC BY 2.0 FR URI (which that licence allows
  instead of a copy) and the CC0 1.0 legal code.
- **Readings.** The `pinyin` field and the filing of sentences under words are
  generated from **CC-CEDICT** (MDBG, <https://cc-cedict.org>) or **JMdict**
  (EDRDG, <https://www.edrdg.org/>), both **CC BY-SA 4.0**
  (<https://creativecommons.org/licenses/by-sa/4.0/>); the manifest `license`,
  `LICENSE`, `ATTRIBUTION.md` and the notice say so. Pinyin is left out where a
  word has several readings; kana is given only where every word has one certain
  reading. The notice says the selection and readings were made by a program and
  may contain errors.
- **Filtering** (all thresholds in `server/tools/tatoeba/rules.json`): an English
  translation is required; orphaned sentences, sentences tagged as unreliable or
  unsuitable, negatively reviewed ones, too short or long ones, deny-listed ones,
  near-duplicates and sentences with too little dictionary coverage or no word
  that links are dropped; sentences by self-declared native speakers rank first;
  each word keeps at most `maxPerWord` sentences. Chinese single-character words
  are character entries, to which the importer links no sentences.
- **How to produce the packs** (from `server/`, with access to
  downloads.tatoeba.org):
  1. Re-read <https://tatoeba.org/en/downloads> and
     <https://tatoeba.org/en/terms_of_use>; replace the placeholder
     `licence.statement` of `server/tools/tatoeba/pin.json` with what they state,
     confirming that every row of `sentences_detailed` is CC BY 2.0 FR (`pin` and
     `build` refuse the placeholder).
  2. `go run ./tools/tatoeba pin --licence-checked <YYYY-MM-DD>` downloads the
     export into the git-ignored `plugins/upstream/tatoeba/` and records the
     archives' SHA-256 and the export date in `pin.json`. Keep those archives:
     Tatoeba overwrites its export weekly, and the packs can be re-created byte
     for byte only from the pinned files.
  3. `go run ./tools/tatoeba build` verifies the archives and writes
     `plugins/data/zh-sentences-tatoeba` and `plugins/data/ja-sentences-tatoeba`,
     plus `report-*.txt` (counts, match rate, readings share, pack sizes),
     `review-*.tsv` (words whose reading was left out) and `sample-*.tsv` in the
     export folder. `--max-per-word N` overrides the cap; `--lang zh` builds one. A pack file above 24 MiB stops the build (lower the cap, or pass `--allow-size`, which `ATTRIBUTION.md` records).
  4. Review the samples, tune `rules.json` and rebuild; then run
     `node scripts/check-sources.mjs` and commit `pin.json`, `rules.json` and
     both pack folders together: once `pin.json` is pinned, `check-sources` requires
     both packs at the pinned export date. A build without a pin is refused.

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
and `attribution`, and the Sources page lists them.
The new-card order "most frequent first" and the starter decks (Top 500/1000/2000,
#75) use the installed frequency packs only (the first pack of the language by
priority); no additional frequency data is bundled for them, and every starter deck
names its pack and licence. wordfreq was re-checked on 2026-11-16: its data may be
redistributed under CC BY-SA 4.0, but its Chinese list includes jieba's word list of
unknown provenance and SUBTLEX data under an e-mail permission, so it stays
local-only, as do jieba counts, SUBTLEX-CH, the Leiden Weibo corpus, BCCWJ and the
JPDB/Innocent/CC100 lists. An opt-in test seeds the
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

## Character components

The radical and part lookup (`/search/parts`) narrows a character grid by
the Kangxi radical, the parts a learner can see and the total stroke count.
Radicals need no extra data: the Unihan importer keeps each character's
`kRSUnicode` radical number and KANJIDIC2 its classical radical, both as a
`radical` link (`GET /api/characters` serves the number as `k`). Unihan 18.0
has no decomposition field (no `kIDS`), so the parts come from **components
packs** (`type: components`, `format: components-tsv`, `GET /api/components`).

**KanjiVG components** (`kanjivg-components`, Japanese, bundled) is derived
from KanjiVG (<https://kanjivg.tagaini.net>, © Ulrich Apel), tag
`r20260714`, commit `d95a97627fd9fe5b2c8d06ca81e38149609c0c1e`. KanjiVG is
licensed CC BY-SA 3.0, as its README, its `COPYING` and the header of every
SVG state. For each kanji drawing (variant files and non-ideographs skipped)
every nested `kvg:element` group except the kanji itself becomes a part,
deduplicated in document order (語 → 言 口 吾 五 二), at most 32; a part's
stroke count is the stroke count of its own drawing, else the most common
count of its groups. No drawing or stroke data is copied. The derived index
(6,312 kanji, 1,456 parts, about 170 KB) is shared under the same licence,
CC BY-SA 3.0; the pack carries KanjiVG's `COPYING` as `LICENSE` and an
`ATTRIBUTION.md`. `scripts/fetch-kanjivg-components.sh` rebuilds it (a manual
maintainer action that refuses to run without `KANJIVG_LICENCE_CHECKED`).
The elements are graphical, not etymological, so "Show all parts" also lists
some noise parts (二 inside 五).

Decompositions **not bundled**:

- **Chinese components** (`zh-components`, local only): CHISE / cjkvi-ids /
  Make Me a Hanzi decompositions are GPL or LGPL or have unverified chains.
  **CHISE IDS** is GPL-2.0-or-later, **cjkvi-ids** (`ids.txt`) "follows CHISE
  terms" (its other files GPLv2) and **Make Me a Hanzi** `dictionary.txt` is
  LGPL, derived from Unihan and cjklib with an unverified chain, so they stay
  local in `plugins/data-local/` and are never committed or put in the image.
  Prepare one yourself with
  `node scripts/prepare-ids-components.mjs <ids.txt> plugins/data-local/zh-components --id zh-components --license "<as stated>" --attribution "<who, with a link>"`
  and seed `plugins/data-local`; the pack carries the licence its source states.
- **KRADFILE / RADKFILE** (EDRDG, CC BY-SA): the licence family fits, but the
  canonical file and EDRDG's current statement could not be fetched and
  checked when this was built; a later option.

## Level lists

The character map groups by, and entries carry badges from, installed level
schemes (the map reads each scheme's per-level characters from
`GET /api/schemes/{id}/characters`). Six are bundled: two derived from bundled dictionaries (below), HSK 3.0 characters and
words, generated by `scripts/prepare-hsk-syllabus.mjs` from the official syllabus (see "Chinese:
HSK 3.0" below), the estimated JLPT words, generated by `scripts/prepare-jlpt-words.mjs` from four
bundled packs and the project's lists (below), and the approximate JLPT kanji, generated by `scripts/prepare-level-packs.mjs` from
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
- **JLPT words (approximate)** (`jlpt-words`, unit `word`; bundled, #219): an
  **estimate** built by qinqin, labelled "≈ N5" … "≈ N1" in the app. No official
  JLPT vocabulary list has been published since 2010. Levels ≈ N5 509, ≈ N4 1,475,
  ≈ N3 3,778, ≈ N2 2,599, ≈ N1 1,638 words, 9,999 in all.
  - Inputs, no published JLPT list copied: the Jiten frequency ranks
    (`jiten-frequency`, CC BY-SA 4.0, Jitensoft), JMdict (`jmdict`, CC BY-SA 4.0,
    EDRDG) for the words, readings and priority tags, the JLPT kanji levels
    (`jlpt-kanji`: kanjiapi.dev, MIT, and KANJIDIC2, CC BY-SA 4.0), the jōyō kanji
    (`joyo-grades`, KANJIDIC2) and three short lists written for qinqin under
    CC BY 4.0 (`scripts/jlpt-words/`, credit "qinqin contributors, CC BY 4.0"):
    `core.tsv` (538 N5/N4 textbook words, reviewed by agents), `grammar.tsv`
    (grammar pieces left out) and `anchors.tsv` (the regression check). The pack
    is an adaptation of the Jiten ranks and JMdict, so it is **CC BY-SA 4.0**
    (`LICENSE` is the legal code); kanjiapi.dev's MIT notice ships beside it as
    `LICENSE-kanjiapi.dev`.
  - Method (`scripts/prepare-jlpt-words.mjs`, rules set by the #219 teacher
    review of 2026-11-27): one Jiten rank is matched to the JMdict entry that has
    most of its rows as a written form with that reading (unmatched ranks are
    listed in `UNMATCHED.tsv`, never guessed). The core list sets the level of
    its words directly. Grammar pieces and expressions, set phrases, numerals
    with counters (十人, ５分), particles, noise (あああ, っつ) and one-kana
    fragments are left out. Otherwise **frequency is the primary signal**: Jiten
    rank ≤ 1,288 ≈ N5, ≤ 2,196 ≈ N4, ≤ 4,927 ≈ N3, ≤ 7,663 ≈ N2, ≤ 10,249 ≈ N1. Harder
    kanji raise a word by one level at most, and not at all when JMdict gives it a
    priority tag; kana, usually-kana, ateji and non-jōyō spellings (綺麗) count as
    kana words. A word on JMdict's basic list (ichi1) among its most frequent
    newspaper words goes one or two levels easier, to ≈ N3 at most, which counters
    the media skew of the Jiten ranks (銀行, 郵便局 rank low there); such words are
    in even beyond the last cut. Outside the core a word is ≈ N4 or harder, except
    kana pronouns and conjunctions (これ, でも); slang, colloquial words and
    interjections not on JMdict's basic lists are ≈ N3 or harder.
  - Why: the first estimate (v0.9.0, the harder of the kanji level and the rank
    level) put basic words far too hard (嫌い, 暑い, 誕生日 and 大丈夫 at ≈ N1, 銀行
    and 野菜 at ≈ N2), because the JLPT kanji estimate puts many everyday kanji at
    N1 (暑, 嫌, 僕, 傘, 誕, 丈: kanjiapi.dev's list follows the pre-2010 four-level
    scale, where these were level 1; 椅, 鍵, 誰, 箸 are grade-8 jōyō kanji its gap
    fill puts at N1). That is the kanji estimate's design, not a bug: a kanji
    *written* is harder than the word *spoken*. The word rules now limit the
    kanji's effect instead. The teachers' suggested caps (any nf01–nf06 word at
    most ≈ N4, any news1/ichi1/spec1 word at most ≈ N3) were measured too: they
    cap about 1,600 and 6,300 of the list's words, against 1,500 and 3,700 words
    commonly cited up to those levels, and fill them with newspaper terms (首相,
    民間), so the lift above replaced them.
  - Evaluation (no ground truth; numbers of 2026-11-28): 81 of 81 anchor words at
    or under their allowed level; the core words placed by the rules alone (the
    core switched off) 73.0% within one level; three blind spot checks by two
    native-Japanese teacher agents each, 184 words in all: on the last, fully
    out-of-sample one (60 words), 83% and 80% of the words the list puts at ≈ N5 or
    ≈ N4 are within one level of the teacher's level, and every word a teacher puts
    at N5 or N4 is within one level in the list (22 of 22). The first estimate got
    under half of its N5/N4 spot checks within one level. A word can be a level
    off; treat a level as a rough guide. `node scripts/prepare-jlpt-words.mjs
    --calibrate` prints the fit and the checks; the numbers are also beside the
    constants in the script and in the #219 plan.
  - Optional base list (not used): Jonathan Waller's JLPT lists (tanos.co.uk),
    which reuse projects describe as CC BY. The site could not be reached and
    no archived copy could be checked here, so the licence is unconfirmed and
    the list is not used (owner, 2026-11-26). The generator reads one with
    `--base <dir>` (n5.csv … n1.csv with `expression` and `reading` columns, the
    format of open-anki-jlpt-decks, plus its `LICENSE`): base words are matched to
    JMdict by form and reading (unmatched and ambiguous words reported per level)
    and keep their level, the estimate fills the rest, and `--calibrate --base`
    fits the cuts on 80% of the base words and reports the agreement on the 20%
    held out. That is a maintainer step once the licence is confirmed (the #219
    plan's local follow-up). The former local-only `jlpt-words` pack ("JLPT
    (vocabulary)", `prepare-level-packs.mjs --jlpt-vocab`) is gone: the bundled
    pack has its id.

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
  different split. No 小学/初中/高中 split is offered (see "Level lists considered and not offered").
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
  carries a copy-protection flag (copy: no, change: no). The `hsk-words`
  pack includes only the vocabulary (word) list and the `hsk-chars` pack only
  the list of characters to recognise (认读字), as plain lists of words and
  characters with their levels (and the words' pinyin as lookup readings);
  neither includes the syllabus's descriptions, task and topic lists, the
  lists of characters to write or explanatory text. The Chinese grammar pack
  (`zh-grammar`), when installed, is listed separately under Grammar lessons
  and uses the syllabus's grammar outline as a topic index, reproducing no
  syllabus text. It includes these lists with
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

The JLPT lists are not official releases (the word list is qinqin's estimate); the HSK 3.0 word and character
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
| **Wikimedia Commons** pronunciation files (zh, ja) | Licence per file, machine-readable through the API (`prop=imageinfo&iiprop=extmetadata`: `LicenseShortName`, `LicenseUrl`, `Artist`). Samples: `File:Zh-nǐ.ogg` "CC BY 2.0 fr" (Wei Gao, Vion Nicolas); `File:Zh-shi4.ogg` "CC BY-SA 2.0 uk", noted "not a native Mandarin speaker"; `File:Zh-ma1.ogg` missing. Re-checked 2026-11-25 over all expected syllable titles: 301 files exist, 224 CC BY-SA 3.0 us, 51 CC BY-SA 3.0, 17 CC BY-SA 2.0 uk, 9 CC BY 2.0 fr, 50 without an author. | **LOCAL-ONLY** tool with a per-file licence allow-list (see Rulings) |
| **Lingua Libre** (cmn 4,108, jpn 5,616 files on Commons) | Checked 2026-11-25 through the Commons API for cmn: 2,976 files "CC BY-SA 4.0" and 1,132 "CC0", none other, every file with an author (jpn not re-checked). Whole-word coverage of HSK 1-4: 1,100 of 1,992 words. Details: `docs/superpowers/specs/2026-11-26-v080-data-sources.md`. | **BUNDLE-eligible** for cmn (licence), not built yet (needs a maintainer-built pack, see the spec); **LOCAL-ONLY** through the Commons tool until then |
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
- **File mapping:** the data repository's `examples-audio/README.md` (pinned by
  SHA-256 in the fetch script) documents it: the files are named by the kanji's
  `kname` prefix plus a suffix `a` to `l` "in alphabetical order" matching the
  readings listed in the `examples` column, and `_06_` is the same in every name.
  The top-level README does not say this. The build also checks it against the data
  it downloads: 10,156 example words and 10,156 files, every kanji has exactly as
  many files as examples, and the file size follows the length of the word's reading
  (correlation 0.78 over all clips, 0.21 when each kanji's files are rotated by one
  position, about 0 for a random pairing). This is evidence from the documentation
  and the data, not from listening.
- **Credit and changes:** the licence text, a link to
  https://creativecommons.org/licenses/by/4.0/ and the names Harumi Hibino Lory and
  Arno Bosse (the Kanji alive credits page lists them as director and assistant of
  the project; the repository's licence file names only "Kanji alive") appear in the
  pack's `ATTRIBUTION.md`, its manifest, on the Sources page and, per recording, as
  a credit line next to the play button. `index.tsv` is marked there as derived from
  `ka_data.csv`; the audio files are unchanged copies.
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

### Level lists considered and not offered

TBCL (臺灣華語文能力基準, NAER) and the mainland school curriculum character tables (小学/初中/高中) were considered and dropped (no redistribution licence; not needed); the old TOCFL 華語八千詞 list (withdrawn in 2021, no licence ever stated) and grade splits copied from textbooks (publisher copyright) were rejected.

## Stroke-order data

- **Hanzi Writer stroke data** (`hanzi-writer-strokes`, fetched at build time):
  stroke-order animation data (`hanzi-writer-data`, derived from the Make Me a
  Hanzi dataset), licensed under the **Arphic Public License** and used
  unmodified.

It is a data pack of type `strokes` (see the wiki's Data-pack-format page), not
part of the web bundle or the binary. `scripts/prepare-strokes-pack.mjs` builds it
from the `hanzi-writer-data` version pinned in `apps/web/package-lock.json` (a
devDependency); the Docker image builds it in its web stage and ships it under
`/opt/qinqin/strokes`, and a checkout builds it into the gitignored
`plugins/data-strokes/` (a default seed root when present):

    npm --prefix apps/web ci
    node scripts/prepare-strokes-pack.mjs --out plugins/data-strokes/hanzi-writer-strokes

The pack carries the package's `ARPHICPL.TXT` as `LICENSE` (the script refuses to
build when it differs from `apps/web/static/ARPHICPL.TXT`) and an
`ATTRIBUTION.md`; both are stored at import and travel inside the
`strokes.hanzi-writer-strokes` data package. The server answers
`/hanzi/U<HEX>.json` from the installed pack, and the Sources page credits it in
its stroke data section (from `GET /api/stroke-packs`). The full licence text is
committed at `apps/web/static/ARPHICPL.TXT` (copied verbatim from the
`hanzi-writer-data` package) and is served by the running app at `/ARPHICPL.TXT`.

Attribution: [Make Me a Hanzi](https://github.com/skishore/makemeahanzi),
[hanzi-writer-data](https://www.npmjs.com/package/hanzi-writer-data).

- **KanjiVG stroke data** (`kanjivg-strokes`, Japanese, fetched at build time; #62): the stroke order of kana, the
  Japanese forms of kanji and the iteration marks (6,614 characters) from
  [KanjiVG](https://kanjivg.tagaini.net), © Ulrich Apel, tag `r20260714`, commit
  `d95a97627fd9fe5b2c8d06ca81e38149609c0c1e`, licensed **CC BY-SA 3.0** (README and `COPYING`, checked 2026-11-26). 3.0 is
  below the project's usual CC BY-SA 4.0 floor; the owner accepted it for KanjiVG on 2026-11-26 (`LICENSING.md`).
  KanjiVG stores each stroke as the centre line of the pen. The pack is an **adaptation**: `scripts/prepare-kanjivg-strokes.mjs`
  samples each path into a median (a short polyline) and widens it by 2.75 KanjiVG units on each side, with round caps,
  into the outline the stroke-data format needs (Hanzi Writer's: strokes and medians in a 1024 box, y up, baseline 900),
  so the writing pad and the stroke player read it like any other strokes pack. Stroke order and direction are
  KanjiVG's own; variant drawings (`-Kaisho` and so on), Latin and symbols are not included. The pack says it was
  changed (manifest `notice`, `ATTRIBUTION.md`) and stays under CC BY-SA 3.0.

It is a data pack of type `strokes` with `languages: ["ja"]`, built by `scripts/fetch-kanjivg-strokes.sh` (a pinned
clone: the tag's commit, the SHA-256 of `COPYING` from `plugins/data/UPSTREAM.sha256` and the README's licence line are
checked, and any difference stops the build) into the gitignored `plugins/data-strokes/kanjivg-strokes`; the Docker
image builds it in its own `kanjivg` stage and ships it under `/opt/qinqin/kanjivg` (`--build-arg WITH_KANJIVG=0`
skips it). The share-alike position of the project: like every BY-SA pack it stays its own data pack, served by the
running server (`GET /hanzi/U<HEX>.json?lang=ja`, `docs/contracts/strokes/`), and is **never** compiled into the Go
binary (`go:embed`), put in the web build or bundled in the Android app. For a character both packs carry, the
language decides which serves it: a Japanese reader gets KanjiVG's shapes, a Chinese one the Make Me a Hanzi shapes.

## Themes

Colour themes are packs of type `theme` (format `themes-json`, see
`docs/contracts/themes/`). These packs are **built into the server binary**
(`server/internal/themes/builtin/<id>/`: `manifest.json`, `themes.json` and the
upstream `LICENSE`, copied verbatim) and are always present; the Sources page
credits them from `GET /api/themes`. Only colour values are taken from each
project (no code, fonts or images); every third-party palette is under the MIT
licence, checked against the upstream LICENSE file on 2026-11-17, and the qinqin
packs are the project's own work under CC BY 4.0 (the full legal code as their
`LICENSE`; credit "qinqin contributors, CC BY 4.0", https://github.com/Elaktrato/qinqin). Each pack's LICENSE
ships inside the server binary and reaches users verbatim: `GET /api/themes`
serves it as the pack's `licenseText`, and the Sources page shows it under the
Themes table. The eight themes of
the approved design use the mockup's values, cross-checked against the
upstream palettes; two mockup values that belonged to another variant are
corrected (Rosé Pine's `pine` accent is `#31748f`, not Moon's `#3e8fb0`; Rosé
Pine Dawn's text is the current palette's `#464261`, not the former `#575279`).

- **qinqin** (`qinqin`, built in): Day, Night, Deep. CC BY 4.0, qinqin contributors. The
  owner's own palette (`#ffffff #0ce6f2 #0098db #1e579c #203562 #252446
  #201533`); the palette has no red, orange or green, so the state and grade
  colours were added beside the blues. Day and Night are the default light and
  dark themes and are also compiled into the web app as the first-paint and
  offline fallback (`apps/web/src/lib/theme/fallback.ts`, pinned to the pack's
  `themes.json` by a test); the web app serves the same CC BY 4.0 text at
  `apps/web/static/QINQIN-LICENSE.TXT` (the pack's `LICENSE`, byte for byte)
  and credits it under "Built into the app".
- **qinqin extras** (`qinqin-extras`, built in): Neon Day and Night, Pigments
  Celadon and Indigo, Pop Bubblegum and Grape. CC BY 4.0, qinqin contributors. Three further
  directions: Neon's ink-grey surfaces with neon accents; Pigments' painter's
  accents 胭脂 rouge, 朱 vermilion, 藤黄 gamboge, 石绿 malachite, 群青
  ultramarine and 紫 violet; Pop's tinted surfaces and clashing
  complementaries.
- **Catppuccin** (`catppuccin`, built in): Latte, Frappé, Macchiato, Mocha.
  MIT, © 2021 Catppuccin. [catppuccin/palette](https://github.com/catppuccin/palette)
  (`palette.json` 1.8.0, commit `07d02aa110ef`). The light flavour uses mantle
  for raised surfaces and surface0 for lines, as in the design.
- **Rosé Pine** (`rose-pine`, built in): Rosé Pine, Moon, Dawn. MIT, © mvllow.
  [rose-pine/palette](https://github.com/rose-pine/palette) (commit `92af52b465ab`).
- **Nord** (`nord`, built in): MIT, © 2016-present Sven Greb.
  [nordtheme/nord](https://github.com/nordtheme/nord) (commit `1cef71605416`).
  The frame (`#242933`) and the secondary text (`#a3adc2`) are shades between
  Nord's colours, as in the design.
- **Gruvbox** (`gruvbox`, built in): the dark theme with the bright accents.
  MIT, © 2018 Pavel Pertsev. Colours from
  [morhetz/gruvbox](https://github.com/morhetz/gruvbox) (`colors/gruvbox.vim`,
  commit `ef8864bb42bf`), whose README and `package.json` state MIT but which
  ships no licence file; the `LICENSE` is the MIT text of the maintained fork
  [gruvbox-community/gruvbox](https://github.com/gruvbox-community/gruvbox)
  (`LICENSE.md`, commit `180ad8597134`), naming the same author.
- **Dracula** (`dracula`, built in): MIT, © 2020 Dracula Theme.
  [dracula/spec](https://github.com/dracula/spec) (`dracula-spec.md`, commit
  `ccf5974d14ec`). Its secondary text colour (Comment) is below 4.5:1 on the
  background, as upstream.
- **Solarized** (`solarized`, built in): Solarized Light and Dark. MIT,
  © 2011 Ethan Schoonover. [altercation/solarized](https://github.com/altercation/solarized)
  (commit `62f656a02f93`). The default accent is magenta, not blue: white
  button text on blue is 3.68:1, on magenta 4.55:1.
- **Tokyo Night** (`tokyo-night`, built in): the Night variant. MIT,
  © 2018-present Enkia. [tokyo-night/tokyo-night-vscode-theme](https://github.com/tokyo-night/tokyo-night-vscode-theme)
  (commit `7c0f11eaef32`; the original theme, not the Apache-2.0 Neovim port).
- **Everforest** (`everforest`, built in): Everforest Dark, medium contrast.
  MIT, © 2019 sainnhe. [sainnhe/everforest](https://github.com/sainnhe/everforest)
  (`palette.md`, commit `85a86eb62409`).
- **Kanagawa** (`kanagawa`, built in): Kanagawa Wave. MIT, © 2021 Tommaso
  Laurenzi. [rebelot/kanagawa.nvim](https://github.com/rebelot/kanagawa.nvim)
  (`lua/kanagawa/colors.lua`, commit `bb85e4bfc8d8`).

Measured contrast (`docs/contracts/themes/README.md`, "Contrast") is reported,
never a reason to leave a theme out; every built-in theme reaches 4.5:1 for
text on its panel and for button text on its default accent. An administrator can add more themes by uploading a theme
pack (Settings → Data), whose review shows the measured contrast.

## Graded readers (Reader, #231)

`server/internal/library/sources/graded/texts/zh.json` and `ja.json` (embedded in the server) are the Reader's graded
readers: 20 Chinese texts (≈ HSK 1–4) and 15 Japanese texts (≈ N5–N3), five a level, stories, dialogues and
informational texts, each with its proper names and the glossed words above its level (a reading and a short English
meaning). The **project wrote them** (CC BY 4.0, credit "qinqin contributors, CC BY 4.0"; `NOTICE`); no third-party
text was copied. They are checked against the bundled word level lists (`hsk-words`, `jlpt-words`) with the shipped
dictionaries (CC-CEDICT, JMdict), which are not part of the files. They were **reviewed by agents acting as teachers,
not yet by a person** (two teachers and an adjudicator per language; notes: `texts/REVIEW.md`); `humanReviewed` stays
`false`. A text added to a library keeps the credit as the book's attribution and licence note; the Sources page credits
them under "Built into the app" (`apps/web/src/lib/sources/coreCredits.ts`). Format: `docs/contracts/graded/README.md`. No pack type (record 0008; plan Ruling 2).

## Reader text sources

The Reader (see `docs/wiki/Reader.md`) imports public-domain works on user request. Nothing
from these sources is bundled; each imported book stores its source link,
attribution, and a licence note, which the Reader shows. The app
credits both sources, and `opencc-js` below, on the Sources page among its own
credits (`apps/web/src/lib/sources/coreCredits.ts`).

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
only when a script conversion is selected. The Sources page credits it (an entry of
`apps/web/src/lib/sources/coreCredits.ts`), and both
licence texts are committed at `apps/web/static/OPENCC-JS-LICENSE.TXT` and
`apps/web/static/OPENCC-APACHE-2.0.TXT` (copied verbatim from the `opencc-js`
package; a web test keeps them identical) and served by the running app at
`/OPENCC-JS-LICENSE.TXT` and `/OPENCC-APACHE-2.0.TXT`.

## Interface font

The interface is set in [Figtree](https://github.com/erikdkennedy/figtree) 2.001
("Copyright 2022 The Figtree Project Authors"), licensed under the **SIL Open Font
License, Version 1.1** with no Reserved Font Name. The app ships the upstream variable
WOFF2 (`fonts/webfonts/Figtree[wght].woff2` at commit
`032dfa7fe219ef3a02890d6d3add84eacc9aebfe`, weights 300–900, 27,676 bytes) **unmodified**
as `Figtree-Variable.woff2` under `apps/web/src/lib/assets/fonts/`; the build emits it as
a hashed asset of the web app, and the service worker precaches it with the rest of the
app. It is never loaded from a third-party host. The licence text is the upstream
`OFL.txt` at the same commit, committed byte for byte at `apps/web/static/FIGTREE-OFL.TXT`
and served by the running app at `/FIGTREE-OFL.TXT`; a web test pins both files' SHA-256.
The Sources page credits it under "Built into the app".

Hanzi and kanji faces are not bundled: they are installable font packs (next section).
Until one is installed, Chinese and Japanese text uses the device's own fonts.


## Icons

The interface's line icons are [Lucide](https://lucide.dev) icons from the npm package
`lucide-static` 1.66.0 (ISC License, "Copyright (c) 2026 Lucide Icons and Contributors"; the icons
Lucide derived from [Feather](https://github.com/feathericons/feather) are under the MIT License,
"Copyright (c) 2013-present Cole Bemis"). Only the shapes of the icons the app uses are copied, by
`apps/web/scripts/vendor-icons.mjs`, into `lucide.ts` under `apps/web/src/lib/ui/icons/`; the app
draws them at a stroke width of 1.5 instead of Lucide's 2 (a modification both licences allow). No
icon package is installed and nothing is loaded from a third-party host. The package's `LICENSE`
(both licence texts and the list of Feather-derived icons) is committed byte for byte at
`apps/web/static/LUCIDE-LICENSE.TXT` and served by the running app at `/LUCIDE-LICENSE.TXT`; a web
test pins its SHA-256. The Sources page credits it under "Built into the app".

## Hanzi and kanji font packs

Sans, Serif and Kai faces for simplified Chinese, traditional Chinese and Japanese come as
packs of type `font` (format `font-slices`, see `docs/contracts/fonts/`): each face cut into
WOFF2 slices by Unicode range, so a page downloads only the slices of the characters it
shows. The packs are **never committed** and no Docker image bakes one (whether the image
should carry a default `noto-sans-sc` is an open owner decision); an administrator builds one
and installs it (Settings → Data upload, or `qinqin seed` with the gitignored
`plugins/data-fonts/` as a pack root):

    npm --prefix scripts/fonts ci      # the subsetter, a build-time tool of the script only
    node scripts/prepare-font-pack.mjs --source klee-one --out plugins/data-fonts/klee-one

Every source is pinned in `scripts/prepare-font-pack.mjs` (URL at a commit or release, the
SHA-256 of each font file and of its `OFL.txt`); the script refuses to build when a download
differs. Each licence text was compared with the canonical SIL OFL 1.1 text on 2026-11-17.

| Pack | Face | Original | Licence |
|---|---|---|---|
| **qinqin Sans SC** (`noto-sans-sc`) | Sans, simplified Chinese | Noto Sans SC, [google/fonts](https://github.com/google/fonts) `ofl/notosanssc` at `7af0d90b4d53` (upstream [notofonts/noto-cjk](https://github.com/notofonts/noto-cjk)) | SIL OFL 1.1; "Copyright 2014-2021 Adobe, with Reserved Font Name 'Source'" |
| **qinqin Sans TC** (`noto-sans-tc`) | Sans, traditional Chinese | Noto Sans TC, same commit | SIL OFL 1.1 (as above) |
| **qinqin Sans JP** (`noto-sans-jp`) | Sans, Japanese | Noto Sans JP, same commit | SIL OFL 1.1 (as above) |
| **qinqin Serif SC** (`noto-serif-sc`) | Serif, simplified Chinese | Noto Serif SC, same commit | SIL OFL 1.1; "Copyright 2012 Google Inc." |
| **qinqin Serif TC** (`noto-serif-tc`) | Serif, traditional Chinese | Noto Serif TC, same commit | SIL OFL 1.1 (as above) |
| **qinqin Serif JP** (`noto-serif-jp`) | Serif, Japanese | Noto Serif JP, same commit | SIL OFL 1.1 (as above) |
| **qinqin Kai SC** (`lxgw-wenkai`) | Kai, simplified Chinese | LXGW WenKai Regular, [lxgw/LxgwWenKai](https://github.com/lxgw/LxgwWenKai) release v1.530 | SIL OFL 1.1 with Reserved Font Names '霞鹜', '霞鶩', '落霞孤鹜', '落霞孤鶩', 'LXGW' and an additional permission for unrenamed web subsets (not relied on: the slices are renamed) |
| **qinqin Kai JP** (`klee-one`) | Kai (textbook style), Japanese | Klee One Regular and SemiBold, google/fonts `ofl/kleeone` at `7af0d90b4d53` (upstream [fontworks-fonts/Klee](https://github.com/fontworks-fonts/Klee)) | SIL OFL 1.1; "Copyright 2020 The Klee Project Authors" |

Every slice is a **Modified Version** under the OFL (subset and converted), so the script
renames it: family, full, PostScript and unique names become `qinqin <Face> <SC|TC|JP>`,
the copyright and licence entries are kept unchanged, and the trademark, vendor, designer
and description entries are dropped; a test checks that no slice name keeps "Noto",
"Source", "LXGW", "Klee" or LXGW's Chinese Reserved Font Names. The pack carries the
original's `OFL.txt` byte for byte as `LICENSE` and an `ATTRIBUTION.md` naming the original,
its authors and the modification; the Sources page credits each installed pack from
`GET /api/fonts`. The original names appear only in these credits, as the OFL allows.
The slice table (`scripts/testdata/font-slices.json`) is generated from the bundled level
lists `tgh-chars`, `joyo-grades` and `jlpt-kanji` (traditional forms through `opencc-js`);
it contains character lists only. LXGW WenKai TC (a separate repository) is not packed:
its licence has not been verified yet.

The script's build-time tools (`scripts/fonts/package.json`, never part of the app or the
image): [subset-font](https://github.com/papandreou/subset-font) (BSD-3-Clause) with
[harfbuzzjs](https://github.com/harfbuzz/harfbuzzjs) (MIT; HarfBuzz is under the Old MIT
licence), [fontverter](https://github.com/papandreou/fontverter) (BSD-3-Clause) with
[wawoff2](https://github.com/fontello/wawoff2) (MIT; Google's WOFF2 encoder).

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

## Pictures

Visual aids (issue #212) add no data: pictures are shown from the packs below, tone colours are drawn from the pinyin readings already in the dictionaries, and character anatomy reads the installed components packs (see "Character components") and the dictionary glosses.

Bundled pictures for words (issue #216): two **images packs**, each its own pack with its licence, notice and
credit. They are data packs of type `images` (see the wiki's Data-pack-format page and
`docs/contracts/images/README.md`), fetched at image build time, never committed, never compiled into the binary and
never bundled in the web build or the APK's web assets: the web app and the APK get pictures from the server
(`GET /api/images/entries/{id}`, and for offline use the server-built data package `images.<packId>`, #274, which
the device keeps under the pack's licence and notice). Licence evidence checked 2026-11-25 against the upstream files.

| Pack | Upstream | Licence | Pictures | Word mappings |
|---|---|---|---|---|
| `images-openmoji` | [OpenMoji](https://openmoji.org) 17.0.0, black-outline SVGs (`openmoji-svg-black.zip`, 3,702,558 bytes) | CC BY-SA 4.0 (README and `LICENSE.txt`) | 967 (1.7 MB of SVG) | 3,165 (zh 1,935, ja 1,230) |
| `images-mulberry` | [Mulberry Symbols](https://mulberrysymbols.org) v3.6.1 by Steve Lee (`mulberry-symbols.zip`, 52,347,398 bytes; 3,435 symbols) | CC BY-SA 4.0 (website and `LICENSE.txt`: "Copyright 2018-2026 Steve Lee ... Creative Commons Attribution-Share Alike License", link to `by-sa/4.0`), not 2.0 UK as an older note said | 707 (4.6 MB of SVG, in colour) | 2,315 (zh 514, ja 1,801) |

- **Credit** (shown on the Sources page and in each pack's `ATTRIBUTION.md`): OpenMoji's own wording, "All emojis
  designed by OpenMoji – the open-source emoji and icon project. License: CC BY-SA 4.0"; Mulberry's, "Mulberry Symbols
  by Steve Lee are licenced under the Creative Commons Attribution-ShareAlike 4.0 License". Every picture is also
  credited in the pack's `pictures.tsv` (OpenMoji's designer per emoji) and next to the picture where the app draws it.
- **Pins:** `scripts/images/pins.json` (upstream URLs, SHA-256 and sizes of every file used: the two zips,
  `data/openmoji.json`, `symbol-info.csv`, the OpenMoji `LICENSE.txt` that carries the CC BY-SA 4.0 legal code, the
  Mulberry `LICENSE.txt` inside the zip, and the CLDR files below). A mismatch stops the build.
- **ShareAlike.** Both sets are CC BY-SA 4.0 and so is anything adapted from them: the pack says so, and the
  recoloured copy the web app draws (the black outline takes the text colour; the file itself is never modified) is
  covered by the same licence. The position this project takes (owner-unconfirmed, flagged in the #216 plan): the
  pictures are a collection next to the MIT code, as the dictionaries are; to keep that true each set stays in its
  own pack directory with its licence text, is never `go:embed`ded (a Dockerfile test checks this), and is not part of
  the web build. Whether pictures inside an Android APK's assets would be more than a collection is unsettled (see
  the v0.8.0 data-sources audit); the APK's web assets carry none, it asks the server.
- **The mapping** (`scripts/images/<pack>/map.tsv`, committed, 130 KB and 98 KB) is derived data: the Unicode CLDR
  emoji annotations of Chinese and Japanese (CLDR 49.0.0, Copyright Unicode, Inc., [Unicode License v3](https://www.unicode.org/license.txt);
  the annotations' names and keywords), the English glosses of CC-CEDICT and JMdict, OpenMoji's English annotations
  and tags, and Mulberry's English symbol names; it is distributed with the packs under CC BY-SA 4.0 and carries the
  Unicode notice. `scripts/build-picture-map.mjs` makes it (rules in `scripts/picture-match.mjs`, tested); 92 rows are
  hand-checked overrides (`scripts/images/openmoji/manual.tsv`). Only words an unambiguous match covers have a
  picture. The doubtful automatic rows of the Starter words, HSK 1-2 and ≈ N5-N4 (532) were reviewed by teacher
  agents (#274, `scripts/images/review/`, not yet by a person): 262 removed (`scripts/images/<pack>/removed.tsv`), 14
  changed to another OpenMoji picture (manual rows; 106 in all now), 256 kept. For Chinese, Mulberry covers only words of the HSK 3.0 word list (a
  selection gate at build time; no list data is copied); for Japanese, only JMdict words with a priority marking.
- **Mulberry** pictures with a `<style>` or another element outside the drawing vocabulary (346 of 3,435) are left out: the server accepts drawings only.
- **Quality.** About 90% of a 60-word sample of the automatic OpenMoji rows was right at a glance; wrong ones are
  mostly a homonym or a near meaning (a "dress" for clothing). The base sets for the Starter mode (#214) are
  described under "Starter sets" (146 and 145 words, reviewed by agents, not yet by a person; every Starter word's
  picture was looked at, and the doubtful rows it found are listed in `server/internal/starter/sets/REVIEW.md`).
- **Not bundled:** ARASAAC (CC BY-NC-SA, non-commercial); Wikimedia Commons pictures via Wikidata (per-file
  licences, later); OpenMoji's colour set (a later per-user choice).

Build a pack into the gitignored `plugins/data-images/` (a default seed root when present) with

    node scripts/prepare-images-pack.mjs --pack openmoji --out plugins/data-images/images-openmoji
    node scripts/prepare-images-pack.mjs --pack mulberry --out plugins/data-images/images-mulberry

(needs Node 22 or newer and `unzip`; the Docker image does it in its `images` stage, `--build-arg WITH_IMAGES=0`
skips it, and ships the packs under `/opt/qinqin/images`). `node scripts/build-picture-map.mjs --cache <dir>
[--report <dir>]` rebuilds the mappings after a new pin or a changed dictionary.

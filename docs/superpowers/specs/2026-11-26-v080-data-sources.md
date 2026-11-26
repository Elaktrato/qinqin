# v0.8.0 data sources: licence and feasibility audit (#133, #62, #237, #216)

Status: audit done 2026-11-25 (all upstream pages and files read that day from this environment). Part B
(what was built) is at the end. **Not legal advice.** Items marked *needs owner confirmation* are decisions, not
facts.

The rule (owner): bundle only data under CC BY-SA 4.0 or more permissive, with notices; check every
licence at download time from the source's own pages and files; a source that fails stays out of the repo or
becomes a gitignored local-only fetch script.

## Summary

| Issue | Source | Licence verified | Passes the rule | Size | Verdict |
|---|---|---|---|---|---|
| #133 | Tatoeba export 2026-11-21 (sentences, links, tags, user data) | CC BY 2.0 FR; part CC0 1.0 (downloads page + terms of use) | Yes (BY is more permissive than BY-SA) | zh 12.8 MB raw / 3.4 MB gzip, ja 21 MB raw | **Bundled** (done) |
| #62 | KanjiVG r20260714 | CC BY-SA **3.0** (README, COPYING) | Not literally (3.0, not 4.0); same terms, 3.0 allows adaptation under later versions; already bundled as `kanjivg-components` | zip main 12.7 MB, xml.gz 3.6 MB | **Bundle eligible, owner confirms the 3.0 precedent; not built** (needs a new stroke format and player) |
| #237 | Commons: Lingua Libre words (cmn) | per file via API: 2,976 CC BY-SA 4.0 + 1,132 CC0 of 4,108 files, all with an author | **Yes, every file** | not measured (see below) | **Bundle eligible** as a pinned release asset; not built |
| #237 | Commons: `Zh-<pinyin><tone>.ogg` syllables | per file: 224 CC BY-SA 3.0 us, 51 CC BY-SA 3.0, 17 CC BY-SA 2.0 UK, 9 CC BY 2.0 FR; 50 of 301 without an author | **No** for 2.0 UK (and 3.0 by the literal rule); only 301 of about 1,300 syllables exist | small | **Local-only** (existing tool), skip for bundling |
| #216 | OpenMoji 17.0.0 | CC BY-SA 4.0 (README, `LICENSE.txt`) | **Yes** | svg-black zip 3.7 MB, 4,495 entries | **Bundle eligible**; not built (needs the `images` pack type) |
| #216 | Mulberry Symbols v3.6.1 | CC BY-SA **4.0** (website, `LICENSE.txt`) | **Yes** (the issue's "2.0 UK" is outdated) | release zip 52 MB, 3,435 symbols | **Bundle eligible**; not built |

## #133 Tatoeba

- **Sources:** `https://downloads.tatoeba.org/exports/` (weekly, Saturday 06:30 UTC): `sentences_detailed`,
  `sentences_CC0`, `links`, `tags`, `user_languages` (all `.tar.bz2`) and `users_sentences.csv`. Export of
  2026-11-21 pinned in `server/tools/tatoeba/pin.json` with SHA-256 of every file.
- **Licence evidence.** `https://tatoeba.org/en/downloads`: "These files are released under CC BY 2.0 FR. A part
  of our sentences are also available under CC0 1.0." and "Many of the Japanese and English sentences are from
  the Tanaka Corpus, which belongs to the public domain." Audio: "The license covering an audio file is chosen
  by the contributor" (audio stays out). `https://tatoeba.org/en/terms_of_use` 6.2: "Tatoeba's technical
  infrastructure uses the default Creative Commons Attribution 2.0 France license (CC-BY 2.0 FR) for the use of
  textual sentences. The BY mention implies a single restriction ...: a condition of attribution", i.e. the
  author's name must be cited. The exports carry no per-row licence column, so "every row is CC BY 2.0 FR" is
  Tatoeba's statement, not something checkable per row; the tool refuses any export whose column layout changes.
- **Verdict:** passes (CC BY and CC0 are more permissive than BY-SA 4.0). The packs mix CC BY 2.0 FR and CC0
  sentences with readings generated from CC-CEDICT / JMdict (CC BY-SA 4.0), so each pack is labelled accordingly.
- **Attribution:** per-sentence `credits.tsv` (id, page, licence, owner, same for the translation), the manifest
  attribution, `ATTRIBUTION.md`, `LICENSE` (the CC BY 2.0 FR URI plus the CC0 legal code) and the Sources page
  notice.
- **Two upstream changes found at pin time, fixed in the tool** (tests added): `users_sentences.tar.bz2` is gone (404,
  the export is now the plain `users_sentences.csv`; `pin.json` points to it), and `user_languages` profile texts
  contain backslash-escaped line feeds inside a field, which the strict reader rejected as a format change.
- **Numbers:** zh 89,325 sentences read, 32,810 bundled under 20,226 words (100% of those link to CC-CEDICT
  words, pinyin on 68.4%); ja 249,006 read, 55,871 bundled under 28,100 words (99.6% link, kana on 72.1%).
  100,110 Japanese sentences were dropped as orphans (no owner), by the existing rule, which includes much of the
  Tanaka corpus; relaxing it is a rules decision, not a licence one. Raw sizes: 12.8 MB + 21 MB; a full
  `qinqin seed` of `plugins/data` took 3 min 20 s here (whole seed, not just the sentences), data directory
  440 MB.
- **Share-alike:** see "Share-alike" below.

## #62 KanjiVG (Japanese stroke order)

- **Sources:** `https://github.com/KanjiVG/kanjivg` release r20260714 (2026-07-14): `kanjivg-20260714-main.zip`
  (12,650,667 bytes), `-all.zip` (22,674,264), `-stripped.zip` (19,334,140), `kanjivg-20260714.xml.gz`
  (3,608,635). README: "KanjiVG is copyright Ulrich Apel and released under the Creative Commons
  Attribution-Share Alike 3.0 licence: http://creativecommons.org/licenses/by-sa/3.0/ See the file COPYING."
- **Rule:** BY-SA 3.0 is not literally "4.0 or more permissive". The terms are the same share-alike family; CC's
  compatibility page says an adaptation of a BY-SA 3.0 work may be licensed under BY-SA 3.0 "or later". The
  project already ships a 3.0 derivative (`kanjivg-components`). *Needs owner confirmation* that 3.0 stays
  acceptable here.
- **Unchanged vs converted:** the issue prefers serving unmodified SVGs. KanjiVG has centre lines only; the
  existing `strokes` format (hanzi-writer JSON) needs outline polygons, so it cannot be produced from it. A
  KanjiVG pack needs a new `strokes` format (for example one unmodified SVG per character in a jsonl.gz) and a
  player that animates centre lines (path length dash-offset). Server importer and registry change plus a web
  engine change: a feature, not a data fetch. Not built.
- **Size:** about 6.7k kanji and kana SVGs; the main zip is 12.7 MB, roughly the size of the Hanzi Writer pack.
- **Obligations:** keep the copyright notice and the author's name, link the licence, mark changes (COPYING 4(c)),
  show it on the Sources page and in `ATTRIBUTION.md`; derived or converted data stays BY-SA 3.0.
- **Recommendation:** bundle unmodified through the Docker web stage like the Hanzi Writer pack (pinned tag and
  commit, hash-checked), after the format and player are designed.

## #237 Mandarin recordings

- **Lingua Libre words** (`Category:Lingua Libre pronunciation-cmn`, 4,108 files). Commons API
  (`prop=imageinfo&iiprop=extmetadata`) on 2026-11-25: **2,976 "CC BY-SA 4.0", 1,132 "CC0", none else; every file
  has an Artist.** The Commons Lingua Libre page itself states only "Files are available under licenses specified
  on their description page", so the per-file value is the evidence; it must be re-read at snapshot time.
  3,492 distinct words; whole-word coverage of the official HSK 3.0 lists: HSK 1 202/300, HSK 2 83/198,
  HSK 3 250/497, HSK 4 565/997 (1,100 of 1,992, 55%), HSK 5 206/1,591, HSK 6 506/1,792, HSK 7-9 699/5,584.
- **Syllables** (`File:Zh-<pinyin><tone>.ogg`): of 2,610 expected titles only 301 exist: 224 "CC BY-SA 3.0 us", 51
  "CC BY-SA 3.0", 17 "CC BY-SA 2.0 uk", 9 "CC BY 2.0 fr"; 50 have no Artist. Fails the rule as written (2.0 UK
  is a ported older version; CC's page lists compatibility for "ported versions of the same or later version"
  only), and the coverage is too thin to play words syllable by syllable. **Keep local-only**, as the existing
  tool does with its allow-list.
- **Build:** the existing tool downloads at one request per second: about 4,100 clips would need over an hour
  and cannot run inside every Docker build. Recommended: a maintainer builds the pack once (pinned
  revision, sha1, licence, author per file in `index.tsv`), attaches it as a release asset and the Docker audio
  stage fetches it by sha256, like Kanji alive's zip. That needs a new `scripts/` step (snapshot with
  revision/sha1 and a diff against the previous one) and the playback order in the issue (word, then syllables with
  tone sandhi, then device voice); with the syllables out, the order is word, then device voice. Not built:
  it needs the maintainer's one-off long download and a hosting decision.
- **Obligations:** CC BY-SA 4.0 requires the creator credit, a licence link and a change note; CC0 none (credit
  anyway). Each clip's credit shows where it plays, as for Kanji alive.

## #216 Pictures

- **OpenMoji** 17.0.0 (2026-04-23). README: "OpenMoji graphics are licensed under the Creative Commons Share
  Alike License 4.0 (CC BY-SA 4.0)"; code under LGPL-3.0 (not used). `LICENSE.txt` is the CC BY-SA 4.0 legal code.
  Suggested credit: "All emojis designed by OpenMoji - the open-source emoji and icon project. License: CC
  BY-SA 4.0". Assets: `openmoji-svg-black.zip` 3,702,558 bytes, `openmoji-svg-color.zip` 5,383,430;
  `data/openmoji.json` has 4,495 entries with annotation, tags and author. **Passes.**
- **Mulberry Symbols** v3.6.1 (2026-08-21). Website: "These symbols are published under the Creative Commons
  BY-SA 4.0 licence" with credit "Mulberry Symbols by Steve Lee are licenced under the Creative Commons
  Attribution-ShareAlike 4.0 License"; repository `LICENSE.txt`: "Copyright 2018-2026 Steve Lee ... Creative
  Commons Attribution-Share Alike License ... https://creativecommons.org/licenses/by-sa/4.0/". The issue's note
  (2.0 UK; one listing 4.0) is out of date: the current official sources say 4.0 and the release's `package.json`
  "ISC" refers to the build scripts. 3,435 symbols in `symbol-info.csv` (with grammar class, tags, English and
  French names); zip 52,347,398 bytes (I could not complete the download here, so the zip's file list is
  unchecked). **Passes.**
- **Commons via Wikidata:** per file; not audited, later. **ARASAAC:** CC BY-NC-SA, excluded.
- **Share-alike reaches our recoloured SVGs** (adaptation): the images pack must say so.
- **Build:** a new `images` pack type (migration, type package, datapkg row, importer, `/api` route, Sources
  credit) plus a mapping format and the CLDR annotation matcher. A large feature; the pack builder would take the
  pinned release zips, keep only mapped files, recolour from theme tokens at render time (CSS), not in the file.
  Not built here.

## Share-alike: a reasoned position (needs owner confirmation)

1. **Data packs carry the data's licence.** A pack that contains BY-SA 4.0 (or 3.0) material, or adaptations of it
   (recoloured OpenMoji, converted KanjiVG, readings generated from CC-CEDICT/JMdict), is distributed under
   that licence: the pack's `LICENSE`, `ATTRIBUTION.md` and manifest say so (as today for dictionaries).
2. **The code stays MIT.** BY-SA 4.0 s.3(b) imposes share-alike on "Adapted Material" (a modification of the
   licensed material). A program that reads a separate data file and shows it, shipped in the same image or APK
   next to it, does not modify the data: it is a collection (the licence's own term, and the same position
   LICENSING.md already takes for CC-CEDICT, JMdict and KANJIDIC2). The MIT code is not an adaptation and is
   not relicensed.
3. **Boundaries that keep this true:** keep each BY-SA dataset in its own pack directory with its licence text
   and notice; never merge the data into source files or compile it into the binary (`go:embed` of a BY-SA
   file is the grey zone, which is why packs, not embedded files, are the pattern; the CC BY 4.0 lemma table is
   the only embedded content and is the project's own); the APK and image are a compilation and must carry the
   notices (Sources page does); do not add technical measures that stop a user from reusing the data.
4. **What I could not settle:** whether embedding BY-SA pictures in the Android APK's assets could be read as
   more than a collection, and the effect of mixing CC BY 2.0 FR sentences with BY-SA readings in one file
   (treated as one BY-SA-labelled pack with the original per-sentence credits kept). Ask a lawyer if either
   matters to a release.

## Part B: what was built

- **#133:** pinned the 2026-11-21 export (licence statement and date recorded in `pin.json`), fixed the two upstream
  format changes in the tool with a test, generated and committed `zh-sentences-tatoeba` and
  `ja-sentences-tatoeba`, checked that both seed (`qinqin seed`: no unknown words skipped) and updated
  `docs/sources.md` and the wiki. The Dockerfile already copies `plugins/data`, so the image carries them.
- **#62, #237, #216:** licence audit and recommendation only. The data passes (#237 Lingua Libre words, #216 both
  sets, #62 under the 3.0 precedent), but each needs infrastructure beyond a fetch script (a new stroke
  format and player; a maintainer-built pack with a hosted asset; a new `images` pack type), so no data was
  added and the existing local-only Commons tool is unchanged.

## Review fixes (v0.8.0)

Independent review, attribution findings (branch `fix/v080-attribution`).

### Tatoeba per-sentence credit (finding 4)

The review was right: `credits.tsv` held ids and owners with no key to join to a displayed sentence, and the only
in-app route was a GitHub blob that does not exist before the branch reaches `main`. Fixed in the data, the importer,
the API and the UI.

- Ruling: each pack sentence carries its Tatoeba id (`id` in `sentences.json`), and a `credits` map of the same file
  gives per id the owner, the translation's id and the translation's owner (`by`, `tid`, `tby`) — one credit per
  sentence however many words list it (a sentence is filed under several words), so the repeat costs an integer, not a
  name — a map beside the entries keeps the one-group-per-line diff and grows the two files by about 1.7 MB gzip in
  total (measured, below); cost if wrong: the pack format gains two fields
  that other pack authors may ignore (a pack without ids is read as before).
- Ruling: the importer stores the credit in four columns of `sentences` (migration 054) and a changed credit updates
  the row in place (same id, so sentence cards keep it) — the sentence API (`GET /api/entries/{id}`,
  `POST /api/entries/{id}/sentences`) serves it as `credit` `{source, id, owner, url, translationId, translationOwner,
  translationUrl}`, omitted when a sentence has none — credits that ship inside the installed pack data work offline and
  need no GitHub; cost if wrong: four columns on a table that a later sentence source would reuse (source is fixed to
  "Tatoeba" in the server for now, which a second credited source would have to generalise).
- Ruling: no contract version bump — `credit` is an additive optional field of the entry answer, which no
  `docs/contracts` fixture covers; the sync pull ships own sentences only and is unchanged (the key is omitted) —
  keeps contract 10 free for the other fix branches; cost if wrong: a client that validates entry answers strictly
  would reject the new key (none does).
- Ruling: the app shows "Tatoeba · <owner>" (link to `https://tatoeba.org/sentences/show/<id>`) and
  "translation <owner>" (link to the translation's page) in small muted text under every Tatoeba sentence on the entry
  page, and under the answer of a sentence card; the Share text carries the credit with both links — the BY condition
  names the author, and the translation has its own author; cost if wrong: one more small line per example.
- Ruling: `credits.tsv`, the manifest attribution and the Sources page entry stay as the aggregate list; their wording
  now says the app shows each credit — the owner asked for the aggregate to remain; cost if wrong: 8.2 MB + 4.9 MB
  duplicate data in the repository (the TSV is derived from the same rows).
- Sizes (committed files, raw / gzip -9): `zh-sentences-tatoeba/sentences.json` 7,870,976 / 2,764,249 -> 10,384,518 /
  3,437,857; `ja-sentences-tatoeba/sentences.json` 13,500,518 / 3,730,981 -> 17,564,215 / 4,698,544; `credits.tsv`
  unchanged (4,875,264 and 8,213,396). Both are under the tool's 24 MiB per-file cap. The packs were regenerated from
  the pinned export (re-downloaded; the old-code build first reproduced the committed packs byte for byte); 49,130
  Mandarin pack sentences, every one credited after `qinqin seed` (0 unknown words skipped).
- Not done: the offline data package (`qqpkg`, format 1) of a sentence pack does not carry the credit columns —
  changing a documented format 1 is an owner decision (see the questions below).

### Starter sets (finding 5)

- Ruling: the Starter word lists stay CC0 1.0 and `LICENSING.md` now names them as a second CC0 exception next to the
  script charts — they are the project's own selection (words, order, one-word glosses, picture pairing) and copy no
  third-party text; the dictionary entries and pictures they name keep their own licences; cost if wrong: if the owner
  wants CC BY 4.0 for everything but the charts, two JSON files change their `license` string and the sentence in
  `LICENSING.md`.
- Ruling: the package doc no longer says "hand-reviewed", and `docs/sources.md` gains a "Starter sets" section saying
  `humanReviewed: false`, 47 (zh) and 55 (ja) words against the issue's 100-300, and the stale "still need hand
  review" line points to it — the files and the prose now agree; cost if wrong: none (wording).
- Owner confirmation needed: CC0 for the Starter lists, and whether to ship them at 47/55 words unreviewed.

### Picture-map notices (finding 6)

- Ruling: `NOTICE.md` (licence CC BY-SA 4.0, the sources the rows derive from, the changes) and
  `LICENSE-UNICODE.txt` (the CLDR 49.0.0 Unicode License v3, verbatim, SHA-256 equal to the pin in `pins.json`) sit
  beside `scripts/images/openmoji/map.tsv` and `scripts/images/mulberry/map.tsv` — the TSVs carry CC-CEDICT and
  JMdict glosses (CC BY-SA 4.0), OpenMoji or Mulberry names and CLDR keywords, and a reader of the repository saw no
  notice; cost if wrong: two small files per directory.
- No data was changed.

### Owner questions

1. Starter sets: confirm CC0 1.0 for `starter-zh.json` and `starter-ja.json` (finding 5), and ship them at 47/55 words
   with `humanReviewed: false`?
2. Mulberry rows for Chinese (`scripts/images/mulberry/map.tsv`, 541 `zh` rows) are admitted by a membership test
   against the HSK 3.0 word list at build time. Which copy of the list the gate reads, and whether a checkout without
   it can rebuild those rows, is not settled here (the project's HSK decisions moved more than once); decide whether
   the gate should use the bundled official HSK list, so that the committed rows are reproducible and the list's terms
   are covered by the attribution. Data not changed here.
3. Package format 1 of sentence packs lacks the credit columns: extend format 1 now (nothing installs packages yet) or
   add a format 2?

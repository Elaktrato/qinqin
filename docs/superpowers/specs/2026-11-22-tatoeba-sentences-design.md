# Bundled Tatoeba example sentences — design (issue #133)

Status: Draft (2026-11-22), written unattended; every non-obvious call is a
**Ruling: what — why — cost if wrong**. Builds on the sentences pack type (`server/internal/sentences`,
`docs/wiki/Data-pack-format.md`), the seed order (`server/cmd/qinqin/seed.go`, sentences = 3) and the
first-start auto-seed (`autoseed.go`). Owner decisions (issue body, 2026-11-19): sentences are **bundled in
the base repository** under `plugins/data/` and installed by `qinqin seed`; the source is **Tatoeba**; the
filtering runs locally from a **pinned** export and is deterministic; the raw export is never committed.

**Environment limit of this build.** `downloads.tatoeba.org`, `tatoeba.org` and `creativecommons.org` are
blocked here (proxy 403) and the owner declined to open them. This build therefore ships the tool, its
rules, tests on a hand-made fixture export, the seed integration and the credits, but **not the packs**:
the owner (or a session with access) produces them with the command sequence in "Owner steps".

## 1. Licence (first)

| Material | Licence as stated by Tatoeba | Used? |
|---|---|---|
| Sentence text (`sentences_detailed`) | CC BY 2.0 FR (downloads page and terms of use) | yes, with attribution |
| Sentences also released as CC0 (`sentences_CC0`) | CC0 1.0 | yes |
| Links, tags, user languages, reviews | part of the same export (CC BY 2.0 FR) | as filter input only; not redistributed except the link ids in `credits.tsv` |
| Audio (`sentences_with_audio`) | per recording, some NC/ND or none (`docs/sources.md` "Audio") | **no** |
| Japanese indices (`jpn_indices`, Tanaka B-lines) | export file, licence not re-read here | **no** (possible follow-up for readings) |

Both CC BY 2.0 FR and CC0 1.0 fit the project rule (CC BY-SA 4.0 or more permissive, with notices).

Ruling: a sentence is kept only if it is in the export's sentence file (stated CC BY 2.0 FR) or in the CC0
file with the same id, language and text (then CC0 1.0); its English translation must pass the same test —
the pack holds both texts, so both need a licence — cost if wrong: a sentence under another licence slips
in; mitigated by the strict column check below and the owner's licence re-check before every pin.

Ruling: the parser is strict — `sentences_detailed` must have exactly 6 tab-separated columns, `sentences_CC0`
exactly 4 — and fails otherwise with "format changed; re-check the export's licence information" — a new
column could be a licence field (Tatoeba has discussed per-sentence licences and "licensing issue"
sentences), so guessing would be the wrong default — cost if wrong: one tool update after a format change.

Ruling: the tool refuses to build unless the pin file records `licence.checked` (a date the owner re-read
https://tatoeba.org/en/downloads and https://tatoeba.org/en/terms_of_use) and the SHA-256 of every
archive — like `KANJIVG_LICENCE_CHECKED` in `scripts/fetch-kanjivg-components.sh` — cost if wrong: none; the
owner types one date.

Ruling (attribution): Tatoeba asks that reused sentences credit Tatoeba with a link and, for CC BY, the
sentence's author; each sentence page is `https://tatoeba.org/en/sentences/show/<id>` (wording **not
verified against the live terms**). Each pack therefore carries `credits.tsv` (sentence id, licence, author,
translation id, its licence and author; one line per bundled sentence) and an `ATTRIBUTION.md` that explains
the format; the manifest `attribution` names Tatoeba, its contributors and `credits.tsv`; the Sources page
shows it with the notice — cost if wrong: if per-sentence credit is required in the UI, a `source` field is
added to the pack format later (the importer ignores unknown fields today, so it is not added speculatively).

Ruling (review fix): `credits.tsv` has the columns `sentence, url, licence, owner, translation, translation_url,
translation_licence, translation_owner` ("owner" is the Tatoeba username listed for the sentence, which is not
always its original author), and the manifest `attribution` and notice link its published copy on GitHub
(`…/blob/main/plugins/data/<id>/credits.tsv`), so the per-sentence credits are reachable from the Sources page.
A credit next to each sentence in the app is **deferred** — cost if wrong: if Tatoeba or CC BY 2.0 FR is read to
require credit where the sentence is shown, a `source` field (id, owner) must be added to the pack format, the
importer, the sync contract and the sentence views; until then the risk is a credit one click away, not beside
the text.

Ruling (review fix): the readings (`pinyin` field) and the filing under words derive from CC-CEDICT (MDBG) or
JMdict (EDRDG), CC BY-SA 4.0; the manifest `license` reads "CC BY 2.0 FR (some sentences CC0 1.0); readings from
<dictionary>, CC BY-SA 4.0", and `LICENSE`, `ATTRIBUTION.md` and the notice name the dictionary, its publisher,
its link and the licence URI. Sentence text and readings keep their own licences in one collection — cost if
wrong: if the combination is held to be one adaptation, the whole pack would need CC BY-SA 4.0 terms (CC BY 2.0
permits that; only the licence string changes).

Ruling (LICENSE): `LICENSE` names CC BY 2.0 FR with its URI (CC BY 2.0 §4a allows "a copy of, or the Uniform
Resource Identifier for, this License") and carries the CC0 1.0 legal code verbatim, copied from
`plugins/data/zh-grammar/LICENSE` — the CC site is blocked here — cost if wrong: add the French legal
code text once the owner can fetch it.

Pack notices (manifest `notice`, Sources page) say: from Tatoeba, export date, the licences, **filtered by a
program, readings generated from CC-CEDICT / JMdict and may contain errors; a reading is left out where a
word has several**, and point to `credits.tsv`.

## 2. Export files (from documentation and memory — **not verified against the live export**)

From https://downloads.tatoeba.org/exports/ (weekly, overwritten in place), each a `.tar.bz2` holding one
tab-separated `.csv` file, `\N` for null:

| Archive / member | Columns used |
|---|---|
| `sentences_detailed.tar.bz2` / `sentences_detailed.csv` | id, lang (ISO 639-3), text, username (`\N` = orphan), date added, date modified |
| `sentences_CC0.tar.bz2` / `sentences_CC0.csv` | id, lang, text, date modified |
| `links.tar.bz2` / `links.csv` | sentence id, translation id (both directions listed) |
| `tags.tar.bz2` / `tags.csv` | sentence id, tag name |
| `user_languages.tar.bz2` / `user_languages.csv` | lang, skill level (0–5, 5 = native; `\N`), username, details |
| `users_sentences.tar.bz2` / `users_sentences.csv` | username, sentence id, review (-1/0/1), dates |

Ruling: the archive URLs, member names and hashes are **data** in `server/tools/tatoeba/pin.json`, and the
reader accepts `.tar.bz2` (the named member), `.bz2` and plain files, so a switch to the per-language exports
is a pin edit plus a test, not a rewrite — cost if wrong: small.

Ruling: because the exports are overwritten weekly, "pinned" means the SHA-256 of the archives the owner
downloaded on the pin date; the archives stay in the git-ignored `plugins/upstream/tatoeba/` and the build
re-verifies them every run. When upstream has moved on, a re-download no longer matches and the tool stops:
re-pinning is a deliberate new export (a reviewable diff of the packs) — cost if wrong: byte-for-byte
re-creation needs the kept archives; the owner should keep them (or the date-stamped copy) somewhere safe.

## 3. Tool

Ruling: **Go, `server/tools/tatoeba`** (like `server/tools/fakeai`), not Node — the readings and the linking
reuse the server's own code: `dict.LoadPack`/`ImportLexicon` load the committed `plugins/data/cedict` and
`plugins/data/jmdict` into a temporary SQLite database, `segment.Service` (greedy longest match with
Japanese deinflection) tokenizes, and `lexicon.Store.BestWord` — the exact call the sentences importer uses —
decides whether a word group links. Stdlib only (`archive/tar`, `compress/bzip2`, `crypto/sha256`,
`net/http`) plus the module's `golang.org/x/text` (NFKC) — cost if wrong: none for the owner (Go is the
server's toolchain); a Node user needs Go.

Commands (run from `server/`):

- `go run ./tools/tatoeba pin --licence-checked YYYY-MM-DD` downloads every archive named in `pin.json`
  into `plugins/upstream/tatoeba/`, and writes its SHA-256, the export date (the `Last-Modified` date of
  `sentences_detailed`) and the licence-check date into `pin.json`. It refuses to replace recorded hashes
  unless `--repin` is given.
- `go run ./tools/tatoeba build` refuses when any hash or the licence date is empty ("run pin first"),
  downloads missing archives, verifies every SHA-256, filters, and writes `plugins/data/zh-sentences-tatoeba`
  and `plugins/data/ja-sentences-tatoeba`, plus a report, a review list and a sample into the export folder.
  Flags: `--root` (repo root, default `..`), `--export`, `--pin`, `--rules`, `--out`, `--max-per-word`
  (overrides the rules' cap), `--workers`, `--lang zh|ja` (one language).

Ruling: a silent unpinned run is impossible — `build` has no "trust on first use" path; only `pin` records
hashes, and only with a licence date — cost if wrong: none.

## 4. Filtering (all thresholds in `server/tools/tatoeba/rules.json`, the one tunable file)

Per language (`zh` ← `cmn`, `ja` ← `jpn`), in this order, each step counted in the report:

1. **Licence** (section 1). 2. **Orphans** dropped (`dropOrphans`). 3. **Tags**: a sentence carrying a tag in
`dropTags` (reliability: `@needs native check`, `@change`, `@check`, `@delete`, `@fragment`, …) or
`denyTags` (unsuitable topics) is dropped; case-insensitive. 4. **Reviews**: any -1 review drops it
(`dropNegativeReviews`). 5. **Length**: `minRunes`..`maxRunes` code points. 6. **Deny-list**: text containing
an entry of `denyWords` is dropped. 7. **Translation**: the English sentences linked directly, passing steps
1–4 and `maxTranslationRunes`; best = owner native in English, then lowest id; none → dropped (the pack
format requires a translation). 8. **Near-duplicates**: key = NFKC, case-folded, punctuation, symbols and
spaces removed; the best-ranked sentence of a key survives. 9. **Dictionary match**: segmented; a sentence
needs `minCoverage` of its Han/kana code points inside dictionary matches and at least one word that links.
`nativeOnly` keeps only sentences whose owner declares skill 5 in the language (default off: native owners
are **preferred** in the ranking instead).

Ranking (for duplicates and the per-word cap): native owner first, then a sentence with a reading, then
shorter, then lower id. Ruling: shorter first — learners and cloze/tile cards need short sentences — cost if
wrong: one comparator line.

## 5. Readings

Ruling: the pack's `pinyin` field becomes **optional** in the importer (empty or missing allowed; hanzi and
translation stay required) — the issue says "leave the reading out (the field is optional)" while
`readPack` required it; the web already renders a sentence without a reading (`Sentences.svelte`,
`ClozeCard`, `SentenceCard` test `sentence.pinyin`) — cost if wrong: a pack sentence shows no reading line.

**Chinese.** Each match's reading is the union of the pinyin of every candidate entry of the matched text
(one CC-CEDICT entry merges several lines: 了 = le, liǎo). One distinct reading (case-insensitive) → used;
several → the rules' `zh.defaultReadings` (reviewed defaults for particles: 了 le, 的 de, 吧 ba, …) when it
names one of them, else the sentence gets **no reading** and the word goes to `review-zh.tsv` (count,
word, readings). An unmatched Han character also drops the reading. Format: CC-CEDICT citation tones (no
sandhi marking, like the dictionary), lower case, syllables of a word joined with `'` before a, o, e
(Hanyu Pinyin orthography, like the grammar packs), words separated by spaces, Chinese punctuation mapped
to ASCII (`，` → `, `), digits and Latin kept.

**Japanese.** A kana-only token is its own reading. A token with kanji is reliable only when every *word*
candidate (character entries of KANJIDIC2 are not loaded) yields the same reading: for each candidate form
that shares a prefix with the surface, the form's kana tail must end the entry reading and the surface's
tail must be kana (行きました: 行く/いく → い + きました); `ja.defaultReadings` (私 わたし, 日本 にほん, …)
settles listed forms; 来る/來る inflections are never derived (irregular stem). Anything else drops the
whole sentence's reading (review list `review-ja.tsv`). Kana readings keep the punctuation, no spaces.

Ruling (`preferCommonReadings`, ja on): when some candidate reading carries a JMdict priority mark, the
unmarked ones do not count (水: みず, not the rare すい; 日本語: にほんご, not にっぽんご); readings that
differ only in script (わたし/ワタシ) are one — found by a run over the real JMdict, where the strict rule
gave 2 readings in 7 test sentences — cost if wrong: a rare reading meant by the writer is shown as the
common one; turn the flag off in `rules.json`.

Ruling (review fix, sentence identity): the importer identifies a pack sentence by entry, text and translation
(no longer the reading): a rebuild that only changes, adds or drops a reading updates the row in place, keeping
its id (sentence cards keep pointing at it) and restamping it for sync; a text or translation change is still a
new sentence — cost if wrong: two pack sentences differing only in reading collapse to one (the first wins).

Ruling: a sentence reading is all-or-nothing — the pack format has one reading per sentence; a partial
reading would be a guess presented as fact — cost if wrong: fewer readings in Japanese; the report gives the
share.

## 6. Linking, cap, output

The word of a match is its lemma (Japanese dictionary form), else the best candidate's matching form; a
group is kept only when `BestWord(language, word)` resolves to one of the match's candidates. Chinese
single-character words are `character` entries, which the importer never links (existing behaviour;
recorded as a limitation, possible follow-up). `skipWords` (particles such as は, を, の) are matched but get
no group. Each word keeps at most `maxPerWord` sentences (rules, default 5; `--max-per-word`).

Ruling: a Japanese kana-only token gets a group only when it is a JMdict-common word as written — the server's
segmenter matches kana runs through kana folding (りま → リマ) and splits unknown runs into rare words
(があ, すか); the kana is still its own reading — cost if wrong: fewer groups for rare kana words.
Segmentation itself is the server's (`internal/segment`, as in the Reader): an expression such as 今日は
(こんにちは) can win over 今日 + は; such groups are visible in the sample for review.

Output per pack (deterministic: groups sorted by word in code-point order, sentences by rank, `credits.tsv` by
sentence id, no timestamps, the version is the pinned export date): `manifest.json`, `sentences.json` (one
group per line), `credits.tsv`, `ATTRIBUTION.md`, `LICENSE`. Reports (export folder, not committed):
`report-<lang>.txt` (counts per step, words linked/skipped = the importer's match rate, readings share,
pack sizes raw and gzip ≈ clone growth, image growth = raw), `review-<lang>.tsv`, `sample-<lang>.tsv`
(every n-th sentence, 200 lines, for the owner's review).

Ruling (review fix, size guard): `build` fails when `sentences.json` or `credits.tsv` of a pack exceeds
**24 MiB** (well under GitHub's 50 MB warning and 100 MB limit) unless `--allow-size` is given, which
`ATTRIBUTION.md` then records. Expected sizes (estimates, not measured — the export is unreachable here): with
`maxPerWord` 5, Mandarin about 30–60k sentence rows ≈ 5–10 MB raw, Japanese about 80–120k rows ≈ 12–20 MB raw;
gzip (≈ clone growth) about a quarter of that. The report gives the real numbers; lower the cap first — cost if
wrong: one rebuild with a lower cap.

Ruling: the tool writes only into a staging directory and swaps it into `plugins/data/<id>` at the end — cost
if wrong: none.

## 7. Seed, checks, credits

- Seed: packs under `plugins/data/` are found by `qinqin seed` and the auto-seed (not demo packs); sentences
  import after dictionaries (order 3). Absent packs are simply absent today. Tests: auto-seed and seed install
  a Tatoeba-shaped pack (the tool's golden output) and link its sentences.
- Ruling: `scripts/check-sources.mjs` gets `GENERATED_PACKS` (`zh-sentences-tatoeba`, `ja-sentences-tatoeba`):
  `docs/sources.md` may name them while they are absent; once present they are bundled packs and every rule
  applies (manifest, notice, named in the docs). `TestCommittedPackNotices` requires their notice when present
  and tolerates their absence — the docs describe the source now, so the tool does not edit them — cost if
  wrong: a stale docs row if the owner never generates the packs.
- Credits: `docs/sources.md` section "Example sentences", wiki `Data-and-licences`, `Admin-data-packs`,
  `Data-pack-format` (optional reading), `plugins/data/README.md`; the Sources page needs no code — it lists
  installed sentence packs from their manifests (`GET /api/sentence-packs`).

## Owner steps

```sh
cd server
go run ./tools/tatoeba pin --licence-checked <YYYY-MM-DD>   # after re-reading the downloads page and terms
go run ./tools/tatoeba build                                 # writes plugins/data/{zh,ja}-sentences-tatoeba
cd .. && node scripts/check-sources.mjs                      # then review plugins/upstream/tatoeba/sample-*.tsv
git add server/tools/tatoeba/pin.json plugins/data/zh-sentences-tatoeba plugins/data/ja-sentences-tatoeba
```

## Out of scope

Audio; Tanaka B-line readings; indirect translations; sentences for single-character Chinese words;
languages other than zh/ja; a UI for per-sentence credits.

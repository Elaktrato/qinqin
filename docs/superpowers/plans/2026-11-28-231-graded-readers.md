# #231 — reader: graded reading library (stories and dialogues per level) (2026-11-28)

Milestone v0.9.0, phase 5 (practice and reading), before #183 ("read next"). Branch `feature/v090-231-graded-readers`
from `feature/v0.9.0` at `f6729b56`. Contract number for this branch: **42** (the orchestrator renumbers). This builder
**holds the text-heavy slot**: it writes the texts and runs the teacher reviews.

Owner decisions that bind: the issue comment of 2026-11-26 (**five texts per level**; native-language teacher subagents
review them as for the course texts, the owner reviews later) and the v0.9.0 plan §2 (review notes beside the content,
"reviewed by agents" shown) and §4 (#183: target 95 % known; candidates are the library, the graded readers and the
course texts).

## What

- **35 original texts**, five per level: Chinese ≈ HSK 1, 2, 3, 4 and Japanese ≈ N5, N4, N3 — short stories,
  everyday dialogues and simple informational texts, written for qinqin under CC BY 4.0, each with its proper names
  and its few glossed words above the level.
- **Embedded in the server** (`server/internal/library/sources/graded/texts/{zh,ja}.json`, with `NOTICE` and
  `REVIEW.md`), served as a **library source `graded`** ("Graded readers"): a text is added to the workspace's library
  as a one-chapter book through the existing source import route, and read in the reader like any book.
- **The catalogue route** `GET /api/library/graded?language=` (texts with level, kind, title, length, names and glosses;
  no bodies), and the **Graded readers tab** of the Sources page: a level filter, each text's level, kind, length,
  "reviewed by agents", its new words (readings through `useRomanisation()`), and **Read** (add, then open).
- **Contract 42** `docs/contracts/graded/`: the text file format, the level rule (how a text is counted against a word
  level list: function words and names left out, coverage and distinct above-level words, the computed level) and the
  catalogue answer; Go and web decode the fixtures.
- **The level check:** a test segments every text with the real segmenter (#348/#349) on the shipped dictionaries and
  level lists (`realdict`, always on) and checks that its computed level is its declared level, with every
  above-level word glossed; the same check runs on a fully seeded database when `QINQIN_GRADED_DB` names it.
- **Review:** two native teacher agents per language and an adjudicator; findings applied; `REVIEW.md` beside the
  texts.

## Tasks

1. This plan.
2. Contract 42 (`graded/`): format and rule fixtures; Go package `graded` (parse, rule) test-first.
3. The level check (realdict and seeded) — the drafting tool.
4. Write the 35 texts; tune them against the check.
5. Teacher review (2 + adjudicator per language), apply, re-check; `REVIEW.md`, `NOTICE`.
6. Server: the `graded` source (Search, Describe, Fetch), the catalogue route, its tests, routes fixture, API docs.
7. Web: API client, the level-rule and catalogue contract tests, the Graded readers tab, credits, e2e and the 360 px
   path.
8. Docs: wiki, sources, contracts index, CHANGELOG, NEXT.md; gates; execution record.

## Rulings

Format: `Ruling: <what> — <why> — <cost if wrong>`.

1. Ruling: **levels with texts: ≈ HSK 1–4 and ≈ N5–N3, five texts each (35)** — the issue's levels exactly (HSK 4 is
   in the issue's list, so it is done rather than left for later); HSK 5+ and N2+ have no texts — a higher level is a
   later batch of the same files (no format change).
2. Ruling: **the texts are embedded project data, not a new pack type** — record 0008 decides new types and #179 set
   the precedent of embedding project-written tables (counters, Starter lists); a pack type would need a migration, a
   type package, two table rows, a data package and an install path for 35 short texts every server should have;
   the file format is a contract with fixtures, so a later `reader` pack type (other languages, #201; user-added
   texts) can load the same files — cost if wrong: that pack type adds a loader and an install path, the format
   stays.
3. Ruling: **the graded readers are a library source (`graded`), and a text becomes a one-chapter book of the
   workspace's library** — the reader, bookmarks, highlights, reading time, word states and #183's library candidates
   then work on it unchanged, and the source import route already has the duplicate check, the language check and the
   import slot; one text a book (not one book a level) so the library and "read next" list each text with its own
   coverage — cost if wrong: a learner who reads all five has five books (they delete like any book).
4. Ruling: **the Sources page lists Graded readers first, and its tab shows the whole catalogue of the workspace
   language with a level filter instead of search and shuffle** — 35 texts fit on one list; the Sources page opens
   on the first source that serves the workspace language, so the library's existing "find books" link lands on the
   graded readers, the best start for a learner; Aozora and Gutenberg keep their tabs — cost if wrong: a learner who
   wants Aozora taps its tab once.
5. Ruling: **"Read" adds the text to the library and opens it** (and "Open" when it is already there) — one tap on a
   phone instead of add, then find it in the library — cost if wrong: none (the book is in the library either way).
6. Ruling: **a text's level is declared in the file and verified by the level rule: its computed level must equal its
   declared level** — the computed level is the lowest level of the scheme (`hsk-words`, `jlpt-words`) at which the
   text fits: of its counted tokens (the segmenter's matches with a dictionary entry, function words and the text's
   names left out) at least 95 % have a word level at or below it (the #183 target: a learner who knows the level's
   words reads it at 95 %), and at most 6 distinct words are above it; the declared level must also have every
   above-level word glossed — serving a computed level would need the dictionaries and level lists at request time
   and would move a text's level when a list changes; checking "equal", not "at most", keeps a level's texts at that
   level (an HSK 3 text that fits HSK 2 is too easy) — cost if wrong: retune two numbers in `level-rule.json`.
7. Ruling: **a token's word level is the lowest level at which the list names it directly: by any of its entries
   (`levels.WordLevels` over the match's candidates, the #349 rule for "listed") or by its written form in the list
   file (`plugins/data/<scheme>/levels.json`)** — the first entry alone misses a homograph listed under another entry
   (CC-CEDICT merges a character's lines; JMdict kana spellings); and the importer keeps one membership per entry at its
   lowest level, so a character listed as a word at HSK 3 but derived at HSK 1 (先 from 先生, 打 from 打电话) has no
   direct membership in the database, though the list names it; derived character memberships still do not count —
   cost if wrong: a word read as a listed homograph counts as within the level.
8. Ruling: **names are listed per text and every token that overlaps a name's occurrence is left out of the count**
   (not counted as known) — the segmenters split unlisted names into characters or kana runs (王明 → 王｜明, アンナ →
   ア｜ン…), which would count as words of random levels; leaving them out does not raise the coverage — cost if
   wrong: a name that is also an ordinary word elsewhere in the text is left out there too (avoided in the texts).
9. Ruling: **the level is shown as the scheme's level name as the bundled list writes it** (`HSK 2`, `≈ N4`), with
   the kind (story, dialogue, information), the length in characters and "reviewed by agents" — the same names as the
   word badges elsewhere; the Japanese list is an estimate and says so with ≈ — cost if wrong: none.
10. Ruling: **length is the number of letters of the paragraphs (Han, kana; no punctuation)**, shown as "N
    characters" — a word count depends on the segmenter and the installed dictionaries; letters do not — cost if
    wrong: none.
11. Ruling: **glosses: each text lists its above-level words with a reading and a short English meaning (at most 8),
    shown in the catalogue under "New words" before reading**; the text itself carries no glosses or readings — the
    reader's own lookup popup and furigana/pinyin settings work on the book, and hidden romanisation applies to the
    gloss readings through `useRomanisation()` — cost if wrong: glosses inside the text need a ruby or note format in
    the book.
12. Ruling: **no translation** — the issue asks for texts at the right difficulty, not a bilingual reader; the lookup
    covers single words — cost if wrong: a later batch adds `translation` (an optional key in format 1).
13. Ruling: **dialogues are lines in Chinese or Japanese quotation marks (“…” / 「…」), one paragraph per line, no
    speaker labels**, as in #223; no Latin letters or Arabic digits in a text (the format check refuses ASCII letters
    and digits) — the reader splits paragraphs, and digits are read as unmatched runs — none.
14. Ruling: **≈ N5 texts are polite (です／ます); ≈ N4 and ≈ N3 mix plain narration with polite dialogue where natural**
    — standard graded-reader practice; the estimated JLPT list puts some core words late (#223 finding 5), which the
    glosses cover — none.
15. Ruling: **the level check runs always, on `realdict`** (the shipped CC-CEDICT/JMdict cut down to the texts'
    windows, plus `hsk-words` and `jlpt-words`), and again on a fully seeded database when `QINQIN_GRADED_DB` is set
    — the realdict import keeps it in CI (no seeded database there, unlike #223's fill check); the full database adds
    the frequency pack that ranks Japanese candidates — cost if wrong: the two readings can differ on a few tokens;
    both are reported, and the always-on one is the gate.
16. Ruling: **the catalogue route `GET /api/library/graded` needs a signed-in session, no personal access token
    (`noTok`), and is not cached by the service worker** — like the other library source routes; it holds no user
    data (the "in library" state comes from the books list) — none.
17. Ruling: **the book's credit: author "qinqin", attribution "qinqin graded readers, <level>: written for qinqin and
    reviewed by agents acting as teachers, not yet by a person", licence note "CC BY 4.0, qinqin contributors"**, and
    a credit on the Sources page under "Built into the app" (`coreCredits.ts`, where the reader's other sources are) — the reader shows a book's attribution; the
    project's own text is CC BY 4.0 (brief §8) — none.
18. Ruling: **the level check reads again each run of adjacent tokens above the declared level (with a function word
    next to it), with the lowest-level reading over every dictionary match** (a part costs its level + 1, a function
    word of a closed list nothing, an unlisted word or a letter 50; then fewer parts) — the segmenters still split
    Japanese kana runs against the words (わたしも｜すし → もす｜しが, 食べに → 食｜べに) and keep expressions of known words as
    one unlisted entry (ですか, 電話をかける, 家を出る): counting the segmenter's tokens as they are put every ≈ N5 text
    "above" ≈ N4 for words a learner knows; #223 ruling 13 made the same call. The function parts are a closed list
    (は が を に … です ます ない …), not "a particle by part of speech": JMdict tags single kana (な, し, か) as particles,
    and a re-read that could use them anywhere read バナナ as バ｜ナ｜ナ. The always-on check and the contract's rule stay
    on the segmenter's tokens otherwise — cost if wrong: a text a little harder than the check says where a re-read
    found a known reading the reader does not show (the findings are in `REVIEW.md`).
19. Ruling: **a gloss word that contains an above-level word glosses it** (工作人员 glosses 人员, 跟上时代 glosses 时代,
    焼き始める glosses 焼き) — the glosses show learners whole words, while the segmenter reads a part above the level;
    found when the adjudicators glossed multi-word units — cost if wrong: a gloss could cover an unrelated word that
    happens to be inside it (none in the shipped texts).
20. Ruling: **the library's link reads "browse graded readers and public-domain texts"** (it read "public-domain texts"
    only) — the link now lands on the graded readers — none.
21. Ruling: **the glosses are the words the check finds above the level** (the Japanese adjudicator's policy, applied to
    both languages; a few extra kept where the realdict and seeded readings differ) — "N new words" should mean the
    words the learner does not know at that level — cost if wrong: a word the popup would explain anyway is not listed.

## Teacher review

Per language two teacher agents and an adjudicator (`claude -p --effort high --tools ""`), each teacher independent,
with every text, its names, glosses and the check's result. Personas, what changed, what was adapted to the check and
the findings for others: `server/internal/library/sources/graded/texts/REVIEW.md`. In short: Chinese 19 of 20 bodies
revised (natural spoken forms, measure words, one word per place — 饭馆, 食堂, 餐厅 —, accuracy of the panda, tea,
subway, rubbish and ticket texts, one kind relabelled: 我的大学 is a story); Japanese all 15 revised (natural forms,
counters 三冊, 辛かった in kanji, accuracy of train etiquette, yukata, festivals and konbini, the cooking sequence, a
letter's sign-off); glosses are the words the check finds above the level. Not applied: replacing a text to give
HSK 1 an informational text (a follow-up for the next batch), lengthening N3 texts, a casual line at N4.

## Execution record

- **Plan** committed first (c2f38d28).
- **Contract and package, test-first:** `format.json` and `level-rule.json` were written, then `contract_test.go`
  against a stub `Parse`/`Check`, run and seen failing (39 failing cases), then `graded.go` and `rule.go`; all passed.
  The web `levelRule.ts` was written after its contract test but the test was not run against a stub first (it passed
  at once on the Go-checked fixture). `source_test.go` and `handlers_graded_test.go` were written before `source.go`
  and the route, but run only once the code existed (not seen failing). The catalogue and panel DOM tests were written
  with the components.
- **The level check was the drafting tool.** Findings that changed it while drafting (Rulings 7, 18, 19): the HSK
  importer's lowest-membership rule hides direct listings of characters derived lower (先, 打, 包); Japanese segmenter
  splits and expressions put every ≈ N5 text "above" until the re-read; a part-of-speech test for function words let
  the re-read read unlisted kana words as particles (バナナ → バ｜ナ｜ナ), hence the closed list; WordLevels had to be read
  for the re-read's own candidates. Each was seen in the dumps (`QINQIN_GRADED_DUMP`) and fixed before the texts were
  tuned further.
- **Texts:** 35 drafted (20 zh, 15 ja), tuned until every text was at its level; reviewed (above); the adjudicated
  versions applied and adapted where the check asked (REVIEW.md lists each adaptation); re-checked on both data sets.
- **Level check numbers (final):** every text's computed level is its declared level, on the shipped dictionaries
  (realdict, always on: `TestEveryTextIsAtItsLevel`, about 10 s) and on a database seeded with every bundled pack
  (`QINQIN_GRADED_DB`, `TestEveryTextIsAtItsLevelSeeded`, about 6 s). Coverage at the declared level (realdict):
  Chinese HSK 1 97.2–100 % (0–2 words above), HSK 2 97.1–99.0 % (1–3), HSK 3 96.1–99.2 % (1–4), HSK 4 96.2–98.9 %
  (2–4); Japanese ≈ N5 95.6–100 % (0–2), ≈ N4 95.6–98.6 % (1–3), ≈ N3 97.7–98.9 % (1). Counted tokens per text:
  Chinese 52–184, Japanese 55–95; lengths 77–296 (zh) and 183–319 (ja) characters. The seeded run differs from the
  realdict run on three Japanese texts by one or two counted tokens (the frequency pack ranks other candidates), with
  the same verdicts.
- **Fixup:** the catalogue fixture was regenerated after the review and folded into the review commit (autosquash), so
  every commit's suites agree.
- **Not green at one commit:** 86060764 (the web tab) put the graded credit in the reader's feature manifest, which
  three Sources page tests forbid (the reader's sources are core credits); found by the full vitest run and fixed in
  f0f9ec73 (the credit moved to `coreCredits.ts`). Every other commit's targeted suites were run green.
- **Real app** (scratch binary, scratch data dir with no packs, 127.0.0.1:18231, a scratch user): `GET /api/version`
  contract 42; `GET /api/library/graded` 401 anonymous; `GET /api/library/sources` lists `graded, aozora, gutenberg`;
  `?language=ja` 15 texts, the first ≈ N5 はじめまして; importing `zh-hsk3-panda` into a new zh workspace 201 (大熊猫),
  again 409, its chapter 0 has 5 paragraphs. Server stopped, scratch removed.
- **Gates:** Go full `./...` (gofmt clean, vet clean): 67 packages ok including `cmd/qinqin`; the one failure is the
  known environment-only `internal/ai` `TestHostnameResolvingToEmbeddedFormIsRefused` (no IPv6). The seeded level check
  passes on a scratch database seeded from `plugins/data`. Web `check` 0 errors 0 warnings (2,224 files), `build` ok,
  vitest 802 files / 16,062 tests passed (1 file, 3 tests skipped), e2e 86 passed (including the new
  `graded-readers.spec.ts` and `/reader/sources` in `phone-width.spec.ts`), `node --test scripts/*.test.mjs` 243 passed
  1 skipped, `gen-api-docs --check` ok.
## Local follow-up

1. **#231, seeded level check on the owner's data** — `qinqin seed --data <scratch>/data --packs plugins/data` in a
   scratch directory, then `cd server && QINQIN_GRADED_DB=<scratch>/data/qinqin.db go test -count=1 -run
   TestEveryTextIsAtItsLevelSeeded -v ./internal/library/sources/graded/`. Look for: every text "computed" at its
   level, PASS. If a text fails after a dictionary or level-list update, adjust its wording or glosses
   (`texts/*.json`) and re-run both level tests.
2. **#231, Android shell** — open Reader → browse graded readers in the APK on the emulator: the Level select opens the
   native picker, Read opens the book, the back button returns to the Sources page with the tab kept. No shell code
   changed; nothing was run here (no Android SDK).
3. **#231, owner's review** — read the 35 texts (`server/internal/library/sources/graded/texts/`) and set
   `humanReviewed` to true per file when done.

## Follow-ups (for the orchestrator to file)

- HSK 1 has no informational text (the review relabelled 我的大学 as a story); add one in a next batch.
- The estimated JLPT list lacks core N5 words (時, 分, ください, 人気, 大好き, 日本, そう; ありがとうございました at ≈ N4) — #219.
- Segmenter: Japanese kana runs still split against words (もす｜しが, 食｜べに, のあ｜と, カレ｜ーパン); Chinese keeps some
  unlisted compounds whole (早点儿, 穿着, 换成, 学会) — #348/#349 follow-ups; details in `REVIEW.md`.
- The HSK importer's lowest-membership rule hides direct listings of characters derived at a lower level (先, 打) from
  `levels.WordLevels`; the level check reads the list file instead.
- #183 (read next) can score the graded readers from `graded.Files()` / `GET /api/library/graded` and the level rule's
  counting (`levelRule.ts`).

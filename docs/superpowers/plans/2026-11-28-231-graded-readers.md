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
7. Ruling: **a token's word level is the lowest direct word-list level of any of its entries** (`levels.WordLevels`
   over the match's candidates, the #349 rule for "listed") — the first entry alone misses a homograph listed under
   another entry (CC-CEDICT merges a character's lines; JMdict kana spellings); derived character memberships do not
   count (#349) — cost if wrong: a word read as a listed homograph counts as within the level.
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
    a credit on the Sources page through the reader's feature manifest — the reader shows a book's attribution; the
    project's own text is CC BY 4.0 (brief §8) — none.

## Teacher review

(filled in task 5)

## Execution record

(filled as the work goes)

## Local follow-up

(filled at the end)

# Saved sentences: each new book sentence of a studied word becomes another sentence card (#279, 2026-11-28)

Milestone v0.9.0, phase 5 ("#279 → #280 → #184, sentences from reading"). Branch `feature/v090-279-saved-sentences`
from `feature/v0.9.0` (b852d09c, ContractVersion 32; this branch uses 33, the orchestrator renumbers).

## What (issue and owner decisions)

- **A word already in study:** the reader popup offers **Save this sentence** next to the "In study" chip. It saves
  the book sentence on the entry (the `resolveBookSentence` path, deduped by text) and adds a Word Salad
  (`sentence`) card for it in the word's decks.
- **Automatic mode:** a reader setting per workspace, **off by default** (owner), that does the same whenever a
  studied word is looked up. **No limit** per word (owner, 2026-11-26).
- **Pacing:** the new cards are ordinary unreviewed cards, so they count as new cards under the deck's daily limit.
- **The entry page** lists the saved sentences (as today) and lets the learner remove one; the cards made from it
  are tombstoned.
- **Contracts:** what a new sentence is, de-duplication, what is stored, how the automatic mode decides
  (`docs/contracts/reader/saved-sentences.json`, decoded by Go and web tests).

Fits what comes next: #280 adds source fields (book, chapter, position) to the same own `sentences` rows; #184 adds
an opt-in "Read the sentence" kind that can be planned from the same saved rows. Nothing here is built for them.

## The design

- **Normalised text** (shared rule): every run of the contract's whitespace set (the ASCII whitespace, U+0085,
  U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF) becomes one space, then the ends are
  trimmed. Two sentences are the same when their normalised texts are equal (nothing else: no punctuation or width
  folding).
- **Server de-duplication:** `POST /api/entries/{id}/sentences` answers **200 with the existing sentence** when one
  the caller can see on the entry (pack, own, AI-kept) has the same normalised text; otherwise it stores the new one
  (201). A second tab or the automatic mode racing the button never makes two rows.
- **The plan** (`planSentenceSave`, web, pure; fixture `plan`): from the word's sentences and the workspace's cards:
  `none` (no sentence beyond the word, a character result, or the word has no vocab card), `already` (a sentence with
  that text has a sentence card of the word), `card` (the sentence exists, no sentence card: add one on it), `save`
  (post the text, then add the card). The card: kind `sentence`, the entry, the sentence id, the decks and written
  snapshot of the word's canonical vocab card. When the word's vocab row skips `sentence`, the sentence is still
  saved but no card is added (`cardAllowed: false`).
- **The automatic mode** (`autoSaveApplies`; fixture `auto`): the workspace-settings key `reader.saveSentences`
  (boolean, default false; `reader/display-settings.json`) is on, the result is the root popup's first result (the
  lookup the history records) with its paragraph known, it is not a character, and the word had a vocab card when the
  popup opened. It runs once per shown result, quietly (a status line, no error line).
- **Removal:** `DELETE /api/entries/{id}/sentences/{sentenceId}` now deletes any of the caller's own sentences (a
  tombstone), not only AI ones; `?reason=` stays for AI examples (a reason on another sentence is 400). The entry page
  shows **Remove** on own sentences; after the delete, the sentence cards of that sentence (and their duplicates) are
  tombstoned in every workspace of the entry's language. Reviews stay in the log (as for every deleted card).

## Tasks

1. This plan.
2. Server: the normalise rule and POST de-duplication; DELETE widened to own sentences (test first; contract fixture
   decoded by Go).
3. Web: `savedSentences.ts` (normalise, plan, auto rule; contract fixture), `reader.saveSentences` in the display
   settings, the API helper for removal (test first).
4. Web: the popup's Save this sentence and the automatic mode (`AddToStudyButtons`), the display panel switch.
5. Web: the entry page's Remove and the card tombstones.
6. Contract version 33, CHANGELOG, wiki (API routes, Reader), release notes, e2e at phone width.

## Rulings

- Ruling: the saved sentence becomes a stored `sentence` (Word Salad) card at once, not a lazy companion — the issue
  asks for "a Word Salad card for it", and a companion only ever plans one sentence per word — a stored card nobody
  wanted is one tap to remove.
- Ruling: "the same sentence" is equal normalised text against every sentence of the entry the learner sees (pack,
  own, AI), with no punctuation or width folding — the dictionary's pack sentences already cover the word, and a
  looser match could hide a really new sentence — two near-identical sentences can both be saved.
- Ruling: the server de-duplicates `POST /api/entries/{id}/sentences` (200 with the existing row) — a second tab or a
  fast double look-up must not make two rows; no backwards compatibility is owed for this route — an API client that
  wanted a second copy of a text no longer gets one (pinyin and translation of the duplicate are dropped).
- Ruling: an existing sentence without a sentence card gets one (`card`) — the sentence the word was first added with
  is already on the entry, and meeting the word in it again should give the card the issue asks for — a learner who
  re-reads the sentence they added the word from gets a Word Salad card for it.
- Ruling: the card's decks and written snapshot are those of the word's canonical vocab card (compareCanonical) — "in
  the word's deck"; duplicates are merged at read time anyway — a word in several decks gets its sentence card in all
  of them, like its other companions.
- Ruling: a word whose vocab row skips `sentence` still saves the sentence, with no card — the learner switched that
  card type off for the word; the sentence is still a useful example — none.
- Ruling: character results get neither the button nor the automatic mode — characters get no sentence companions
  and the add path saves no sentence for them — none.
- Ruling: the automatic mode acts only for the root popup's first result with a known paragraph, and only for a word
  that was in study when the popup opened — the first result is the look-up the history counts; a word added in the
  same popup already saved its sentence — hover look-ups (when the hover lookup is on) also count as look-ups.
- Ruling: the setting lives in the workspace's `reader` object as `saveSentences` and is switched in the reader's
  Display panel — the issue asks for a reader setting per workspace; the Display panel is the reader's one settings
  place — a learner looking in Settings > Study does not find it there.
- Ruling: a failed automatic save shows nothing but the status line staying empty (no error) — the learner did not
  ask for anything; the button still works — a silent failure means no card that time.
- Ruling: removal tombstones the cards in every workspace of the entry's language — own sentences belong to the
  user, not a workspace — a workspace whose study data does not load keeps its card (the card then shows the word's
  first sentence, as for a pack update), and the page says so.
- Ruling: a removed sentence can be saved again by the automatic mode when the word is met in it again — tombstoned
  rows are not consulted; remembering removals is a new store — a learner who removes a sentence and re-reads it with
  the automatic mode on gets it back.
- Ruling: the AI example delete also tombstones the cards of that sentence — the same rule for every own sentence —
  none.
- Ruling: course reading texts (#218) are not shown in the reader yet (`ReadingStep` has no look-up popup), so they
  get the flow only once they are; every place that runs the reader popup with a paragraph (books, grammar lessons,
  conversations) gets it now — the popup is shared — none.
- Ruling: no new stored data (own sentences and cards exist; the setting is a key in an existing settings object), so
  no new delete rule or backup member — the backup already carries own sentences (`sentences.jsonl`), cards and
  workspace settings — none.

## Pending review

Nothing: this issue adds UI strings only (no course text, glosses or translations). The `de`/`ja` catalogues do
not exist yet on the integration branch (#144/#145 come last).

## Local follow-up

- **#279, Android WebView:** in the APK (`apps/android`, a debug build on an emulator or phone), open a book, tap a
  word that has a card, press **Save this sentence** in the bottom sheet: the sheet stays open, the status line
  "Sentence saved as a new card." appears and the hardware back button still closes the sheet first; on the word's
  page **Remove** takes the sentence away without the page jumping. Not checked here (no Android SDK or emulator);
  the same flow passed in headless Chromium at 360 × 740 with touch (`e2e/tests/saved-sentences.spec.ts`).

## Execution record

- Task 1 (plan): f3ed7409.
- Task 2 (server, df92904b): test first. `saved_contract_test.go` (normalise, whitespace set, same text, remove
  rules, `FindSame` visibility) and `TestSavedSentenceRoutes` (200 on a duplicate, pack text answered, another user's
  text private, 401, 404 for another user's and a pack sentence, 400 for a report of an own sentence, 204, saved again
  after a removal) were written and seen failing (undefined functions; the duplicate POST answered 201), then
  `saved.go` and the handler change made them pass. `DeleteAI` became `DeleteOwn`; its old test case "an own sentence
  the AI did not write is 404" now checks that such a sentence cannot be reported.
- Task 3 (web logic, 21531561): test first. `savedSentences.test.ts` (the fixture's normalize, whitespace set, same,
  plan and auto cases, and `saveBookSentence` with fakes) failed on the missing module, then passed (45 tests). The
  display-settings fixture cases for `saveSentences` were added with the parse change. `sentence.ts` now re-exports
  the contract's `normalizeSentence` (the old JavaScript `\s` rule left U+0085 alone, unlike Go); the reader's
  `resolveBookSentence` keeps its own tests green.
- Task 4 (popup, a530d711): **not test first**: `AddToStudyButtons` and the Display switch were written, then their
  DOM tests (seven popup cases, two panel cases), which passed on the first run.
- Task 5 (entry page, 2089b6f1): `removeSentence.test.ts` first (failed on the missing module, then passed); the
  `Sentences` snippet and `EntryView` DOM tests were written after the components.
- Pacing (99cca716): a test that pins the existing behaviour (four stored sentence cards of one word, new limit 2 →
  two planned); it passed at once, as expected: nothing in the queue changed.
- E2E (acdc041a): `saved-sentences.spec.ts`, two tests at 360 × 740 with touch, the no-sideways-scroll guard on the
  sheet with the new button and on the entry page with Remove; the cards checked through the pull API. No new path:
  the reader and entry pages are in `phone-width.spec.ts` already.
- Hidden romanisation: no new reading is shown (the popup and the entry's sentence list already use
  `useRomanisation()`); the guard passes.
- Gates at 4b053026: Go `./...` all packages ok except the known `internal/ai`
  `TestHostnameResolvingToEmbeddedFormIsRefused` (no IPv6); vitest 785 files, 15685 passed, 3 skipped; `check` 0
  errors; `build` ok; e2e 77 passed (the whole suite ran); `node --test scripts/*.test.mjs` 243 passed, 1 skipped;
  `gen-api-docs --check` clean (no route row changed).

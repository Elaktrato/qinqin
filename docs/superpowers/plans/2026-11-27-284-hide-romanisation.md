# #284 — hide romanisation everywhere (romaji; pinyin and bopomofo) (2026-11-27)

Milestone v0.9.0, phase 2. Branch `feature/v090-284-hide-romanisation`. The owner's decision comment (2026-11-26)
confirms the four flashcard choices of the issue body: tone cards answer in tone numbers and contours; typed-reading
cards play the sound; the romanisation is the last hint step; tone colours and furigana keep their own switches. The
plan §3 makes the rule binding on every new screen of the milestone (drills, courses, sentence cards, the add-on), so
the mechanism must be one call a later builder cannot miss.

## What

- A per-workspace setting `romanisation` (workspace settings, synced and backed up like the other study settings):
  `{"pinyin": "always" | "never", "bopomofo": …, "romaji": …}`, default `always`. Settings > Study shows only the
  members of the workspace's language (profile field `romanisations`).
- One rule, `isReadingShown(type, prefs)` (`lib/languages/romanisation.ts`), and one view every component uses,
  `useRomanisation()` (`lib/languages/useRomanisation.ts`): `shows(type)`, `showsText(text, language)` for an untyped
  reading string, `shown(readings)`, `hidden(readings)`. `ReadingText` (the shared reading widget) renders nothing for
  a hidden type.
- Every place that shows a reading uses it: the entry page (readings line, compounds, characters, sentences, AI
  examples), the reader (popup and phone sheet entry card, smart readings and ruby, the words panel, the source
  search), search results, the lookup history, the deck word lists, the character-map tooltip, every flashcard kind
  (front, back, hints, the tone card), Starter mode, the grammar examples, the writing-system trainer (kana).
- Flashcards as the owner confirmed: a new last hint kind `romanisation` (offered only when the entry has a hidden
  reading, counted as a hint); tone cards with pinyin hidden label the pads by character and answer with tone numbers
  and contours; the trainer's sound prompts play the sound and keep the romaji behind a hint.
- A guard test (`romanisation.lint.test.ts`) that lists the reading-rendering components and fails when a Svelte file
  renders a known reading field without the helper.
- Contract: `settings/romanisation.json` (+ the key in `workspace-settings.json`), `cards/hints.json` (the new kind),
  `languages/profiles.json` (`romanisations`), contract 15, CHANGELOG. Docs: wiki Development, record 0004 (UI
  conventions: where the helper lives and who must call it), NEXT.md.

## Tasks

1. Plan (this file).
2. The rule: `romanisation.ts` + fixture + tests (web), profile field (web + Go), workspace-settings key and merge case
   (Go), `useRomanisation`, `ReadingText` hides; contract 15 and CHANGELOG.
3. Settings > Study: the Romanisation section (one switch per type of the language).
4. Entry page, search, lookup history, deck lists, stats tooltip, grammar examples.
5. Reader: entry card (popup and sheet), smart readings/ruby, words panel, source search.
6. Flashcards: reading tables, sentence/cloze readings, hints (`romanisation` kind, last), tone card, Starter mode.
7. Writing-system trainer (kana): chart labels on tap, sound prompts with the romaji as a hint, romaji-answer modes.
8. The guard test, docs (wiki, record 0004, NEXT.md), e2e at phone size.

## Rulings

- Ruling: per workspace, inside the existing workspace `settings` object (key `romanisation`), not a keyed row — a
  workspace is one study language, the other study settings (hints, visual aids, starter) live there, and it syncs and
  backs up with no new code — cost: two workspaces of one language each have their own switch.
- Ruling: modes are strings `always` / `never`, not booleans — the issue names them so and a later `hint` mode (show on
  tap everywhere) fits without a new key — cost: none.
- Ruling: romanisations are the reading types `pinyin`, `bopomofo` (zhuyin) and `romaji`; kana, on and kun are not
  (furigana keeps its own reader switch) — the issue's list — cost: none.
- Ruling: a reading string without a type (the reader's word lists, the lookup history, deck lists, a sentence's
  reading line, a book's own ruby) is typed by its script (`readingTypeOfText`): Bopomofo letters → `bopomofo`, Latin
  letters → `pinyin` in Chinese and `romaji` in Japanese, anything else (kana, hanzi) is not romanisation — the server
  sends these as plain strings and the script decides unambiguously — cost: a Latin gloss passed by mistake would be
  hidden too (none of the call sites passes one).
- Ruling: a book's own ruby (EPUB/Aozora) of a hidden type is not drawn — the owner's rule is "nowhere"; kana ruby
  (furigana) stays under its own switch — cost: a Chinese book with pinyin ruby shows bare hanzi while pinyin is hidden.
- Ruling: the romanisation hint is a new registry kind `romanisation`, revealed last, never stored: its mode follows the
  reading kind's mode on that card kind (`never` stays `never`, `always` and `hint` become `hint`) and it applies where
  the reading kind applies (not on tone cards, where the pinyin is the answer) — "the romanisation is the last hint
  step" and one more cell in Settings > Hints would only allow `always`, which contradicts hiding — cost: a learner
  cannot turn the romanisation hint off without turning the reading hint off.
- Ruling: with a type hidden the reading hint shows only the shown readings (kana; bopomofo when only pinyin is hidden);
  an entry whose readings are all hidden offers the romanisation hint alone. The sound is not a new hint kind: every
  card already has its play button on the answer — cost: the sound is not offered before the answer.
- Ruling: the tone card with pinyin hidden labels each pad with its character (or "Syllable n" when the characters do
  not line up), names no pinyin in its accessible labels, and answers with the tone number and its contour per syllable
  instead of the pinyin; the answer's reading table drops the pinyin row — owner decision — cost: none.
- Ruling: no flashcard kind asks for a typed romanisation today; the "typed reading plays the sound" rule lands where
  such prompts exist, the writing-system trainer: its Recall, Type and Write prompts show a sound button and a "Show
  romaji" hint instead of the romaji. Recognise and Read answer by choosing a romaji, so with romaji hidden they are not
  offered (a note says why) — cost: those two modes are gone until romaji is shown again. A future typed-reading card
  follows the issue: the sound, and skipped without a voice.
- Ruling: Starter mode with romaji hidden starts Japanese words at the kana front (stages 1 and 2 show kana without
  romaji; the "now in kana" and "no more romaji" notes are not shown); with pinyin hidden a Chinese word is introduced by
  picture, sound and characters (the reading stage shows the characters; bopomofo stands in for pinyin when it is
  shown). The stage replay is unchanged (no contract change to `starter/stages.json`) — cost: none.
- Ruling: signed out, or outside a session (the sources page, tests without a session), everything is shown — the
  default — cost: none.
- Ruling: the share text of a word or sentence (the OS share sheet) keeps its reading — it is written for another
  person, who may need it — cost: a learner sharing a word sends pinyin they do not see themselves.
- Ruling: a grammar lesson of another language than the workspace's follows the current workspace's switches (the
  setting is the workspace's; the plain string is typed by the lesson's language) — cost: none in practice.
- Ruling: the guard is a source scan of the markup (`romanisationGuard.ts`): known reading fields (`.pinyin`,
  `reading.value`, `.reading`, `.roman`, `readingBeside(`, `readingLine(`, `row.r`, tone syllables, `<ToneText`,
  `front.annotation`, ruby `.ruby`/`.rt`, `q.prompt`); a file that prints one is in `RENDERERS` and uses the helper,
  or `EXEMPT` with a reason (the visual-aid previews) — not an AST analysis — cost: a reading printed from a local
  variable with another name is not seen; the list grows with each new reading field.
- Ruling: typing romaji or pinyin to search, the IME and the entry editor's reading fields are unchanged; the editor
  shows the stored readings it edits (asking to edit counts as asking) — cost: none.

## Execution record

1. Plan committed first.
2. The rule: `romanisation.test.ts` (fixture cases) written first and seen failing (no module), then
   `romanisation.ts`; `ReadingText.dom.test.ts` seen failing on the hidden case, then `ReadingText` hides. Go:
   `romanisation_test.go` and the profiles fixture with `romanisations`; a merge case in `workspace-settings.json`
   (run by the existing Go merge test). Contract 15, CHANGELOG.
3. Settings: `RomanisationSettings.dom.test.ts` and the component written together (not seen failing first).
4. Entry page and lists: the EntryView DOM test was checked to fail with the old `Readings.svelte` and pass with the
   new; search, lookups, deck lists, CellTip and grammar edits are covered by the guard and the full suite, not by
   their own DOM tests.
5. Reader: `readingLine` test seen failing, then the `shows` parameter; `shownPieces`/`shownRuns` tests written with
   the code (not seen failing); EntryCard and ChapterText DOM tests added after.
6. Flashcards: `hints.json` cases and `hints.contract.test.ts` seen failing (14), then `hints.ts`; Starter tests seen
   failing (5), then `starter.ts`; ToneCard, card and hint DOM tests written with the code.
7. Scripts: `romaji.test.ts` seen failing (no module), then `romaji.ts`; page DOM tests written with the views.
8. Guard (`romanisation.lint.test.ts`, with planted cases), docs (wiki Development, Settings tour, Flashcards, Reader,
   Scripts trainer; record 0004; NEXT.md), e2e `hide-romanisation.spec.ts` at 360 px (checked to fail with romaji
   shown).

## Local follow-up

- Hand check on a phone (Android shell and a mobile browser): Settings → Study → Romanisation in a Chinese and a
  Japanese workspace; a Tones card with pinyin hidden (pads by character, the answer as tone numbers and contours);
  the kana trainer's Recall prompt with only the sound; a Chinese EPUB with pinyin ruby while pinyin is hidden.

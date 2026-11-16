# Unknown words and text coverage in the reader — design (issue #68, v0.3.0 stretch item 4)

Status: Draft (2026-11-16), written unattended; every non-obvious call is a
**Ruling: what — why — cost if wrong**. Nothing is built. Builds on reader display and smart readings
(#78, `2026-11-15-v030-reader-display-design.md`, `docs/contracts/reader/`), the decks view's add-to-deck
(`docs/contracts/decks/add-to-deck.json`) and the known-words predicate of #75
(`apps/web/src/lib/study/known.ts`, `2026-11-16-v030s-frequency-decks-design.md`), which is merged into the
collection branch before this build starts. Owner direction: **known uses the same mastery definition as
smart hiding (#78)**.

## What exists (checked on `feature/v030s-unknown-words` 2cd6e23 and #75's branch 96121d2)

- `POST /api/segment {lang, text, readings?}` (signed in, ≤ 5 000 code points) → greedy longest matches
  `{surface, start, end, lemma, entries:[{id, kind, reading?}], reading?}`. `annotations.ts` chunks a
  chapter (≤ 4 000 code points, visible paragraph first, 2 in flight, abort on change) and keeps the matches
  in a memory LRU of 6 chapters keyed `bookId:chapter:variant`. It runs only when readings are `always` or
  `smart` (`ReadingsController`, `readings.svelte.ts`).
- Smart hiding: `masteryIndex` (entry → best `cardScore` of its reviewed vocab cards) and
  `isKnown(match) = score(first candidate) ≥ smartThreshold` (`smartReadings.ts`). BookView builds the index
  from `loadStudyHistory` only in `smart` and reloads it on `onStudyWrite`.
- #75: `knownEntries(cards, scheduleOf)` = vocab cards with `cardScore ≥ MASTERY_THRESHOLD` (80), with the
  header "#68 adds a manual mark; extend this predicate, never fork it"; fixture `frequency/known.json`.
- Add-to-deck: `planAddToDeck` (create / join / skip, idempotent) + `addPlanRows` + `pushStudyRows`
  (200 rows per push). Popup "+" adds one vocab card (`AddToStudyButtons.svelte`).
- Level sessions create real `c-vocab-<entryId>` cards on the first grade (`levels/`), so level study is
  already visible as card state.
- No "known" mark exists. `stats/wordStates.ts` has an unrelated `WordState` (new/learning/young/mature of
  a card's FSRS schedule); this item uses its own name to avoid confusion.
- Backup restore remaps entry ids only inside `card:*` rows (`backup/remap.go` `PluginRow`).

## Non-goals

A placement test or "I know HSK 1–3" bulk mark (#74, #82), a server-side chapter cache or a persistent
client cache, known characters (only words/entries), a jump from the list to an occurrence, per-word
colours in entry pages, study cards or the journal, Android.

## Three states

`Familiarity = 'new' | 'learning' | 'known'`, per entry, decided for a match by its **first candidate**
(the entry whose reading smart mode shows):

1. **known** — the entry carries the learner's manual mark, **or** its best reviewed vocab card has
   `cardScore(stability) ≥ threshold`;
2. **learning** — otherwise, the entry has a live vocab card (reviewed or not);
3. **new** — otherwise.

Ruling: one predicate in `study/known.ts` serves the reader, smart hiding and #75's starter decks: a
`KnownIndex {scores, carded, marks}` and `familiarity(entryId, index, threshold)`; `knownEntries` keeps its
signature and gains the marks — the issue, #75's header and the owner direction all ask for one definition
— cost if wrong: none, it is one function.

Ruling: **the threshold is a parameter; the reader passes its `smartThreshold`, every other caller passes
`MASTERY_THRESHOLD`.** Inside the reader a word is coloured known exactly when smart mode hides its reading
(the owner's direction) and the learner's slider moves both. Starter decks (#75) keep the fixed 80: the
slider is a reader display setting, and letting it change what a deck copies would surprise — cost if
wrong: with a slider below 80 a word can look known in the reader and still join a starter deck (it already
has a card, so the add only joins it).

Ruling: **the manual mark wins over every card and every threshold**, for every caller: a marked word is
known in the reader, its reading is concealed in smart mode, and starter decks skip it. The card (if any)
stays and keeps being studied; the decks view's "mastered" numbers are card statistics and ignore marks —
cost if wrong: a learner who marks a word to hide it from the reader also hides it from starter decks
(the intent of "I know this").

Ruling: only the first candidate counts (as in smart hiding): a card on a homograph further down the list
does not make a match learning or known — the colour must agree with the reading the reader shows — cost if
wrong: a learner with a card on the second 了 entry sees 了 as new and can add or mark it from the popup.

Ruling: **level lists never make a word known or learning.** Membership in HSK 2 says nothing about this
learner; level study already shows through the cards level sessions create, and a bulk "I know these
levels" belongs to placement (#74/#82) — cost if wrong: an advanced learner marks the frequent words once
via the list's bulk "I know these" (below).

## The manual mark

Row `known:<entryId>` of plugin `qinqin-flashcards`, **workspace-scoped**, data
`{version: 1, entryId: int, createdAt: RFC 3339}`. Valid only when the key's number is a positive integer
equal to `data.entryId`; anything else is ignored. Unmarking tombstones the row; marking again revives it
under the same key (last write wins per key, so two devices never duplicate a mark).

Ruling: one row per entry, not one set row — per-key last-write-wins keeps marks from two devices, and the
pull/push and backup paths already handle thousands of rows — cost if wrong: a learner marking 5 000 words
pushes 25 requests once.

Ruling: workspace scope, like cards — entries belong to one language and a workspace is a language — cost
if wrong: two workspaces of the same language keep separate marks (as they keep separate cards).

Sync: ordinary plugin data, pulled with the study data (`StudyData.known?: number[]`, absent without rows)
and written by `PUT …/data/known:<id>` (one) or `pushStudyRows` (bulk; `pushStudyRows` learns tombstones
via `deletedAt`). Backup: plugin rows are exported generically, but the key carries an entry id, so export
lists the entry in `refs/entries.json` and restore remaps key and `entryId` like a derived card id; an
unresolved entry drops the row (counted in "dropped rows"). Contract case in `backup/remap.json`.

## Showing the states

Setting `highlightWords: boolean` in the workspace `reader` object (default `false`, per-field parse like
the others, toggled in the Display panel: "Mark words by how well I know them"). The threshold slider shows
when readings are `smart` **or** `highlightWords` is on; its text becomes "A word counts as known from a
memory score of 80".

- **new**: solid 2 px underline plus a light blue tint; **learning**: dotted 2 px underline plus a light
  amber tint; **known**: plain text. Text colour never changes (its contrast is untouched); the underline
  colours reach 3:1 against the page in light and dark themes (WCAG 1.4.11).
- Ruling: the non-colour cue is the underline style (solid vs dotted) and the absence of any mark for known
  words; a legend with both samples sits under the toggle — colour-blind and greyscale readers tell the
  states apart — cost if wrong: a third shape later.
- Ruling: known words are not marked — marking 90 % of a page is noise, the point is the unknown rest —
  cost if wrong: none, a later "show known too" toggle.
- Adjacent words of one state stay distinguishable: the underline and tint are background layers sized
  `calc(100% - 0.12em)` on the word's last piece, so each word ends in a small gap.
- Forced colours: tints drop, underlines fall back to `text-decoration` solid/dotted in `CanvasText`.
- Screen readers: the text is unchanged; the state is announced in the lookup popup ("New word",
  "Learning", "Known — marked by you" / "Known — memory score 85"), which is where the actions are.
  Ruling: no inline announcement — hearing a state before every word makes reading impossible — cost if
  wrong: an opt-in later.
- Rendering: ranges `{start, end, state}` per paragraph cut the runs like generated readings do and only add
  a class to existing `<span data-o>` / `<ruby>` pieces, so `dom.ts` offsets are unchanged (tested by the
  same round trip as readings). Ruling: inside a user highlight no state is drawn (the highlight wins, as it
  does over readings) — cost if wrong: an unknown word inside a highlight shows only in the panel's list.

## Coverage

Computed per paragraph from the matches and summed (`coverage.ts`, contract `reader/coverage.json`):

- **Token** = a match whose surface holds at least one word character: Han (incl. 々〆) for `zh`; Han, kana
  (hiragana, katakana, not `ー` alone) for `ja`. Punctuation, digits (ASCII or full width), Latin and symbols
  never form tokens. Han numerals (三, 百) are words and count.
- **Type** = the first candidate's entry id; inflected forms share their lemma's entry.
- **Unmatched** = maximal runs of word characters outside every match (names and rare words the dictionary
  lacks); reported as "N passages are not in the dictionary", never in the percentage.
- Coverage = known tokens / tokens, **floored** to a whole percent; `null` without tokens.
- Book coverage = summed token counts over chapters (token-weighted), not a mean of chapter percentages.
- Unknown list = types not known, by token count descending, then first occurrence; each with its lemma, the
  first match's reading when loaded, its count and state.

Ruling: running words (tokens), not distinct words — "you know 87 % of the words" is the reading-comprehension
measure readers expect (LingQ, Migaku, Learning-with-texts) and it moves when a frequent word is learned —
cost if wrong: types are already counted ("46 different new words" is shown beside it).

Ruling: kana-only words (particles, を, です) and proper nouns count like any other word; nothing is
filtered by part of speech (the dictionary has no reliable flags for both languages). A learner marks them
once with "I know these" — cost if wrong: a Japanese beginner's first figure is lower by the particles.

Ruling: unmatched runs stay out of the denominator — the learner can neither add nor mark them (no entry),
so a figure that can never reach 100 % would only frustrate — cost if wrong: coverage reads a little high
on name-heavy texts; the separate count says so.

Ruling: floor, not round — "100 %" must mean every counted word is known — cost if wrong: none.

## Loading and caching

Ruling: **one match source per chapter for readings, states and coverage**: `ReadingsController` loads
when readings are not `never`, **or** `highlightWords` is on, **or** the Words panel is open; it always
asks `readings: true` (the overlay is one batched query per request) so toggling readings later costs no
second segmentation; the existing LRU of 6 chapters is the per-chapter cache — cost if wrong: one segment
request per chunk pays a reading lookup it may not need.

- Invalidation: the key stays `bookId:chapter:variant` (the text). Card reviews, marks and the threshold
  never re-segment: states and coverage are recomputed from the cached matches and a new `KnownIndex`
  (reloaded on `onStudyWrite`, which every mark and add triggers). A pack update is seen after a reload.
  Memory only, as today: no IndexedDB (mastery and dictionaries change; reopening is cheap).
- Coverage is shown only when every paragraph of the chapter is loaded; before that the panel says
  "Counting… 5 of 12 parts"; failed chunks show "Some parts could not be counted" with Try again.
- **Book coverage** is on demand ("Count the whole book"): chapters are fetched and segmented one after
  another through a separate loader (2 requests in flight, abortable, progress "Chapter 12 of 40"); only a
  small per-chapter tally `{entry → count, first occurrence, lemma, reading}` plus the unmatched count is
  kept, in memory for the life of the book page, keyed `bookId:chapter:variant`; the open chapter's tally
  comes from the reader's matches. Ruling: client-side, on demand, not a server route — the variant
  conversion is client-side and a server chapter cache was declined in #78 — cost if wrong: a long novel
  takes a minute per visit; a server tally route later.

Performance budget (checked in the real-app check and by a timing-reporting unit test):

| Step | Budget |
| --- | --- |
| one 4 000-code-point chunk, `readings: true`, on this machine | ≤ 400 ms server time |
| a 30 000-code-point chapter fully loaded (8 chunks, 2 in flight) | ≤ 2 s |
| states + coverage + list for 30 000 tokens (pure, recomputed after a review) | ≤ 50 ms |
| whole-book count, 300 000 code points | ≤ 60 s with progress (on demand) |

Only new and learning words add pieces; with highlighting on, the DOM holds no more pieces than readings
`always` would.

## The Words panel and adding

A fourth rail tab **Words** (beside Bookmarks, Highlights): "You know 87 % of the words in this chapter",
"1 234 of 1 420 words · 46 different new words · 12 learning", the unmatched note; a Book section with the
button or the book figure; the list (scope: this chapter, or the whole book once counted), top 50 with
"Show 50 more", each row with a checkbox, lemma, reading, `×count` and a state chip with text.

Actions under the list, for the chosen deck (General plus the workspace's decks, General first):
- **Add selected (N)** and **Add all new words (M)** — `planAddToDeck` over the items, in list order
  (`createdAt = now + i ms` keeps the most frequent first); `written` comes from `POST /api/entries/bases`
  (the same snapshot the decks view uses), in chunks of 500. The result line names created and joined
  counts ("Added 40 words to General; 3 already had cards and joined it").
- **I know these (N)** — writes `known:` rows for the selection; the note offers **Undo** (tombstones
  exactly those rows) until the next action.
Ruling: "Add all" means all **new** words of the scope, not learning ones — they already have cards; a
selected learning word joins the deck as in the decks view — cost if wrong: one click to select them.

Ruling: no sentence is saved with a bulk add (the popup's "+" keeps saving its sentence) — 40 sentences
picked by the first occurrence would be guesses — cost if wrong: the learner adds sentences per word.

Popup: next to "+", an **I know this** toggle (pressed state `aria-pressed`) writing or tombstoning the
mark, and the state line above it when highlighting is on. Writes go to the book's workspace, as "+".

## Testing

Pure modules with unit tests and contract fixtures decoded by web tests: `reader/word-states.json`
(states, rows), `reader/coverage.json`, new cases in `reader/smart-readings.json` (a mark conceals),
`reader/display-settings.json` (`highlightWords`), `frequency/known.json` (marks), `backup/remap.json`
(a `known:` row follows its entry, an unresolved one is dropped; also decoded by the Go test). jsdom: the
rendered classes and the `dom.ts` round trip, the Display toggle and legend, the Words panel (progress,
figures, selection, add twice adds nothing, mark and undo), the popup toggle. Go: backup export refs and
restore remap of `known:` rows. Real-app check on a built server with `cedict` and `jmdict`.

## Risks

- Japanese segmentation splits some inflections or compounds differently from what learners call a word;
  the figure is honest about the dictionary's view.
- Greedy longest match can glue a known word to its neighbour into a longer unknown entry; the popup shows
  the match, and the learner can mark it.
- A whole-book count on a very long book sends many requests; it is explicit, cancellable and per user.

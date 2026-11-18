# Stats contract: the summary numbers and reviews per day

Issue #105 (Stats in the lighter look), in-app only. Rule source:
`docs/superpowers/specs/2026-11-16-visual-rework-design.md` §9 "Stats"; every number is a reuse of a rule
defined elsewhere: the learner's day (`docs/contracts/study-day/`), the streak (`docs/contracts/scheduler/`),
the known-word predicate (`docs/contracts/frequency/`, `known.json`), the decks page's overall 30-day figure
(`docs/contracts/decks/`) and the study-time amount (`docs/contracts/goals/`). Every client (web, Android)
implements the same numbers and runs `summary-numbers.json`. Fixture format: see `docs/contracts/README.md`.
The server is unchanged: no Go decoder reads this folder.

The numbers are **never stored**: no row, no row key, no cached statistic. They are derived from the event
log and the live rows every time Stats → Overview is shown.

## The four summary numbers

| Number | Definition |
| --- | --- |
| Streak | `dailyStreak(reviews, now, day, vacation).current` — the same number the flashcards widget shows (`docs/contracts/scheduler/`, streak rules: consecutive learner days with a review, vacation days neutral, the current run counts back from today or from yesterday while today has none) |
| Words known | the number of entries `known` by the one known predicate (`docs/contracts/frequency/`, `known.json`): its entry ids are the live manual `known:<entryId>` marks plus the entries whose live **vocab** card has a schedule whose card score is at least 80 (`MASTERY_THRESHOLD`) |
| Recall, last 30 days | the decks page's **overall** figure (`docs/contracts/decks/`): `deckNumbers({deckId: null})` gives `retention` and `retentionBase`; the share is `null` below `RETENTION_MIN_REVIEWS` (10 eligible reviews), and `retentionBase` says how many reviews it was computed from |
| Studied this month | the sum of `studySeconds` (`docs/contracts/goals/`, the `flashcards:studyTime` metric) over the learner days from the first day of the **calendar month of `today`** through `today` |

The window of the review statistics is the **30 learner days ending today**: `today − 29 … today` inclusive,
made of civil dates (`addDays`), never of 30 × 24 hours. A review belongs to a day by `day.of(ts)`.

Rulings (copied from the implementation plan, because they define the numbers):

- Ruling: "words known" = entries `known` by the one known predicate (a live known mark or a live vocab card
  at the mastery threshold), not the decks page's "Mastered" (cards only) — the reader and the starter decks
  use the same predicate, so the number matches what the reader underlines — cost: it can be higher than
  "Mastered" on the decks page.
- Ruling: "studied this month" = flashcards study time (`studySeconds`, the `flashcards:studyTime` goal metric
  and the weekly "Study time" row) over the learner days of the current calendar month; reading time stays in
  its own widget — one definition of "studied" across goal, week and Stats — cost: a learner who only reads
  sees 0 here (the reading widget sits below).
- Ruling: recall = the decks page's overall 30-day figure, and the decks page's label changes to "Recall,
  last 30 days" — design §10 renames the number; one number keeps one name — cost: a wiki line and a value
  change in the catalogue.

## Reviews per day (the chart)

The chart draws the last 30 learner days. A day's count is the number of **valid reviews** of the shown
workspace whose `dayOf(ts)` is that date (the review-log rule of `docs/contracts/scheduler/`: a parseable
`ts`, a non-empty `cardId`, a grade 1–4). Every review counts once, including the first review of a card;
reviews of a card that has since been deleted stay in the chart, because they happened. The series is always
30 entries, zero-filled, oldest first, and today is flagged (the client names it "today"). A review older
than the window is not in the series but may still be in the month's study time or the streak.

## A workspace only

The client passes the history of one workspace. The functions also drop events whose `workspaceId` is not
the given workspace, so a caller that hands the whole local log cannot mix two workspaces. Reviews of other
workspaces are never counted in any of the four numbers or the series.

## When flashcards are off

The two core widgets read flashcards data, so with the feature switched off the summary widget says
"Switch on flashcards in Settings → Features to see these numbers." and the reviews chart is left out (no
reviews can be made). The Stats → Overview page keeps its widget grid; plugins' widgets stay after the default
arrangement.

## The default arrangement (`statsOrder`)

Stats → Overview shows the design's default arrangement first, then every other available widget in registry
order (core, features, plugins; a plugin widget is never dropped):

1. `summary-numbers`
2. `word-states`
3. `flashcards-summary`
4. `reviews-per-day`
5. `activity-heatmap`
6. `character-map-summary`
7. `reading-time`

A widget whose id is in the list but unavailable (the character map in a Spanish workspace, a switched-off
feature) is simply absent; the rest keep their relative order. A client may place unknown widgets after the
default arrangement.

## Fixtures

`summary-numbers.json`: cases `{name, note, now, zone, cards, reviews, marks, vacation, schedules?, expect}`.

- `zone` is the learner's zone (`studyDay` with one zone change at `null`); `now` is an RFC 3339 instant.
  The fixture's `now` and `zone` define `today`; a case may state it in its note.
- `cards` are the live cards (a deleted card is absent), `reviews` the local review log events
  `{id, cardId, ts, grade, mode?, durationMs?}` of the shown workspace, `marks` the live `known:<entryId>`
  entry ids, `vacation` the merged vacation runs (`{start, end}`) of the workspace.
- `schedules` gives a card's derived schedule explicitly (`{state, stability, difficulty, due}`), so a case
  that depends on the known threshold does not depend on FSRS parameters; a card without an entry has no
  schedule (never reviewed).
- `expect` is `{streak, wordsKnown, recall: {share, base}, studiedSeconds, reviewsPerDay}`;
  `reviewsPerDay` lists only the non-empty days as `[day, count]` (the client always pads to 30).

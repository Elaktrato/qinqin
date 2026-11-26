# Placement test and "I already know this" — design (issue #74)

New learners tell the app what they know. Nothing here creates a card.

## Known by declaration

The reader's manual mark (#68) already is the declaration: the workspace keyed row `known:<entryId>`. Every
consumer of the shared predicate (`lib/study/known.ts`: the reader's word colours and coverage, smart readings,
Stats "words known", lookups, starter decks) already lets a mark win over cards. So a range or a placement
result is written as `known:` rows, for words and for character entries alike. No new storage, no server code.

Each row a declaration writes also carries `batch` (a ULID), `source` (`range` | `placement`) and `scope` (a
label such as "HSK 3.0 · up to HSK 3"). Readers that do not know the fields ignore them (`reader/word-states.json`
"extra fields are irrelevant"). The batch is what makes **undo** possible after the page was left.

- Ruling: declared words are `known:` rows with an optional batch, not a new row family or a range row — every
  client, the backup (rows are exported and remapped by entry) and every consumer already understand the row; a
  range row would force each consumer to resolve level lists — cost if wrong: an N1 declaration writes about ten
  thousand small rows (200 per request) instead of one.
- Ruling: a declaration never overwrites a live mark — the existing row keeps its origin (a reader mark stays a
  reader mark and is not undone with a batch) — cost if wrong: a batch can be smaller than its range.
- Ruling: known by declaration is not mastery — the card score, the map's colours and "L of N learned" stay
  reviewed mastery only; a declared word is "known" for the reader, stats and starter decks, and a card, if the
  learner later makes one, schedules normally from new — cost if wrong: a learner who declares HSK 1-3 still sees
  empty characters on the map until they review them; showing declarations there is a map change for a later issue.
- Ruling: undo tombstones exactly the rows still carrying the batch, never a mark made by hand since — cost if
  wrong: a word the learner re-marked by hand after the declaration survives the undo.

## Offered where

- Settings → Study → "What you already know": declare a range (scheme, "everything up to" a level, a preview
  of how many words are new marks, an explicit confirm), the list of declarations with Undo, the placement test.
- Home: a card offers it while the workspace has no card, no mark and no declaration and a level scheme is
  installed for its language; dismissing it is remembered on the device (a convenience, `localStorage`).

## Placement test

Self-assessed recognition (the level lists carry the written form and readings, not meanings): each item shows a
word or character; the learner answers "I know it" or "Not sure". "Not sure" counts as not known. A probe is
up to 4 random items of one level; the level passes at 3 known, stops early when decided. The levels are searched
by bisection: probe the middle level, a pass moves the search up, a fail down; the placed level is the highest
level passed (0 = none), at most `ceil(log2(L+1))` probes. Items come from a seeded PRNG (mulberry32), so a seed
replays the whole test. The result screen proposes "mark everything up to <level>" with the level changeable and
the number of new marks shown; nothing is written before the confirm button, and the written declaration is
undoable. The test can be repeated: a new run gives a new proposal and never lowers or removes what was marked.

- Ruling: self-report, not multiple choice — level lists have no glosses and no new data is allowed; the
  confirm step plus undo bound the damage of an over-optimistic click — cost if wrong: placement over-estimates
  for a learner who clicks "I know it" too freely.
- Ruling: bisection, not a per-level sweep — a beginner answers about 8 items, not 40 — cost if wrong: a learner
  with holes (knows HSK 5 words but not HSK 3) is placed by the middle probes only; the editable proposal covers it.

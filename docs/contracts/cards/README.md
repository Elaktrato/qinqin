# Card ids, burying and cloze (reverse and cloze cards, #65)

Rules every client implements identically. Fixtures: `{"version":1,"rule":"cards/<name>","cases":[...]}`.

## Card kinds and ids

Kind order everywhere: `vocab, sentence, writing, tone, reverse, cloze`. Opt-in kinds: `reverse`, `cloze`.

| Kind | Stored id | Dedupe `cardKey` | Virtual (planned, not created) id |
|---|---|---|---|
| vocab | `c-vocab-<entryId>` | `vocab:<entryId>` | `level:<entryId>` (level sessions) |
| sentence | `c-sentence-<entryId>` | `sentence:<entryId>:<sentenceId>` | `companion:sentence:<entryId>` |
| writing | `c-writing-<entryId>` | `writing:<entryId>` | `companion:writing:<entryId>` |
| tone | `c-tone-<entryId>` | `tone:<entryId>` | `companion:tone:<entryId>` |
| reverse | `c-reverse-<entryId>` | `reverse:<entryId>` | `companion:reverse:<entryId>` |
| cloze | `c-cloze-<entryId>` | `cloze:<entryId>` | `companion:cloze:<entryId>` |

One cloze card per entry; its id never names a sentence (the sentence is chosen per showing).
Fixture: `card-ids.json` (`kind`, `entryId`, `sentenceId?`, `id`, `cardKey`, `virtualId?`).

## Data

- Deck switch: plugin-data key `deckcfg:<deckId>` -> `{deckId, cardTypes: ["reverse"|"cloze"], updatedAt, ...unknown fields kept}`.
  Absent or unparsable = no opt-in kinds. Works for `general`.
- A vocab row may carry `skipKinds: [kind]` (non-vocab kinds the learner removed for that word); duplicates union it.
- Mastery counts only `vocab, sentence, writing, tone`. Reverse and cloze count as reviews for XP
  (`reverse` 10, `cloze` 15), streaks, heatmap and the optimizer.
- Old clients ignore unknown card kinds and read an unknown review mode as `vocab`.

## Burying (`burying.json`)

Card C is buried at `now` iff some other live card S of the same entry has a recorded review R with
`day(R.ts) === day(now)` (the learner's day, `docs/contracts/study-day/`) and `buries(S.kind, C.kind)`,
where `buries(a, b) = a in {reverse, cloze} or b in {reverse, cloze}`. The four existing kinds never bury
each other. Reviews of cards that no longer exist bury nothing; a card is never buried by its own reviews;
Again counts. Buried cards stay due, nothing is rescheduled; they leave the queue and the due counts before
any limit is applied. For virtual items the same rule yields keys `<kind>:<entryId>` for every kind
(also kinds without a card) that an answered sibling of another kind buries.

Case: `{name, now, today, cards: [{id, kind, entryId}], reviews: [{cardId, ts, day, grade}],
buriedCardIds, buriedKeys}`. `day` is precomputed so the fixture does not depend on zone rules.
Lists are compared as sets.

## Cloze (`cloze.json`)

One cloze card per entry (`c-cloze-<entryId>`). Per showing, nothing stored:

1. Candidates = the first 8 sentences of the entry in server order whose text is not blank (blank ones do not
   count towards the 8; a client segments at most these). Eligible sentences = the candidates whose text has at least
   one blank span.
2. Blank spans (code-point offsets, half-open) = the segmenter matches (`POST /api/segment`) whose
   `entries[].id` contains the entry id; if none, the non-overlapping leftmost occurrences of the written
   form and of every form text, longest first, except an occurrence lying inside a strictly longer segmenter
   match (中国 inside 中国人). All spans are blanked; the first span is the answer slot,
   the others show the same gap marker.
3. Shown sentence = `eligible[n mod len]`, n = the card's number of recorded reviews.
4. Answer = the code points of the first span.

Case: `{name, cardId, entry: {id, written, forms?: [{text}]}, sentences: [{id, hanzi}],
matchesBySentence: {"<id>": [{start, end, entries: [{id}]}]}, reviews: n, eligibleIds, shownId (null),
spans: [[s, e]], before, after, answer}`; `before`/`after` are arrays of strings and extra gaps `{"gap": true, "answer": "<that span's own text>"}`
(shown after the answer, so 食べて … 食べた keep their own forms).

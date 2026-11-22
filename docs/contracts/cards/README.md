# Card ids, burying, cloze, deck sessions and the session mix (reverse and cloze cards, #65; #132)

Rules every client implements identically. Fixtures: `{"version":1,"rule":"cards/<name>","cases":[...]}`;
`deck-session.json` has three case lists instead: `plans`, `steps`, `eligible`; `session-mix.json` has `keys`,
`gaps`, `queues`.

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

- Deck switch: the typed `deckSettings` row of the deck (`study/README.md`; legacy key `deckcfg:<deckId>`)
  -> `{deckId, cardTypes: ["reverse"|"cloze"], newOrder, extra}`; unknown members are kept in `extra`.
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

## Deck sessions (`deck-session.json`)

A deck session studies the cards of the chosen decks (`deckIds`) and kinds (`kinds`) with a session new-card
limit (`newLimit`) and review limit (`reviewLimit`). Level sessions follow their own plan
(`levels/character-level-queue.json`). `deckSessionPlan` (web: `lib/study/cardFlow.ts`, with
`companions.ts` and `scheduler.ts` `buildQueue`) returns `{queue, reserve, backfillLeft}`; `plans` cases pin
the ids of each, decoded by `apps/web/src/lib/study/cardFlow.test.ts`. Inputs: zone `history`, `now`,
`language`, `cards`, `reviews` (`{cardId, ts, grade}`; event ids are given in list order, `mode` is the card's
kind), optional `vacation` runs, `limits` rows (`scheduler/`), `deckSettings` (deck id → enabled opt-in kinds),
`newRank` (entry id → frequency rank, the `orderNew` key of `frequency/`), `skip` and `offline`; `weights`
`"default"` is `default_w` (`scheduler/fsrs.json`).

1. **Nothing on a vacation day**: today inside a vacation run gives an empty queue and reserve.
2. **Session kinds**: `kinds` without `tone` unless the workspace language is Chinese (`zh`, `zh-*`, `zh_*`).
3. **Before the limits** leave: cards outside the session decks or kinds; cards **buried** today (an opt-in
   card of a word answered today, `burying.json`); a non-vocab card whose word's vocab card lists its kind in
   `skipKinds`; a reverse or cloze card without a vocab card of its word, or without a session deck (among its
   own decks) whose `deckSettings` enable its kind. They never use up a slot.
4. **Real cards** (`buildQueue`): due cards first, earliest due first, equal due by id; then never-reviewed
   cards in the order added (`createdAt`, then id) or by `orderNew` with the frequency key (ranked first by
   rank, unranked after them in the order added); admitted by the daily limits of `scheduler/` and the
   session limits (`daily-limits.json`).
5. **Companions** (virtual items, created on their first grade): for every vocab card in a session deck,
   oldest first (`createdAt`, then id), one item per selected companion kind it has no card of: `sentence`,
   `writing`, `tone`, then the opt-in `reverse` and `cloze`. Never for a kind the word skips, a `kind:entryId`
   in `skip` (remembered ineligible), a kind buried today, or writing when the vocab card's `written` snapshot
   has no Han character (no snapshot: decided when shown). Character vocab cards (`entryKind: "character"`)
   get only writing, from the learner day after their first review. Opt-in kinds: only from a session deck that
   enables them, never for a word with a queued real card, **at most one per word, reverse preferred** (cloze
   when reverse cannot be planned). Items are taken round-robin by kind (one of each kind per round, in kind
   order). **Offline nothing is planned** (a companion becomes a card by a row write; the offline outbox
   carries review events only).
6. **Budget and reserve**: companions are new cards. The queue holds the real cards, then the companions the
   session's new limit still admits (after the real new cards) and each deck's daily new limit allows; the
   companions the daily limits allow beyond the session limit are the **reserve**, in planning order.
7. **`backfillLeft`** = `backfillLimit(newLimit)` = `max(30, 2 · max(0, floor(newLimit)))`.

`steps` cases replay the runner's two queue edits on a plan:

- `drop` (`dropItem`): an item that proved ineligible leaves the queue. A dropped **virtual** item frees its
  slot: the first reserve item is appended while `backfillLeft > 0` (which then decreases); a dropped real card
  frees nothing; an unknown id changes nothing.
- `bury` (`buryAfterAnswer`): after an answer at `index`, every later item of the same word (another card,
  not a re-show) that the answer buries (`burying.json`: either kind opt-in) is removed, each like a `drop`;
  `buried` counts them.

`eligible` cases pin `isEligible(kind, entry, ctx)`, decided when an item is about to be shown: vocab always;
sentence when a sentence resolved; writing when the word has Han characters with stroke data (`usableChars`)
and is not a character entry without glosses; tone when the workspace language is Chinese and a pinyin
reading parses as clean toned pinyin (tone marks, not numbers); reverse for a `word` entry with a gloss;
cloze when an eligible cloze sentence resolved.

Ruling: the fixture pins the **plan** and eligibility, not which sentence a sentence card shows or how a
virtual item is graded — sentence choice and cloze are already pinned (`cloze.json`), grade suggestions are
deferred (spec D2) — cost: none.


## Session mix (`session-mix.json`, #132)

The order of the card types inside a session, applied **after** the plan (deck sessions above, level sessions
`levels/`): it reorders the planned queue and never adds, drops or re-admits an item, so limits, caps, the
reserve and burying are unchanged. Web: `lib/study/sessionMix.ts` (`mixSession`, `mixFlowQueue`), decoded by
`apps/web/src/lib/study/sessionMix.test.ts`. Spec: `docs/superpowers/specs/2026-11-22-mix-card-types-design.md`.

- **Blocks**: the due block (a real card with a valid review) and the new block (never reviewed or virtual), each
  keeping its items; output `[...due, ...new]`.
- **Order** (the session setup's `typeOrder`, absent = `mixed`): `grouped` sorts each block stably by kind order
  (`vocab, sentence, writing, tone, reverse, cloze`), incoming order inside a kind; no seed, no spacing.
- **Mixed**, per block of `N` items:
  1. item `j` (0-based, incoming order) of a kind with `n` items gets `p = ((j + 0.5) / n) * N`;
  2. `key = p + 8 * mixKey(seed, cardId)` (`MIX_SPREAD = 8`); sort ascending, ties by kind order, then `j`;
  3. spacing, one item per step; `sep(word)` = items placed since that word's (`entryId`) last item, infinite if
     none, the due block's output counting for the new block. With `R` items left and `r` of a word's: the first
     item whose word has `2r - 1 >= R` and `sep >= 1` goes now; else, for `need = gap … 0`, the first item whose
     word has `sep >= need`;
  4. `gap = typeGap(N)` = 1 if `N < 8`, 2 if `N < 16`, else 3.
- `mixKey(seed, cardId) = randomKey(seed)(fnv1a32(cardId))`: FNV-1a 32 over the UTF-8 bytes (offset `0x811c9dc5`,
  prime `0x01000193`, unsigned), passed to `randomKey` (`frequency/` new order: `seed | 0`, `id | 0`, the
  `0x9e3779b1`/`0x85ebca6b` mix, result `/ 2^32`). Doubles throughout; evaluate `p` exactly as written.
- `seed` is the session's seed (drawn when the setup's Start is pressed, the same one the random new order uses),
  so a reload of the same session gives the same queue for the same items, and the next session another one.
- Never back to back: whenever no word holds more than `ceil(R / 2)` of a block's `R` items, no two neighbours in
  the block share a word. When the gap cannot be met (one word's four types) the result is the deterministic best
  effort above.
- Unchanged: Again re-shows (`requeueAfterGrade`, after 4 other cards), reserve replacements (appended at the
  end), burying in the session (`bury` steps above: only when an opt-in kind is on either side).

Case: `keys`: `{cardId, seed, fnv, key}` (exact doubles); `gaps`: `{n, gap}`; `queues`: `{name, note?, seed, order,
items: [{cardId, kind, entryId, review}], expect: [cardId]}` (`items` in plan order).

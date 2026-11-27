# Card ids, burying, cloze, eligibility, deck sessions, the session queue, the session mix and hints (reverse and cloze cards, #65; #132; #175; #215; #288)

Rules every client implements identically. Fixtures: `{"version":1,"rule":"cards/<name>","cases":[...]}`;
`deck-session.json` has three case lists instead: `plans`, `steps`, `eligible`; `session-mix.json` has `keys`,
`gaps`, `queues`; `session-queue.json` has `noLimit` and `cases`; `hints.json` has `kinds`, `modes`, `notApplicable`,
`defaults`, `settings`, `plans`, `grades`, `results` (below).

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

Card C is buried at `now` iff some other live card S of the same entry has a recorded review R (not replaced,
`events/review-replace.json`; a replacement keeps the target's `ts`, so a changed grade buries the same) with
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
   `entries[].id` contains the entry id (for an entry whose written form has a Han character, a match whose text has
   none, such as はし for 橋, counts only when the entry is its first candidate, `entries[0]`: a later candidate is a
   homophone); if none, the non-overlapping leftmost occurrences of the written
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
(`levels/character-level-queue.json`). `deckSessionPlan` (web: `lib/features/flashcards/session/cardFlow.ts`, with
`companions.ts`, `scheduler.ts` `queueCandidates` and `sessionQueue.ts`) returns `{queue, reserve, backfillLeft}`; `plans` cases pin
the ids of each, decoded by `apps/web/src/lib/features/flashcards/session/cardFlow.test.ts`. Inputs: zone `history`, `now`,
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
   in `skip` (ruled out by the eligibility index, below), a kind buried today, or writing when the vocab card's
   `written` snapshot has no Han character (no snapshot: decided when shown). Character vocab cards (`entryKind: "character"`)
   get only writing, from the learner day after their first review. Opt-in kinds: only from a session deck that
   enables them, never for a word with a queued real card, **at most one per word, reverse preferred** (cloze
   when reverse cannot be planned). Items are taken round-robin by kind (one of each kind per round, in kind
   order). **Offline nothing is planned** (a companion becomes a card by a row write; the offline outbox
   carries review events only).
6. **Budget and reserve** (the session queue below, over the real cards then the companions): companions are
   new cards. The queue holds the real cards, then the companions the session's new limit still admits (after
   the real new cards) and each deck's daily new limit allows; the new items (real or companion) the daily
   limits allow beyond the session limit are the **reserve**, in planning order, at most `backfillLeft` items.
7. **`backfillLeft`** = `backfillLimit(newLimit)` = `max(30, 2 · max(0, floor(newLimit)))`; `NO_LIMIT` with
   Study all.
8. **Study all** (`studyAll`): the session queue's rule — no session caps and no daily limits, not even the
   default 20/200.

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


## Eligibility (`eligibility.json`, #288)

Which companion cards an entry can make is decided **when the session is planned**, not when the card is shown, so
the counts (the study modal's "This session", the home widget, the session counter) only promise cards the session
shows. The rules are the show-time rules above (`eligible`), moved to planning:

| Kind | Eligible when | Decided by |
|---|---|---|
| `sentence` | the entry has a sentence whose text is not blank (JavaScript `trim`) | server |
| `cloze` | one of the first 8 non-blank sentences has a blank span (`cloze.json`), with the server's segmenter (`POST /api/segment`, deinflection and lemma packs included: 食べた in a sentence counts for 食べる and the card blanks 食べた); a language the server cannot segment has no cloze | server |
| `tone` | a tonal language (`languages/`) and a pinyin reading that parses as clean toned pinyin (tone marks, no numbers or punctuation; a lone neutral `r` joins the syllable before it) | server |
| `reverse` | a `word` entry with at least one gloss | server |
| `writing` | a Han character of the written form has stroke data in an installed strokes pack (whatever its language), and the entry is not a `character` without glosses | server |

The sentences are those the viewer may see (pack sentences, then the viewer's own); the written form and readings
are the viewer's (their entry patch applied). Another user's sentences never count.

**Route.** `POST /api/study/eligibility {"ids": [<entry id>, ...]}` (1 to 500 positive ids; duplicates once) →
`200 {"entries": {"<id>": ["sentence", "writing", "tone", "reverse", "cloze"]}}`, each list in kind order, every asked id
answered, an unknown entry with `[]`. `400 bad_request` for a malformed body or ids, `401` without a session, `429
rate_limited` while the user's segmentation slots (shared with `POST /api/segment`) are taken. No access tokens; not
cached by the service worker (an offline session plans no companions).

**Planning.** A client keeps the answers as an index per session. A companion is planned only when the index
lists its kind for the entry (`skip` in the deck-session cases:
the `kind:entryId` keys the index rules out). An entry the index does not know yet (not asked, or the request failed)
is planned as before and checked when shown. A card that still turns out unusable when shown (a pack removed since
planning) is dropped and the client removes the kind from the entry's index row; `dropItem` replaces a dropped
companion from the reserve, which holds eligible items only, so the counter never drops by more than the cards
removed. Entries are asked again after 10 minutes, and adding a sentence forgets the entry.

Case: `{name, entry: {id, language, kind, written, forms: [{text}], readings: [{type, value}], glosses},
segmentable, sentences: [{id, hanzi}], matchesBySentence: {"<id>": [{start, end, entries: [{id}]}]}, strokes, kinds}`;
`glosses` is the number of glosses; a sentence without `matchesBySentence` has no match; `strokes` are the characters
with stroke data. Go:
`server/internal/eligibility/contract_test.go`; web: `apps/web/src/lib/features/flashcards/session/eligibility.contract.test.ts`
(the same cases through the show-time rules).

## Session queue (`session-queue.json`, #175)

The admission every session shares: deck sessions (above), level sessions (`levels/`) and the counts (due/new
numbers, "left today"). Each lists its **candidates** in queue order its own way, `{cardId, deckIds, bucket}` with
`bucket` = `continuing` (due, already reviewed today), `review` (due) or `new` (never reviewed, or virtual); the
builder never reorders them. Web: `lib/features/flashcards/session/sessionQueue.ts` (`admitSession`, `buildSessionQueue`), decoded by
`apps/web/src/lib/features/flashcards/session/sessionQueue.test.ts`. Spec: `docs/superpowers/specs/2026-11-23-queue-builder-design.md`.

1. **Vacation day** (`vacationToday`): nothing is admitted; queue and reserve are empty, `left` is all zero.
2. **Caps**: `cap(x)` = `floor(x)` for a finite `x`, at least 0 (fixture caps such as `1.7` and `-2`); anything
   else is 0. **Study all** (`studyAll`) uses `noLimit` (1 000 000) for both caps and treats every deck as
   unlimited (`limitsOf` is not consulted, so the 20/200 defaults do not apply); nothing else changes.
3. **Admission**: `scheduler/README.md` "Limits" (`admit`) with those caps, the limit rows (`limits`: `workspace`,
   `decks`, `existingDecks` — `null` means every named deck exists) and today's `counts` (`newDone`,
   `reviewDone` per deck). `inSession` is that pass; `inAllowance` the same with no new-card cap (the review cap
   kept); `left` the pass with no session cap.
4. **Queue** = candidates in `inSession`, in order. **Reserve** = candidates in `inAllowance` and not in
   `inSession` (always new items), in order, at most `backfillLeft`.
5. **`backfillLeft`** = `noLimit` with Study all, else `max(30, 2 · cap(newLimit))`.

Case: `{name, vacationToday, studyAll, caps: {newLimit, reviewLimit}, limits, counts, candidates, expect: {queue,
inAllowance, reserve, backfillLeft, left: {reviews, new, unlimited, limitedOut}}}`.

Unreadable rows (`sync/unreadable-rows.json`) are not candidates: they are absent from the cards, planning writes
nothing, and a card created from a virtual item takes the next free id (`freshCardId`).

## Session mix (`session-mix.json`, #132)

The order of the card types inside a session, applied **after** the plan (deck sessions above, level sessions
`levels/`): it reorders the planned queue and never adds, drops or re-admits an item, so limits, caps, the
reserve and burying are unchanged. Web: `lib/features/flashcards/session/sessionMix.ts` (`mixSession`, `mixFlowQueue`), decoded by
`apps/web/src/lib/features/flashcards/session/sessionMix.test.ts`. Spec: `docs/superpowers/specs/2026-11-22-mix-card-types-design.md`.

- **Blocks**: the due block (a real card with a valid review) and the new block (never reviewed or virtual), each
  keeping its items; output `[...due, ...new]`.
- **Order** (the session setup's `typeOrder`, absent = `mixed`): `grouped` sorts each block stably by kind order
  (`vocab, sentence, writing, tone, reverse, cloze`), incoming order inside a kind, then runs the spacing of step 4
  below with `gap = 1` (so a word is not back to back at a seam between two groups; vocab first applies); no seed.
- **Vocab first** (`vocabFirst`, deck sessions only): in the new block a non-vocab item may not go while a vocab
  item of its word is left in the block, so a new word's Recognise card comes before its other types. Items that
  may not go take no part in any step below (the counts `r` still count them). Level sessions leave it off: a
  character level gates new writing by learner day itself (`levels/README.md`).
- **Mixed**, per block of `N` items:
  1. position `p`: in the **due block** `p = i`, the item's 0-based index in the block (due order, so the most
     overdue cards stay early whatever their kind); in the **new block** item `j` (0-based, incoming order) of a
     kind with `n` items gets `p = ((j + 0.5) / n) * N` (the kinds spread evenly);
  2. `key = p + 8 * mixKey(seed, cardId)` (`MIX_SPREAD = 8`), or `key = p` when the block holds a single kind
     (its incoming order stays); sort ascending, ties by kind order, then `j`;
  3. `gap = typeGap(N)` = 1 if `N < 8`, 2 if `N < 16`, else 3;
  4. spacing, one item per step; `sep(word)` = items placed since that word's (`entryId`) last item, infinite if
     none, the due block's output counting for the new block. With `R` items left and `r` of a word's: the first
     item whose word has `2r - 1 >= R` and `sep >= 1` goes now; else, when `gap > 1`, among the items whose word
     has `r >= 2`, `sep >= gap` and `(r - 1) * (gap + 1) + 1 >= R - 2`, the first item of the word with the most
     left (strictly more wins, so ties keep the earliest); else, for `need = gap … 0`, the first item whose word
     has `sep >= need`.
- `mixKey(seed, cardId) = randomKey(seed)(fnv1a32(cardId))`: FNV-1a 32 over the UTF-8 bytes (offset `0x811c9dc5`,
  prime `0x01000193`, unsigned), passed to `randomKey` (`frequency/` new order: `seed | 0`, `id | 0`, the
  `0x9e3779b1`/`0x85ebca6b` mix, result `/ 2^32`). Doubles throughout; evaluate `p` exactly as written.
- `seed` is the session's seed, drawn fresh at every Start (the setup page and a deck's or level's Study button
  alike; the same one the random new order uses) and kept in the tab's setup, so a reload of the same session gives
  the same queue for the same items and the next session another one. A setup without a seed gets one drawn once
  per tab (`qinqin.study.sessionSeed`), never one per load.
- Never back to back, per block: when nothing was placed before the block, no two neighbours in it share a word
  whenever no word holds more than `ceil(R / 2)` of its `R` items. After a placed prefix (the new block after the
  due block) the same holds, the seam to the prefix included, when moreover the word placed last holds at most
  `floor(R / 2)` of them; otherwise the seam is best effort. Vocab first never breaks it (a word's vocab item can
  always go). When the gap cannot be met (one word's four types) the result is the deterministic best effort above.
- Unchanged: Again re-shows (`requeueAfterGrade`, after 4 other cards), reserve replacements (appended at the
  end), burying in the session (`bury` steps above: only when an opt-in kind is on either side).

Case: `keys`: `{cardId, seed, fnv, key}` (exact doubles); `gaps`: `{n, gap}`; `queues`: `{name, note?, seed, order,
vocabFirst, items: [{cardId, kind, entryId, review}], expect: [cardId]}` (`items` in plan order).

## Hints (`hints.json`, #215)

Optional help a learner asks for during a review instead of looking at the answer, on every card kind. Web:
`lib/features/flashcards/face/hints.ts` (`HINT_REGISTRY`, `readHintSettings`, `resolveHints`, `lowerForHints`, `applyHints`), decoded by
`apps/web/src/lib/features/flashcards/face/hints.contract.test.ts`. Spec: `docs/superpowers/specs/2026-11-26-hints-design.md`.

- **Hint kinds** (the registry, in the fixed order they are revealed in): `reading` (the entry's readings: kana,
  pinyin, zhuyin, romaji, on and kun), then `picture` (ready since #212: an entry
  offers it only when it has one, `hasPicture`: an images pack maps it, #216, and the Pictures visual aid is on,
  `aids/README.md`). A new kind is a new registry row with its own defaults; Starter mode
  (#214) uses the same kinds, rules and display, and replaces the modes of one card with `forced` ones (its stages).
- **Modes**, per hint kind and card kind: `always` (part of the front, shown from the start), `hint` (hidden until the
  learner asks), `never`. **Defaults** are the table `defaults` in the fixture: reading is a hint on `vocab`
  (Recognise), `sentence`, `reverse` (Recall) and `cloze`, always on `writing` (the writing card has always shown
  it), never on `tone` (there it is the answer: `notApplicable`); picture is a hint on `vocab`, `writing`, `tone` and
  `reverse`, never on `sentence` and `cloze`.
- **Setting**: the workspace-settings key `hints` (`settings/`): `{<kind>: {<card kind>: <mode>}}`, written one cell at
  a time by merge patch. Read cell by cell: an absent cell, an unknown mode, a non-object member, an unknown kind or
  card kind is the default (never an error); a pair in `notApplicable` is `never` whatever is stored. Because it is a
  workspace setting it is synced with the workspace and part of a backup (a restore keeps unknown members).
- **Plan of one card** (`resolveHints`): for each registry kind in order, skip it when it does not apply to the card
  kind or the entry cannot offer it (`hasReading`: the entry has at least one reading; `hasPicture`), else its mode
  (`forced` over the setting) puts it in `always` or `onRequest`; `never` leaves it out. Cases: `plans`.
- **The control**: one Hint control per card, offered while `onRequest` has a kind left and the card is not answered.
  Each press reveals the next kind of `onRequest`, one at a time, in the fixed order. `always` kinds are on view from
  the start and are not counted. Web: a Hint button and the H key (Alt+H inside a text field, where H is a letter).
  Android implements the same control with its own widget.
- **Grade rule** (`lowerForHints(suggested, used)`, `used` = hints revealed with the control): with `used = 0`
  nothing changes; with `used >= 1` the suggestion goes down one step: Easy (4) to Good (3), Good (3) to Hard (2);
  Hard and Again stay, and no suggestion (a self-graded card) counts as Good and becomes Hard (2). A second hint
  lowers no further. The learner can still pick any grade; this
  only moves the suggestion. Cases: `grades`.
- **Recording** (`applyHints(result, used)`): the review's `meta.hints` is the card's own help count plus `used`
  (writing: stroke hints and shown strokes; sentence: the translation shown and giving up). The card's own help is
  not changed by this rule and, as before, does not lower the suggestion by itself. Cases: `results`.

Ruling (owner, 2026-11-26; replaces "capped at Hard") — a hint lowers the suggestion by one step, a card without a
suggestion counts as Good — a peek at a word the learner nearly knew no longer drops an Easy suggestion to Hard,
and Again and Hard are not lowered further — cost: where the suggested grade was Easy the learner still sees Good,
and the stored reviews of earlier builds (suggestion capped at Hard) are not rewritten.

Ruling: the control's hints lower the suggestion but the earlier in-card helps (stroke hint, translation, give-up)
keep their own suggestions — those were never part of the grade and changing them would shift every writing and
word-order suggestion in already-tested sessions — cost: a stroke hint still leaves the suggestion at Good.

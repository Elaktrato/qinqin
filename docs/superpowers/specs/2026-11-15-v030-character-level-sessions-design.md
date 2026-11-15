# Level sessions for character-unit schemes — design (issue #57)

Status: Draft for review (2026-11-15), v0.3.0 work item 1, revised after a builder check. Written
unattended; every non-obvious call is a **Ruling** (`what — why — cost if wrong`). Nothing is built. Depends on the learner's day
(`2026-11-15-v030-study-day-design.md`) for one rule (writing unlocks on a later day).

## Intent and why

`/study` → By level lists the levels of character packs (`jlpt-kanji`, `joyo-grades`, `tgh-chars`) but
cannot start a session: "0 words … Nothing is due", start disabled. `buildLevelQueue`
(`apps/web/src/lib/study/levelQueue.ts`) keeps only entries with `kind === 'word'` and level sessions
are vocab-only (`levelSessionItems` in `cardFlow.ts`). A character scheme's members are character
entries (`GET /api/schemes/{id}/entries?level=` returns `kind: "character"`; the scheme row has
`unit: "character"`), so nothing qualifies. Kanji and hanzi learners study exactly these lists.

## Goals

- A level session of a character-unit scheme studies that level's characters.
- Two exercises per character, both existing card kinds: **recognition** (`vocab` kind on a character
  entry: glyph → readings and meanings) and **writing** (`writing` kind: readings and meanings →
  write the glyph; the writing card already exists).
- Cards are created lazily on the first grade, with the existing deterministic ids, so two devices
  never create duplicates.
- New cards per session are capped (`newLimit`, and the daily limit once #89 lands); mastery of a level
  is shown with the Stats → Characters definitions.

## Non-goals

- Tone or Word Salad cards for characters, writing/tone for word-unit levels (unchanged: vocab only).
- Radical/component drills (#71), stroke-count quizzes, kana (#63).
- A new card kind or event type; a new mastery formula.

## Approaches

1. **Reuse `vocab` and `writing` kinds on character entries (CHOSEN).** Card rows, ids, scheduling,
   mastery, card management (#30) and the optimizer all work unchanged; only the queue, one card face
   and the setup page change.
2. **A new `character` card kind.** Clearer in data, but every switch over `CARD_KINDS` (XP table,
   eligibility, card-type opt-out, management filters, the Android contract) grows a case. Rejected.
3. **Derive characters from word cards only (no character cards).** That is today's mastery map, not a
   way to study a kanji list. Rejected.

## Queue (`buildLevelQueue`, unit-aware)

Inputs gain `unit: 'word' | 'character'`, `kinds: StudyCardKind[]` and `studyDay` (for `today` and
`dayOf`). Word unit: behaviour unchanged (vocab, `kind === 'word'` entries, virtual id `level:<entryId>`).

Character unit, for each entry with `kind === 'character'` in level order (first occurrence wins):

- Considered kinds: `vocab` and `writing`, filtered by the session's `kinds`; other selected kinds are
  ignored with the setup warning "Character levels study recognition and writing cards."
- **Real card**: the card with `kind` and `entryId` (input is already canonical-merged; if duplicates
  remain, `compareCanonical` picks the survivor, as `canonicalCards` and `addCard` do). Reviewed
  and due → review bucket; never reviewed → new bucket with its real id; reviewed, not due → omitted.
- **Virtual card**: none exists → new bucket with id `level:<entryId>` for vocab (unchanged prefix) and
  `level:writing:<entryId>` for writing. On the first grade `gradeItem` creates the card with
  `newCardId(kind, entryId)` = `c-vocab-<entryId>` / `c-writing-<entryId>`, `written` = the character,
  `entryKind: 'character'` (new optional snapshot field on `StudyCard`, like `written`), no `sentenceId`,
  deck General — exactly what adding the character from its entry page creates, so both paths converge
  on one row.
- **Writing unlock**: when both kinds are selected, a character's writing card (real-new or virtual) is
  a new candidate only after its recognition card has a valid review on an earlier learner day
  (`dayOf(firstReview) < today`). With vocab not selected, writing is not gated.
- **Order**: due reviews earliest-due first (ties by entry order); then the new bucket: unlocked writing
  cards in level order, then recognition cards in level order — real-but-unreviewed and virtual items
  interleaved by level order (unlike the word path, which puts real-new cards first); `newLimit` caps the
  new bucket as a whole (cards, not characters). Due-ness is the shared predicate (`due ≤ now`; no queue on
  vacation days once item 4 lands).
- **Reserve**: the session also builds the next `backfillLimit(newLimit)` new items as a reserve (the deck
  session's mechanism, `cardFlow.ts`), so a writing item dropped for missing stroke data or missing
  glosses is replaced instead of shrinking the session; drops are remembered per tab (`ineligible.ts`).

Ruling: writing unlocks the day after recognition — seeing a glyph and then being asked to write it a
few cards later tests short-term memory, not recall; a day's gap is the classic kanji-app order —
cost: a learner who wants both on day one must run a writing-only session.

Ruling: `newLimit` counts cards, not characters — limits (#89) count cards from review events, so one
unit everywhere — cost: with writing unlocked, a session of 20 new cards may introduce only ~10
characters.

Ruling: reuse `level:<entryId>` for recognition and add `level:<kind>:<entryId>` — virtual ids are never
stored, but keeping the old one avoids touching every existing level-queue test — cost: two id shapes.

## Card face for character entries

`buildVocabFaces(entry, …)` for `entry.kind === 'character'`: the front holds the glyph only (no readings,
no example sentence); the back carries every reading of the entry grouped by type (on/kun for Japanese,
pinyin for Chinese) and the meanings. Today `back` copies `front` and `VocabCard.svelte` renders only
`front.readings`, so the back's readings become their own field and the card renders them after the reveal
(a required change). `gradeItem` stores no `sentenceId` for character entries. Word
entries are unchanged (their front keeps the reading). The writing card already shows readings and
glosses as its prompt and writes each character of `written`, so a one-glyph card needs no change;
stroke data comes from the existing `usableChars` check, and a character without stroke data is
ineligible for writing (dropped, never created), as today. A character entry without glosses is also
ineligible for writing (a pinyin-only prompt matches many homophones).

Ruling: front shows the glyph alone for character entries — reading recall is half of what a kanji
card trains, and a character entry's "reading" is several on/kun readings that would give it away —
cost: an existing vocab card on a character entry (added from its entry page) gets harder.

Ruling: no sentence on character cards — a blanked example sentence would show half the answer on a
one-glyph card — cost: no context line for characters.

Ruling: writing needs glosses — cost: some Unihan-only hanzi get recognition cards only.

## Deck sessions

`planCompanions` skips sentence and tone companions for cards with `entryKind === 'character'` and plans
their writing companion only under the unlock rule (an earlier learner day's recognition review). Cards
without the field (created before) behave as today.

Ruling: an `entryKind` snapshot on new cards rather than an entry fetch in the planner — the planner is
pure and sync-free — cost: character cards created from the entry page before this ships stay unmarked
(they keep today's companion behaviour).

## Setup page and mastery

- `routes/study/+page.svelte` "By level": counts come from a pure `levelPlanCounts(...)` (new, in
  `levelQueue.ts`) per unit and kinds; the level label reads "N characters" for character units; the
  start button enables when `due + fresh > 0`; `guidance` becomes unit-aware (a writing-only character
  session can start; it blocks only when no selected kind is usable for the unit), and the copy "This level
  has no words yet." / "Draw words from one level…" reads "characters" for character units.
- Each level option shows "L of N learned" in its text, where *learned* is `masteryForChars(...)` stage
  `learned` (score ≥ `MASTERY_THRESHOLD`, `lib/study/mastery.ts`) and N counts the level's characters as
  `fetchSchemeCharacters` (`lib/api/schemes.ts`, `GET /api/schemes/{id}/characters`) returns them (each
  Han character once, in its lowest level; non-Han and 々 skipped), so N can differ from the entry count.
  Word levels show the same over their derived characters. No new formula. Known differences from the
  Stats page: it also fills legacy cards' missing `written` and scores variant glyphs (the picker does
  not), and a freshly unlocked writing card lowers a character's mean for a while.
- `typeWarnings`: word levels keep "Level sessions study vocab cards only…"; character levels warn
  only for selected kinds other than vocab/writing.

Ruling: show "learned" counts in the level picker rather than a new progress metric — the direction
says mastery comes from Stats → Characters; one definition keeps #90 and #78 consistent — cost: the
count moves slowly (80 points needs months of stability).

## Interaction with later items

- #89 daily limits: existing cards are admitted by their own decks' limits, virtual items by General's
  (they join General); the new bucket is capped by `min(session newLimit, remaining new today)`.
- #88 vacation: no queue on vacation days (shared predicate).
- #65 siblings: recognition and writing cards of one character are siblings; "buried until the next
  day" will subsume the unlock rule for real cards, while the unlock rule still governs virtual ones.
- #90 decks view: a level's system deck is the same character list; adding it creates recognition
  cards with the same deterministic ids.

## Contract fixtures (`docs/contracts/levels/`)

- `character-level-queue.json` — inputs (unit, entries, cards, reviews with `ts` and grade, zone history,
  now, kinds, newLimit) → the ordered queue of `{cardId, kind, entryId, virtual}` and the reserve; cases:
  fresh level, writing locked on the same day, unlocked the next learner day (Tokyo history, an Easy review
  at 23:30 local so the card is not due again), writing-only session, existing card added from the entry
  page (real id, interleaved by level order), duplicate cards (`compareCanonical` survivor), due before new,
  `newLimit` counting cards across kinds, a word-unit scheme (unchanged), `kinds: ["tone"]` on a character
  level → empty, a character without stroke data (in the queue; the session drops it and takes the reserve).
- `level-card-ids.json` — virtual id ↔ created card id pairs for both kinds.

## Risks

- Character entries without glosses (Unihan-only Chinese characters): the back shows readings only;
  the card is still studiable. Seen in the real-app check.
- Stroke data is hanzi-writer-data (Chinese-based): Japanese-only shinjitai code points (e.g. 歩) may be
  missing and shared code points can differ in stroke order; such characters get recognition cards only.
- Big levels (Jōyō grade S, 1,100+ characters) make `masteryForChars` run per level in the picker;
  it is one pass over cards, cached per history load, as on the map page.

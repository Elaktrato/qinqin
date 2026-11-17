# Decks view (flashcards, #90)

Rules every client implements identically. Fixtures: `{"version":1,"rule":"decks/<name>","cases":[...]}`.
Prerequisites: `docs/contracts/cards/` (card ids, kinds, burying) and `docs/contracts/study-day/`.

## Deck numbers (`deck-stats.json`)

Scope: a deck = the live cards whose `deckIds` contain it; overall = the cards in at least one existing
deck (General always exists), each counted once.

- `words` = vocab cards of the scope; `cards` = all cards of the scope.
- State per word = the state of its vocab card's derived schedule: New (never reviewed or FSRS New),
  Learning (any other non-review state), Young (review, stability < 21 days), Mature (>= 21).
- `studied` = words whose state is not New. `mastered` = words whose card score >= 80 where
  `score = round(100 * log2(1 + stability) / log2(366))` (stability clamped to 0..365 inside the log).
  Reverse and cloze cards never change states, studied or mastered.
- `due` / `fresh` = what a session started now over the scope would take with unlimited limits, of the
  given effective `kinds`, buried cards removed (`cards/`), opt-in kinds only where a deck of the scope
  enables them.
- `reviews30` = recorded reviews (all kinds) of the scope's cards whose learner day lies in the 30 days
  `today-29 .. today`. `retention` = among those, the reviews of cards that had an earlier review (any time;
  ties by event id) -> share with grade >= 2; `null` below 10 such reviews (`retentionBase` is their count).
- Fixture cards carry their derived `schedule` (`state`, `stability`, `due`); implementations take it as
  given, so the file does not depend on the FSRS parameters.

## System decks (`system-deck-ids.json`)

Computed, never stored: a level deck is (installed scheme in the workspace language, level) from the
public scheme API, filtered by the scheme unit (`word` schemes keep words, `character` schemes keep
characters). Owned copies get a deterministic id:

- `slug(s)` = NFC, lower case, every Unicode code point outside `[a-z0-9-]` replaced by one `-`.
- `fnv1a32(s)` = FNV-1a 32 bit over the UTF-8 of the NFC text, 8 lower-case hex digits.
- level deck: `d-lvl-<slug(packId)>-<fnv1a32(packId + "\0" + levelName)>`; plugin deck: `d-plg-<slug(pluginId)>-<fnv1a32(pluginId + "\0" + key)>`.
- starter deck (frequency, #75): `d-frq-<slug(packId)>-<fnv1a32(packId + "\0" + "top-" + size)>`; see
  [`../frequency/`](../frequency/README.md).

## Add to my decks (`add-to-deck.json`)

See the fixture cases. Per item in level order: no live vocab card -> create `c-vocab-<entryId>`
(`written`, `deckIds: [target]`, `createdAt = now + i ms`); a live vocab card outside the target ->
join (append the target to its row and every sibling row of that entry); already inside -> skip. The deck
row `{id, name, createdAt, source: {type: "level", packId, level}}` is written only when no live row with
that id exists. Re-adding writes nothing new; two devices planning from the same input and `now` write
identical rows. Writes go through `POST /api/sync/push` (`pluginData`), 200 rows per request, deck row
first; a response with `dataSkipped` or `dataRefused` > 0 is a failure.

## Character mastery (`char-mastery.json`)

The character map scores every glyph from the cards that contain it (web: `lib/study/mastery.ts`
`masteryFromSchedules`, `stageOf`; `lib/study/charGroups.ts` `cellStates`; decoded by `mastery.test.ts` and
`charGroups.test.ts`). Nothing is stored; no server code.

- A card counts for a glyph when its kind is one of `masteryKinds` (`vocab`, `sentence`, `writing`, `tone`;
  reverse and cloze never move the map), it has a non-empty `written` snapshot that contains the glyph, and it
  has a schedule (it was reviewed; the schedule is the FSRS replay of `scheduler/fsrs.json`, given directly in
  the cases as `schedules`: card id → stability, `null` = never reviewed). A glyph repeated in one snapshot
  counts the card once. The empty string never matches.
- Card strength = `min(1, log2(1 + max(0, stability)) / log2(1 + 365))` (non-finite stability: 0); the glyph's
  `score` = `round(100 · mean strength)` over its counted cards, `reviewedCards` = their number. A glyph with
  no counted card is `{score: 0, stage: "unknown", reviewedCards: 0}`; a counted card of stability 0 also
  gives score 0 and stage `unknown`, with the card counted.
- Stages (`stages` cases): `0` unknown, `< 25` fresh, `< 50` learning, `< 80` mature, else learned (80 is the
  mastered threshold, as in `deck-stats.json`).
- Cells (`cells` cases): a map cell shows the **best** form among its glyph `c` and its variant glyphs `v` —
  the highest score, never a sum; on equal scores the larger `reviewedCards`; that form's card count is shown.
  A form missing from the scores counts as 0.

## Entry bases

`POST /api/entries/bases` `{"ids":[int...]}` (1..500 ids, body <= 16 KiB) -> the `EntryBase` rows of
`GET /api/schemes/{id}/entries`, in first-occurrence order, unknown ids omitted, with the caller's own
overlay applied. 401 without a session, 400 `ids must be 1 to 500 entry ids`, 413 over the body cap.

## Notes for implementers

- Numbers are computed from one schedule replay per reviewed card; the fixtures give schedules directly so a
  client with a different FSRS binding still checks the counting rules.
- The deck row field `source` is optional and ignored by clients that do not know it; unknown `source` shapes
  are dropped when reading. A copied deck is an ordinary deck: renaming, deleting and card management work as
  for any other.
- System decks are never written. Their level names are the identity of a copy: a pack update that renames a
  level makes a later add create a second deck, the old one keeps working.
- Concurrency: two devices joining the same word to different decks at the same moment is last-write-wins at row level (one deck may lose the word; there are never duplicate cards). A writer stamps each row `max(its clock, newest known updatedAt or tombstone time of that row + 1 ms)`, so a clock behind the server's does not lose to a fresh tombstone.
- Daily limits (#89) and vacation (#88) are not part of these numbers yet; when they land, `due` and `fresh`
  here stay uncapped and "left today" is shown beside them.

## Real-app check (v0.3.0 build)

Against a built server (embedded web build, `hsk-words` + `cedict` seeded, 127.0.0.1): `POST /api/entries/bases`
401 without a token, 2 rows in request order for 3 ids with one unknown, 400 for 0 and for 501 ids, a user's
overlay visible only to that user; `GET /api/schemes` -> `HSK 1` (163 words) -> owned id
`d-lvl-hsk-words-b06fd2ac`; the add plan pushed through `POST /api/sync/push` (a General card joined, the rest
created, `dataAccepted` = rows); the pulled plan of a second add is empty and no row's `updatedAt` moved; a
tombstoned deck row and card row are revived by a later push under their old keys; an older revival against a
newer tombstone answers `dataSkipped: 1`; a second user sees none of the rows and cannot push into the first
user's workspace; 5,077 rows (HSK 7-9) pushed in 26 requests of 200.

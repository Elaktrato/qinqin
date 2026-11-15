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

- `slug(s)` = lower case, every char outside `[a-z0-9-]` replaced by `-`.
- `fnv1a32(s)` = FNV-1a 32 bit over the UTF-8 of the NFC text, 8 lower-case hex digits.
- level deck: `d-lvl-<slug(packId)>-<fnv1a32(packId + "\0" + levelName)>`; plugin deck: `d-plg-<slug(pluginId)>-<fnv1a32(pluginId + "\0" + key)>`.

## Add to my decks (`add-to-deck.json`)

See the fixture cases. Per item in level order: no live vocab card -> create `c-vocab-<entryId>`
(`written`, `deckIds: [target]`, `createdAt = now + i ms`); a live vocab card outside the target ->
join (append the target to its row and every sibling row of that entry); already inside -> skip. The deck
row `{id, name, createdAt, source: {type: "level", packId, level}}` is written only when no live row with
that id exists. Re-adding writes nothing new; two devices planning from the same input and `now` write
identical rows. Writes go through `POST /api/sync/push` (`pluginData`), 200 rows per request, deck row
first; a response with `dataSkipped` or `dataRefused` > 0 is a failure.

## Entry bases

`POST /api/entries/bases` `{"ids":[int...]}` (1..500 ids, body <= 16 KiB) -> the `EntryBase` rows of
`GET /api/schemes/{id}/entries`, in first-occurrence order, unknown ids omitted, with the caller's own
overlay applied. 401 without a session, 400 `ids must be 1 to 500 entry ids`, 413 over the body cap.

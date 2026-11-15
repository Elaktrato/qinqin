# Card management (issue #30): delete and move cards

Goal: delete cards (single and bulk, undoable) and move cards between decks, with UI on the study setup page. Dedupe is already done (`canonicalCards`).

## Findings
- Cards are plugin data rows `card:<id>` (`qinqin-flashcards`, workspace-scoped). `DELETE` tombstones a row; `fetchStudyData` already skips `deletedAt` rows; the server's `PUT` on a tombstoned key revives it (`deleted_at = NULL`), and tombstones travel through sync. No server change is needed.
- Review events live in the event log, keyed by `payload.cardId`. Mastery, word states, scheduling and counts all iterate over cards and look reviews up per card, so reviews of a missing card are ignored. EXP, streak and heatmap read events directly and are unaffected.
- Readers of cards: `loadStudyData`/`canonicalCards`, `deckSessionItems`/`sessionCounts` (setup counts and session queue), `characterMap`, `wordStates`, `studyData` cache (`onStudyWrite` invalidation), `AddToStudy`, reader buttons. All go through `fetchStudyData`, so a tombstone hides the card everywhere at once.

## Store
- `deleteCards(ids)`: tombstone every stored row whose `cardKey` matches a requested card (so a not-yet-merged duplicate cannot resurface), plus the stored companion cards (sentence, writing, tone) of a deleted vocab card. Returns the removed rows for undo.
- `restoreCards(rows)`: PUT the returned rows back (revives the tombstones; reviews re-attach by id).
- `moveCards(ids, {add?, remove?})` / `setCardDecks`: move = replace deck membership with the target deck for all rows of the selected cards (duplicates included); never leaves a card without a deck (falls back to General); empty or unknown-deck targets rejected.

## UI (study setup page, new `CardManager.svelte`)
- Section "Cards" below Decks: filter by deck, list of vocab cards (written form or entry id, deck chips), row checkboxes, select-all, shift-click range.
- Selection bar: "Move to..." deck select + button, "Delete" button. Single delete is immediate with an Undo toast (8 s, focusable button, `role="status"`); bulk delete (more than one card) asks for confirmation first, then also offers Undo.
- Keyboard: checkboxes and buttons are native; Delete key on a focused row deletes it. Touch: row height of at least 44 px.
- After every write the page reloads data, so counts and the queue preview update.

## Rulings
- Ruling: delete = tombstone via the existing DELETE — keeps review events, EXP and history, syncs for free — cost if wrong: none (revivable with PUT).
- Ruling: undo is a PUT of the removed rows rather than a delayed delete — works across a reload race and needs no timer-owned state — cost if wrong: an undo after another device re-added the card overwrites its fields.
- Ruling: deleting a vocab card also tombstones its stored companion cards — companions are meaningless without the word and would otherwise be unreachable in the list — cost if wrong: their review state is lost from the queue (restorable by undo).
- Ruling: only vocab cards are listed — companions are derived from them, so one row per word — cost if wrong: stray non-vocab cards without a vocab card are not manageable.
- Ruling: move replaces deck membership with the chosen deck (not "add") — "move" semantics; multi-deck membership stays possible via the entry page — cost if wrong: users wanting copy semantics need a later "add to deck" action.
- Ruling: a word of a level session reappears as a virtual card after deletion and is recreated when graded — level sessions study scheme words, not decks — cost if wrong: surprising revival; the scheme remains the source there.
- Ruling: re-adding a deleted word revives its old history (same deterministic id) — keeps progress, no duplicate — cost if wrong: a user wanting a clean slate cannot get one.
- Ruling: no server change and no new API — see Findings — cost if wrong: none.
- Ruling: bulk delete confirms with `window.confirm`, as deck delete does — consistent with the page — cost if wrong: a custom dialog later.

## Tasks (test first)
1. Store tests + `deleteCards`, `restoreCards`, `moveCards` (+ tombstone respected by `loadStudyData`, counts, map input).
2. Pure selection helper (`cardSelection.ts`: toggle, range, select-all) with tests.
3. `CardManager.svelte` + wiring in the study page + undo toast.
4. Gates, real-app check (delete, undo, move, queue and counts).

# Flashcards decks view — design (issue #90, v0.3.0 item 3b)

Status: Draft (2026-11-15), written unattended; calls are **Ruling: what — why — cost if wrong**.
Nothing is built. **Built after item 3** (`2026-11-15-v030-reverse-cloze-cards-design.md`, which defines
`deckcfg:<deckId>`, the new kinds, burying and `skipKinds`). **Per-deck daily limits (item 4b, #89)** are
designed in `2026-11-15-v030-vacation-and-limits-design.md` (not yet written when this was drafted);
this view reserves their place and wires them when 4b lands. Days are the learner's day (item 1,
#84, `2026-11-15-v030-study-day-design.md`), used only through an injected `dayOf(ms)` and `today`
from `StudyDay` (`lib/time/studyDay.ts`); "the last 30 days" counts civil dates back from `today`.

## Intent

Today flashcards has a home widget, the study setup and the session; decks can only be seen as
checkboxes on `/study`. This adds a **Decks page** (plugin surface `page`, `/p/flashcards`): every
deck of the workspace with its numbers and a Study button, a deck detail with its items and card
management, deck settings, overall stats, and a read-only section of **system decks** (level decks
from installed level packs, and decks a plugin ships) that a learner can copy into a deck they own.

## Non-goals

Sharing decks between users, editing system decks, a "time to clear" estimate (Ruling: the direction
lists studied, mastered, retention and reviews; an honest estimate needs the 4b limits — cost if
wrong: add it with 4b), new mastery definitions, a server-side deck model, moving `/study`.

## Routes and modules

`/p/flashcards/<rest>`, parsed by `lib/plugins/flashcards/route.ts` (pure, like grammar's):

| rest | view |
|---|---|
| `` | Decks list (overall stats, your decks, system decks) |
| `deck/<deckId>` | Deck detail |
| `deck/<deckId>/settings` | Deck settings |
| `system/level/<packId>/<levelName>` (level name URI-encoded) | System level deck detail |
| `system/plugin/<pluginSlug>/<deckKey>` | Plugin deck detail (reserved, no provider ships one yet) |

Anything else renders the list. The builtin manifest `server/internal/plugins/builtin/flashcards.json`
gains surface `page` (version 1.2) and `webPlugins` gets `pages: [{ title: 'Decks', nav: true,
component: FlashcardsPage }]`. Components stay thin: `FlashcardsPage.svelte` (router), `DeckList`,
`DeckDetail`, `DeckSettings`, `SystemDeckDetail`, `DeckStatsPanel`; logic lives in pure modules:
`deckStats.ts`, `deckRows.ts`, `systemDecks.ts`, `addToDeck.ts`, `deckSettings.ts` (from item 3),
`cardActions.ts` (the card-management controller extracted from `CardManager.svelte`).

## Numbers (existing definitions; file references are the source of truth)

One `scheduleIndex(cards, reviews, w)` pass replays each reviewed card once
(`scheduleFor`, `lib/study/scheduler.ts`) and is shared by every deck on the page.

- **Words** of a deck = its vocab cards; **cards** = all its live cards of every kind.
- **Item state** = `classifySchedule` of the vocab card (`lib/stats/wordStates.ts`): New (never
  reviewed or FSRS New), Learning (learning/relearning), Young (review, stability < 21 days,
  `MATURE_STABILITY_DAYS`), Mature (≥ 21). Ruling: the direction's "new/learning/review/mature" is
  shown with the existing labels (`WORD_STATES`), so "review" reads **Young** — #53 already separated
  these names from the map's; a second vocabulary would undo that — cost if wrong: a label change.
- **Studied** = words whose state is not New (same file).
- **Mastered** = words whose vocab card's **memory score ≥ `MASTERY_THRESHOLD` (80)**
  (`lib/study/mastery.ts`: score = round(100 × log2(1 + stability) / log2(366)), the per-card term
  that `masteryForChars` averages; 80+ is the "Learned" band of Stats → Characters). Item 3 exports
  it as `cardScore(stability)`; `masteryForChars` uses the same function (no behaviour change).
  Ruling: the direction says to use Stats → Characters' definition, and #78 (smart hiding) needs a
  0–100 score whose threshold the learner can move; Mature (21 days) stays visible as a state —
  cost if wrong: switch "mastered" to Mature in one function.
- Reverse and cloze cards never change studied/mastered/state (item 3: mastery counts only vocab here).
- **Due** = real cards a session started now would review: due ≤ now, of the kinds in effect
  (remembered session kinds; reverse/cloze only where the deck enables them and the word does not
  skip them), **minus buried** (item 3). **New** = real cards never reviewed, same kinds. Not-yet-created
  reverse/cloze cards are not counted; the deck row says "+ reverse/cloze cards as you study".
- **Reviews (30 days)** = recorded reviews of the deck's cards (all kinds) with
  `dayOf(ts)` within the 30 learner dates ending today (`addDays(today, -29)` … `today`).
- **Retention (30 days)** = among those reviews, the ones of cards that already had an earlier review
  (first reviews excluded), share with grade ≥ 2 (Hard/Good/Easy). Shown as "—" below 10 such
  reviews. Ruling: no retention figure exists yet; this is Anki's "true retention", a review statistic
  and not a mastery definition — cost if wrong: one function.
- **Overall** = the same over every card in at least one existing deck, each counted once (the
  `wordStateCounts` rule). General is listed only when it holds cards.

## Decks list

Top: overall stats panel (words, studied, mastered, retention, reviews 30 d). Then **Your decks**:
General (when non-empty), then user decks by name. Each row: name (link to detail), "N words · M
cards", due, new, a two-segment bar (mastered, studied-not-mastered, rest) with a text alternative
("40 words: 12 mastered, 18 studied"), **Study** (writes the session setup — `mode: 'decks'`, this
deck only, the saved limits and effective kinds — and goes to `/study/session`), and Settings.
"New deck" reuses `createDeck`. Then **Level and plugin decks** (below).

## Deck detail

Header with the deck's numbers, Study and Settings. Rows are **one per entry** of the deck (grouped
from all its cards, so a stray sibling without a vocab card is still listed and manageable): written
form, reading (from entry bases, below), state, sibling chips (the kinds that exist; skipped kinds
shown "off"), next due. Search (written form, readings, entry id; folded like the map's search — `fold` in
`lib/study/charGroups.ts`, exported — so "hao" finds hǎo and hiragana finds katakana), filters (state, kind, due now), sort (added, due, state). Selection,
bulk **Move** and **Delete** with the single-slot **Undo** reuse `cardActions.ts` — the controller
extracted from `CardManager.svelte` (serialized write chain, `PartialCardsError` handling, 10 s undo
that pauses while busy, focus return), so both places behave identically. Expanding a row offers
per-kind **Remove** / **Turn back on** (`dropSiblingCards` / un-skip, item 3). The word opens
`/entry/<id>`. Rendering is batched: 100 rows, then "Show 100 more".

**Entry bases.** New route `POST /api/entries/bases` `{ids: number[]}` (1–500 ids) → `EntryBase[]`
in request order, unknown ids omitted, authenticated (401 otherwise, 400 on a bad body). It serves
the same shared rows as `GET /api/schemes/{id}/entries` (`entryBases`), nothing user-specific. The
client loads bases for the visible rows first, then the rest in chunks of 500 (concurrency 2), cached
for the session. Ruling: a batch read instead of one `GET /api/entries/{id}` per row — a 3,000-word
deck would otherwise be 3,000 requests before search by reading works — cost if wrong: one small route.

## Deck settings

Rename (`renameDeck`), Delete (confirm: "Its N cards move to <their other decks or General>"; uses
`deleteDeck`, which moves cards out first, then tombstones `deckcfg:<id>`), **Card types**: Reverse and
Cloze switches writing `deckcfg:<id>.cardTypes` (item 3), and a **Daily limits** slot. General can be
configured but not renamed or deleted.

**4b integration point.** `DeckSettings` renders `<DeckLimitsSlot deckId workspaceId />`; until 4b
lands the slot module exports nothing and the section is hidden. 4b provides the editor and
`limitsLeftToday(deckId) -> { new: number | null; reviews: number | null }` (null = unlimited), which
the list and detail show as "x left today" next to Due/New. Per-deck limits may live in the same
`deckcfg:` row: `deckSettings.ts` keeps unknown fields on every write.

## System and plugin decks

**Representation. Ruling: computed, never stored** — a level deck is (installed scheme in the
workspace language, level) from `GET /api/schemes`; its items are `GET /api/schemes/{id}/entries?level=`
filtered by the scheme unit (`word` schemes keep `kind === 'word'`, `character` schemes keep
characters). Nothing to sync or migrate, a pack update shows at once, and the read-only rule holds by
construction — cost if wrong: the list needs the API (it is public and cached by the browser).
Plugin decks come from an optional web-registry provider `WebPlugin.decks?: () =>
Promise<SystemDeckDef[]>` (`{key, title, language, entryIds}`); no plugin ships one in v0.3.0
(starter decks, #75, will).

The section groups decks by scheme, collapsed; expanding loads each level's items (concurrency 2,
cached) and shows "x of y in your decks". A system deck detail lists its items with the learner's
state (or "not studied"), **Study** (a level session for that level: the existing `mode: 'levels'`),
and **Add to my decks**.

**Add to my decks** (`addToDeck.ts`, pure plan + one writer):
- Target: a new owned deck with a **deterministic id** (default) or an existing deck the learner
  picks. Owned id = `d-lvl-<slug(packId)>-<fnv1a32hex(packId + "\u0000" + levelName)>`, plugin decks
  `d-plg-<slug(pluginId)>-<fnv1a32hex(pluginId + "\u0000" + key)>`; `slug` lower-cases and maps
  `[^a-z0-9-]` to `-`; strings are NFC UTF-8. Example: `hsk-words`/`HSK 1` → `d-lvl-hsk-words-b06fd2ac`.
  The deck row is `{id, name: "<scheme name> · <level>", createdAt, source: {type: 'level', packId,
  level}}`; an existing (live) row is never rewritten, so a rename survives re-adding; a tombstoned
  one is revived. `parseDeck` keeps `source` (display: "Copied from HSK 1").
- Plan per item, in level order: no live vocab card → **create** `c-vocab-<entryId>` (revives a deleted
  word with its history, like re-adding today) with `written`, `deckIds: [target]`, and
  `createdAt = base + i ms` so new cards come in level order; a live vocab card not in the target →
  **join**: append the target to its and its siblings' `deckIds` (siblings follow their word); already
  in the target → skip. Re-adding therefore only adds what is new, and running it on two devices
  writes the same keys.
- Writes go through `POST /api/sync/push` (`pluginData`, last-write-wins, `updatedAt` = now) in chunks
  of 200 rows, deck row first; a progress line ("Adding 200 of 300…") and on failure "Added 200;
  try again to add the rest" (the plan is idempotent, so retry is safe). Ruling: batch push instead
  of one PUT per card — a 1,000-word level is five requests, not 1,000 — cost if wrong: none; the
  route already exists and enforces workspace ownership and `owns-data`.
- The system deck itself is never written.

## Performance (thousands of cards)

5,000 cards and 50,000 reviews must stay interactive: one schedule replay per reviewed card per load
(asserted by a counting test with an injected `schedule`), deck summaries in one pass over cards,
rows built once and filtered in memory (search debounced 150 ms), batched rendering, entry bases in
chunks, system deck items loaded on expand only. No timing assertions in tests.

## Testing

Pure modules with unit tests and the contract fixtures (`docs/contracts/decks/*.json`); jsdom tests
for the list (numbers, text alternative, Study writes the setup), detail (search, filters, bulk
move/delete/undo through `cardActions`), settings (rename, delete confirm text, card-type switches)
and the system section (add, re-add adds nothing). Go tests for `POST /api/entries/bases`
(401, 400, order, unknown ids, cap). A built-server curl check covers the route, the push writes and
the idempotent re-add.

## Risks

- `cardActions` extraction touches the shipped CardManager; its behaviour is pinned by new tests first.
- Sync push applies rows one by one; a crash mid-chunk leaves a partial add, which a retry completes.
- Level names are the identity of a copied deck: renaming a level in a pack update makes a re-add
  create a second deck (the old one keeps working).

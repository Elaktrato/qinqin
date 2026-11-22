# Mix card types within a session (#132) — design

Issue: #132 "flashcards: mix card types within a session (not just the order of words)". Owner decision
(2026-11-19, in the issue): card types are mixed randomly and the mix differs every session — a fresh seed per
session start, as #129 does for words; a reload of the same session keeps its order.

## Today

- Deck sessions (`cardFlow.ts` `deckSessionPlan`): `queue = [...real, ...companions]`. `real` is `buildQueue`
  (due cards earliest due first, then new cards in the session's new order); the companions (virtual items of
  the kinds a session adds: sentence, writing, tone, reverse, cloze) follow every real card, planned round-robin
  by kind. A session is "the word cards, then a block of other types".
- Level sessions (`levelQueue.ts`): due first, then the new bucket; character levels put all new writing items
  before all new recognition items. A word's types stay adjacent or in blocks.
- The random new order (#129, `newOrder.ts` `randomKey(seed)(entryId)`) shuffles words: all cards of one word
  share the key, so they stay back to back.
- Again re-shows (`requeue.ts`) come back after `REQUEUE_GAP` (4) other cards. Burying (`siblings.ts`,
  `buryAfterAnswer`) removes a word's later items in the session when either kind is opt-in (reverse, cloze);
  the four basic kinds never bury each other.

## Goal

The session interleaves card types; two cards of the same word are kept apart (never back to back when the
queue allows it, a few cards apart in longer sessions); the same rule in deck and level sessions, for real cards
and session-added items alike; limits, burying and re-shows unchanged; an optional setup choice "Order of card
types: Mixed (default) / Grouped by type". The rule is a contract fixture for Android (#38).

## Design

One pure module, `apps/web/src/lib/study/sessionMix.ts`. It runs **after** the plan: `deckSessionPlan` and
`buildLevelPlan`/`levelSessionItems` are unchanged (their fixtures stay valid) and decide which items a session
holds; `mixSession` only decides their order. The session page calls it once on the planned queue; the reserve,
`dropItem`, `buryAfterAnswer` and `requeueAfterGrade` work on the mixed queue as before.

### Blocks

The queue splits into the **due block** (real cards with a valid review: `!virtual` and a valid review of
`cardId`) and the **new block** (everything else), each keeping its incoming relative order. The output is
`[...due block, ...new block]`, each block reordered as below.

Ruling: due reviews stay first; types are mixed inside the due block and inside the new block — the most
overdue cards still get done when the learner stops early; the issue recommends it — cost if wrong: a learner who
wants new cards among reviews gets them only after the reviews (as today).

### Mixed (the default)

For one block of `N` items:

1. **Even merge by kind.** Per kind, the items keep their incoming order (due order, or the session's new order);
   item `j` (0-based) of a kind with `n` items gets the position `p = ((j + 0.5) / n) * N`. The kinds are thus
   spread evenly over the block instead of following each other in blocks.
2. **Jitter.** `key = p + MIX_SPREAD * u`, `MIX_SPREAD = 8`, `u = mixKey(seed, cardId)` in `[0, 1)`; a block
   holding a single kind takes `key = p` (nothing to interleave). Sort by `key` ascending; ties by kind order
   (`vocab, sentence, writing, tone, reverse, cloze`), then `j`.
3. **Spacing.** Walk the sorted list (`spaceOut`), placing one item per step. `sep(word)` = cards placed since
   that word's last card (infinite if none; the due block's output counts for the new block). With `R` items
   left and `r` of them belonging to one word:
   - if some item's word has `2r - 1 >= R` and `sep >= 1`, the first such item goes now (otherwise that word
     would have to end back to back);
   - else, when `gap > 1`: among the items whose word has `r >= 2`, `sep >= gap` and
     `(r - 1) * (gap + 1) + 1 >= R - 2` (`PRESSURE_SLACK = 2`: the word nearly needs the rest of the block to
     keep the gap), the first item of the word with the most items left goes now;
   - else, for `need = gap, gap - 1, …, 0`, the first item whose word has `sep >= need` goes now.
4. `gap = typeGap(N)`: 1 when `N < 8`, 2 when `N < 16`, else 3 (other cards between two cards of one word).

`mixKey(seed, cardId) = randomKey(seed)(fnv1a32(cardId))`: FNV-1a 32 over the UTF-8 bytes of the card id
(offset `0x811c9dc5`, prime `0x01000193`), read as a signed 32-bit integer by `randomKey` (`entryId | 0`).
Virtual ids (`companion:<kind>:<entryId>`, `level:…`) are stable, so a reload computes the same keys.

Ruling: mixing keeps the chosen orders approximately instead of shuffling the block outright — an item moves at
most about `MIX_SPREAD` places from its even-merge position, so "Most frequent first", "Level order" and the due
order still hold for the session's start, while the random default (words already random by #129) gets types
interleaved within a few cards — cost if wrong: a learner expecting a full shuffle of the new cards sees the word
order kept roughly; changing `MIX_SPREAD` is a one-constant contract change.

Ruling: a block of one kind keeps its incoming order (still spaced by word, e.g. two sentence cards of one
word) — a vocab-only session has no types to mix, so its due order and its new order (level order, most frequent
first) stay exactly as before; found while wiring the page (level-order tests) — cost if wrong: single-kind
sessions are not reshuffled, which the random new order (#129) already does for words.

Ruling: the gap scales with the block length (1 / 2 / 3 at `N < 8` / `< 16` / otherwise) — a short block cannot
hold a large gap, and a gap the block cannot hold would push same-word cards together at its end — cost if
wrong: a gap one card too small or too large in mid-sized sessions.

Ruling: the pressure step (`PRESSURE_SLACK = 2`) was added after the real-app check, where a 20-card new block
ended with one card between two cards of one word although the gap of 3 fitted. In a simulation of 4,000
seeded deck-like blocks it kept the full gap in every block where a greedy "most cards left first" spacer can
(0 misses against 42–256 without it, 54 with slack 1), moving cards on average 0.6 places from the jitter order
(the most-left-first spacer: 2.8) — cost if wrong: a slightly more ordered tail of long blocks.

Ruling: when the gap cannot be met (e.g. a session of one word's four types) the result is a deterministic best
effort: the first item in jitter order whose word is furthest away within the gap, ending in plain jitter order
when every item belongs to the same word. The "never back to back" promise holds whenever the block allows it
(no word holds more than `ceil(R / 2)` of `R` items; the `2r - 1 >= R` step keeps it so) — a property test pins
it — cost if wrong: none beyond an odd order in degenerate sessions.

Ruling: the gap is measured across the block boundary (the new block starts after the due block's last
cards) but a block's items never leave their block — cost: the first new card may be the word of the last due
card when nothing else fits.

### Grouped by type

Each block is stably sorted by kind order (`vocab, sentence, writing, tone, reverse, cloze`), keeping the
incoming order inside a kind (due order; the session's new order, then planning order for companions). No seed
and no spacing: two types of a word land in different groups. Due still first.

### Interaction with today's rules

- **Limits and caps**: unchanged; the plan admits, `mixSession` only reorders the admitted items (same set).
- **Burying** — Ruling: unchanged, and consistent with `cards/README.md`: answering a card buries the word's
  later items in the same session exactly when `buries(a, b)` (an opt-in kind on either side,
  `buryAfterAnswer`), and until the next learner day; the four basic kinds never bury each other — which is
  what makes spacing them apart useful — cost if wrong: a learner who wants vocab to hide writing for the day
  would need a contract change of `burying.json`.
- **Again re-shows** — Ruling: `requeueAfterGrade` is unchanged (after `REQUEUE_GAP` other cards); a re-show is
  the same card already answered, so spacing it from its siblings is not attempted — cost if wrong: a re-show can
  sit next to another type of its word.
- **Reserve** — Ruling: a replacement from the reserve (`dropItem`) is still appended at the end, unmixed —
  cost: rare adjacency at the very end of a session.
- **Reload** — Ruling: the setup draws `seed` at Start (unchanged) and the mix uses it, so the same input gives
  the same queue; after some cards are answered a reload re-mixes the remaining ones with the same keys, so the
  order stays close but may shift by a few places — cost: a few cards swap places after a reload.

### Setup choice

`StudySessionConfig.typeOrder?: 'mixed' | 'grouped'` (absent = mixed), stored with the per-tab setup in
sessionStorage (`qinqin.study.session`) like the order of new cards; an unknown value reads as absent and never
discards the setup. The setup page shows a select **Order of card types** with **Mixed** and **Grouped by
type** under the order of new cards. Strings in `en.json`: `study.limitsSection.typeOrder`,
`study.typeOrder.mixed`, `study.typeOrder.grouped`.

Ruling: per tab, not synced, not remembered across tabs — it is a session choice like the order of new cards;
the deck rows keep their contract — cost: a learner who always wants grouped picks it again in a new tab.

## Contract

`docs/contracts/cards/session-mix.json` (`rule: cards/session-mix`) with `keys` (`{cardId, seed, fnv, key}`),
`gaps` (`{n, gap}`) and `queues` (`{name, seed, order, items: [{cardId, kind, entryId, review}], expect}`), a
"Session mix" section in `cards/README.md`, a line in `levels/README.md`, the folder row in
`docs/contracts/README.md` and the "Cards and study" line of `overview.md`. Decoded by
`apps/web/src/lib/study/sessionMix.test.ts`. No Go: the server never builds queues. No new stored row.

## Testing

Unit and contract tests for `fnv1a32`, `mixKey`, `typeGap`, `spaceOut`, `mixSession`, a property test (random
blocks: same set, blocks kept, no back to back when feasible), `session.ts` parse/save of `typeOrder`, the setup
page select (jsdom), the session page using the mix (jsdom). Real-app check: a seeded scratch server and the
queue builder run on its real API data in a temporary vitest.

## Out of scope

Mixing reviews with new cards; spacing re-shows; Android (#38) itself; #131 (change a grade), which builds on
these modules after this merges.

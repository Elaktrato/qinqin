# Level session queues (character schemes)

The rule behind `/study` → By level for schemes whose `unit` is `character` (JLPT kanji, Jōyō grades,
通用规范汉字表). Word-unit schemes keep the original vocab-only rule. Spec:
`docs/superpowers/specs/2026-11-15-v030-character-level-sessions-design.md`.

## Units and kinds

- `unit: "word"`: entries of kind `word`, card kind `vocab` only, virtual id `level:<entryId>`.
- `unit: "character"`: entries of kind `character`; card kinds `vocab` (recognition) and `writing`.
  Any other selected kind is ignored; with none left the queue is empty.
- An entry counts once (first occurrence in level order). One card per (kind, entry): if several stored
  cards share the key the earliest `createdAt` wins, ties by the smaller id.

## Ids

| Item | Id |
| --- | --- |
| virtual recognition item | `level:<entryId>` |
| virtual writing item | `level:writing:<entryId>` |
| card created on first grade | `c-vocab-<entryId>` / `c-writing-<entryId>` (`newCardId`) |

Virtual ids are never stored. An existing card (for example added from the entry page) is used with its
real id, never duplicated. Fixture: `level-card-ids.json`.

## Queue (`character-level-queue.json`)

1. Review bucket: cards with a valid review that are due (`due <= now`), earliest due first, ties by entry
   order, at most `reviewLimit`. Reviewed and not due: omitted.
2. New bucket: never-reviewed real cards and virtual items. Unlocked writing items first, then recognition
   items, each group in level order (real and virtual interleaved by level order). At most `newLimit`
   cards in total (cards, not characters).
3. Reserve: the next new items after the cap (a session replaces dropped items from it).
4. Writing unlock: only when both `vocab` and `writing` are selected, a new writing item for an entry is
   included only if the entry's recognition card has a valid review whose learner day (`dayOf`, zone
   history) is before today's learner day. With `writing` alone there is no gating.
5. `strokeData: false` on an entry means its glyph has no stroke data: it never gets a writing item (recognition is unaffected and still takes its slot).
6. The session then orders the queue by the session mix (`cards/README.md`, `session-mix.json`): due first, the
   kinds interleaved inside each block and a character's two kinds kept apart (or grouped by kind when the setup
   asks for it). The plan above and its fixture are the order before the mix.

Inputs use `history` (zone changes, see `study-day/`), `now`, `entries`, `cards`, `reviews`
(`cardId`, `grade`, `ts`), `newLimit`, `reviewLimit`; `weights: "default"` means the FSRS default weights.
Every recognition review that unlocks a writing item is Easy (4) so the card is not due again at once.

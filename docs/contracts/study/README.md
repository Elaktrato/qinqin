# Typed study rows

Cards, decks, deck settings, daily limits, FSRS parameter sets and the active FSRS set are core data with
fixed shapes (v0.4.0, issue #85). Until v0.3.x they were keyed JSON rows of the plugin data store
(`card:*`, `deck:*`, `deckcfg:*`, `limits:*`, `fsrs:set:*`, `fsrs:active`); migration `038_core_study`
moved every readable row into one table per family, keeping its identity, `version`, stamps and tombstone.
Design: `docs/superpowers/specs/2026-11-16-v040p-core-features-design.md`.

Owner code: `server/internal/study/rows` (shapes, and the keyed-row codec the backup format uses),
`server/internal/study` (store: last-write-wins and reads; the paged pull reads its tables).

Fixtures:

- `rows.json` — valid and invalid wire rows per collection (the strict wire decode).
- `lww.json` — last-write-wins and tombstone cases of a push; `expect` is `applied`, `skipped` or `unchanged` (see `outcomes`).
- `setup.json` — the saved study setup, the keyed row `study-setup` (see Study setup below; web:
  `apps/web/src/lib/features/flashcards/setup/setup.test.ts`; Go: `server/internal/keyed/setup_contract_test.go`, key and scope).
- `canonical.json` — duplicate cards merged at read time: `{cards, reviews}` and the merged `{cards, reviews,
  merged}` (web: `apps/web/src/lib/studycore/canonical.test.ts`).

Web: `apps/web/src/lib/studycore/rows.ts` (strict parse, the study shapes, `sameBody`) and `store.ts` (typed
pull and push; a write is never sent when it would change nothing). The web decodes `rows.json` and
`lww.json`; its test-only mirror of the keyed-row codec (`lib/testing/legacyCodec.ts`) decodes
`backup/study-rows.json`.

## Collections

Every typed row is a workspace row; there is no user-global typed row.

| Collection | Keyed form (backups only) | Identity (per user and workspace) |
| --- | --- | --- |
| `cards` | `card:<id>` | `id` |
| `decks` | `deck:<id>` | `id` |
| `deckSettings` | `deckcfg:<deckId>` | `deckId` |
| `limits` | `limits:workspace` (`deckId: null`) and `limits:deck:<deckId>` | `deckId` (`null` = the workspace row) |
| `fsrsSets` | `fsrs:set:<id>` | `id` |
| `fsrsActive` | `fsrs:active` | one per workspace |

The study's other rows (`goals:workspace`, `known:<entryId>`, `milestone:<id>`, user-global `vacation:<id>`)
are keyed rows (`keyed/`) with their own contracts.

**The keys of the six families are never keyed rows (#198, #199).** The keyed rows store accepts no such key:
`GET`, `PUT` and `DELETE /api/rows/{key}` of one answer 404 `not_found`, and a push item of `rows` with one is
refused alone (`dataRefused`).

## Wire shape

Every key is always present; optional members are `null`; `extra` is always a JSON object. Each row also
carries `workspaceId`, `version`, `updatedAt` (the server write stamp; the pull cursor reads it) and
`deletedAt` (`null` or the tombstone time). Times are RFC 3339 UTC.

```jsonc
// cards
{"workspaceId":7,"id":"c-vocab-1201","kind":"vocab"|"sentence"|"writing"|"tone"|"reverse"|"cloze",
 "entryId":1201,"written":null|string,"entryKind":null|"character","sentenceId":null|int,
 "skipKinds":[non-vocab kinds, vocab cards only],"deckIds":[string],"createdAt":string,"extra":{},
 "version":3,"updatedAt":"2026-11-12T10:00:00Z","deletedAt":null}
// decks        {"id","name","createdAt","source": null | {"type":"level","packId","level"}
//                | {"type":"frequency","packId","size": int > 0}, "extra", meta}
// deckSettings {"deckId","cardTypes":["reverse"|"cloze"],"newOrder": null | {"by":"added"} | {"by":"frequency"}
//                | {"by":"level","packId"}, "extra", meta}
// limits       {"deckId": null | "<deckId>", "new": null | {"limit": 0..9999 | null}, "reviews": same, "extra", meta}
//                null = not set (deck -> workspace -> default 20/200); {"limit": null} = unlimited
// fsrsSets     {"id","w":[21 numbers],"createdAt","source":"optimized"|"imported","labelled","logLoss",
//                "baselineLogLoss" (number | null), "extra", meta}
// fsrsActive   {"setId": string | null, "changedAt": string | null, "extra", meta}
```

Decode rules (`rows.json`): an unknown top-level member, a missing key, a wrong type, an `extra` that is not
an object, an `entryId`/`sentenceId` that is not an integer in `1..2^53-1`, an unknown kind, `skipKinds` on a
non-vocab card, a duplicate in `deckIds`, `skipKinds` or `cardTypes`, a source or order outside its variants,
a limit outside `0..9999`, a weight list that is not 21 numbers and an `updatedAt` that is not an RFC 3339 time or is the zero time (`0001-01-01T00:00:00Z`) are invalid. The server checks structure
only: FSRS weight ranges stay a client rule (a set outside the ts-fsrs ranges is unusable = default weights;
the rule and its cases are `scheduler/fsrs.json`).
On push `version` is ignored and may be left out, and `deletedAt` may be left out (= live).

`extra` holds every member the typed shape does not carry, verbatim (a newer client's member, or a known
member whose stored value the typed shape cannot carry, under its own name). `extra` must not carry a
typed member's name, with one exception: a known member whose stored keyed value the typed shape cannot
carry while that typed member is unset (`null`) - an unusable `source`, an `entryKind` other than
`"character"`, a `sentenceId` that is not an integer in `1..2^53-1`, an unreadable `newOrder`, a limit
outside `0..9999`. The keyed form (backups) writes `extra` first, so a backup carries such a value exactly
as it was stored; a client that sets the typed member replaces it. A member that the keyed form writes from a
typed value always wins: the server drops `extra` members shadowed by a set typed member (`id`, `kind`,
`entryId`, `deckIds`, `createdAt` of a card; `deckId`, `cardTypes`, `updatedAt` of deck settings;
`version` of limits; and every optional member that is not `null`), and a writer must not send them.

Members of `extra` a client reads (written by clients, never by the server): `reading` on a card (#346), a string,
the reading the card is pinned to (the Starter add flow writes it from the set's `reading`); its back shows only that
reading's meanings (`senses/README.md`). Anything else (not a string, empty) is no pin.

## Last-write-wins and tombstones (`lww.json`)

The keyed-row rule, per row: a push item's edit time is its `updatedAt`, or its `deletedAt` when later,
clamped to the server clock. It wins when the stored edit time (`modified_at`, second precision) is not
after it (a same-second client write wins). An item whose typed members and `extra` equal the stored live
row is `unchanged`, whatever its stamp: nothing is written (`version` included) and it counts
`dataAccepted`, so a retry after a lost answer, or the same edit from two devices, never reads as "the
server holds newer data" (`dataSkipped`). Deleting an absent or deleted row is
skipped; a deletion keeps the row's last data; a newer live write revives a tombstone. Every applied write
bumps `version` and stamps `updatedAt` with the server clock. A pull from the zero cursor ships live rows
only; any other cursor (including `1970-01-01T00:00:00Z`) ships tombstones too.

## The keyed form (backups only)

Until v0.3.x the six families were keyed JSON rows; a personal backup still carries them in that keyed form, in
both directions. The codec (`FromLegacy`, `ToLegacy`) and its fixture are part of
the backup contract: `docs/contracts/backup/README.md` and `backup/study-rows.json`. No route reads or writes
the keyed form any more (the v0.3.x "legacy view" and the legacy pull were removed in #198).

## Duplicate cards (`canonical.json`)

New cards get a deterministic id (`c-<kind>-<entryId>`, `cards/card-ids.json`), so two devices adding the same
card write one row. Older cards (ULID ids) can exist twice; every client merges them **at read time**, before
limits, queues, statistics and goals count anything. Stored rows are never rewritten.

- Duplicates share a `cardKey`: `<kind>:<entryId>`, and for sentence cards `sentence:<entryId>:<sentenceId>`
  (empty after the last colon when there is none). Vocab, writing and tone keys ignore `sentenceId`; two
  sentence cards about different sentences, or one with and one without a `sentenceId`, are different cards.
- Per key the **earliest `createdAt`** survives (compared as instants: `01:00:00+01:00` ties `00:00:00Z`); ties,
  and two unparsable times, go to the **lowest id** (string order). An unparsable `createdAt` loses to every
  real one.
- The survivor keeps its own members and its **position** in the card list; the duplicates drop out. It gains
  every deck of the duplicates (its own decks first, then each duplicate's new decks, duplicates taken in
  survivor order: earliest first); a missing `written`, `entryKind` or `sentenceId` is taken from the first
  duplicate in that order that has one; `skipKinds` become the union of all, as known non-vocab kinds in kind
  order (`sentence, writing, tone, reverse, cloze`).
- Reviews of a duplicate are **re-pointed** to the survivor (`payload.cardId`); the event ids and every other
  member stay. Reviews of other cards are untouched.
- `merged` is the number of cards that dropped out (a card id listed twice counts once as merged).
- The merge is pure and idempotent: merging the result again changes nothing.

Ruling: no Go test and no server implementation — the server never merges cards (it stores rows as written);
adding one would be a second implementation nobody runs — cost: none.

## Study setup (`study-setup`, a keyed row)

The setup the study modal starts (design `docs/superpowers/specs/2026-11-25-study-modal-design.md`): one keyed row
per workspace (`keyed/`), synced, the same on every device. It is not a typed row: the server stores it like any
keyed row and never reads its members.

```jsonc
{"version": 1,
 "decks": "all" | ["general", "<deck id>", ...],   // "all" stays live: a deck created later joins
 "mode": "decks" | "levels", "schemeId": int | null, "levelName": string | null,
 "cardTypes": ["vocab" | "sentence" | "writing" | "tone"],   // the kinds that are not opt-in
 "unchecked": ["reverse" | "cloze"],   // opt-in kinds the learner switched off
 "newLimit": 1..999, "reviewLimit": 1..999,
 "newOrder": "random" | "deck" | {"by": "added"} | {"by": "frequency"} | {"by": "level", "packId": string},
 "typeOrder": "mixed" | "grouped"}
```

- **Read** member by member (`parse` cases): a missing or bad member is its default (`defaults`), never the
  whole row. An empty deck list is `"all"`. A kind list with no known kind is `["vocab"]`; a list of opt-in kinds
  only is an empty list. A newer `version` is read leniently.
- **Kinds studied:** `cardTypes` (within the workspace language's `cardKinds`, `languages/profiles.json`), plus
  each opt-in kind a deck in scope switches on (`deckSettings.cardTypes`) that is not in `unchecked`.
- **Repair** after the read, with what the reader knows (`repair` cases; `null` = not known yet, left alone): a
  level mode with no scheme or level, or one not installed for the workspace language → decks mode, the deck
  selection kept (`levelGone`); an explicit list with no deck left (`general` always exists) → `"all"`
  (`decksGone`); kinds the language lacks are dropped, and none left → `["vocab"]` (`typesGone`). A reader shows
  the note; the repaired value is used but written back only when the learner changes something.
- **Write** (`write` cases): the stored object with the setup's members replaced; unknown members kept; a stored
  integer `version` ≥ 1 kept, else 1. A client re-reads the row before it writes.
- **Not in the row:** a running session (its seed, Study all and the page it was started from) stays in the tab;
  a one-off start from a deck or a level never changes the row.

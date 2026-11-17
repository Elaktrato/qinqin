# Typed study rows

Cards, decks, deck settings, daily limits, FSRS parameter sets and the active FSRS set are core data with
fixed shapes (v0.4.0, issue #85). Until v0.3.x they were keyed JSON rows of plugin `qinqin-flashcards`
(`card:*`, `deck:*`, `deckcfg:*`, `limits:*`, `fsrs:set:*`, `fsrs:active`); migration `038_core_study`
moved every readable row into one table per family, keeping its identity, `version`, stamps and tombstone.
Design: `docs/superpowers/specs/2026-11-16-v040p-core-features-design.md`.

Owner code: `server/internal/study/rows` (shapes and the legacy codec), `server/internal/study` (store:
last-write-wins, pull, legacy view).

Fixtures:

- `rows.json` — valid and invalid wire rows per collection (the strict wire decode).
- `legacy-codec.json` — legacy `qinqin-flashcards` row (key + data) to typed row, `unreadable`, and the
  legacy object written back (`roundTrip`); `families` maps keys to collections.
- `lww.json` — last-write-wins and tombstone cases of a push; `expect` is `applied`, `skipped` or `unchanged` (see `outcomes`).
- `legacy-view.json` — the request shapes of a v0.3.0 web shell and what the legacy view answers.

Web: `apps/web/src/lib/study/rows.ts` (strict parse, the study shapes, `sameBody`) and `store.ts` (typed
pull and push; a write is never sent when it would change nothing). The web decodes `rows.json`, `lww.json`
and `legacy-codec.json` (a test-only mirror of the codec, `lib/study/testing/legacyCodec.ts`).

## Collections

Every typed row is a workspace row; there is no user-global typed row.

| Collection | Legacy key | Identity (per user and workspace) |
| --- | --- | --- |
| `cards` | `card:<id>` | `id` |
| `decks` | `deck:<id>` | `id` |
| `deckSettings` | `deckcfg:<deckId>` | `deckId` |
| `limits` | `limits:workspace` (`deckId: null`) and `limits:deck:<deckId>` | `deckId` (`null` = the workspace row) |
| `fsrsSets` | `fsrs:set:<id>` | `id` |
| `fsrsActive` | `fsrs:active` | one per workspace |

The remaining keyed rows of the study namespace `qinqin-flashcards` (`goals:workspace`, `known:<entryId>`,
user-global `vacation:<id>`, unknown keys) stay plugin-data rows with their own contracts.

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
//                | {"type":"plugin","pluginId","key"} | {"type":"frequency","packId","size": int > 0}, "extra", meta}
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
only: FSRS weight ranges stay a client rule (a set outside the ts-fsrs ranges is unusable = default weights).
On push `version` is ignored and may be left out, and `deletedAt` may be left out (= live).

`extra` holds every member the typed shape does not carry, verbatim (a newer client's member, or a known
member whose stored value the typed shape cannot carry, under its own name). `extra` must not carry a
typed member's name, with one exception: a known member whose stored legacy value the typed shape cannot
carry while that typed member is unset (`null`) - an unusable `source`, an `entryKind` other than
`"character"`, a `sentenceId` that is not an integer in `1..2^53-1`, an unreadable `newOrder`, a limit
outside `0..9999`. The legacy view writes `extra` first, so an old shell reads such a value back exactly as
it stored it; a client that sets the typed member replaces it. A member that the legacy form writes from a
typed value always wins: the server drops `extra` members shadowed by a set typed member (`id`, `kind`,
`entryId`, `deckIds`, `createdAt` of a card; `deckId`, `cardTypes`, `updatedAt` of deck settings;
`version` of limits; and every optional member that is not `null`), and a writer must not send them.

## Last-write-wins and tombstones (`lww.json`)

The plugin-data rule, per row: a push item's edit time is its `updatedAt`, or its `deletedAt` when later,
clamped to the server clock. It wins when the stored edit time (`modified_at`, second precision) is not
after it (a same-second client write wins). An item whose typed members and `extra` equal the stored live
row is `unchanged`, whatever its stamp: nothing is written (`version` included) and it counts
`dataAccepted`, so a retry after a lost answer, or the same edit from two devices, never reads as "the
server holds newer data" (`dataSkipped`). Deleting an absent or deleted row is
skipped; a deletion keeps the row's last data; a newer live write revives a tombstone. Every applied write
bumps `version` and stamps `updatedAt` with the server clock. A pull from the zero cursor ships live rows
only; any other cursor (including `1970-01-01T00:00:00Z`) ships tombstones too.

## The legacy codec (`legacy-codec.json`)

`FromLegacy(key, data)` reads a legacy row exactly as the v0.3.0 web parsers did (key/payload agreement,
`deckIds` cleaned to unique strings, `skipKinds`/`cardTypes` to known kinds in kind order, limits only at
`version: 1`, members beyond a source or order variant dropped). A row the v0.3.0 parsers ignored is
`unreadable` (and so is a card whose `entryId` is not an integer in `1..2^53-1`; a `sentenceId` that is not
one stays in `extra`, since the v0.3.0 web read such a card). `ToLegacy` writes the
legacy object back; deck settings get `updatedAt` = the row's edit time (`modified_at`).
`ToLegacy(FromLegacy(row))` equals the row as JSON values except for that cleaning.

## The legacy view (old web shells only)

A cached v0.3.x web shell keeps working for the v0.4.x line through a legacy view of the same tables:

- `GET /api/sync/pull` whose `collections` names `pluginData` and none of the six typed collections gets
  every typed row (cursor and tombstone rules as above) appended to `pluginData` as its legacy
  `qinqin-flashcards` row. A pull without `collections` gets the typed collections and no legacy rows. A
  client that understands typed collections must name one whenever it pulls `pluginData`.
- A pushed (`POST /api/sync/push` `pluginData`) or `PUT /api/plugins/qinqin-flashcards/data/{key}` row of a
  typed family is decoded and applied to the typed table with the same last-write-wins, except that a row
  equal to the stored live row after the codec's cleaning is counted `dataAccepted` without a write (no
  version bump; a v0.3.0 shell reports any skipped row as an error and re-sends unchanged rows); a row the codec
  refuses is `dataRefused` (push) or 400 `study_row_invalid` (`PUT`; also for a typed key without
  `?workspace=`, since there is no user-global typed row). A `PUT` is stamped with the server clock and
  answers the stored legacy row; equal content changes nothing (the version stays). `DELETE` tombstones
  the typed row (404 when it is already a tombstone).
- `GET` of a key or a prefix answers the legacy row of a typed row. A typed row (live or tombstoned)
  shadows a leftover `plugin_data` row of the same key; a key only a leftover holds (a row the migration
  could not read) is served, listed and deleted from `plugin_data` exactly as before. Prefix lists merge
  both in key order.

Android never uses the legacy view: it pulls and pushes the typed collections and uses `pluginData` only
for the keyed rows.

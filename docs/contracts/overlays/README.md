# Overlays: a user's edits of shared dictionary entries (#37)

A user may correct the written form and the readings of a shared dictionary entry for themselves. The edit
is a **patch** layered on the shared entry at read time; the shared rows are never changed (a dictionary
re-import keeps every patch). Design: `docs/superpowers/specs/2026-11-17-v040p-contract-gaps-design.md`
(Q11; issue #109).

Owner code: `server/internal/api/handlers_entries.go` (`handlePutEntry`), `server/internal/overlay/overlay.go`
(`Put`, `Apply`), `server/internal/sync/page_collections.go` (`overlays`). The web has no apply code (it reads
entries with the patch already applied).

Fixture `overlay.json`:

- `entry` — the shared entry the cases edit (发 of the test dictionaries) as everyone sees it unpatched.
- `cases` — `PUT /api/entries/{id}` steps (`put` body; `unknownId`: an id that does not exist; `age`: the
  stored stamp is set to `2026-01-01T00:00:00Z`, so the next write shows whether it stamps anew) with the answer,
  then `row`: the stored patch as the pull v2 `overlays` row carries it (`null` = no row), `fresh` = stamped
  by the last write. Go: `server/internal/api/contract_overlays_test.go` (also checks that another user pulls
  nothing and an anonymous read sees the shared entry).
- `apply` — a stored row over a shared entry view and the view the user sees. Go:
  `server/internal/overlay/overlay_test.go` (`TestContractOverlayApply`).

## The edit: `PUT /api/entries/{id}`

Body `{"written": string | null, "readings": [{"type": string, "value": string}] | null}`; a missing member is
`null`; other members are ignored. Signed-in users (and tokens with write access); the answer is the caller's
patched entry view (the same body as `GET /api/entries/{id}`).

Validation, in this order: an unknown or malformed id is `404 entry not found` (before the body is read); a
body that is not this shape is `400 malformed request body`; a `written` that is blank after trimming is
`400 written must not be empty`; a reading with a blank (after trimming) `type` or `value` is
`400 each reading needs a type and a value`. Errors are plain text and store nothing.

## The stored patch

- The patch **replaces** the previous one wholesale (it is not merged member by member).
- `null` = untouched: that member shows the shared value. `written` is stored as sent (not trimmed);
  `readings` exactly as sent, in order, nothing derived — each reading is stored with the four members of an
  entry reading, `{type, value, plain, ord}`: members not sent are `""` and `0` (a client that sends
  `{type, value}` reads back `plain: ""`, `ord: 0`). `readings: []` is stored as an empty list: the entry
  then shows **no** readings.
- An all-null patch (`{}`) is a revert: the entry shows the shared values, and the row is **kept** with both
  members `null` and a fresh stamp, so other devices learn of the revert (there are no overlay tombstones).
- The row is stamped with the **server clock** when the PUT arrives (`updatedAt`, whole seconds UTC). Last
  arrival wins.

Ruling: the contract states that overlay edits are **server-stamped** and that a queued offline edit
therefore wins over a newer edit another device made while it was offline — this is today's behaviour and #37's
queue must know it; changing it (client stamps) is a route change for #37 to decide — cost: a stale offline
edit can overwrite a newer one.

## Sync, apply and backup

The pull v2 `overlays` collection ships `{entryId, written, readings, updatedAt}` for entries of the round's
languages (`sync/`); each row is the user's whole patch of that entry (upsert by `entryId`).

**Apply rule** (an offline client showing an entry it holds): start from the shared entry; when the row's
`written` is not null it replaces the written form; when `readings` is not null it replaces the readings list
(an empty list = no readings). Nothing else of the entry changes (forms, senses, sense groups keep the shared
values). No row, or a row of two nulls, shows the shared entry.

Overlays are part of the personal backup (`backup/`: `overlays/NNNNNN.jsonl`, the same row shape).

Ruling: no web test — the web has no apply code (it reads applied entries); adding one would be a second
implementation nobody runs — cost: none.

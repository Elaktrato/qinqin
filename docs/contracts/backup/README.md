# Personal backup archive, format v2 (#61, #199)

A user's own data as a zip of JSON (`qinqin-<username>-<YYYYMMDD-HHMMSS>.zip`). Server routes:
`POST /api/account/export` (ticket) and the staged restore under `/api/account/restore`; see
`docs/superpowers/specs/2026-11-15-v030-backup-design.md`. `sample-v2/` is a valid unpacked archive
(the Go test zips it and restores it); `remap.json`, `reject.json` and `study-rows.json` are fixtures every
implementation runs.

## Entries (Store or Deflate only, no encryption)

```
manifest.json            written LAST: format, formatVersion (2), appVersion, schemaVersion, createdAt,
                         user {id, username}, counts, files [{name, bytes, sha256}]
account.json             {username, timeZones [{zone, from, createdAt}], features [{id, enabled}],
                         interfaceLanguage?}  optional (#73): '' or a language tag (i18n/language-tags.json)
account/avatar.jpg       optional (#189): the profile picture, its 256 px JPEG (manifest count `avatar`, 0 or 1)
refs/entries.json        [{id, language, kind, extKey, written}]   entries any exported row refers to (cards, notes, edits, events)
refs/dictionaries.json   [{id, packId}]                              dictionaries named by hiddenDictionaries
refs/sentences.json      [{id, entryId, own, sourcePack, hanzi}]    sentences cards point at
workspaces.json          [{id, language, name, settings, updatedAt}]
events/NNNNNN.jsonl      {id, workspaceId, device, ts, type, payload, updatedAt}
rows/NNNNNN.jsonl        {workspaceId|null, key, data, version, updatedAt, modifiedAt|null}
overlays/NNNNNN.jsonl    {entryId, written, readings, updatedAt}
sentences/NNNNNN.jsonl   {id, entryId, hanzi, pinyin, translation, updatedAt, ai?} own sentences only; ai = {provider, model, level} on a kept AI example (#186, the rules in examples/README.md)
library/books.json       [{id, workspaceId, language, title, author, source, sourceId, sourceUrl,
                           attribution, licenseNote, chapterCount, position, createdAt}]
library/books/<id>.json  the chapter array exactly as stored
library/bookmarks/NNNNNN.jsonl, library/highlights/NNNNNN.jsonl

Every JSONL collection is a FAMILY of numbered parts (NNNNNN = 000001, 000002, ...), each at most 100000 lines
and about 32 MiB, so no entry outgrows the per-entry cap; a family without rows has no part. Readers read the
parts in name order.
```

Ids in the archive are the SOURCE server's ids. A `workspaceId: null` row is a user-global row
(for example `vacation:<ULID>` rows): ALL of the user's live rows are exported,
global ones included, and a restore writes them back as global rows.

### Typed study rows

Cards, decks, deck settings, limits, FSRS sets and the active set live in typed tables on a v0.4 server
(`docs/contracts/study/`). The archive carries each LIVE typed row in its keyed form in the `rows` family
(`card:<id>`, `deck:<id>`, `deckcfg:<deckId>`, `limits:workspace`, `limits:deck:<deckId>`,
`fsrs:set:<id>`, `fsrs:active`; the keyed-row codec's `ToLegacy`: same key, data, `version`, `updatedAt`,
`modifiedAt`), counted under `rows`. This keyed form exists only in archives: no route reads or writes it
(the keyed rows store refuses these keys, `keyed/`). Typed tombstones are never exported.

A restore remaps these rows exactly like every row (workspaces, derived card ids, entry and
sentence ids, `remap.json`), then decodes each with the codec into its typed table: `version` and the edit
time (`modifiedAt`, else `updatedAt`) are kept, `updatedAt` is the restore time (like every restored
row). A typed-family row the codec cannot read, or one without a workspace, is dropped and counted in
`droppedRows` (the dry-run report counts it too). The restore clears the user's typed rows (tombstones included) and the library deletion log
(`library_deletions`, sync bookkeeping that is never exported); every client pulls in full after a
restore.

### Journal documents (#199, #185)

The journal's entries, reviews, topic ideas, settings and conversations are typed storage (`journal/README.md`).
The archive carries each as a workspace row of the `rows` family in its keyed form: `journal:entry:<id>` (the entry
as the routes answer it), `journal:review:<entryId>`, `journal:suggestions`, `journal:settings`,
`journal:conversation:<id>` (the conversation with its messages, as `GET` answers it), version 1,
`updatedAt` the document's stamp, counted under `rows`; per workspace the entries come before their
reviews. A restore remaps the workspace and writes each into its table through the store's own validation;
one that does not decode, that the store refuses, or a review whose entry the archive did not restore first is
dropped and counted in `droppedRows`.

Grammar lesson runs (`grammar/README.md`, #277) are `grammar` events and travel with the other events; an export
writes no grammar rows. An archive written before #277 carries the progress as a workspace row of the `rows` family
per lesson, `grammar:progress:<packId>:<lessonId>` with `{completedAt, best, total}`: a restore turns each into the
one `grammar` event it stands for (`grammar/runs.json` `legacy`: its best score at its `completedAt`, or at the row's
`updatedAt` when that is no RFC 3339 time; a fresh id of that instant, device `restore`) and counts it under
`restored.rows`; one the conversion refuses, or without a workspace, is dropped and counted by both the dry run and
the restore. An export never writes a stamp a restore refuses: a review's or an entry's `createdAt` or the topic
ideas' `createdAt` that is not an RFC 3339 time (left by an older server) is replaced by the row's write time (for
the topic ideas, the export's). A journal row without a workspace is dropped by both the dry run and the restore.

### The keyed-row codec (`study-rows.json`)

`FromLegacy(key, data)` reads a keyed row exactly as the v0.3.0 web parsers did (key/payload agreement,
`deckIds` cleaned to unique strings, `skipKinds`/`cardTypes` to known kinds in kind order, limits only at
`version: 1`, members beyond a source or order variant dropped). A row the v0.3.0 parsers ignored is
`unreadable` (and so is a card whose `entryId` is not an integer in `1..2^53-1`; a `sentenceId` that is not
one stays in `extra`, since the v0.3.0 web read such a card). `ToLegacy` writes the keyed object back; deck
settings get `updatedAt` = the row's edit time (`modified_at`). `ToLegacy(FromLegacy(row))` equals the row as
JSON values except for that cleaning. Fixture: `study-rows.json` (keyed row to typed row, `unreadable`, the
object written back as `roundTrip`; `families` maps keys to collections). Go: `server/internal/study/rows`
(`codec_test.go`); migration 038 keeps a frozen copy (`server/internal/db/step038/testdata`). Web: a test-only
mirror (`apps/web/src/lib/testing/legacyCodec.ts`) that builds old-shaped test data.

## Version rule

`formatVersion` is the only compatibility key. A reader accepts exactly the versions it knows (2) and
rejects everything else (`backup_version_unsupported`); `appVersion`/`schemaVersion` are informational.
Format 2 (#199) replaced the `plugin-data` family (rows with a `pluginId`) by `rows` and `account.json`
`pluginStates` by `features`; a format 1 archive (every archive from before #199) is refused (owner
direction 2026-11-24: old backups need not restore). An older server rejects a newer format.

Optional additions keep the version: `account.json` `interfaceLanguage` (#73) is written by every export since
then; a restore sets it when present and valid (`i18n/language-tags.json`), leaves the current setting when the
key is absent or null (older archives), and ignores an invalid tag without failing (a preference is not worth a
refused restore). A server from before #73 decodes `account.json` strictly and refuses such an archive as malformed: restoring
into an older server is not supported.

### Profile picture (#189)

`account/avatar.jpg` is the 256 px square the server serves (`auth/avatar.json`); the manifest counts it as
`avatar` (1, or 0 / absent without the entry, and a count without the entry or the entry without the count is
invalid). A reader checks it exactly like an upload: at most 5 MB, a still JPEG, PNG or WebP of at most 25
megapixels and 8192 px a side, otherwise the archive is invalid. A restore never writes the archive's bytes: the
picture is decoded and encoded again (both sizes), and it REPLACES the current picture; an archive without one
removes it, like every other part of the account data.

## Never in an archive

Password hash, email, sessions, personal access tokens, reset links, one-time-code challenges, TOTP secrets and recovery codes,
AI keys and AI selection and usage, invites, the audit log, SMTP settings, QINQIN_SECRET, journal photo
drafts, tombstoned (deleted) keyed rows and typed study rows, own sentences, the library deletion log,
dictionary and pack content, data packages (`<data>/packages`: shared data, rebuilt by the server, never user
data). A restore never changes who can sign in.

## Caps (checked on the bytes read, declared sizes ignored)

Upload 128 MiB (a server never PRODUCES an archive above its own upload cap, 2 GiB expanded or 64 MiB per book:
the export is refused with `backup_too_large_to_restore`); manifest 1 MiB; one JSONL line 1 MiB; a JSON array file or book file 64 MiB; all
entries together 2 GiB; at most 10 000 entries; a row value 256 KiB; names exactly as above, no
duplicates; book files only for ids listed in `library/books.json`. Entry names are never joined into
a path: only integer book ids build file names.

## Remapping on restore

See `remap.json`. Entry identity is `(language, kind, extKey)`, falling back to the unique live entry
with that language and kind whose first written form equals `written`; none or several: unresolved.
Unresolved references are dropped, never guessed. Card ids `c-<kind>-<entryId>` whose number equals the
card's `entryId` are rewritten with the new entry id in one simultaneous pass; review events follow
(`payload.cardId`); a card of an unresolved entry or sentence is dropped and its reviews keep the
history under `orphan:<oldId>`. `read` events: `payload.bookId` through the book map; `view` events:
`payload.entryId` (unresolved: field removed). Event ids are kept; an id another user owns on the target gets a
new ULID, and every restored `review` whose `replaces` (a changed grade, `events/review-replace.json`) names such
an id is rewritten to the new id (other members byte for byte), so the replaced review stays replaced; only the
restoring user's rows are read or written (Go: `restore_test.go` `TestRestoreKeepsReplacementLinks`). Workspace ids inside `vacation:*` rows
(`scope.workspaces`) and `hiddenDictionaries` (by dictionary pack id) are remapped; a vacation whose
workspace list becomes empty is dropped (`"all"` stays). Workspace and book ids are always new.

Personal notes (rows `note:<entryId>` whose key number equals `data.entryId`,
`docs/contracts/notes/`): export lists each live note's entry in `refs/entries.json`; restore rewrites the
key and `entryId` together to the target entry, every other member byte for byte, and drops the note when
the entry is unresolved (the dry-run report counts it under that entry's `notes` and in `droppedRows`).
If two archive notes of one workspace would land on the same target entry, the newest
(`modifiedAt ?? updatedAt`, ties: the smaller source entry id) is kept and the other dropped, never a
blocking collision. (Today's entry resolution maps at most one archive entry to a target entry, so this
cannot happen through `resolveEntries`; the rule keeps a restore safe if that ever changes.) Invalid note rows are dropped: a row whose key starts with `note:` but
is not canonical (`note:01`, `note:+1`, `note:`) or whose `data` is not an object with a JSON integer
`entryId` equal to the key's number is never restored (kept verbatim it would annotate whatever entry its
key names on the target, or collide with a remapped note); it counts in `droppedRows`. Every other
keyed row (`notecfg`, the home layout, ...) is restored unchanged.

Manual known marks (rows `known:<entryId>`, `reader/README.md`) follow the same rules as
notes: export lists the entry of each live mark in `refs/entries.json`; restore rewrites key and `entryId`
together (other members byte for byte), drops a mark whose entry is unresolved, drops an invalid `known:`
row (key not canonical, `data` not an object with a JSON integer `entryId` equal to the key's number, or
no workspace: marks are workspace rows) and
keeps the newest of two marks that would land on one target; every dropped mark counts in `droppedRows`.
A key no store takes (`keyed/families.json`, a typed family, `journal:`, `grammar:progress:` (converted to an event)) is dropped and
counted in `droppedRows`.

The lookup history (row `lookups`, one per workspace, `docs/contracts/lookups/`): export lists
the entry of every valid item in `refs/entries.json`. Restore parses the row with the lookups parse rules,
moves each item to the target entry (unresolved: the item is dropped), maps `books` through the book map
(unresolved ids removed), merges items that land on one target entry (`count` and every `sources` member
summed and clamped to 1 000 000, earliest `firstAt`, latest `lastAt`, books of the newest item first,
distinct, at most three), sorts newest first and keeps 500; `clearedAt`, `version` and unknown top-level
members keep their bytes. A `lookups` row whose `data` is not a version 1 object (a JSON string holding one
is decoded first) or that has no workspace is dropped and counts in `droppedRows` (kept as it is, its ids
would name other words). Dropped items are not listed in the dry-run report. `lookupcfg` (user-global, no
ids) is restored unchanged. Cases: the `lookups:` rows of `remap.json`; the sample archive carries one row.

## Limits of a restore

At most 2,000,000 events (`backup_too_many_events`), one restore applied at a time server-wide
(`restore_busy`, Retry-After 30), event `ts` normalised to UTC whole seconds like a normal push, a card
id collision after remapping makes the stage invalid (never fails at apply), safety exports: newest three
or one week.

## Restore rules in short

Order: validate everything (nothing changes), dry-run report, safety export of the current data, then one
transaction that deletes the user's rows through the same registry as account deletion
(`auth.UserTables()`: every table with user data has an export decision and a restore decision, enforced
by the schema guard test) and inserts the archive's. Account identity and security tables are never
touched; only the user's OTHER sessions are revoked. Books are staged beside the target and moved after
the commit. Restore replaces; there is no merging import.

## Server backup (not a user archive)

`qinqin-server-<date>.tar.gz`: `qinqin.db` (VACUUM INTO snapshot) with `avatars/` (the profile pictures its rows
name, part of `db`; linked under the pictures' lock together with the snapshot, so the files match its rows), `books/`, `packs/`, `audio/`,
`BACKUP-INFO.json` last (`format: qinqin-server-backup`, `formatVersion`, per-file SHA-256). It holds
password hashes and sealed secrets; restoring is offline (`tar xzf` into an empty volume). `<data>/packages` is
not in it: the restored server rebuilds every package at start, to the same revisions and content hashes.

## Android (v0.4.0)

Export and restore are server features; the app calls the same routes (ticket download, staged upload).
After a restore all local data is invalid: on 401 re-login and do a full paged pull (`GET /api/sync/pull?v=2`
without `since`, `docs/contracts/sync/`); workspace ids change. Installed packages stay valid while the
catalogue's `instanceId` is unchanged (a personal restore keeps the server); a different `instanceId` means
discard packages too (`docs/contracts/packages/`).

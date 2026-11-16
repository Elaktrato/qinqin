# Personal backup archive, format v1 (#61)

A user's own data as a zip of JSON (`qinqin-<username>-<YYYYMMDD-HHMMSS>.zip`). Server routes:
`POST /api/account/export` (ticket) and the staged restore under `/api/account/restore`; see
`docs/superpowers/specs/2026-11-15-v030-backup-design.md`. `sample-v1/` is a valid unpacked archive
(the Go test zips it and restores it); `remap.json` and `reject.json` are fixtures every implementation runs.

## Entries (Store or Deflate only, no encryption)

```
manifest.json            written LAST: format, formatVersion (1), appVersion, schemaVersion, createdAt,
                         user {id, username}, counts, files [{name, bytes, sha256}]
account.json             {username, timeZones [{zone, from, createdAt}], pluginStates [{pluginId, enabled, order}]}
refs/entries.json        [{id, language, kind, extKey, written}]   entries any exported row refers to (cards, notes, edits, events)
refs/dictionaries.json   [{id, packId}]                              dictionaries named by hiddenDictionaries
refs/sentences.json      [{id, entryId, own, sourcePack, hanzi}]    sentences cards point at
workspaces.json          [{id, language, name, settings, updatedAt}]
events/NNNNNN.jsonl      {id, workspaceId, device, ts, type, payload, updatedAt}
plugin-data/NNNNNN.jsonl {pluginId, workspaceId|null, key, data, version, updatedAt, modifiedAt|null}
overlays/NNNNNN.jsonl    {entryId, written, readings, updatedAt}
sentences/NNNNNN.jsonl   {id, entryId, hanzi, pinyin, translation, updatedAt}     own sentences only
library/books.json       [{id, workspaceId, language, title, author, source, sourceId, sourceUrl,
                           attribution, licenseNote, chapterCount, position, createdAt}]
library/books/<id>.json  the chapter array exactly as stored
library/bookmarks/NNNNNN.jsonl, library/highlights/NNNNNN.jsonl

Every JSONL collection is a FAMILY of numbered parts (NNNNNN = 000001, 000002, ...), each at most 100000 lines
and about 32 MiB, so no entry outgrows the per-entry cap; a family without rows has no part. Readers read the
parts in name order.
```

Ids in the archive are the SOURCE server's ids. A `workspaceId: null` plugin row is a user-global row
(for example `vacation:<ULID>` rows of `qinqin-flashcards`): ALL of the user's live rows are exported,
global ones included, and a restore writes them back as global rows.

### Typed study rows (v0.4.0, still format 1)

Cards, decks, deck settings, limits, FSRS sets and the active set live in typed tables on a v0.4 server
(`docs/contracts/study/`). The archive carries each LIVE typed row as its legacy `qinqin-flashcards` plugin
row (`card:<id>`, `deck:<id>`, `deckcfg:<deckId>`, `limits:workspace`, `limits:deck:<deckId>`,
`fsrs:set:<id>`, `fsrs:active`; the study codec's `ToLegacy`: same key, data, `version`, `updatedAt`,
`modifiedAt`), counted under `pluginData`, so a v0.4 archive restores on a v0.3 server and a v0.3 archive on
a v0.4 one. Typed tombstones are never exported. A leftover `plugin_data` row of a typed family is exported
only while it is still a readable study row whose key no typed row holds (so keys never repeat).

A restore remaps these rows exactly like every plugin row (workspaces, derived card ids, entry and
sentence ids, `remap.json`), then decodes each with the codec into its typed table: `version` and the edit
time (`modifiedAt`, else `updatedAt`) are kept, `updatedAt` is the restore time (like every restored plugin
row). A typed-family row the codec cannot read, or one without a workspace, is dropped and counted in
`droppedRows` (the dry-run report counts it too); v0.3.0 restored such rows as inert plugin rows no client
read. The restore clears the user's typed rows (tombstones included) and the library deletion log
(`library_deletions`, sync bookkeeping that is never exported); every client pulls in full after a
restore.

## Version rule

`formatVersion` is the only compatibility key. A reader accepts exactly the versions it knows (1) and
rejects everything else (`backup_version_unsupported`); `appVersion`/`schemaVersion` are informational.
A newer server must keep reading v1; an older server rejects a newer format.

## Never in an archive

Password hash, email, sessions, personal access tokens, reset links, one-time-code challenges, TOTP secrets and recovery codes,
AI keys and AI selection and usage, invites, the audit log, SMTP settings, QINQIN_SECRET, journal photo
drafts, tombstoned (deleted) plugin rows, typed study rows and own sentences, the library deletion log,
dictionary and pack content.
A restore never changes who can sign in.

## Caps (checked on the bytes read, declared sizes ignored)

Upload 128 MiB (a server never PRODUCES an archive above its own upload cap, 2 GiB expanded or 64 MiB per book:
the export is refused with `backup_too_large_to_restore`); manifest 1 MiB; one JSONL line 1 MiB; a JSON array file or book file 64 MiB; all
entries together 2 GiB; at most 10 000 entries; a plugin value 256 KiB; names exactly as above, no
duplicates; book files only for ids listed in `library/books.json`. Entry names are never joined into
a path: only integer book ids build file names.

## Remapping on restore

See `remap.json`. Entry identity is `(language, kind, extKey)`, falling back to the unique live entry
with that language and kind whose first written form equals `written`; none or several: unresolved.
Unresolved references are dropped, never guessed. Card ids `c-<kind>-<entryId>` whose number equals the
card's `entryId` are rewritten with the new entry id in one simultaneous pass; review events follow
(`payload.cardId`); a card of an unresolved entry or sentence is dropped and its reviews keep the
history under `orphan:<oldId>`. `read` events: `payload.bookId` through the book map; `view` events:
`payload.entryId` (unresolved: field removed). Workspace ids inside `vacation:*` rows
(`scope.workspaces`) and `hiddenDictionaries` (by dictionary pack id) are remapped; a vacation whose
workspace list becomes empty is dropped (`"all"` stays). Workspace and book ids are always new.

Personal notes (`qinqin-core` rows `note:<entryId>` whose key number equals `data.entryId`,
`docs/contracts/notes/`): export lists each live note's entry in `refs/entries.json`; restore rewrites the
key and `entryId` together to the target entry, every other member byte for byte, and drops the note when
the entry is unresolved (the dry-run report counts it under that entry's `notes` and in `droppedRows`).
If two archive notes of one workspace would land on the same target entry, the newest
(`modifiedAt ?? updatedAt`, ties: the smaller source entry id) is kept and the other dropped, never a
blocking collision. (Today's entry resolution maps at most one archive entry to a target entry, so this
cannot happen through `resolveEntries`; the rule keeps a restore safe if that ever changes.) Invalid note rows are dropped: a `qinqin-core` row whose key starts with `note:` but
is not canonical (`note:01`, `note:+1`, `note:`) or whose `data` is not an object with a JSON integer
`entryId` equal to the key's number is never restored (kept verbatim it would annotate whatever entry its
key names on the target, or collide with a remapped note); it counts in `droppedRows`. Every other
`qinqin-core` row (`notecfg`, the home layout, ...) is restored unchanged.

Manual known marks (`qinqin-flashcards` rows `known:<entryId>`, `reader/README.md`) follow the same rules as
notes: export lists the entry of each live mark in `refs/entries.json`; restore rewrites key and `entryId`
together (other members byte for byte), drops a mark whose entry is unresolved, drops an invalid `known:`
row (key not canonical, `data` not an object with a JSON integer `entryId` equal to the key's number, or
no workspace: marks are workspace rows) and
keeps the newest of two marks that would land on one target; every dropped mark counts in `droppedRows`.
Other `qinqin-flashcards` keys (`knownfilter`, ...) are untouched.

The lookup history (`qinqin-core` row `lookups`, one per workspace, `docs/contracts/lookups/`): export lists
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

`qinqin-server-<date>.tar.gz`: `qinqin.db` (VACUUM INTO snapshot), `books/`, `packs/`, `audio/`,
`BACKUP-INFO.json` last (`format: qinqin-server-backup`, `formatVersion`, per-file SHA-256). It holds
password hashes and sealed secrets; restoring is offline (`tar xzf` into an empty volume).

## Android (v0.4.0)

Export and restore are server features; the app calls the same routes (ticket download, staged upload).
After a restore all local data is invalid: on 401 re-login and do a full pull; workspace ids change.

# Backup: personal export/restore and the admin server backup — design (#61, v0.3.0 item 5)

Status: Draft (2026-11-15), written unattended. Every non-obvious call is a **Ruling: what — why — cost
if wrong**. Nothing is built. Direction: `docs/superpowers/directions/2026-11-15-v0.3.0-web-build.md`
item 5 (it overrides the issue body where they differ: the issue asked for a merging import, the
direction for **restore replaces all of the user's data**). Builds on: accounts plan 2 (user deletion
core `server/internal/auth/delete.go`: `userTables`/`keptTables` and the schema guard, Settings →
Account and Admin tabs, `auth_audit`), the learner's day (`user_time_zones`, migration 035), vacation
and limits (`vacation:*` user-global rows with workspace ids in `scope`, `limits:*` workspace rows), the
cards design (card ids `c-<kind>-<entryId>`, `deckcfg:*`), #86 (`limiter`, named buckets).

## What exists (checked on `feature/v0.3.0` b925e17)

- SQLite in WAL mode, foreign keys declarative only. Entry ids are local `INTEGER PRIMARY KEY` ids of
  `entries` (the lexicon, not AUTOINCREMENT); an entry's portable identity is `UNIQUE (language, kind, ext_key)`
  (JMdict sequence, CEDICT key, Unihan character). A re-seed or another server gives other ids.
- Id-bearing user data: `user_edits.entry_id`, `sentences.entry_id` (user rows: `user_id` set,
  `source_pack` empty), flashcards rows `card:<cardId>` in plugin data (`entryId`, `sentenceId`,
  derived ids `c-<kind>-<entryId>`), review events (`payload.cardId`), read events
  (`payload.bookId`), view events (`payload.entryId`, `routes/entry/[id]/+page.svelte`), `library_bookmarks/highlights.book_id`, workspace ids everywhere
  (`study_events`, `plugin_data`, `library_books`, `journal_photos`, `vacation:*` `scope.workspaces`),
  workspace setting `hiddenDictionaries` (dictionary ids; portable identity `dictionaries.pack_id`).
- Workspace and book ids are AUTOINCREMENT (never reused); `study_events.id` is a client ULID and the
  **global** primary key. Book content is `<data>/books/<userId>/<bookId>.json`.

## Scope

In: per-user export (zip of JSON), staged restore that replaces the user's data, admin whole-server
backup (download and CLI), docs, a contract for the format. Out: merging import, scheduled backups
with retention (documented with cron + CLI instead), admin export of another user's data, restoring
a server backup through the UI.

Ruling: no merging import — the direction decides "replace all"; merge would need LWW for every table
and orphan handling — cost if wrong: users who want to combine two accounts cannot (open point).
Ruling: no admin export of another user — the admin has the server backup; a per-user download of
someone else's journal is a privacy step the owner did not ask for — cost if wrong: one route later.

## 1. What a personal export contains

One registry decides, per user table and per data directory, **delete / export / restore**:
`userTables` in `auth/delete.go` gains an `Export` field (`exportRows`, or `exportSkip` with a
reason), and the schema guard also fails when a deleted table has no export decision. The export
writer iterates that registry, so a new user table cannot be forgotten by either feature.

| Data | Export | Restore |
|---|---|---|
| `workspaces` (language, name, settings) | yes | new rows, ids remapped |
| `study_events` (all types) | yes | inserted, ids kept (see §4) |
| `plugin_data` live rows (all plugins, user-global and workspace) | yes | inserted |
| `plugin_states` | yes | replaced |
| `user_edits` (overlays) | yes, with entry refs | re-resolved |
| `sentences` where `user_id` = me | yes, with entry refs | new ids |
| `library_books` + content files, `library_bookmarks`, `library_highlights` | yes | new ids |
| `user_time_zones` (zone history) | yes | replaced |
| (rows of plugins not installed here) | yes | inserted inert, listed in the report |
| `journal_photos` + `<data>/journal/<id>/` | **no** (temporary drafts) | deleted |
| `sessions`, `password_resets`, `auth_challenges`, `mfa_*`, `ai_keys`, `ai_selection`, `ai_calls`, `invites`, `auth_audit`, `users` row (hash, email, flags) | **no** | untouched |

Ruling: library books and their texts are included — the issue lists them, uploaded books may exist
nowhere else, and text compresses ~5:1 — cost if wrong: large archives for big libraries (the 128 MiB
upload cap, §5, is the limit; the dialog shows the size before restore).
Ruling: tombstones (`deleted_at` on plugin rows and own sentences) are not exported — restore replaces everything and revokes the other
sessions (§4), so nothing needs to learn about deletions — cost if wrong: none known.
Ruling: account identity (password, email, MFA, sessions, AI keys) is never part of the archive — it is
security data, and restoring onto another account must not change who can sign in — cost if wrong: the
learner re-enters an AI key after moving servers (the dialog says so).

## 2. Format v1

`qinqin-<username>-<YYYYMMDD-HHMMSS>.zip`, entries (Store or Deflate only):

```
manifest.json           written last; see below
account.json            {"username","timeZones":[{zone,from}],"pluginStates":[{pluginId,enabled,order}]}
refs/entries.json       [{"id":1201,"language":"zh","kind":"word","extKey":"…","written":"你好"}]
refs/dictionaries.json  [{"id":3,"packId":"cc-cedict"}]
refs/sentences.json     [{"id":88,"entryId":1201,"own":false,"sourcePack":"tatoeba-zh","hanzi":"…"}]
workspaces.json         [{"id":7,"language":"zh","name":"","settings":{…},"updatedAt"}]
events/000001.jsonl     one event per line {"id","workspaceId","device","ts","type","payload","updatedAt"}
plugin-data.jsonl       {"pluginId","workspaceId":7|null,"key","data","version","updatedAt","modifiedAt"|null}
                        (pluginId = column pack_id; modifiedAt null for rows older than migration 011)
overlays.jsonl          {"entryId","written","readings","updatedAt"}
sentences.jsonl         {"id","entryId","hanzi","pinyin","translation","updatedAt"}
library/books.json      [{"id","workspaceId","language","title",…,"position","createdAt"}]
library/books/<id>.json the chapter array exactly as stored
library/bookmarks.jsonl, library/highlights.jsonl
```

`events/` holds at most 100 000 lines per file. `refs/entries.json` lists every entry id referenced
by any exported row (overlays, sentences, card rows, derived card ids), `refs/sentences.json` every
sentence id referenced by a card. Ids in the archive are the **source** server's ids.

`manifest.json`:
`{"format":"qinqin-user-backup","formatVersion":1,"appVersion":"0.3.0","schemaVersion":"035_user_time_zones",
"createdAt":"…Z","user":{"id":4,"username":"alice"},"counts":{"workspaces":2,"events":120345,…},
"files":[{"name":"events/000001.jsonl","bytes":…,"sha256":"…"}]}`.

Ruling: JSON Lines for the big collections, JSON arrays for the small ones — a reader never holds a
million events in memory and each line is independently checkable — cost if wrong: none (documented).
Ruling: the manifest is the last entry — counts and hashes are known only after writing; readers find
entries by name — cost if wrong: none.
Ruling: `formatVersion` is the only compatibility key: restore accepts exactly the versions it knows
(1) and rejects anything else with 422 `backup_version_unsupported`; `schemaVersion`/`appVersion` are
informational. A newer server reading v1 must keep working (fixture in the contract) — cost if wrong:
a future v2 needs a converter for v1, which is the point.

## 3. Export route and writer

- `POST /api/account/export` → `{"url":"/api/account/export/<ticket>","expiresInSeconds":60}`;
  `GET /api/account/export/<ticket>` streams the zip (`Content-Disposition: attachment`,
  `Cache-Control: no-store`). The ticket is 128-bit random, stored as SHA-256, single use, 60 s,
  bound to the user id; an unknown, used or expired ticket is 404.
  Ruling: a download ticket instead of a bearer-authenticated `fetch` + blob — the browser streams the
  file to disk itself (a phone cannot hold a 100 MB blob comfortably) and the bearer token never goes
  into a URL — cost if wrong: a 60-second link could be replayed from a proxy log once (single use).
- Writer `backup.WriteUser(ctx, db, dataDir, userID, w io.Writer)`: one **read transaction** (WAL
  snapshot: events and cards agree; a slow client holds the snapshot and delays WAL checkpoints for
  the download's duration — accepted and documented, exports are rare), rows streamed with `rows.Next()` into `zip.Writer` →
  `io.MultiWriter(entry, sha256)`; per-file counts; memory is O(refs), not O(events). Entry refs are
  collected while streaming card rows and written after (`refs/` entries precede the manifest).
- Limits: one export per user at a time (409 `export_running`), bucket `export` 6/hour (429 +
  `Retry-After`), never while a restore of that user runs.
- Audit `data_exported` (`{"events":n}`), no secret in any row.

## 4. Restore

**Stage:** `POST /api/account/restore` (body = the zip, `application/zip`, cap 128 MiB, bucket
`restore` 5/hour) → 202 `{"token":"…"}`; the file lands in `<data>/tmp/restore/<token>.zip`; one stage
per user (a new upload discards the old); stages expire after 30 min (janitor). Validation runs in the
background; `GET /api/account/restore/<token>` → `{"status":"validating"|"ready"|"invalid"|"running"|"done"|"failed","report":{…},"error":{code,message}}`.
Tokens are stored hashed (SHA-256); a token of another user is 404 (indistinguishable from unknown).
`DELETE /api/account/restore/<token>` discards.

**Validation (all before anything changes):** zip opened from disk (`zip.OpenReader`); only the names
of §2 (books by integer id that exists in `books.json`), no duplicates, ≤ 10 000 entries, methods
Store/Deflate; every entry read through a counting `LimitReader` (declared sizes are ignored): manifest
1 MiB, a JSONL line 1 MiB, a book file 64 MiB, all entries together 2 GiB; SHA-256 and counts must match
the manifest; every row parsed and checked (types, ULID event ids, plugin data value ≤ 256 KiB like
`PUT`, workspace languages present in `languages` — otherwise the report lists them and the stage is
`invalid`); then the **dry run** of the remap (below) produces the report:
`{"backup":{"username","createdAt","appVersion"},"replaces":{"workspaces":3,"events":9876,"cards":…,"books":…},
"restores":{…same keys…},"unresolved":{"entries":[{"written":"…","language":"zh","cards":2,"overlays":0}],
"sentences":n},"pluginsNotInstalled":["x"],"reidentifiedEvents":0,"bytes":…}`.

**Entry and id remapping** (pure package `backup/remap`, fixture-tested):

1. Entries: each ref → `SELECT id FROM entries WHERE language=? AND kind=? AND ext_key=? AND deleted_at IS NULL`;
   none → the unique live entry with that `(language, kind)` whose first form (`forms.text`, lowest
   `ord`) equals `written`; none or several → **unresolved**. Same server: every ref maps to itself.
   **Collisions:** if two source entries map to one target entry, the one matched by exact `ext_key`
   keeps it and the others become unresolved; if none or both matched exactly, all of them become
   unresolved. `Plan` detects this, so a `ready` stage can never fail on the unique keys of
   `plugin_data` (`card:c-<kind>-<id>`) or `user_edits (user_id, entry_id)`.
2. Sentences: own sentences get new ids on insert (old→new map); a pack sentence resolves by
   `(source_pack, new entry id, hanzi)` among live rows; otherwise unresolved.
3. Cards (`qinqin-flashcards`, key `card:<id>`): `entryId` and `sentenceId` rewritten; a **derived** id
   (`^c-(vocab|sentence|writing|tone|reverse|cloze)-(\d+)$` whose number equals the card's old
   `entryId`) becomes `c-<kind>-<newEntryId>`, key included; other ids (ULIDs) stay. A card whose entry
   or sentence is unresolved is **dropped**; its old id maps to `orphan:<oldId>`.
4. Review events: `payload.cardId` through the card-id map (one simultaneous pass, so swapped ids
   never chain); read events: `payload.bookId` through the book map; view events: `payload.entryId`
   through the entry map (unresolved → the field is removed, the event kept for activity counts); workspace ids everywhere through
   the workspace map, including `vacation:*` `scope.workspaces` (ids not in the backup dropped; a
   period whose checklist becomes empty is dropped, see ruling) and `hiddenDictionaries` (by
   `packId`; unresolved ids dropped). Other plugins' data is restored verbatim (only `workspace_id`
   remapped).
5. Overlays and own sentences of unresolved entries are dropped and counted.

Ruling: unresolved references are **dropped, never guessed**, and the restore needs the explicit
`"unresolved":"drop"` acknowledgement when any exist (otherwise 409 `unresolved_entries`) — a dangling
id would silently point at a different word on this server — cost if wrong: a learner restoring onto a
server without their dictionary loses those cards (the report names them first; installing the
dictionary and restoring again recovers them).
Ruling: orphaned review events are kept with `cardId` = `orphan:<oldId>` — history (streaks, heatmap,
reviews per day) stays complete, and no future card can inherit foreign reviews by id — cost if wrong:
none; reviews of unknown cards are already ignored by the scheduler.
Ruling: a vacation period whose checklist maps to no workspace is dropped — "all" would widen it —
cost if wrong: the learner re-creates one period.
Ruling: event ids are kept (idempotent against a device that pushes the same event again); an id that
already belongs to **another** user on this server is re-identified with a new ULID of the same
millisecond and counted (`reidentifiedEvents`) — the global primary key forbids two owners — cost if
wrong: that event could be pushed twice by an old device of the other account (impossible in practice).

**Apply:** `POST /api/account/restore/<token>` `{"confirm":"<username>","password":"…","code"?,"unresolved"?:"drop"}`
(re-auth exactly as self-delete: 403 `wrong_password`/`code_invalid`, 422 `confirm_mismatch`) → 202;
status moves to `running`, then `done` (with the final counts) or `failed` (nothing changed).

1. **Safety export first:** the server writes the current data with the same writer to
   `<data>/backups/pre-restore/<userId>/<ts>.zip` (keeps the newest one, 7 days; deleted with the
   account — the deletion registry gains this directory). `POST /api/account/restore/safety-export`
   issues a fresh 60 s ticket for it on demand (404 when none exists), so the link never goes stale. The dialog also offers the normal download before upload.
2. Book files of the backup are written to `<data>/books/<userId>/.restore-<token>/` first.
3. Take `usersMu` (`auth.Users.WithUserLock`, the lock `DeleteUser` holds) **before** opening the
   transaction — never the other way round, or a waiting `DeleteUser` and the restore block each other
   on SQLite's write lock. Then one `BeginTx` transaction whose first statement is a guarded write
   (`UPDATE users SET updated_at = ? WHERE id = ? AND disabled_at IS NULL`; 0 rows → abort: user
   deleted or disabled), every statement on `tx`, inserts through prepared statements in batches;
   delete the user's workspaces with everything scoped to them (`study_events`,
   `plugin_data`, `library_*`, `journal_photos`) — the workspace-deletion statements, plus user-global
   `plugin_data`, `plugin_states`, own `sentences`, `user_edits`, `user_time_zones`; insert the backup
   with the maps (plugin rows: `updated_at` = now so every client's delta pull sees them, `modified_at`
   and `version` kept); revoke **all other** sessions of the user; audit `data_restored` with counts.
4. Still under `usersMu`: commit, then move the staged book files into place and remove the old book
   files and journal photo directory; drop the stage; release the lock.

The write transaction holds SQLite's single write lock for its whole duration; other users' writes wait
(busy timeout 5 s) and may fail and be retried by their clients. Ruling: accept a bounded pause and
measure it — the big test asserts a 1M-event restore finishes in < 60 s on the CI runner, the README
says a large restore briefly pauses writes for everyone — cost if wrong: chunked restore with a
"restoring" lock-out of the user, which is much more code.

Ruling: the restore is one transaction for the database and "write new files before, delete old files
after commit" for the disk — a failed restore changes nothing; the worst case after a crash between
commit and file moves is missing book texts, which the report and log state — cost if wrong: re-run.
Ruling: restore revokes the user's other sessions — other devices must reload instead of pushing stale
user-global rows (LWW) into the restored state — cost if wrong: the learner signs in again on the phone.
Ruling: staging and apply run in the background with a status route, like pack staging — a 1M-event
restore takes longer than proxy timeouts — cost if wrong: polling code in the client.
**The device that restored** (status `done`): the client clears the workspace selection, removes its
queued reviews of the old workspace ids (and says how many, if any), deletes its offline API caches
(PWA spec §3) and reloads the app.

Ruling: restore into a different account than the backup's is allowed and warned about in the report
(moving servers usually changes the user id, sometimes the name) — cost if wrong: none.

Deleting the account (self or admin) discards its stage and safety exports; a restore never recreates
a deleted account (step 3 check under `usersMu`).

## 5. Admin server backup

- `POST /api/admin/backup` `{"include":["db","books","packs","audio"]}` (default all four) →
  `{"url":"/api/admin/backup/<ticket>"}` (ticket as §3); `GET` streams `qinqin-server-<ts>.tar.gz`:
  `BACKUP-INFO.json` (`format`, `formatVersion` 1, `schemaVersion`, `createdAt`, `files` with SHA-256),
  `qinqin.db`, `books/`, `packs/`, `audio/`. Never `journal/` (temporary), `cache/`, `tmp/`,
  `backups/`, and never `QINQIN_SECRET` (it is not in `/data`).
- The database copy is `VACUUM INTO '<data>/tmp/backup-<ts>.db'` on its own connection (a consistent
  snapshot; WAL writers continue), streamed, deleted afterwards (also on error and at start-up).
  Precondition: free space on the data volume ≥ db size + WAL size + 64 MiB (`statfs`), else 507
  `insufficient_storage`. One server backup at a time (409 `backup_running`); 1/minute bucket.
  Files are walked after the snapshot; a book added in between may be an orphan file, a book deleted in
  between may lack its text (documented).
- CLI: `qinqin backup --out <file|->` (same writer) opens the database **read-only without running
  migrations** (`db.OpenReadOnly`, new) so it can run beside the server for `docker exec` + host cron; README shows cron
  and retention with `find -mtime`.
- The archive contains password hashes, hashed session tokens and AI keys/SMTP password sealed with
  `QINQIN_SECRET`: the README says to store it like the secret, and that restoring without the same
  secret loses the sealed values (users re-enter AI keys; admin re-enters SMTP).

Ruling: tar.gz, not zip, for the server backup — restore is `tar xzf` into an empty volume with the
container stopped, the documented path already used — cost if wrong: none.
Ruling: the UI only creates server backups; restoring one is the documented offline procedure (stop,
empty volume, extract, same secret, same or newer image, start) — replacing a live database from inside
the process is the riskiest code in the app for a rare operation — cost if wrong: the admin uses a shell.

## 6. Web UI

- **Settings → Account → Your data** (every user): "Download my data" (ticket → `location.assign`),
  size hint after; "Restore from a backup": file input → upload with progress → report table ("This
  will replace: 3 workspaces, 9 876 reviews, …" / "From the backup: …"), unresolved words listed with
  the drop checkbox, a "Download a backup of my current data first" button, password (+ code), type the
  username, Restore; then the running/done states and the safety-export link. Signed-out others note.
- **Settings → Admin → Backup** (admins): include checkboxes, free-space note, "Create server backup",
  restore steps summary linking the README.
- Logic in `lib/account/backupView.ts`, `lib/admin/serverBackupView.ts` (pure, tested); a11y as the
  accounts UI (labels, `role="alert"`/`"status"`, focus to headings).

## 7. Contract, docs, tests

- `docs/contracts/backup/`: `README.md` (format v1, remap rules), `sample-v1/` (an unpacked tiny
  archive: two workspaces, cards of each derived kind, events incl. an orphan, a vacation checklist),
  `remap.json` (cases: same server, swapped ids, ext_key miss → written match, unresolved, ULID card),
  `reject.json` (hostile inputs and their codes). Go reads all three; Kotlin can later.
- README "Backup" (personal export/restore, server backup, CLI + cron, restore steps, secret);
  `deploy/portainer-stack.yml` comment on backups; deploy README link.
- Tests: round trip (seed every exported table → export → change and add data → restore → the
  user's rows and files equal the seed modulo the id maps; a second user untouched); restore onto a server with re-seeded (shifted) entry ids;
  hostile zips (zip-slip names, duplicate names, bomb > caps with small declared sizes, a 2 MiB line,
  bad SHA, unknown version, truncated archive, encrypted entry) → `invalid`, data unchanged;
  authorization (other user's token, ticket reuse/expiry); rate limits; a 1M-event export and
  restore under a memory bound (`runtime.MemStats.HeapInuse` sampled < 64 MiB; runs only with `QINQIN_BIG_TESTS=1`, once in the plan's last task).

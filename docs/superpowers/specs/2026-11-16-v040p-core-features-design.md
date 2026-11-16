# Flashcards and the reader as core features — design (issue #85, reworked)

Status: Draft (2026-11-16), v0.4.0 prep item 4. Written unattended; every non-obvious call is a
**Ruling** (`what — why — cost if wrong`). Nothing is built. Depends on items 1–3 being merged into
`feature/v0.4.0-prep` (route table, settings pages, page titles). Item 5 (paged user-data sync, packages)
builds on the storage chosen here.

Owner decision (authoritative, replaces #85's original "move flashcards and reader onto the plugin SDK"):
flashcards and the reader leave the plugin system and become core features; each user can still switch
them off for themselves; cards, decks, deck settings, limits, FSRS settings and the reader library,
bookmarks, highlights and reading position get a typed core API with fixed row shapes; a migration keeps
every card id, review event and setting; v1 backups still restore; old outboxes still flush; the journal
and grammar stay plugins on the SDK.

## Intent and why

Today the study state is a bag of JSON values under plugin `qinqin-flashcards` (`deck:*`, `card:*`,
`deckcfg:*`, `limits:*`, `fsrs:*`, ...). Only the TypeScript parsers in `apps/web/src/lib/study/store.ts`
know the shapes; the server stores any value. The Android client (#34–#38, sync engine #35) needs fixed
shapes it can rely on, server-side validation, deltas with tombstones and last-write-wins (LWW) per row,
and a model that is not "whatever the web plugin wrote". The reader already has real tables
(`library_books`, `library_bookmarks`, `library_highlights`) but no row versioning, no tombstones and no
contract fixture. Both features are what qinqin *is*; pretending they are optional plugins costs a
manifest, a hand-kept permission list, `/p/<slug>` URLs and a plugin toggle that the SDK design itself
never used for them (`2026-11-15-plugin-sdk-design.md`, "only the journal migrates").

## Goals

- Typed server storage and wire shapes for six study resources: cards, decks, deck settings, limits,
  FSRS parameter sets, the active FSRS selection; one shared legacy-row codec.
- A migration that moves every readable `qinqin-flashcards` row of those families into the new tables
  with its key identity, `version`, `updated_at`, `modified_at` and tombstone intact; no event touched.
- The typed resources travel in `GET /api/sync/pull` and `POST /api/sync/push` as new collections with
  the plugin-data LWW and tombstone rules; item 5 can page them (`updated_at` index per table).
- Library rows gain `updatedAt` and a deletion log so item 5 can ship library deltas; their JSON shapes
  are pinned by a contract fixture for the first time.
- Old web shells (a cached PWA of v0.3.x) keep reading and writing for the whole v0.4.x line through a
  legacy view of the same data; v1 archives restore; outbox v2 flushes unchanged.
- Flashcards and the reader leave `webPlugins`, `/p/<slug>` and Settings → Plugins; they get core routes,
  a Settings → Features switch and core credits. Journal and grammar are unchanged plugins.
- Close the overview's "no fixture" gaps for `deck:*`, `card:*`, `deckcfg:*`, `fsrs:set:*`, `fsrs:active`
  and the reader library.

## Non-goals

- Paging, cursors and per-language limits of the pull (item 5). Item 4 only makes the rows pageable.
- Moving `goals:workspace`, `known:*`, `vacation:*`, `note:*`, `notecfg`, `lookups`, `lookupcfg` or UI rows
  out of plugin data (each already has a contract and fixture; see Q3).
- Event payload contracts for `read`, `session`, `view`, `lookup`, `journal` (item 6).
- Server-side scheduling, due counts or deck statistics: the schedule is still derived on the client by
  replaying `review` events (`scheduler/`).
- New single-resource REST routes for study rows (`PUT /api/study/cards/{id}` ...): push/pull is the API.
- Removing the legacy view (not before v0.5.0; see Q9).

## Anti-goals

- Losing a card id, a review, a setting or an offline-queued write that the v0.3.0 server accepts.
- A second source of truth (no dual writes into `plugin_data` and the new tables).
- Field caps that a stored row could already violate (it would be dropped or become unwritable).

## Questions I asked myself

**Q1. Real tables, or keyed rows under `qinqin-core`?** Real tables, one per legacy key family, one row
per legacy key.

- Ruling: six tables `study_cards`, `study_decks`, `study_deck_settings`, `study_limits`,
  `study_fsrs_sets`, `study_fsrs_active`, each mapping 1:1 to one legacy key family — why: typed columns
  with CHECK constraints give the server real validation and Android a shape that cannot drift, and a
  1:1 mapping keeps identity, LWW, versions and tombstones exactly as clients know them, so the legacy view
  (Q9), the v1 backup (Q8) and the migration all use one codec — cost if wrong: a later schema change
  needs a table rebuild instead of a parser change; keyed rows would have been a cheaper migration.
- Rejected: keyed rows renamed to `qinqin-core` (renaming the pack id breaks every old shell's pull
  filter `pluginId === "qinqin-flashcards"` and still leaves the server blind to the shapes); keyed rows
  kept under `qinqin-flashcards` with a server validator (honest about cost, but "core" storage would stay
  a plugin namespace on the wire forever, and server queries — journal suggestions, entry deletion, future
  due notifications — keep parsing JSON).
- Every table has the same sync columns as `plugin_data`: `version` (bumped per write), `updated_at`
  (server write stamp; the pull cursor), `modified_at` (edit time; LWW), `deleted_at` (tombstone), plus
  `extra` (a JSON object: every member the typed shape does not carry, verbatim). See the data-migration
  section for exact columns.
- Ruling: every typed shape carries `extra` — why: deck settings already promise "unknown kept verbatim",
  a newer Android build may add a member, and a lossless codec needs a place for members the typed shape
  cannot hold — cost if wrong: one opaque object clients must echo back.
- Ruling: a known member whose stored value the typed shape cannot carry (an invalid `source`, an
  `entryKind` other than `"character"`, `skipKinds` on a non-vocab card, an unparseable `newOrder`) moves
  into `extra` under its own name; a set typed member always wins over an `extra` member of the same name,
  and the server drops such shadowed `extra` members on write — why: the TS parsers ignore those values
  today, so typed reads are unchanged, and the legacy view still returns the row as stored (the
  `frequency/deckcfg-new-order.json` rule for `newOrder` becomes the general rule) — cost if wrong: junk
  survives in `extra`; harmless because nothing reads it.

**Q2. What does the server validate?** Structure, not semantics.

- Ruling: the Go codec accepts every row the v0.3.0 TS parser accepts (structural parity: required
  members, types, key/payload agreement) and enforces nothing the TS parser did not — FSRS weight ranges
  stay a client rule ("unusable set" = default weights), limit ranges are the existing `0..9999 | null`,
  no new length caps — why: a stricter server would leave readable rows behind in the migration or make
  them unwritable after it (anti-goal) — cost if wrong: a client can store an out-of-range weight set, as
  today; clients ignore it, as today.
- Ruling: `entryId` and `sentenceId` must be JSON integers (positive, at most 2^53−1); a `card:` row with
  a fractional `entryId` (accepted by `typeof === "number"` today) stays behind as unreadable — why:
  entry ids are integers everywhere else and the remap code already requires it — cost if wrong: such a
  row, which no import or UI ever wrote, is not migrated (counted in the migration log, still in
  `plugin_data`).
- Typed push items are validated strictly: a malformed item is 400 for the whole push (like a malformed
  `pluginData` item today). Legacy-view writes (Q9) are lenient: an unreadable row is refused alone.

**Q3. Which v0.3.0-stretch rows become typed now?** Exactly the six families the item names.

| Key (plugin) | Decision | Why |
| --- | --- | --- |
| `card:*`, `deck:*`, `deckcfg:*` (incl. `newOrder`), `limits:workspace`, `limits:deck:*`, `fsrs:set:*`, `fsrs:active` (`qinqin-flashcards`) | typed tables | named by the item; the gaps table lists them unpinned |
| `goals:workspace`, `known:<entryId>`, `vacation:*` (user-global) (`qinqin-flashcards`) | stay keyed rows under `qinqin-flashcards` | each has a contract and fixture (`goals/goal-rows.json`, `reader/word-states.json`, `scheduler/vacation-*.json`) and a restore remap; moving them buys Android nothing |
| `note:*`, `notecfg`, `lookups`, `lookupcfg`, UI rows (`qinqin-core`) | unchanged | pinned by `notes/`, `lookups/` |
| Reader library, bookmarks, highlights, position | already tables; gain `updatedAt` + deletion log + fixture | named by the item |

- Ruling: `qinqin-flashcards` stays the plugin-data namespace of the remaining keyed study rows (now
  documented as "the study namespace", not a plugin) — why: renaming it breaks every old shell and every
  restore remap rule that names it, for no gain — cost if wrong: a plugin-looking id on the wire; renaming
  later is one more legacy alias.

**Q4. How do typed rows travel?** As new collections of the existing pull and push.

- Pull collections gain `cards`, `decks`, `deckSettings`, `limits`, `fsrsSets`, `fsrsActive`
  (`sync.Collections`); each row is the typed shape of the data-migration section plus `workspaceId`,
  `version`, `updatedAt`, `deletedAt`. The tombstone and cursor rules are the plugin-data ones (zero
  cursor: live rows only; `1970-01-01T00:00:00Z` is a real cursor and ships tombstones).
- Push body gains the same six arrays. Each item carries `updatedAt` (its edit time) and optionally
  `deletedAt`; LWW is the plugin-data rule (edit time clamped to the server clock, compared at second
  precision with the stored `modified_at`, a same-second client write wins, deleting an absent or deleted
  row is skipped). The counters `dataAccepted`, `dataSkipped` count typed items too.
- Ruling: an item whose typed members and `extra` equal the stored live row is skipped (counted
  `dataSkipped`), not rewritten — why: a retried push then changes nothing, so Android's retry is
  idempotent in `version` as well as content, and item 5's pager does not see phantom changes — cost if
  wrong: an equal rewrite does not refresh `modified_at`; nothing reads that for equal content.
- Ruling: no new REST routes for study rows; the web writes single rows as one-item pushes — why: one
  write path with LWW, already token-gated (`tokWriteAny`) and body-capped (8 MiB, 256 KiB per item,
  413); fewer routes for the route walk, the PWA fixture and tokens — cost if wrong: scripts write
  through a slightly larger body; per-resource routes can be added later without changing storage.
- Ruling: per typed item the encoded size cap is the plugin-data value cap (256 KiB, 413 for the whole
  push) — why: same budget as the legacy row it replaces — cost if wrong: none known.
- Workspace rules: every typed row is a workspace row; `workspaceId` must be owned (else 404 for the whole
  push, nothing applied, as today); there is no user-global typed row.

**Q5. What do the reader tables need?** Row stamps, deletions and a fixture; their routes stay.

- `library_books`, `library_bookmarks` gain `updated_at` (backfilled from `created_at`); a position PUT,
  a rename, a bookmark relabel and a highlight edit stamp it. `library_highlights` already has it.
- Ruling: deletions of books, bookmarks and highlights (one by one, with their book, with their workspace)
  are recorded in a new `library_deletions(user_id, collection, row_id, workspace_id, deleted_at)` table in
  the same transaction; the live tables keep hard deletes — why: the live tables keep their unique
  indexes and every query stays as it is, while item 5 still gets tombstones to page — cost if wrong: one
  more table to clear on account deletion and restore (registry entries below).
- Ruling: `library_bookmarks` and `library_highlights` are rebuilt with `INTEGER PRIMARY KEY
  AUTOINCREMENT` (as migration 023 did for books) — why: a deleted id that comes back would make a delta
  client apply "deleted 5" and "created 5" in the wrong order — cost if wrong: a table copy at upgrade.
- Book JSON gains `updatedAt`; bookmark JSON gains `updatedAt`; nothing else changes on the library routes.
  No library collection joins the pull in this item (item 5 adds it, reading these columns).

**Q6. Per-user off switch: `plugin_states` or a new core setting?** `plugin_states`, unchanged.

- Ruling: the switch stays the caller's `plugin_states` row of `qinqin-flashcards` / `qinqin-reader`,
  read through `GET /api/plugins` and the pull's `pluginStates`, written through
  `PUT /api/plugins/{id}/state` (`order` is ignored for these two ids; clients send 0) — why: no
  migration, the v1 archive's `account.json` `pluginStates` keeps meaning the same, old shells keep their
  toggle and their widgets, Android reads one collection — cost if wrong: a table named "plugin" holds a
  core setting; a typed `/api/me/features` can wrap it later.
- Ruling: both ids stay registered as **reserved core rows**: `flashcards.json` becomes the study
  namespace (`"surfaces": [], "permissions": ["owns-data"], "events": []`, version 2.0) and `reader.json`
  the reader switch (`"surfaces": [], "permissions": [], "events": []`, version 2.0); `review` and `read`
  with their activity rules move into `core.json` (version 1.2) — why: an unregistered `qinqin-flashcards`
  would make every old-shell push of a `known:` row a 404 that fails the whole push (`sync.Push` checks
  plugin existence), and an absent `qinqin-reader` row hides the old shell's reader widget
  (`state?.enabled ? widgets : []`) — cost if wrong: two registry rows that clients must know are not
  plugins (overview lists the reserved ids `qinqin-core`, `qinqin-flashcards`, `qinqin-reader`).
- Ruling: switching a feature off is a presentation preference: its nav link, its widgets and its page
  (which shows "Flashcards is switched off" with a link to Settings → Features) disappear exactly where the
  plugin switch hid them in v0.3.0; the server never refuses, deletes or hides data; review and read events
  keep being accepted and counted on the heatmap and in goals — why: a second device mid-session or an
  offline outbox must never fail because a toggle changed, and the switch was never a security boundary —
  cost if wrong: a user who switched flashcards off still sees reviews from another device in Stats.
- Ruling: in the nav the two core features come first in a fixed order (Decks, Reader), then plugins in
  the user's plugin order — why: they are the app, not add-ons — cost if wrong: a user who had put
  Journal first sees it second.

**Q7. URLs, code layout, credits.**

- Ruling: the pages move from `/p/flashcards/...` and `/p/reader/...` to `/flashcards/...` and
  `/reader/...` (same sub-paths); `legacyRedirect` maps the old prefixes, keeping query and fragment —
  why: `/p/` means "plugin" and is the only thing left that says so; the sub-route grammar is untouched —
  cost if wrong: one redirect forever; old bookmarks and shared links keep working.
- Ruling: `apps/web/src/lib/plugins/{flashcards,reader}` move to `apps/web/src/lib/features/{flashcards,reader}`
  in one mechanical commit with no content change besides import paths — why: Android readers (item 6)
  read TS sources as references and the path should say what the code is — cost if wrong: merge noise for
  later branches; done last in phase B so the logic commits stay reviewable.
- The reader's credits (Aozora Bunko, Project Gutenberg, opencc-js with both licence texts) move verbatim
  from `readerManifest.sources` to `lib/sources/coreCredits.ts`; the Sources page lists them under "Core".
  Licensing first: no text is shortened, no licence file is dropped.
- `lib/goals/builtinSources.ts` reads `core.json` and `journal.json`; the activity route reports `plugin:
  "qinqin-core"` for `review` and `read`. Goal metrics (`activity:review`, `activity:read`,
  `flashcards:new`, `flashcards:studyTime`) are ids, not plugin references, and stay as they are.
- `logChangingTypes()` (cache invalidation of the event log) is redefined as "every built-in or
  registered event type that has an activity rule" — today `review`, `read`, `journal`, the same set it
  was; without this, moving `review` into `core.json` would drop it from the set.

**Q8. Backup: does the archive version bump?** No, it stays `formatVersion` 1.

- Ruling: export writes each typed row as its legacy `qinqin-flashcards` plugin row (`ToLegacy`: key,
  data, `version`, `updatedAt`, `modifiedAt`) into the `plugin-data` family; restore runs the existing
  validation and remap on the legacy rows and then inserts the typed families through `FromLegacy` into the
  typed tables — why: the archive is an interchange format and the legacy row form is now a fixture-pinned
  encoding of each typed resource; `remap.json`, `reject.json`, `sample-v1/` and every restore rule stay
  valid; a v0.4 archive still restores on a v0.3 server (a real downgrade path after a failed upgrade) —
  cost if wrong: a future v2 that mirrors the tables; the codec makes that mechanical.
- A typed-family row in an archive that `FromLegacy` refuses is dropped and counted in `droppedRows`
  (v0.3.0 restored it verbatim as an inert row no client could read).
- Export never writes a leftover unreadable typed-family `plugin_data` row (Q10): it would duplicate a key
  of a typed row and make the archive invalid (`checkPluginRow` refuses duplicate keys).
- `library_deletions` and typed tombstones are never exported (tombstoned plugin rows are not either); a
  restore clears them with the user's rows — every client does a full pull after a restore (`backup/`).
- `auth.UserTables()` gains one entry per new table (export `ExportRows` through the codec, restore
  `RestoreReplace`; `library_deletions`: `ExportSkip` "sync bookkeeping", deleted with the user, not
  restored); the account-deletion preview gains `cards` (live cards).

**Q9. How does a cached old shell behave?** It keeps working, read and write, for the v0.4.x line.

A v0.3.x shell keeps running until its user presses Reload on the update banner (the new worker waits;
`lib/pwa/sw/lifecycle.ts`), possibly for days. It reads study state from `GET /api/sync/pull?cursor=1970-
01-01T00:00:00Z&collections=pluginData,pluginStates` and writes with `PUT`/`DELETE
/api/plugins/qinqin-flashcards/data/{key}?workspace=` and `POST /api/sync/push {pluginData}`.

- Ruling: a **legacy view** serves those requests from the typed tables: (1) a pull that names
  `pluginData` and none of the six typed collections gets every typed row (since the cursor, same
  tombstone rule) appended to `pluginData` as its legacy row; a pull without `collections` means all
  collections, which include the typed ones, so it gets no legacy rows; (2) a pushed or `PUT`
  `qinqin-flashcards` row of a typed family is decoded and applied to the typed table with the same LWW
  (a row the codec refuses is `dataRefused` in a push, 400 `study_row_invalid` on `PUT`); `DELETE`
  tombstones the typed row, falling back to `plugin_data` when no typed row exists; (3) `GET` of one key or
  a prefix list answers the legacy row of a typed row first, else the `plugin_data` row — why: the old
  shell sees byte-equivalent data, studies, adds and deletes cards, and the new shell sees its writes
  immediately, with one storage and no client cooperation — cost if wrong: about 300 lines of facade kept
  until v0.5.0 at the earliest; a client that understands typed collections must always name one when it
  pulls `pluginData` (documented in the overview).
- Ruling: the legacy view is deprecated from v0.4.0 and may only be removed in a release whose notes say
  so and which ships a "this app version is too old" answer that old shells can show — why: removing it
  silently would make an open old tab show empty decks — cost if wrong: the facade lives longer.
- Item 5 must keep the legacy request form (`collections=pluginData,pluginStates`, RFC 3339 cursor, one
  unpaged answer) working while the legacy view exists.

**Q10. What does the migration do with rows it cannot read?** Leaves them where they are.

- Ruling: a live or tombstoned `qinqin-flashcards` row of a typed family whose data `FromLegacy` refuses,
  whose workspace is NULL or whose workspace is not owned by the row's user stays in `plugin_data`
  untouched and is counted in one log line; no client could read it before, so nothing visible changes —
  why: never delete data in a migration — cost if wrong: inert rows in the database (the legacy view
  shows them to old shells exactly as v0.3.0 did; the new web ignores typed-family keys in `pluginData`).

**Q11. Tokens (#83).** No route changes, so no token rule changes.

- `GET /api/sync/pull` (`tokReadAny`), `POST /api/sync/push` (`tokWriteAny`) carry the typed
  collections; `GET|PUT|DELETE /api/plugins/{id}/data[/{key}]` (`tokReadWS`/`tokWriteWS`) keep serving
  `qinqin-flashcards` rows through the legacy view; library routes keep their rules. The pinned token
  route set (`auth/tokens-routes.json`) does not change.
- Ruling: scripts keep working except one documented break: a token script that reads cards from the
  `pluginData` of a pull **without** `collections` gets them only in the new `cards` collection — why: the
  legacy view must key on something old shells always send — cost if wrong: such a script needs
  `collections=pluginData` or the typed collection (wiki API-Access-tokens notes it).

**Q12. Rate limits, body caps, isolation, route walk, PWA.**

- No route is added or removed, so the route walk, `routes.fixture.json`, `API-Routes.md` and the token
  fixture are unchanged (tests confirm). Push keeps its 8 MiB body cap; typed items 256 KiB each. Sync has
  no per-route limiter today; token requests keep the `pat` bucket.
- Isolation: every typed table carries `user_id`; every query filters by it; push checks workspace
  ownership per item; two-user tests per collection (pull never shows another user's rows; push to a
  foreign workspace is 404 with nothing applied; legacy view likewise).
- Workspace deletion deletes the workspace's typed rows (and records library deletions); account
  deletion deletes every typed row and deletion-log row of the user (registry + schema guard test).
- PWA: the cache allowlist accepts `/api/sync/pull` whose `collections` is a non-empty subset of
  `pluginData,pluginStates,cards,decks,deckSettings,limits,fsrsSets,fsrsActive`; offline study reads the
  saved pull; `prepareOffline` warms the new pull path. The partition generation stays `qinqin-api-v1-`
  (the new path differs, so an old saved pull is never served for it).

**Q13. Search, stats, heatmap, the study-event hook.**

- Search does not refer to plugin ids. Stats/heatmap read event types; only the `plugin` field of
  activity sources changes (see Q7). Widget ids and the home layout row are unchanged; widget `owner`
  becomes the feature id (`qinqin-flashcards`, `qinqin-reader`), gated by the feature switch.
- Server code that read `qinqin-flashcards` card rows reads `study_cards`: `journal/suggest_input.go`,
  `cmd/qinqin/seed.go` (`warnEntryIDUsers`), `backup` export refs.
- Ruling: no built-in subscribes to the `study-event` hook; #85's "first real hook consumer" is closed as
  superseded — why: its only candidates (flashcards, reader) are now core and use the event layer
  directly; journal and grammar have no need — cost if wrong: the hook stays unused (about 40 lines).

## Data migration (exact shapes)

Migration `NNN_core_study.sql` (next free number at build time; `038` today) plus a Go step of the same
name in `server/internal/db/gosteps.go`. Common sync columns of every `study_*` table: `version INTEGER
NOT NULL, updated_at TEXT NOT NULL, modified_at TEXT NOT NULL, deleted_at TEXT, extra TEXT NOT NULL
DEFAULT '{}' CHECK (json_valid(extra) AND json_type(extra) = 'object')`, `user_id INTEGER NOT NULL
REFERENCES users(id)`, `workspace_id INTEGER NOT NULL REFERENCES workspaces(id)`, and
`INDEX (user_id, updated_at)`. Times are RFC 3339 UTC seconds, as in `plugin_data`.

| Legacy (`plugin_data`, pack `qinqin-flashcards`) | Table, primary key | Typed columns |
| --- | --- | --- |
| `card:<id>` `{id, kind, entryId, written?, entryKind?, sentenceId?, skipKinds?, deckIds, createdAt}` | `study_cards (user_id, workspace_id, id)`, index `(user_id, workspace_id, entry_id)` | `kind TEXT CHECK IN (vocab,sentence,writing,tone,reverse,cloze)`, `entry_id INTEGER NOT NULL`, `written TEXT NULL`, `entry_kind TEXT NULL CHECK (= 'character')`, `sentence_id INTEGER NULL`, `skip_kinds TEXT NOT NULL '[]'`, `deck_ids TEXT NOT NULL '[]'`, `created_at TEXT NOT NULL` |
| `deck:<id>` `{id, name, createdAt, source?}` | `study_decks (user_id, workspace_id, id)` | `name TEXT NOT NULL`, `created_at TEXT NOT NULL`, `source TEXT NULL` (JSON, one of three variants) |
| `deckcfg:<deckId>` `{deckId, cardTypes, newOrder?, updatedAt, ...}` | `study_deck_settings (user_id, workspace_id, deck_id)` | `card_types TEXT NOT NULL '[]'`, `new_order TEXT NULL` (JSON) |
| `limits:workspace` / `limits:deck:<deckId>` `{version:1, new?, reviews?}` | `study_limits (user_id, workspace_id, deck_id)`; `deck_id = ''` is the workspace row | `new_set INTEGER 0/1`, `new_limit INTEGER NULL CHECK 0..9999`, `reviews_set`, `reviews_limit` (same) |
| `fsrs:set:<id>` `{id, w[21], createdAt, source, labelled?, logLoss?, baselineLogLoss?}` | `study_fsrs_sets (user_id, workspace_id, id)` | `w TEXT NOT NULL` (JSON array of 21 finite numbers), `created_at TEXT`, `source TEXT CHECK IN (optimized, imported)`, `labelled REAL NULL`, `log_loss REAL NULL`, `baseline_log_loss REAL NULL` |
| `fsrs:active` `{setId, changedAt}` | `study_fsrs_active (user_id, workspace_id)` | `set_id TEXT NULL`, `changed_at TEXT NULL` |

Typed wire shapes (pull and push; every key always present; `extra` always an object):

```jsonc
// cards
{"workspaceId":7,"id":"c-vocab-1201","kind":"vocab","entryId":1201,"written":null,"entryKind":null,
 "sentenceId":null,"skipKinds":[],"deckIds":["general"],"createdAt":"2026-11-10T08:00:00Z","extra":{},
 "version":1,"updatedAt":"2026-11-10T08:00:00Z","deletedAt":null}
// decks           {"workspaceId","id","name","createdAt","source": null | {"type":"level","packId","level"}
//                   | {"type":"plugin","pluginId","key"} | {"type":"frequency","packId","size"}, "extra", meta}
// deckSettings    {"workspaceId","deckId","cardTypes":["reverse"|"cloze"],"newOrder": null | {"by":"added"}
//                   | {"by":"frequency"} | {"by":"level","packId"}, "extra", meta}
// limits          {"workspaceId","deckId": null | "general" | "<deckId>",
//                   "new": null | {"limit": 0..9999 | null}, "reviews": same, "extra", meta}
//                   null = not set (inherits deck -> workspace -> default 20/200); {"limit": null} = unlimited
// fsrsSets        {"workspaceId","id","w":[21 numbers],"createdAt","source":"optimized"|"imported",
//                   "labelled": number|null, "logLoss": number|null, "baselineLogLoss": number|null, "extra", meta}
// fsrsActive      {"workspaceId","setId": string|null,"changedAt": string|null,"extra", meta}
// meta = "version","updatedAt","deletedAt"; on push "updatedAt" is the edit time and "version" is ignored
```

Codec rules (`server/internal/study/legacy`, pinned by `docs/contracts/study/legacy-codec.json`):
`FromLegacy(key, data)` requires the key/payload agreement of the TS parser (`card:<id>` with
`data.id == id`, `deckcfg:<deckId>` with `data.deckId`, `fsrs:set:<id>` with `data.id`); limits need
`version: 1` (another version stays behind); `deckIds`/`cardTypes`/`skipKinds` are cleaned exactly as the
TS parser cleans them (strings only, deduplicated, known kinds in kind order); deckcfg's inner `updatedAt`
is dropped (the row's `modified_at` replaces it) and `ToLegacy` writes `updatedAt = modified_at` back;
members not carried go to `extra` (Q1). `ToLegacy(FromLegacy(row))` equals the row as JSON values,
except for the cleaning, which equals what the v0.3.0 web wrote back on its next save.

Go step, inside the migration transaction: for every `plugin_data` row with `pack_id =
'qinqin-flashcards'` and a key of the six families, ordered by rowid: skip (leave) when `workspace_id IS
NULL`, when the workspace is not the row user's, or when `FromLegacy` refuses; else insert the typed row
with the same user, workspace, identity, `version`, `updated_at`, `COALESCE(modified_at, updated_at)`,
`deleted_at` (a tombstone migrates as a tombstone with its last data) and delete the `plugin_data` row.
Log once: `migration NNN: moved <n> study rows (<per family>), left <m> unreadable rows in plugin_data`.
`study_events` is not touched. Library part: `ALTER TABLE library_books ADD COLUMN updated_at TEXT`
backfilled from `created_at`; `library_bookmarks` rebuilt with AUTOINCREMENT and `updated_at` (copy
verbatim, `updated_at = created_at`); `library_highlights` rebuilt with AUTOINCREMENT (columns unchanged);
the 020/021 indexes recreated; `CREATE TABLE library_deletions (user_id, collection TEXT CHECK IN
('books','bookmarks','highlights'), row_id INTEGER, workspace_id INTEGER, deleted_at TEXT, PRIMARY KEY
(collection, row_id))` with `INDEX (user_id, deleted_at)`.

Before → after, one card (user 1, workspace 7):

```
before plugin_data: (qinqin-flashcards, 1, 7, "card:c-vocab-1201",
  '{"id":"c-vocab-1201","kind":"vocab","entryId":1201,"deckIds":["general"],"createdAt":"2026-11-10T08:00:00Z"}',
  version 3, updated_at 2026-11-12T10:00:00Z, modified_at 2026-11-12T09:59:58Z, deleted_at NULL)
after  study_cards: (1, 7, "c-vocab-1201", vocab, 1201, NULL, NULL, NULL, '[]', '["general"]',
  "2026-11-10T08:00:00Z", extra '{}', version 3, 2026-11-12T10:00:00Z, 2026-11-12T09:59:58Z, NULL)
legacy view of it: exactly the before row (pluginId, key, userId, workspaceId, data, version 3, updatedAt, deletedAt)
```

## Compatibility matrix

| Client / artefact | After upgrade | Proven by |
| --- | --- | --- |
| Old SPA (cached v0.3.x shell) on the new server | Reads decks, cards, settings via the legacy view; adds, moves, deletes cards and decks, edits limits, deck settings and FSRS sets; reviews as events; toggles both switches; offline uses its saved pull. Shows the update banner within an hour. | Go old-shell scenario test replaying v0.3.0 `store.ts` request shapes; real-app check step 4 |
| Outbox v2 (review events in `localStorage`) | Flushes unchanged through `POST /api/events/batch`; card ids and events are unchanged, so replay is identical | `pwa/outbox-v2.json` web test unchanged; Go test posts a v0.3.0 outbox item into a migrated DB |
| Old shell's pending plugin-data writes (`pushStudyRows`, `PUT`) | Applied to typed tables with the same LWW; unreadable rows refused alone (`dataRefused`) | Go legacy push tests |
| Backup v1 archive from v0.3.0 | Restores; typed families land in typed tables, remapped as before; unreadable typed rows dropped and counted | `sample-v1` (extended) restore test, `remap.json` unchanged, real-app check step 5 |
| Backup written by v0.4 | `formatVersion` 1; restores on v0.4 and on v0.3 | Go round-trip test; real-app check step 6 |
| Token scripts (#83) | Plugin-data routes and pull with `collections=pluginData` unchanged; full pull without `collections` moves cards to `cards` (documented break) | Go token tests on the legacy routes |
| Android (#35) | Uses only typed collections and `pluginData` for keyed rows; never the legacy view; LWW by `updatedAt`, tombstones by `deletedAt`, idempotent retries | `study/rows.json`, `study/lww.json` (Go + web), overview |
| Journal, grammar plugins | Unchanged; journal suggestions read `study_cards` | journal tests |

## Testing and verification

- Go: codec fixture test (both directions); migration test on a hand-built v0.3.0-shaped database (every
  family, tombstones, unreadable rows, NULL and foreign workspaces, events untouched, every card id kept);
  store LWW table test; pull/push per collection, isolation (two users), 400/404/413; legacy view tests
  (pull rule, push, `PUT`/`DELETE`/`GET` fallbacks, token rules); registry and activity sources; workspace
  and account deletion; library stamps and deletion log on every delete path; backup round trip and
  `sample-v1` restore into typed tables.
- Web: `study/rows.json` and `study/lww.json` decoded; store read and write paths (existing `store.test.ts`
  cases kept, asserting the typed wire); PWA classify subset; features registry, nav order, widgets gate;
  routes and redirects; Settings → Features; Sources credits; `logChangingTypes`.
- Real app: a v0.3.0 binary creates real data, the new binary migrates it, then an old-shell request replay,
  a v1 restore and an outbox flush (plan, last task).

## Left to the builder

Go package and file names inside `internal/study`; whether the legacy view lives in `sync` and `api` or
behind one `study.Legacy` type; the wording of the switched-off notice and of the Features section.

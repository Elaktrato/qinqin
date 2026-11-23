# Sync: paged pull, push and the legacy pull

A client gets its **first copy of shared data by package download** (`docs/contracts/packages/`) and its
**user data by the paged pull** (`GET /api/sync/pull?v=2`); it sends offline work with `POST /api/sync/push`.
The pull carries the caller's own data only — never lexicon rows — paged with a row and byte budget and
limited to the languages of the caller's workspaces. Design:
`docs/superpowers/specs/2026-11-16-v040p-packages-design.md` (Q6–Q8, Q13; issue #93).

Owner code: `server/internal/sync` (`page.go`, `token.go`, `page_collections.go`, `legacy.go`, `sync.go`),
`server/internal/api/handlers_sync.go`. Web: `apps/web/src/lib/sync/pager.ts`, `apps/web/src/lib/study/store.ts`.

Fixtures:

- `pull-page.json` — valid and invalid v2 pages; the row shape of every collection.
- `pull-rounds.json` — scenarios (setup, requests, writes between pages, expected rows per page) run by the
  Go tests.
- `push-result.json` — push requests and their status and body, as built.
- `legacy-pull.json` — the legacy form (no `v=2`) and what it answers.
- `unreadable-rows.json` — a page with an unreadable row of every typed family (malformed, or written by a newer
  client) and an unreadable `pluginData` row: what a reader loads, counts and must never rewrite ("Reading rows").

Error codes are in `docs/contracts/auth/errors.json`: `sync_collection_moved` (400), `sync_page_invalid` (400),
`sync_cursor_expired` (410), `not_found` (404). v2 errors are JSON `{error, message}`.

## Pull v2

```
GET /api/sync/pull?v=2[&since=<cursor>][&limit=1..2000][&collections=a,b][&workspace=<id>][&tombstones=1]
GET /api/sync/pull?v=2&page=<next>          continuation: nothing else may be repeated
```

Signed-in users and personal access tokens as before (`tokReadAny`). Answers `Cache-Control: private, no-cache` (`cacheControl` in `pull-page.json`): no shared cache keeps a page and a
browser revalidates it, but it may be stored — the web service worker saves pages for offline study and never saves
an answer that says `no-store` (before this fix the pages said `no-store`, so offline study had no saved pages).

### Collections and the round

Round order (fixed): `workspaces`, `pluginStates`, `pluginData`, `cards`, `decks`, `deckSettings`, `limits`,
`fsrsSets`, `fsrsActive`, `books`, `bookmarks`, `highlights`, `overlays`, `sentences`, `events`. Without
`collections` a round carries all of them. An unknown name is 400 `sync_page_invalid`; a lexicon name
(`entries`, `links`, `senses`, `levelMembers`, `dictionaries`, `schemes`, `levels`) is 400
`sync_collection_moved`.

- A round fixes `until` = the server clock at its first page. Every page holds rows with
  `since <= updatedAt < until`, collection by collection in round order, each ordered by
  `(updatedAt, server row order)`; a page that finishes a collection goes on with the next one.
- A page stops at `limit` rows (default 500) or before the row that would take its encoded rows past
  4 MiB, but always holds at least one row while rows remain; a single row above 4 MiB ships alone.
- `more` is false exactly when no row of the round remains (the server looks ahead), so only a round
  without rows ends on an empty page. Then `next` is null and `cursor` is set: `until − 30 s`, so a row
  stamped before a slow commit comes next round (rows of the last 30 s may arrive twice: upsert by key).
- A row rewritten during a round gets a stamp `>= until`: it is not shipped twice in one round and comes in
  the next one. A client that reads only from-scratch rounds and drops the cursor (the web study read) can
  therefore miss a row edited while its multi-page round runs, if the row's old stamp sorted onto a page not
  yet read: that load lacks the row, and the next load (a new round) has it. Accepted: the window is one
  round and nothing is lost on the server; until the next load a local write to that row is stamped by the
  local clock alone (no server time known for it), as for a row the client never saw.
- From no `since` a round ships live rows only. With a `since` it ships tombstones too (`deletedAt` set).
  `tombstones=1` (the only value) makes a round from no `since` ship tombstones as well, library
  `library_deletions` rows included; with a `since` it changes nothing. A client that stamps its writes after
  the times the server holds (the web study pull: a re-add from a slower clock must not lose to a newer
  tombstone) asks for it. It is a filter like the others: the page token and the cursor bind it, so the
  next round sends it again.
- Within a library collection (`books`, `bookmarks`, `highlights`) the tombstones follow the live rows
  instead of interleaving by stamp: the live rows by `updatedAt`, then the `library_deletions` rows by
  `deletedAt`. Library ids are never reused, so no live row and tombstone of one round share an id; upsert
  and delete by id and the order does not matter.
- `page` and `since` tokens are opaque (`p2.…`, `c2.…`; only the prefixes are a contract). A page token binds
  the user and every filter; a cursor binds the collections, workspace and tombstones filters, so a client keeps one
  cursor per filter set. Another user's token, a token of other filters, a garbled token, a `page=` request
  that repeats `since`/`collections`/`workspace`/`limit`/`tombstones`, a `tombstones` value other than `1`, or
  a `limit` outside 1..2000 is 400
  `sync_page_invalid`.
- 410 `sync_cursor_expired` (defined, not yet sent): discard local user data and pull without `since`.

### Scope and the language filter

- `workspace=<id>` narrows workspace rows (`workspaces`, `pluginData`, typed rows, library rows, `events`) to
  that workspace plus user-global rows (`pluginData` with `workspaceId: null`, `pluginStates`) and
  entry-bound rows (`overlays`, `sentences`) to its language. Another user's or an unknown workspace is
  404 `not_found`.
- `overlays` and own `sentences` ship only for entries whose language is in the round's language set: the
  languages of the caller's workspaces (or the one workspace's language with `workspace=`) at round start.
- When the language set differs from the one inside `since`, `overlays` and `sentences` ship from no
  `since` (live rows, every language now in scope) and `restarted` lists them.
- `scope` is set on the first page of a round only (null after): `workspaces` (every workspace of the caller,
  sorted by id, whatever `workspace=` says; a client deletes the local data of a workspace not listed —
  workspace deletion leaves no tombstone), `languages` (the round's language set, sorted) and `catalogue`
  (the ETag of the caller's default `GET /api/packages`, byte-equal to that response's `ETag` for the same
  credential — an administrator's session sees build errors there, an administrator's token does not; a
  changed value means "re-read the catalogue").

### Page

```jsonc
{"format": 2, "instanceId": "<ULID>", "until": "2026-11-12T10:00:00Z",
 "scope": {"workspaces": [{"id": 7, "language": "zh"}], "languages": ["zh"], "catalogue": "\"k-3fa9\""},
 "restarted": [],                        // on every page of the round; subset of [overlays, sentences]
 "collections": {"workspaces": [], "pluginData": [ /* rows */ ], "…": []},   // every requested key, arrays
 "more": true, "next": "p2.…", "cursor": null}
```

Row shapes (every key always present; `pull-page.json` `shapes`):

| Collection | Row |
| --- | --- |
| `workspaces` | `{id, language, name, settings, updatedAt}` (no tombstones) |
| `pluginStates` | `{pluginId, userId, enabled, order, updatedAt}` (no tombstones) |
| `pluginData` | `{pluginId, key, userId, workspaceId, data, version, updatedAt, deletedAt}` |
| `cards` … `fsrsActive` | the typed rows of `docs/contracts/study/rows.json` (strict decode) |
| `books`, `bookmarks`, `highlights` | the rows of `docs/contracts/library/rows.json` plus `deletedAt: null`; a tombstone is exactly `{id, workspaceId, updatedAt, deletedAt}` (from `library_deletions`, `updatedAt` = `deletedAt`) |
| `overlays` | `{entryId, written, readings, updatedAt}` (`null` = untouched; no tombstones) |
| `sentences` | own sentences only: `{id, entryId, sourcePack: "", userId, hanzi, pinyin, translation, updatedAt, deletedAt}` |
| `events` | `{id, workspaceId, device, ts, type, payload, updatedAt}`, every type but `lookup` (no tombstones) |

### Reading rows (`unreadable-rows.json`, #167)

The server sends only rows that decode (`pull-page.json`: a case with `"level": "row"` is invalid server output).
A reader still meets rows it cannot read: a newer server or client wrote them (a typed member outside `extra`, a
card kind, deck source or new-card order this version does not know), or a row is damaged. The rule, for every
client (web and Android):

1. **The pager checks the envelope only:** the top-level members, `format`, `instanceId`, `until`, `scope`,
   `restarted`, `collections` (exactly the requested keys, each an array) and `more`/`next`/`cursor`. An envelope
   fault refuses the page; a row never does.
2. **The consumer decodes each row** with its collection's decoder: typed rows strictly as
   `docs/contracts/study/rows.json`, the others by the `shapes` above. A row that does not decode is **unreadable**:
   skipped, counted per collection and reported (web: one console warning with collection, count and identities,
   never row data, and a notice on the study page). The other rows load: one bad row never blocks studying.
3. **An unreadable row is never rewritten or deleted.** A reader keeps the identity of each unreadable typed row
   whose identity member is still readable (`id`; `deckId`; `''` for the workspace `limits` row and for
   `fsrsActive`) and refuses a write to it (the web says the item was saved by a newer version); a new card never
   takes such an id (the next one: `c-<kind>-<entry>-<sentence>`, then a ULID; the read-time merge of
   `study/canonical.json` joins the two once both are readable); a deck delete tombstones only rows it read. The row
   stays on the server as written, so the client that wrote it still reads it.
4. A row of another workspace is not counted, readable or not (`workspace=` already filters them out).

The server follows the same rule for its own stored rows (#167 review). A stored typed row it cannot read back
(stored JSON it does not know, such as a deck `source` type or a `newOrder` a newer server wrote before a
downgrade, or a damaged row) is logged by family, workspace and identity (never its data) and skipped: the paged
pull goes on and its position, so the cursor, still moves past the row; the legacy pull and the legacy plugin-data
view skip it too (a legacy GET of its key is 404, a leftover plugin row of the key does not show through). A write
that would replace it (`POST /api/sync/push`, a legacy plugin-data PUT or DELETE of its key) is refused with 409
`study_row_unreadable` (`docs/contracts/auth/errors.json`) and nothing in the request is applied. Go:
`server/internal/sync/unreadable_stored_test.go`, `unreadable_http_test.go`. The backup export still fails on such
a row: a backup must not silently lose data.

## Push (`push-result.json`)

`POST /api/sync/push` is unchanged: body `{events, pluginData, cards, decks, deckSettings, limits, fsrsSets,
fsrsActive}` (each optional), answer `{eventsAccepted, eventDuplicates, dataAccepted, dataSkipped,
dataRefused}` with every key always present. The whole body is validated first: a malformed item is 400 and
a foreign workspace or unknown plugin 404, and then nothing is applied (400 `bad_request` naming the item,
404 `not_found`). A plugin value or typed item above 256 KiB, or a body above 8 MiB, is 413 `too_large`. A
row of a plugin without `owns-data` is refused alone (`dataRefused`). Plugin rows and typed rows are
last-write-wins on the edit time (`docs/contracts/study/README.md`); a typed row equal to the stored one
counts `dataAccepted` without a write.

## Legacy form (`legacy-pull.json`, until v0.5.0)

Any pull without `v=2`: `cursor` (RFC 3339, optional) and `collections` exactly as in v0.3.x, one JSON
object, streamed row by row. It answers `Deprecation: true` and
`Link: </api/sync/pull?v=2>; rel="successor-version"`. A client that reads nothing for 60 s is cut (the
write deadline moves forward as rows go out), so a stalled reader does not hold the server's read
transaction; the truncated JSON makes it retry, as after a network cut.

- Item 4's legacy view applies unchanged (`docs/contracts/study/legacy-view.json`): a pull naming
  `pluginData` and none of the typed collections gets the typed rows as `qinqin-flashcards` rows in
  `pluginData`.
- Lexicon collections moved to packages: naming one is 400 `sync_collection_moved` (JSON); a pull without
  `collections` keeps their keys as `[]`. `sentences` carries the caller's own sentences only.
- Other legacy errors are 400 `bad_request` (a cursor that is not RFC 3339, an unknown collection).

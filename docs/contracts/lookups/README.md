# Lookup history

A per-workspace history of the words a learner looked up, with a "no card yet" prompt and add-to-deck.
Spec: `docs/superpowers/specs/2026-11-16-v030s-lookup-history-design.md` (issue #72). Web:
`apps/web/src/lib/lookups/lookups.ts` (rules), `recorder.ts` (buffer and flush), `store.ts` (I/O).
Fixtures: `lookup-rows.json` (parse rules), `lookup-merge.json` (merge, remove, clear), `lookup-prompt.json`
(the prompt), decoded by `apps/web/src/lib/lookups/lookups.test.ts`. The restore remap is pinned by the
`lookups:` cases of [`../backup/remap.json`](../backup/remap.json) (Go: `server/internal/backup`).

## Rows

Plugin data of the built-in plugin **`qinqin-core`**, read and written through the generic plugin data
routes and the `pluginData` sync collection. There is no lookup-specific data route and the server never
parses the rows (except on a backup restore, below).

| Key | Scope | JSON shape |
| --- | --- | --- |
| `lookups` | workspace (always `?workspace=<ws>`) | `{"version": 1, "clearedAt": RFC 3339 \| null, "items": [item], ...unknown kept}` |
| `lookupcfg` | **user-global** (`workspaceId: null`, written without `workspace`) | `{"version": 1, "record": <bool>, ...unknown kept}` |

Item: `{"entryId": int, "count": int, "firstAt": RFC 3339, "lastAt": RFC 3339, "sources": {"reader": n,
"lesson": n, "search": n}, "books": [bookId, ...]}`.

There are never per-word keys and a client never `DELETE`s the `lookups` row: a delete would keep a
tombstone holding the last data. Clearing is a `PUT` (below).

## Parse rule (`lookup-rows.json`, op `rows`)

A row that is missing, tombstoned (`deletedAt != null`), not a JSON object (a string holding JSON text
is decoded first, as the web SDK does for every row) or whose `version` is not the number `1` is an
**empty history** `{clearedAt: null, items: [], extra: {}}`. Otherwise:

- `clearedAt` is kept when it is an RFC 3339 timestamp string, else null.
- `extra` is every top-level member other than `version`, `clearedAt` and `items`, verbatim; a writer
  keeps it. Unknown *item* members are not kept.
- `items` that is not an array is `[]`. An element is skipped unless all hold:
  - it is an object;
  - `entryId` is an integer ≥ 1 (a JSON number with no fraction; `"12"` and `1.5` are not);
  - `count` is an integer ≥ 1; a count above **1 000 000** is clamped to 1 000 000;
  - `firstAt` and `lastAt` are RFC 3339 timestamp strings (`YYYY-MM-DDTHH:MM:SS[.fraction](Z|±HH:MM)`, upper-case
    `T` and `Z`, a real calendar date and time).
- `firstAt` later than `lastAt` reads as `firstAt = lastAt`.
- `sources`: an object; members whose value is not an integer ≥ 0 are dropped, values above 1 000 000 are
  clamped; a missing or non-object `sources` is `{}`. Known keys are `reader`, `lesson`, `search`; other keys are
  kept and shown nowhere, but at most 13 of them (in order; the known keys always stay, so at most 16 members)
  and none longer than 32 characters. A restore merge applies the same cap.
- `books`: an array; non-integers and integers < 1 are dropped, then duplicates (the first stays), then
  everything after the third; missing or not an array is `[]`. Most recent first.
- A later item with an `entryId` already seen is skipped (the first stays).
- The items are sorted **newest first**: `lastAt` descending (by instant), then `count` descending, then
  `entryId` ascending; after sorting only the first **500** (`LOOKUP_CAP`) are kept. Eviction is therefore
  "least recently looked-up first; ties: smaller count, then larger entryId".

500 realistic items serialise to under 80 000 bytes and 500 items at the field maxima to under
110 000 (fixture `size` cases), well inside the 256 KiB plugin data value cap.

Timestamps are compared as instants; their text is kept as it is (only `firstAt` may be replaced by
`lastAt`'s text). A writer serialises `{...extra, version: 1, clearedAt, items}` with each item's six
members in the order above.

## `lookupcfg` (`lookup-rows.json`, op `cfg`)

"Record words I look up", one switch per user for every workspace and device. `record` is `false` only
when the row is a live version 1 object whose `record` is the boolean `false`; a missing, deleted,
unreadable or other-version row, or a non-boolean `record`, reads as **on**. `extra` is every member other
than `version` and `record`; a save keeps it.

## Merge (`lookup-merge.json`, op `merge`)

A client buffers *hits* `{entryId, at (RFC 3339), source: reader|lesson|search, bookId?}` and merges them
into the row it just read. Hits are applied in order of `at` (ties keep their order). A hit is ignored when
`entryId` is not an integer ≥ 1, `at` is not RFC 3339, or `clearedAt` is set and `at <= clearedAt` (a
lookup made before a Clear never comes back). Otherwise, with `item` the stored item of that entry:

- no item: a new item `{count: 1, firstAt: at, lastAt: at, sources: {<source>: 1}, books: [bookId] or []}`;
- else a **repeat** when `|at − item.lastAt| < 600 000 ms` (`LOOKUP_DEDUPE_MS`, 10 minutes): `count` and
  `sources` stay;
- else `count + 1` and `sources[source] + 1` (each clamped to 1 000 000);
- in every case `lastAt = max(lastAt, at)`, `firstAt = min(firstAt, at)`, and when the hit has a
  `bookId`: if `at >= ` the old `lastAt` it moves to the front of `books`, otherwise it is appended when
  absent; `books` keeps its first three.

Then the items are sorted and capped as in the parse rule. The dedupe lives in the shared merge (not only
in one tab) so two tabs and other clients agree.

## Remove and Clear (ops `remove`, `clear`, `staleAfterClear`)

- Remove = the same read-modify-write without the given entry ids.
- Clear = `PUT lookups?workspace=<ws>` with `{...extra, version: 1, clearedAt: <now>, items: []}`, then
  `DELETE /api/events/lookups?workspace=<ws>` (below). Unknown top-level members are kept. **clearedAt is the
  server's clock**: the `updatedAt` of the PUT answer (RFC 3339, whole seconds); when it differs from the
  client's `<now>` the row is written once more with it, so every device's lookups compare against one
  clock. The client keeps this clearedAt ("mine").
- A client never writes Clear or Remove while one of its own flushes is in flight, and starts none until
  the write is done (one chain per tab).
- `staleAfterClear(row, mine)` (input `{row, clearedAt: mine}`): true when the row's `clearedAt` is missing
  or earlier than mine — another device's flush that read the row before the Clear wrote its old copy
  back, with its old clearedAt — or some item has `lastAt <= mine`. A later clearedAt (cleared again
  elsewhere) with only newer items is not stale. About 30 s after a Clear the client re-reads the row once
  (from its store, not the page, so leaving the page does not cancel it; signing out does) and, when
  stale, writes `{...extra, version: 1, clearedAt: mine, items: []}`: a stale copy's counts include the
  erased past, so none of its items is kept.

## Writing: read, merge, write

A flush **always reads the row in the same flush** before it writes it (`find`, merge, `put`); a client
never writes a copy it read earlier: a copy from before a Clear on another device would bring the erased
words back. Two devices writing in the same second can lose one device's increments (last write wins per
row); the counts are informal and this is accepted. Before every flush the client re-reads `lookupcfg`;
when recording is off it writes nothing and discards its buffer. The buffer is memory only: nothing about
lookups goes to `localStorage`, `sessionStorage`, IndexedDB, URLs or logs, and the web service worker
filters the rows and old `lookup` events out of every API copy it saves (`../pwa/README.md`).

## Prompt (`lookup-prompt.json`)

`promptItems`: items with `count >= 3` (`PROMPT_MIN_COUNT`) whose entry is **new** (no live vocab card and
no "I know this" mark: the familiarity predicate of `../frequency/known.json`, `../reader/word-states.json`),
ordered by `count` descending, then `lastAt` descending, then `entryId` ascending, at most **10**
(`PROMPT_MAX`).

## What counts as a lookup (informative, UI clients)

- Reader and grammar lessons: a root hover popup with at least one result after it stayed open 1 000 ms,
  or at once when the pointer enters it; a selection popup when its (non-empty) results arrive. Nested
  popups never. The recorded entry is the first result.
- Search: opening a result (click or Enter on a hit). Typing a query records nothing.
- Entry page visits from elsewhere are not lookups.
- No workspace (a book without a workspace, no current workspace): nothing is recorded.

## `lookup` events

The web app no longer emits `lookup` events (they held free-text search queries); the event type stays
declared by the `qinqin-core` manifest and the server still accepts it. Events are append-only with one
exception: **`DELETE /api/events/lookups?workspace=<id>`** (signed-in user) deletes the caller's events of
type `lookup` in that workspace and answers `{"deleted": n}`; no `workspace` or a non-numeric one is 400,
a workspace that is not the caller's is 404. Nothing derives from `lookup` events. Other event types are
never deleted.

## Backup and restore

The `lookups` row is exported with the other plugin data rows and every item's `entryId` is listed in
`refs/entries.json`. On restore each item follows its entry to the target server's id (an unresolved entry
drops the item), `books` ids follow the restored books (unresolved ids are removed), items that map to
the same target entry merge (`count` and every `sources` member summed, earliest `firstAt`, latest
`lastAt`, books newest item first, distinct, at most three), and the list is sorted and capped as above.
`clearedAt` and unknown top-level members are kept verbatim. A `lookups` row whose data is not a version 1
object is dropped (counted in `droppedRows`): carried as it is its ids would name other words on the
target. Dropped items are not listed in the dry-run report. `lookupcfg` (user-global, no ids) is restored
as it is. See [`../backup/README.md`](../backup/README.md).

# Lookup history with add-to-deck — design (issue #72, v0.3.0 stretch item 5)

Status: Draft (2026-11-16), written unattended; every non-obvious call is a
**Ruling: what — why — cost if wrong**. Nothing is built. Owner direction: "#72 lookup history with a
prompt to add words to a deck." The issue has no comments. Builds on add-to-deck
(`docs/contracts/decks/add-to-deck.json`), #77's `qinqin-core` rows with backup entry-id remap
(`2026-11-16-v030s-notes-design.md`) and #68's familiarity predicate (`study/known.ts`,
`2026-11-16-v030s-unknown-words-design.md`); both are merged into the collection branch before this build.

## What exists (checked on `feature/v030s-lookup-history` 2cd6e23)

- Event type `lookup` is declared by the `qinqin-core` manifest (`server/internal/plugins/builtin/core.json`)
  and in `EventType` (`apps/web/src/lib/events.ts`). It has **no activity rule**: it counts toward nothing
  (heatmap, streak, stats, goals). It is emitted in exactly one place: `routes/search/+page.svelte`
  `recordLookup` posts `{query}` once per query and language per page visit. The reader's hover and
  selection popups (`plugins/reader/useLookup.svelte.ts`, also used by grammar `LessonView.svelte`) emit
  nothing. The entry page emits `view {entryId}`.
- Events are append-only: `server/internal/events` has `Append` and `Since`, nothing deletes, and the
  contract (`overview.md`) says so. They are exported in the backup (`events/*.jsonl`). So today every
  search query a learner ever typed is kept forever with no way to remove it.
- Plugin data `DELETE` tombstones a row and **keeps its last `data`** (`plugins.DeleteDataAt`); a `PUT`
  overwrites the stored value in place (upsert, no history table).
- Add-to-deck: `planAddToDeck` / `addPlanRows` / `pushStudyRows`, written forms via
  `POST /api/entries/bases` (`api/entryBases.ts`). The popup's `AddToStudyButtons.svelte` already knows
  whether the entry has a card (`hasCard`).
- Backup restore maps books before plugin rows (`backup/restore.go`), so `Maps.Books` is ready in
  `Maps.PluginRow`.

## Goals

- A per-workspace history of looked-up words, newest first, with count, first/last time and where (book
  titles, lesson, search).
- Add to a deck per word or in bulk; remove words; clear the whole history; a switch to stop recording.
- A prompt for words looked up often that have no card yet (history page and reader popup).
- Synced across devices, bounded in size, included in the backup and restored onto the right entries.
- Deletion that really deletes, including the old `lookup` search events.

## Non-goals (v1)

A home widget, a main-nav item, search queries without an opened result, lookups in nested popups, per-
occurrence logs (which sentence, which page), statistics or charts of lookups, heatmap or goal credit,
Android UI, a history across all workspaces on one page, exporting the history as CSV.

## Questions answered

**1. Storage: events, one row per word, or one row per workspace?**

- Ruling: **one `qinqin-core` plugin data row per workspace, key `lookups`**, holding a capped item list —
  privacy needs a real erase, and only an overwriting `PUT` gives one through existing routes: a
  `DELETE` (per-word rows as #77/#68 use) leaves a tombstone with the last data *and* a key naming the
  entry, forever; events cannot be deleted at all. The row syncs as ordinary plugin data, is exported
  generically, and is isolated by the plugin data routes — cost if wrong: two devices flushing within the
  same second can lose one device's increments (last write wins per row); counts are informal, so this is
  accepted.
- Ruling: plugin `qinqin-core`, not `qinqin-reader` — search and lessons record too, and the core cannot be
  switched off — cost: none (#77 already taught the remap a second plugin id).
- Ruling: **the web app stops emitting `lookup` events**; the type stays declared (old rows, other clients)
  and the server keeps accepting it — the row replaces it, and an undeletable second copy would defeat the
  privacy goal — cost: nothing reads `lookup` events today.

**2. Shape.**

```json
key "lookups"   plugin "qinqin-core", workspaceId <ws>
data {"version": 1, "clearedAt": "2026-11-16T09:00:00Z" | null,
      "items": [{"entryId": 1201, "count": 4, "firstAt": "…Z", "lastAt": "…Z",
                 "sources": {"reader": 3, "search": 1}, "books": [17, 4]}]}
```

- Valid item: `entryId` positive integer; `count` integer ≥ 1 (clamped to 1 000 000); `firstAt`, `lastAt`
  RFC 3339 (`firstAt > lastAt` reads as `firstAt = lastAt`); `sources` an object of non-negative integers
  (known keys `reader`, `lesson`, `search`; unknown keys kept and shown nowhere); `books` up to 3 distinct
  positive integers, most recent first. An invalid item is skipped, a later duplicate `entryId` is skipped.
  A row that is missing, tombstoned, not an object or `version !== 1` is an empty history.
- Ruling: unknown top-level members are kept verbatim on write; unknown item members are not — the row is
  rewritten by every flush, and keeping per-item extras across merges needs rules nobody needs yet — cost: a
  later `version: 2` adds item fields with a version bump.
- Ruling: **cap 500 items**, the least recently looked-up dropped first (ties: smaller `count`, then larger
  `entryId`) — 500 items serialise to about 65 KB (fixture case), a quarter of the 256 KiB value cap, and
  one GET + PUT per flush stays cheap; 500 distinct words is months of reading — cost: an old word looked up
  once falls out; frequent words stay because they are recent.
- No time-based expiry (YAGNI; Clear and Remove cover privacy).

**3. What counts as a lookup.** The recorded entry is always the popup's or hit's entry id; for a popup
it is `results[0].entryId`, the entry shown first.

- Reader and grammar lessons: a **root hover popup with at least one result counts after it stayed open
  1 000 ms, or at once when the pointer enters it**; a **selection popup counts when its results arrive**
  (non-empty). Nested popups never count.
  Ruling — hover fires every 80 ms while the mouse crosses a line; a second of dwell or entering the popup
  means the learner read it, and a selection is always deliberate — cost if wrong: a slow reader resting
  the mouse records a few unintended words; Remove fixes them.
- Search: **opening a result** (click or Enter on a hit's link) counts, source `search`. Typing a query
  does not. Ruling — a query is free text, often partial or a typo, and has no entry to add to a deck;
  opening a hit is the look-up — cost if wrong: a learner who reads the gloss in the hit list and never
  opens it leaves no history.
- Entry page visits from elsewhere (links, home) are not lookups (they stay `view` events).
- Workspace: the reader's book workspace (`workspaceForBook`, the same as "+" and reading time), the
  lesson's `studyWorkspaceId`, search's current workspace; none → nothing recorded.
- Ruling: **dedupe in the merge rule, not only in the tab**: a lookup of an entry within 10 minutes after
  its stored `lastAt` updates `lastAt` and `books` but not `count` or `sources` — rereading a paragraph
  hovers the same words again; putting the window into the shared merge (fixture) makes two tabs and
  Android agree — cost if wrong: a word studied intensely in one sitting counts once.

**4. Writing: buffer, flush, never from a stale copy.** A per-tab `LookupRecorder` buffers lookups in
memory and flushes 5 s after the last one (at most 30 s after the first) and on `visibilitychange` to
hidden. A flush is **read, merge, write**: `find('lookups')`, re-check the switch, `mergeLookups`,
`put`. A failed flush keeps the buffer (≤ 200 lookups, oldest dropped) for the next one.

- Ruling: never write a row the flush did not just read — a tab holding a copy from before a Clear on
  another device would bring the erased history back — cost: a lookup buffered when the tab is closed
  offline is lost.
- Ruling: the buffer lives in memory only, never `localStorage`/IndexedDB — a looked-up word must not
  linger in browser storage after Clear or sign-out — cost: same as above.
- Ruling: lookups older than or equal to `clearedAt` are dropped by the merge — a buffered lookup made
  before a Clear elsewhere cannot revive it — cost: none.
- Accepted race: a Clear that lands between another device's read and write is overwritten by that write
  (one round trip wide). The history page re-reads 30 s after a Clear and repeats it once if items older
  than `clearedAt` came back (`staleAfterClear`) — cost: a second request in a rare case.
- Removing a word is the same read-modify-write without that `entryId`.

**5. Recording switch.** Row `lookupcfg` of `qinqin-core`, **user-global** (`workspaceId: null`, like
`vacation:*`): `{version: 1, record: boolean}`; missing or unreadable reads as **on**; unknown members kept.

- Ruling: default on — the issue and the owner ask for the history; the data stays on the learner's own
  server, the history page explains it and is one click from Search — cost if wrong: a learner who never
  opens the page builds a history; Clear deletes it.
- Ruling: one switch per user, not per workspace — privacy choices are about the person; the recorder
  reads it at start and before every flush, so a switch turned off on one device stops every other device
  at its next flush and discards their buffers — cost: someone wanting history only in Japanese cannot.
- Turning it off does not erase; the page then offers "Clear history too".

**6. Old `lookup` events.** New route **`DELETE /api/events/lookups?workspace=<id>`** → `{deleted: n}`,
deleting the caller's events of type `lookup` in that workspace (accUser; workspace required, 400 without,
404 when not the caller's). "Clear history" calls it after writing the empty row.

- Ruling: an exception to append-only for exactly this type — nothing derives from `lookup` events (no
  activity rule, no replay), they hold free-text queries, and privacy is a must — cost: one route and
  authorization tests; the contract sentence "append-only" gains the exception.
- Not deleted: other event types (a `view` event is part of the study log, not the history); copies in
  archives the learner downloaded, safety exports (kept ≤ 7 days), administrator backups, and SQLite free
  pages until reused. The wiki says this plainly.

**7. The "no card yet" prompt.**

- Rule (`promptItems`, fixture): items with `count ≥ 3` whose entry is `familiarity === 'new'` (#68: no
  live vocab card and no "I know this" mark), most looked-up first, then most recent, at most 10.
- History page: a box above the list, "You keep looking these up" with the words and "Add these N to
  [deck]". Reader popup: under the add buttons, for the top result only, when it has no card, is not
  marked known and its count is ≥ 3: "You've looked this up 4 times." (text, no button: "+" is right
  there). Ruling: no home widget and no notification — YAGNI; the popup is where the word is in front of the
  learner — cost if wrong: a later widget reuses `promptItems`.
- The popup reads the count from the recorder's in-memory copy (loaded once when the book opens and kept
  current with its own lookups); no extra request per popup. Recording off: no hint.

**8. The history page** — route `/lookups`, title "Lookup history", for the current workspace.

- Header: the switch "Record words I look up" (`role="switch"`) with one line of explanation. Links to the
  page: the Search page ("Lookup history") and Settings → Your data. Ruling: no main-nav item — the nav
  is full and the page is a secondary tool — cost: discoverability; the reader popup hint does not link.
- The prompt box (7), then a toolbar: deck select (General first, then decks by `createdAt`), "Add
  selected (N)", "Remove selected (N)", filter "All / No card yet", "Clear history…" (inline confirm:
  "Delete the lookup history of <workspace>, including old search records? This cannot be undone.").
- List, newest first, 50 at a time ("Show 50 more"): checkbox, written form (link to the entry), reading,
  `×count`, "last 3 Nov" (learner's day) and where ("《三体》, 《活着》, lessons, search"; a book id the
  library no longer has reads "a removed book"), a state chip with text ("No card", "In study", "Known"),
  per-row "Add" (to the selected deck) and "Remove". An entry the dictionary no longer has shows "Not in
  the dictionary any more" with Remove only.
- Adding uses `planAddToDeck` with the items in list order; the result line names created and joined
  counts. Ruling: added words stay in the history (their chip changes; the prompt drops them) — it is a
  history, not an inbox — cost: none.
- Empty state: "No lookups yet. Hover or select a word in the reader, or open a search result." Offline or
  failed load: inline error with Try again; nothing is cached.

**9. Backup.** The row is exported generically. Export adds every item's `entryId` to
`refs/entries.json`. Restore (`Maps.PluginRow`, `qinqin-core` key `lookups`): each item's entry through
`Maps.Entries` (unresolved: dropped), `books` through `Maps.Books` (unresolved ids dropped), items that
map to one target entry merge (sum `count` and `sources`, min `firstAt`, max `lastAt`, books newest first
≤ 3), then sort and cap. `clearedAt` and unknown top-level members kept.

- Ruling: an unparseable `lookups` row is dropped on restore — carried as is, its ids would name other
  words on the target — cost: a corrupt history is lost.
- Ruling: dropped items are not listed in the dry-run report — it is informal history; listing words per
  unresolved entry would bury the card losses the report exists for — cost: a few history words vanish
  silently on a server lacking their dictionary.
- `lookupcfg` (global, no ids) is restored generically.

## Data flow

```
reader / lesson popup ─(dwell|enter|selection)─┐
search hit opened ─────────────────────────────┼─▶ LookupRecorder (memory) ─flush─▶ GET lookups
                                               │        ▲ count for popup hint      merge (pure)
lookupcfg (user-global) ◀── page switch ───────┘        │                           PUT lookups
/lookups page ── GET lookups + entry bases + study data ─┴─ add (planAddToDeck) / remove / clear
clear ── PUT {items:[], clearedAt} ── DELETE /api/events/lookups?workspace=
backup ── plugin-data (generic) + refs entries (new) ── restore remaps entries, books (new)
```

## Code layout

- `apps/web/src/lib/lookups/lookups.ts` (pure): constants, `parseLookups`, `serializeLookups`,
  `mergeLookups`, `removeLookups`, `clearedLookups`, `promptItems`, `parseLookupCfg`, `serializeLookupCfg`,
  `whereText`.
- `apps/web/src/lib/lookups/recorder.ts`: `LookupRecorder` (timers, buffer, flush with injected I/O),
  `lookupRecorder()` per-tab singleton; `dwell.ts`: the hover dwell rule as a small state machine.
- `apps/web/src/lib/lookups/store.ts`: I/O over `createPluginSdk(core)` and the delete route.
- `apps/web/src/lib/lookups/historyView.ts` (pure page model) + `routes/lookups/+page.svelte` (thin).
- Hooks: `useLookup.svelte.ts` (an `onLookup` option), `BookView.svelte`, `LessonView.svelte`,
  `routes/search/+page.svelte` (record on open, `record('lookup')` removed), `AddToStudyButtons.svelte`
  (hint), Settings → Your data (link).
- Server: `internal/events` `DeleteLookups`, `api/handlers_events.go` + route row; `internal/backup`
  export refs and `PluginRow` branch.

## Security, privacy and isolation

- Isolation: the plugin data routes (session user; `?workspace=` must be owned, else 404) and the new
  route (same check). Tests with two users for both, and that the route deletes nothing but the caller's
  `lookup` events of that workspace.
- Words are rendered by text interpolation only. No looked-up word in logs, URLs or browser storage.
- Signing out drops the recorder (buffer and copy).

## Testing

Contract fixtures (`docs/contracts/lookups/`) decoded by web unit tests; recorder and dwell with fake
timers; jsdom tests for the page (list, add once is idempotent, remove, clear with confirm, switch, prompt)
and the popup hint; search records on open only. Go: `DeleteLookups`, route authorization (401, foreign
workspace 404, two users), backup export refs and remap fixture cases. Real-app check on a built server.

## Risks

- Lost increments when two devices flush the same second (accepted, informal counts).
- A Clear racing another device's flush (mitigated by the re-check, not eliminated).
- The 1 s dwell is a guess; it is one constant.

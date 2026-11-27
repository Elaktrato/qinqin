# Show cached data at once, refresh in the background (#290)

Milestone v0.9.0, phase 1 (foundations). Branch `feature/v090-290-cached-refresh` from `feature/v0.9.0`. No owner
decision comments on the issue; the issue body is the brief.

**Goal:** coming back to Home (and Stats, the decks list) shows what the session already knows at once and refreshes
it quietly: no loading line, no layout jump, and a failed refresh keeps the shown data with a quiet notice. Writes
keep planning against the newest rows.

## What happens today

- `StudyCache.view()` serves held rows only while they are younger than 8 s; after that every reader waits on a
  delta round.
- The event log cache (`EventLog.load`, `WorkspaceCache`, 8 s) drops the log on every posted review and after 8 s:
  the next widget read walks the whole log again before anything shows.
- Home reads its layout (`loadLayout`) on every visit and renders no widget until it answers; the heatmap reads the
  widget options (`loadWidgetOptions`) on every mount.
- Each widget starts in `loading` on every mount (a "Loading…" line) and replaces its content with an error on a
  failed refresh.

## Tasks

1. This plan.
2. Measure: `routes/homeRevisit.dom.test.ts` renders Home with its default widgets on the fake study server (2,000
   cards, 3,000 reviews), unmounts it, advances the clock past the freshness window and renders it again. It counts
   requests per kind and how many widgets show a loading line before content. Numbers before and after go below.
3. Study cache stale-while-revalidate (`lib/studycore/cache.ts`): a held slot answers at once and starts a delta in
   the background; only a first load, `force`, `full`, a slot marked stale, or a reader asking for `current` waits.
   Writes (`planningView`, `loadRawStudyData`) and `loadStudyData` (pages that schedule cards; they read the log
   fresh anyway) ask for `current`. A failed background refresh is recorded in the session's `RefreshReport`
   (`lib/studycore/refreshReport.svelte.ts`) and cleared by the next round that lands. Tests first.
4. Event log stale-while-revalidate (`lib/workspace/workspaceCache.ts` gains `revalidate`): a held log is served at
   once after its TTL or after a post marked it stale, the refresh runs in the background, and its landing tells the
   log's listeners. Tests first.
5. Home's own data in the session (`HomeData`, `lib/widgets/homeData.ts`, held by `SessionCaches.home`): layout and
   widget options are served from memory at once and refreshed in the background; a save on this device updates the
   held copy. A device copy of both (localStorage, key per user id, `qinqin.home.v1.<user>`) gives a warm start
   after a reload; it is removed at sign-out. Tests first.
6. Widgets keep their last value (`WidgetLoad`, `lib/widgets/widgetLoad.svelte.ts`, values held per session in
   `SessionCaches.widgets`): a remounted widget shows its last value for the same workspace at once, the loading line
   shows only on a true first load, and a failed refresh keeps the value with a quiet "Could not refresh" line and
   Try again. Applied to the Home and Stats widgets. Home shows one quiet notice when the background study refresh
   failed. DOM tests first.
7. Other pages: the decks list keeps its data in the session's held values in the same way. The reader library and
   the rest are listed below.
8. E2E: revisit Home after studying a card and after the freshness window, and see no loading line.
9. Docs: the sync contract's "Rounds and cursors" notes say when a client may serve held rows (README only, no wire
   change), CHANGELOG entry, record 0009 (the held values), wiki, NEXT.md.

## Rulings

(filled in while working)

## Execution record

(filled in while working)

## Local follow-up

(filled in while working)

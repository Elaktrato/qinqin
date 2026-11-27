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

- Ruling: `StudyCache.view()` serves held rows by default and `{ current: true }` asks for today's waiting rule;
  `planningView`, `loadRawStudyData` and `loadStudyData` pass it — the issue keeps writes on the newest rows, and
  `loadStudyData` feeds the study session and the scheduling page, which read the log fresh anyway, so a held
  read saves them nothing — cost if wrong: a page that should have been fast still waits one delta round.
- Ruling: a posted review marks the event log stale instead of dropping it, and the next read serves the held log
  while it reloads — the reviews just sent are merged from the outbox and the recently-sent list, so the counts are
  right at once; the reload's listeners bring the rest (read events, sessions) — cost if wrong: a reading-time or
  heatmap number lags by one reload after a post.
- Ruling: the week's activity is not cached on its own: the weekly widget's held view (WidgetLoad) shows at once and
  `loadWeek` refreshes it behind — one held value per widget covers the activity, the history and the replay at
  once, without a second cache to keep in step — cost if wrong: the Week page (not a widget) still waits for the
  activity request on each visit.
- Ruling: the device copy holds only Home's layout and widget options, in localStorage under
  `qinqin.home.v1.<user id>`, removed at sign-out (kept after an expired token, like the recently-sent reviews) —
  they are non-sensitive and make Home render its widgets at once after a reload; computed widget values (word
  counts, streaks, reading time) are study data and stay in memory only — cost if wrong: after a reload the widgets
  still show their loading lines once (the study cache is empty then anyway).
- Ruling: widgets hold their value in the session (`SessionCaches.held`, by widget id and workspace; the weekly
  summary by workspace and week) — record 0009 puts per-user state in the session, so a new session (sign-out,
  user switch, 401) starts empty by construction — cost if wrong: a long session keeps one value per widget and
  workspace in memory (small).
- Ruling: a held widget value refreshes once per mount (the heatmap's `loadedHere`), and widgets that read the study
  rows or the log now listen to `onStudyChange` and `events.onChange` (flashcards, daily goal, week, word states,
  reading time) — a background refresh otherwise never reaches a widget already showing the held value — cost if
  wrong: one extra recompute per change while Home is open.
- Ruling: one quiet notice for a failed background refresh: the widget's own `stale` line (WidgetCard) when its
  load failed, and one Home line from the session's `RefreshReport` when the cache or log refresh behind held data
  failed — the cache swallows the background failure, so the widget cannot see it — cost if wrong: on a failure
  both lines can show at once.
- Ruling: no ContractVersion bump: "Serving held rows" in the sync README is a client rule with no route, payload or
  fixture change; a CHANGELOG entry records it — cost if wrong: the orchestrator bumps on merge.
- Ruling: Home's layout and options are still read on every visit (behind the held copy) — another device may have
  changed them, and the read is one small keyed-row list — cost if wrong: two requests per visit that could wait for
  a longer window.

## Execution record

Measured with `apps/web/src/routes/homeRevisit.dom.test.ts` (`QINQIN_MEASURE=1` prints the counts): Home with
its default widgets on the fake study server, 2,000 cards, 3,000 reviews, 100 rows per pull page. "Loading lines
seen" counts every widget loading line that appeared during the visit. Time is not measured in a unit test
(record 0005, `noWallClock.test.ts`); a first probe with a clock (removed) showed the revisit after 20 s at about
340–420 ms in jsdom with no network latency and about 480–510 ms with 30 ms per request, and a revisit 1 s later at
about 340–400 ms: the time was the widgets' recompute and render, not the network.

| Visit | Before #290 | After #290 |
|---|---|---|
| First visit | 37 requests, 4 loading lines | 37 requests, 4 loading lines |
| Revisit after 20 s | 16 requests (1 pull, 1 log walk, layout, options) waited on, 4 loading lines | 14 requests, all behind the held content, 0 loading lines; every widget has content at its first paint before any answer |
| Revisit within 8 s | 14 requests, 4 loading lines | 10 requests, no pull and no log read, 0 loading lines |

What the numbers say about memoising more: on a revisit nothing waits any more for the network or the history
replay; the replay and the widget computations (word states, summary numbers, the week's replay) still run once per
refresh, behind the shown values. Memoising them per cache view (the mastery map per view) would save CPU on a
change, not time to content; left as a follow-up.

Tasks:

1. Plan (0cef4e04).
2. Measurement test, before numbers (fc05e514). The fake study server gained an event log, a test's own routes and a
   latency.
3. Study cache SWR (3755e41d). Test-first: the seven SWR cache tests failed for the right reason (the held rows were
   not served; no failure was reported), then passed; three older round tests now ask for `current`. The
   RefreshReport test failed (no module) before its class existed. Contract notes and CHANGELOG.
4. Event log SWR (33b6f297). Test-first: the WorkspaceCache revalidate tests and the two EventLog tests failed, then
   passed. The measurement test lost its clock (the wall-clock guard).
5. Home's setup held (1e08b5ba). `homeData.test.ts` was written first and failed (no module).
6. WidgetLoad (c6c4fb61). `widgetLoad.test.ts` first (failed: no module); the SummaryWidget DOM tests for the
   revisit and the failed refresh were written after its conversion, then checked against the old component
   (both failed there).
7. The other widgets and the heatmap (4ed28712): converted under the existing widget DOM tests; no new test per
   widget (WidgetLoad is the tested part). The heatmap's held window and the two-step character map are covered by
   the existing heatmap and map tests plus the Home revisit test.
8. Home's quiet notice and the pinned revisit (this commit's test was written after the notice).
9. Decks and library (bbc4e437): `decksData.test.ts` and the two Library tests were written first and failed.
10. Sign-out isolation readers for held values and Home's layout (passed at once: the session owns them).
11. E2E `home-revisit.spec.ts` (bc7a6341): passes on the branch, fails on the base (12 loading lines seen).
12. Docs: wiki (Finding your way, Development), record 0009, NEXT.md.

Not done, listed for the PR:

- Stats → Week, Stats → Characters and the study scheduling page still wait for their loads on each visit (they
  read `loadStudyData` or the full map; the Stats overview's widgets do hold their values).
- Computed widget values are not kept on the device (Ruling above); after a reload the widgets load once.
- No "updating" cue while a refresh runs behind a held value (the issue allows at most a subtle one; none is shown).
- The Week page's activity request is not cached (Ruling above).

## Local follow-up

- #290 on a large real account: open Home, go to Decks, wait 10 s, come back; Home must show its widgets at once.
  In the browser's network panel the `sync/pull` delta and the `events` walk go out after the widgets show. Then
  switch the network off in the dev tools and come back again: the widgets stay, and Home says "Could not refresh
  your study data. Showing what was loaded last."
- #290 in the Android app (needs the APK build): kill and reopen the app; the widget layout shows at once (device
  copy), and after signing out `qinqin.home.v1.*` is gone from the WebView's localStorage (chrome://inspect).

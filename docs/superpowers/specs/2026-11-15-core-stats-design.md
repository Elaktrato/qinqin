# Core activity statistics — design (issue #48)

Status: Draft for review (2026-11-15). Written unattended under the owner's rule "licensing first, then
the best experience for the user even at higher development cost"; every call is a **Ruling** and can
be overruled. Nothing is built. **Depends on** the plugin SDK design
(`2026-11-15-plugin-sdk-design.md`, issue #39): manifests are canonical JSON validated by the server
and declare the event types each plugin emits. It is built after #39, on the same branch: #39
accepts `activity` as an opaque object, and this design's first task types and validates it.

## Intent and why

The home heatmap (`apps/web/src/lib/components/ActivityHeatmap.svelte`, `lib/activity/activity.ts`) is
already core and counts flashcard reviews, reading and journal entries. But it downloads every event
of the 91-day window and scores them in the browser from `ACTIVITY_SOURCES`, a hard-coded list: a new
plugin's activity needs a core edit, the Android client (#38) would need a second copy of the
scoring, and the transfer grows with study volume (a heavy flashcard user posts about 1,000 review
events a day). The issue also asks for a combined view across workspaces and filters per activity
type. This design moves scoring to declarative rules in plugin manifests, aggregation to the server,
and adds the two views to the heatmap.

## Goals

- **Contribution through the manifest**: an `activity` rule on a manifest `events` entry makes that type
  count, with no core change. The three current sources move out of core into their plugins.
- **Server endpoint** `GET /api/stats/activity` aggregating by UTC day, workspace and type (plugin
  follows from type), fast on large logs, with a pinned performance test.
- **Heatmap**: filter chips per activity type and a scope switch "This workspace / All workspaces",
  remembered per user across devices.
- Scores identical to today's for the existing three sources.

## Non-goals

- Local-time days (see Rulings), streaks, goals, new charts, other widgets changing scope.
- Plugin detail statistics (flashcards' own charts stay in flashcards; the reading-time widget keeps
  reading the event log).
- A rollup table or cache (only if the performance test fails; see Rulings).

## Approaches

1. **Declarative rules, SQL aggregation per rule, finest grain to the client (CHOSEN).** The server runs
   one indexed `GROUP BY` per rule and returns day × workspace × type cells; the browser folds them into
   whichever scope and filter the user picks, instantly, from one request. Android can evaluate the
   same rules offline from `/api/plugins`.
2. **Keep client scoring, read rules from manifests.** No server work, but the full window still
   travels and every client scores; rejected for the large-log case.
3. **A daily rollup table maintained on append.** Fastest reads, but a rule change (a new plugin version)
   needs a recompute and sync-pushed back-dated events need care; kept as the fallback.

## Activity rule (inside a manifest `events` entry)

```jsonc
{ "type": "read", "activity": {
    "label": "Reading",                                  // chip and tooltip, 1..40 chars
    "describe": { "one": "{n} minute of reading",        // both forms must contain {n}
                  "other": "{n} minutes of reading" },
    "measure": { "field": "seconds", "unit": "seconds", "min": 30, "max": 7200 },
    "pointsPer": 300 } }
```

Kinds, decided by which optional fields are present (the server rejects other combinations):

| Kind | Fields | points | raw |
|---|---|---|---|
| count | neither `measure` nor `distinctBy` | 1 per event | 1 per event |
| distinct | `distinctBy: "<field>"` | 1 per distinct string `payload.<field>` per (day, workspace); missing or non-string counts 0 | = points |

Distinct is defined per (UTC day, workspace) and the combined view sums workspaces; this is the
reference for the oracle and fold tests. Journal entry ids are ULIDs inside one workspace's data, so
it equals today's per-day count.
| measure | `measure` + `pointsPer` | per event `ceil(min(v, max) / pointsPer)`, 0 if `v` is not a JSON number or `v < min` | sum of `min(v, max)` over counted events |

Validation: field names `^[A-Za-z][A-Za-z0-9_]*$`; `measure.unit` is `"seconds"` (the only unit, YAGNI);
`0 ≤ min < max ≤ 86400`; `pointsPer` is a whole number ≥ 1 and only allowed with `measure`. For `{n}`, a `seconds` unit
shows whole minutes, at least 1 (`max(1, round(raw / 60))`); otherwise `n = raw`.

The migrated rules (today's `ACTIVITY_SOURCES`, unchanged in effect):

- `qinqin-flashcards` / `review`: count; "Flashcard reviews"; "{n} flashcard review(s)".
- `qinqin-reader` / `read`: the measure rule above (30 s floor, 5 min per point, 2 h cap per event).
- `qinqin-journal` / `journal`: `distinctBy: "entryId"`; "Journal entries"; "{n} journal entry/entries".

## Server

**Migration `028_study_events_type_index.sql`**: `CREATE INDEX idx_study_events_user_type_ts ON
study_events (user_id, type, ts, workspace_id)`; count rules are then answered from the index alone.

**`plugins.ActivityRules(ctx, db) ([]plugins.RuleOf, error)`**: `RuleOf{Plugin, Type string;
Rule ActivityRule}` for every registered feature plugin whose manifest parses with `sdk ≥ 1`: built-ins
first in `plugins.Builtin()` order (so reviews, reading, journal, as today), then other plugins by id,
each in manifest order. A type claimed by a built-in and another row goes to the built-in only (SDK
design ruling). The order is fixed, not the user's plugin order, so tooltips do not reshuffle.

**Package `server/internal/stats`**: `Activity(ctx, db, userID int64, from, to time.Time, workspace
*int64, rules []plugins.RuleOf) ([]Cell, error)` with `Cell{Day string; Workspace int64; Type string;
Points int64; Raw float64}`. One query per rule over `user_id = ? AND type = ? AND ts >= from AND ts <
to+1 day [AND workspace_id = ?]`, grouped by `substr(ts, 1, 10)` (timestamps are stored as UTC RFC
3339, so that prefix is the UTC day) and `workspace_id`. Payload fields are read with `json_extract`
behind `json_valid`; the measure ceiling is computed in SQL with real division, `q = r * 1.0 / p`, as
`CAST(q AS INTEGER) + (q > CAST(q AS INTEGER))` (integer `r / p` would truncate: 301 s must give 2). Cells with 0 points are dropped; the result is sorted by day, workspace, type.

**`GET /api/stats/activity?from=YYYY-MM-DD&to=YYYY-MM-DD[&workspace=ID]`** (authenticated):

```json
{ "from": "2026-08-17", "to": "2026-11-15",
  "sources": [{ "type": "review", "plugin": "qinqin-flashcards", "label": "Flashcard reviews",
                "unit": "count", "describe": { "one": "{n} flashcard review", "other": "{n} flashcard reviews" } }],
  "cells": [{ "day": "2026-11-13", "workspace": 3, "type": "review", "points": 9, "raw": 9 }] }
```

- Defaults: `to` = today (UTC), `from` = `to` − 90 days. 400 for a malformed date, `from > to` or a span
  over 366 days; 404 for an unknown or foreign workspace (as `/api/events`).
- `unit` is `"seconds"` for measure rules, `"count"` otherwise.
- `sources` lists every rule, also those with no cells, so the chips are stable.

**Performance (pinned).** `TestActivityLargeLog` (skipped under `-short`) seeds 400,000 events for one
user (one year, ~1,100 a day across the three types and two workspaces) plus 100,000 for another, then
asserts that `EXPLAIN QUERY PLAN` of every rule query uses `idx_study_events_user_type_ts`, and that a
91-day `Activity` call finishes within 2 s (the measured time goes in the ledger; expected well under
200 ms). `BenchmarkActivity91Days` reports the same. An **oracle test** compares `Activity` with a
plain Go loop over `events.Since` on a 5,000-event random log (all three kinds, invalid payloads,
window edges) and must match cell for cell.

## Web

- `lib/api/stats.ts`: `fetchActivity(from: string, to: string): Promise<ActivityResponse>` (no
  workspace parameter: the heatmap always fetches the combined grain once; see Rulings).
- `lib/activity/activity.ts` is rewritten around the response: `HEATMAP_DAYS`, `windowStart`,
  `levelFor` stay; `foldActivity(resp, view, now, days)` returns the 91-day map of `DayActivity{day,
  total, bySource, raw, byWorkspace}` for `view = { workspace: number | null; hidden: string[] }` (null
  = all workspaces); `describe(source, raw)`, `dayTooltip(day, sources, workspaceName)` and
  `windowSummary(map, sources, scope)` replace the per-source functions. `ACTIVITY_SOURCES` and its scoring
  are deleted; `readingPoints` moves to `lib/stats/readingTime.ts`, its only remaining user.
- `lib/activity/viewPrefs.ts`: `loadActivityView()`/`saveActivityView(view)` through
  `createPluginSdk(coreManifest).data.user()`, key `activity-view`, value `{ "version": 1, "scope":
  "workspace" | "all", "hidden": ["read"] }`; anything unparsable reads as the default `{ scope:
  "workspace", hidden: [] }`. Saves are optimistic; a failed save keeps the view for the session and
  logs a warning.
- `ActivityHeatmap.svelte` loads the view and the response together, refetches when
  `onEventLogChange` fires and on mount, and renders:

```
Activity                                   ( This workspace | All workspaces )
[✓ Flashcard reviews 412] [✓ Reading 38] [  Journal entries 3]
▢▢▣▣▢▣▣ … (13 weeks)
412 points in the last 13 weeks                               Less ▢▣▣▣▣ More
```

  - The scope switch is a two-option radio group; with no workspace selected, "All workspaces" is
    chosen and "This workspace" is disabled (this replaces today's "choose a workspace" state).
  - Chips are toggle buttons (`aria-pressed`) in `sources` order, each with the window's points for the
    current scope; they wrap at 390 px. A hidden type leaves the cells, totals, tooltip and summary.
    All hidden: the grid stays with the note "All activity types are hidden."
  - Tooltip: `2026-11-13: 12 points — 9 flashcard reviews, 15 minutes of reading`; in the combined
    scope it adds `· 中文 8, 日本語 4` (workspace names from the workspaces store).
  - The aria-label (window summary) names the scope: "Learning activity in all workspaces for the last
    13 weeks: …".
- `LOG_CHANGING_TYPES` follows the manifests (SDK design), so a new plugin's type refreshes the heatmap.

## Rulings

- Ruling: UTC days stay — the session receipts, reading time and the old heatmap all use UTC, and local
  days need a time-zone parameter plus finer SQL buckets — cost if wrong: a later `tz` parameter and a
  migration of the folding; the response format can stay.
- Ruling: one combined fetch, client-side folding and filtering — chips and scope switch instantly and
  the response is at most 91 × workspaces × types small rows — cost if wrong: a `workspace` query is
  already supported by the endpoint for Android.
- Ruling: chips per activity type, not per plugin — a plugin may contribute several types, and the type
  is what the user recognises ("Reading") — cost if wrong: grouping chips by `plugin` in the UI.
- Ruling: a disabled plugin's activity still counts and its chip shows — disabling hides a feature, not
  the user's history; the chip lets them hide it — cost if wrong: one filter in `ActivityRules`.
- Ruling: the scope and hidden types are stored per user in `qinqin-core` plugin data — the owner chose
  server-side per-user storage for the home layout, and Android gets it through sync — cost if wrong:
  one key to drop.
- Ruling: the combined view is opt-in on the heatmap only, default "This workspace" — the stats design
  decided "Stats are for the active workspace only"; the issue asks for a combined heatmap, so the
  default keeps the owner's decision and the switch answers the issue — cost if wrong: flip the default.
- Ruling: tooltips switch to the rules' own wording ("15 minutes of reading" instead of "3 Reading (15
  min)") — the old form special-cased `read` in code — cost if wrong: a template field.
- Ruling: no cache or rollup until the pinned test fails — YAGNI; indexed SQL over 91 days is expected
  well under the bound — cost if wrong: Approach 3 behind the same endpoint.
- Ruling: source order is fixed (built-ins in `Builtin()` order, then by id), not the user's plugin
  order — keeps today's "reviews, reading, journal" wording and stable tooltips — cost if wrong: sort
  by `ListFor` instead.
- Ruling: `pointsPer` is a whole number and the SQL divides as real — removes the integer-division trap
  the builder check found — cost if wrong: none for the built-in rules (300).
- Ruling: span cap 366 days — bounds a request's cost while allowing a yearly view later — cost if
  wrong: a constant.

## Tests and verification

- Go: rule validation table (kinds, combinations, bounds, `{n}`), each kind's SQL (old TS vectors ported:
  read 29/30/300/301/7200/9000 s and a string; journal repeat entry same day, null id, next day),
  workspace filter, foreign workspace 404, date errors, the oracle test, the large-log test and benchmark,
  `ActivityRules` ordering and the disabled-plugin case.
- Web: `foldActivity` (scopes, hidden, empty, window edges, unknown types ignored), `describe`,
  `dayTooltip`, `windowSummary`, `viewPrefs` parsing, the heatmap's fetch through a mocked client.
- Real app at 1280 and 390 px, light and dark: a zh and a ja workspace with reviews, reading and a
  journal entry; switch scope, toggle chips, reload and see the view kept, open a second browser context
  for the same user and see it there; keyboard through the switch and chips; the network panel shows
  one `/api/stats/activity` request and no `/api/events` from the heatmap.

## Left to the builder

The exact chip styling (reuse the search-filter chip look); query helper structure inside `stats`; the
oracle generator's seed. Open: local-time days and a yearly view are follow-ups, not this issue.

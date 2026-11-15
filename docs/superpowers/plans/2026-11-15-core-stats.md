# Core Activity Statistics (issue #48) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The owner always runs plans subagent-driven, but they must say "start" before anyone dispatches an implementer.

**Goal:** Plugins contribute heatmap activity through declarative rules in their manifests; the server aggregates by UTC day × workspace × type at `GET /api/stats/activity`; the heatmap gets type filter chips and a "This workspace / All workspaces" switch remembered per user.

**Architecture:** `plugins.ActivityRule` types the `activity` object of manifest `events` entries (#39 accepted it opaque). New package `server/internal/stats` runs one indexed `GROUP BY` per rule. The web fetches the combined grain once and folds it per scope and filter in `lib/activity/activity.ts`; view prefs live in `qinqin-core` plugin data through the SDK.

**Tech Stack:** Go 1.26 (stdlib, modernc SQLite JSON1), SvelteKit 2 + Svelte 5 runes, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-15-core-stats-design.md` (binding, incl. Rulings) and its base `2026-11-15-plugin-sdk-design.md`.

**Prerequisite:** the plugin-SDK plan (`2026-11-15-plugin-sdk.md`) is complete on `feature/plugin-sdk`. This plan continues on the same branch and worktree `<wt>` = `/home/user/www/github/qinqin/.claude/worktrees/plugin-sdk` (one branch for the owner to test; spec Approach 1 needs both). Ledger: `<wt>/.superpowers/sdd/2026-11-15-core-stats/progress.md`.

## Gates

Same as the SDK plan: web `npm --prefix <wt>/apps/web run check`, `npm --prefix <wt>/apps/web test`, `npm --prefix <wt>/apps/web run build`; Go `docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e GOPATH=/tmp/gopath -e GOCACHE=/tmp/gocache -v <wt>:/src -w /src/server -e GOTOOLCHAIN=auto -e GOFLAGS=-buildvcs=false golang:1.26 sh -c "go vet ./... && go test ./..."`; race for `./internal/stats/... ./internal/plugins/... ./internal/api/...`. Each task: gates green, one commit ending with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, explicit `git add`. Never merge or push.

## Global Constraints

- Scores for `review`, `read`, `journal` equal today's `ACTIVITY_SOURCES` (read: 30 s floor, 300 s per point, 7200 s cap per event; journal: one per `entryId` per UTC day).
- Days are UTC; `substr(ts,1,10)` is the day (timestamps are stored as UTC RFC 3339 by `events.Append`).
- Endpoint limits: span ≤ 366 days; default window = today UTC and the 90 days before (91 days, like `windowStart`).
- Rule validation values: field `^[A-Za-z][A-Za-z0-9_]*$`; `measure.unit` = `"seconds"`; `0 ≤ min < max ≤ 86400`; `pointsPer` whole number ≥ 1, only with `measure`; `measure` and `distinctBy` exclusive; `label` 1..40; `describe.one`/`describe.other` contain `{n}`.
- Source order: built-ins in `plugins.Builtin()` order, then other plugins by id, manifest order inside. A disabled plugin's sources still count.
- View prefs: `qinqin-core` user-global key `activity-view`, value `{"version":1,"scope":"workspace"|"all","hidden":[...]}`; default `{scope:'workspace', hidden:[]}`.

## Review Focus

1. **Integer division in SQL.** `{"seconds":301}` with `pointsPer` 300 must score 2. Pinned in Task 3 (`TestActivityMeasure` vector 301).
2. **Malformed payloads in the log** (`null`, `"x"`, `{"seconds":"300"}`, `{"entryId":5}`, invalid JSON text inserted by hand) must count 0 and never fail the request. Pinned in Task 3 (`TestActivityBadPayloads`, a raw-SQL insert of `not json`).
3. **Large logs.** 400k events must not make the endpoint slow, and the planner must use the new index. Pinned in Task 4.
4. **No workspace selected / a deleted workspace in the cells.** The heatmap must show the combined view, and cells of a workspace no longer in the store must still count with a fallback name (`Workspace 7`). Pinned in Task 5 (`foldActivity` and `dayTooltip` cases) and Task 7 (real app).
5. **Two devices editing the view.** Last write wins, no error; a corrupt stored value reads as the default. Pinned in Task 6 (`parseActivityView` cases).

---

### Task 1: Typed activity rules and the migrated built-in rules

**Files:**
- Create: `server/internal/plugins/activity.go`, `server/internal/plugins/activity_test.go`
- Modify: `server/internal/plugins/manifest.go` (`EventDecl.Activity *ActivityRule`, validated in `ParseManifest`), `server/internal/plugins/builtin/{flashcards,reader,journal}.json` (add the spec's three rules; version stays `1.1`), `apps/web/src/lib/plugins/contract.ts` (`EventDecl.activity?: ActivityRule` TS mirror)

**Interfaces:**
- Produces:
  ```go
  type Plural struct { One, Other string }                          // json one, other
  type Measure struct { Field, Unit string; Min, Max float64 }      // json field, unit, min, max
  type ActivityRule struct {
      Label string; Describe Plural; Measure *Measure; PointsPer int64; DistinctBy string
  }                                                                  // json label, describe, measure, pointsPer, distinctBy
  type Kind string; const (KindCount Kind = "count"; KindDistinct = "distinct"; KindMeasure = "measure")
  func (r ActivityRule) Kind() Kind
  ```
- TS: `interface ActivityRule { label: string; describe: { one: string; other: string }; measure?: { field: string; unit: 'seconds'; min: number; max: number }; pointsPer?: number; distinctBy?: string }`.

- [ ] **Step 1: Failing tests** `TestParseManifestActivity`: the three spec rules parse with kinds count/measure/distinct; errors (fragment asserted): `label` empty or 41 chars; `describe.one` without `{n}`; `measure` with `distinctBy` → `measure and distinctBy are exclusive`; `pointsPer` without `measure`; `measure` without `pointsPer`; `pointsPer: 0`; `pointsPer: 2.5` (decode error names the field); `unit: "minutes"`; `min: 40, max: 30`; `max: 90000`; field `"1x"`; unknown field inside `activity`. `TestBuiltinManifestsValid` (from the SDK plan) also asserts the three rules equal the spec values.
- [ ] **Step 2: Run the Go gate**: FAIL. **Step 3: Implement** (strict decoding applies inside `activity` too). **Step 4: Go and web gates**: PASS.
- [ ] **Step 5: Commit** `feat(plugins): activity rules in plugin manifests`.

### Task 2: `plugins.ActivityRules`

**Files:** Modify `server/internal/plugins/activity.go`; test `activity_test.go`.

**Interfaces:** Produces `type RuleOf struct { Plugin, Type string; Rule ActivityRule }` and `func ActivityRules(ctx context.Context, sqlDB *sql.DB) ([]RuleOf, error)` (no user argument: order and inclusion do not depend on user state).

- [ ] **Step 1: Failing tests:** with built-ins registered → `[review/qinqin-flashcards, read/qinqin-reader, journal/qinqin-journal]` exactly; an extra admin plugin `zz-grammar` with `grammar` and `aa-extra` with `drill` → appended as `drill`, `grammar` (by id); a grandfathered row and an unparsable row are skipped; an admin row also claiming `read` (inserted by SQL) does not produce a second `read`; disabling `qinqin-reader` for a user changes nothing.
- [ ] **Step 2: FAIL. Step 3: Implement** (read all registry rows, `ParseManifest`, order by `BuiltinIDs()` index then id). **Step 4: PASS. Step 5: Commit** `feat(plugins): activity rules of the registered plugins`.

### Task 3: `stats.Activity` — SQL per rule, with an oracle

**Files:** Create `server/internal/stats/activity.go`, `server/internal/stats/activity_test.go`, `server/internal/stats/oracle_test.go`.

**Interfaces:**
- Consumes: `plugins.RuleOf`, `events.Append`, `events.Since` (oracle only).
- Produces:
  ```go
  type Cell struct { Day string `json:"day"`; Workspace int64 `json:"workspace"`; Type string `json:"type"`; Points int64 `json:"points"`; Raw float64 `json:"raw"` }
  // from and to are UTC dates (00:00); the window is [from, to+1 day).
  func Activity(ctx context.Context, sqlDB *sql.DB, userID int64, from, to time.Time, workspace *int64, rules []plugins.RuleOf) ([]Cell, error)
  ```
  Result sorted by day, workspace, type; zero-point cells dropped; never nil.

- [ ] **Step 1: Failing tests** (events via `events.Append`, two workspaces, a second user whose events must never appear):
  - `TestActivityCount`: 3 reviews on 11-13 in ws 1, 1 in ws 2 → cells `(11-13,1,review,3,3)`, `(11-13,2,review,1,1)`.
  - `TestActivityMeasure` (ported from `activity.test.ts`): seconds 29 → none; 30 → 1 point raw 30; 300 → 1; 301 → 2; 7200 → 24 raw 7200; 9000 → 24 raw 7200; all on one day sum to points 52, raw 14731.
  - `TestActivityDistinct`: `{entryId:"A"}` twice on 11-13 and once on 11-14, `{entryId:"B"}` on 11-13, `{entryId:null}` and `{}` on 11-13 → 11-13 points 2, 11-14 points 1.
  - `TestActivityBadPayloads`: `null`, `"x"`, `{"seconds":"300"}`, `{"entryId":5}`, and a row inserted by SQL with payload `not json` → 0 points, no error.
  - `TestActivityWindowAndFilter`: events at `from` 00:00:00Z and at `to` 23:59:59Z count, one at `to+1` 00:00:00Z does not; `workspace` filter keeps only that workspace; unknown types ignored.
- [ ] **Step 2: Run**: FAIL.
- [ ] **Step 3: Implement.** One query per rule, args `user_id, type, from RFC 3339, to+1 day RFC 3339 [, workspace]`, `GROUP BY substr(ts,1,10), workspace_id`. Payload reads: `CASE WHEN json_valid(payload) THEN json_extract(payload, '$.' || ?) END` with `json_type(...)` checks (`'text'` for distinct; `'integer'`/`'real'` for measure). Measure points: `q = r * 1.0 / ?` with `CAST(q AS INTEGER) + (q > CAST(q AS INTEGER))`, `r = MIN(v, max)` and `v >= min`. Field names come from validated rules and are bound, never concatenated into SQL.
- [ ] **Step 4: Oracle test** `TestActivityMatchesOracle`: a `math/rand` (seed 48) log of 5,000 events over 120 days, 3 workspaces, the three types, 10 % malformed payloads; a plain Go reference over `events.Since` (decode payload, apply the spec's table) must equal `Activity` cell for cell, for both `workspace == nil` and one workspace, over a 91-day window inside the 120 days.
- [ ] **Step 5: Go gate and race**: PASS. **Step 6: Commit** `feat(stats): activity aggregation by day, workspace and type`.

### Task 4: Index migration and the large-log test

**Files:** Create `server/internal/db/migrations/026_study_events_type_index.sql`, `server/internal/db/migrate_026_test.go`, `server/internal/stats/large_test.go`.

- [ ] **Step 1: Failing tests:** `TestMigration026CreatesTypeIndex` (after `migrateThrough(sqlDB, "026_study_events_type_index")`, `PRAGMA index_list('study_events')` contains `idx_study_events_user_type_ts`); `TestActivityUsesTypeIndex`: for each built-in rule, `EXPLAIN QUERY PLAN` of the exact SQL `Activity` runs (export it in-package as `ruleQuery(rule, withWorkspace bool) string`) contains `idx_study_events_user_type_ts`, both with and without workspace.
- [ ] **Step 2: FAIL. Step 3:** write the migration (`CREATE INDEX IF NOT EXISTS idx_study_events_user_type_ts ON study_events (user_id, type, ts, workspace_id);` with a header comment naming the stats endpoint).
- [ ] **Step 4: Large-log test** `TestActivityLargeLog` (`if testing.Short() { t.Skip() }`): bulk insert by prepared statement in one transaction: user 1, 365 days ending today, per day 1,000 reviews, 80 reads (random 10–3,000 s), 15 journal events over 5 entry ids, split over 2 workspaces (≈400k rows); user 2 with 100k reviews. Time `Activity` for the last 91 days, all workspaces: assert < 2 s and `t.Logf` the duration. `BenchmarkActivity91Days` on the same data (seed once with `sync.Once`).
- [ ] **Step 5: Go gate** (not `-short`): PASS; write the logged time and `go test -run x -bench Activity91Days ./internal/stats` output into the ledger. If over 2 s, stop and report (the spec's fallback is a rollup table; that is a design change, not a fix).
- [ ] **Step 6: Commit** `perf(db): index study events by user, type and time for statistics`.

### Task 5: `GET /api/stats/activity`

**Files:** Create `server/internal/api/handlers_stats.go`, `server/internal/api/handlers_stats_test.go`; modify `server/internal/api/api.go` (route `GET /api/stats/activity`).

**Interfaces:** Response `{ from, to string; sources []sourceJSON; cells []stats.Cell }` with `sourceJSON{Type, Plugin, Label, Unit string; Describe plugins.Plural}` (json `type, plugin, label, unit, describe{one,other}`), `unit` = `"seconds"` for measure rules else `"count"`.

- [ ] **Step 1: Failing tests:** defaults (no params) → `from` = today − 90, `to` = today (UTC); explicit range; 400 for `from=2026-13-01`, `from > to`, span of 367 days (366 ok); 404 for another user's workspace; 401 without token; `sources` lists the three built-ins in order even with no events; a second user's events never appear; `cells` is `[]` not `null`.
- [ ] **Step 2: FAIL. Step 3: Implement** with `s.requireUser`, `s.workspaceOwned`, `plugins.ActivityRules`, `stats.Activity`. **Step 4: Go gate and race: PASS. Step 5: Commit** `feat(api): activity statistics endpoint`.

### Task 6: Web — fetch, fold, describe; view prefs

**Files:**
- Create: `apps/web/src/lib/api/stats.ts`, `apps/web/src/lib/api/stats.test.ts`, `apps/web/src/lib/activity/viewPrefs.ts`, `apps/web/src/lib/activity/viewPrefs.test.ts`
- Modify (rewrite): `apps/web/src/lib/activity/activity.ts`, `apps/web/src/lib/activity/activity.test.ts`; `apps/web/src/lib/stats/readingTime.ts` (+ test import) takes over `readingPoints`.

**Interfaces:**
- `stats.ts`: `interface ActivitySource { type: string; plugin: string; label: string; unit: 'count' | 'seconds'; describe: { one: string; other: string } }`, `interface ActivityCell { day: string; workspace: number; type: string; points: number; raw: number }`, `interface ActivityResponse { from: string; to: string; sources: ActivitySource[]; cells: ActivityCell[] }`, `fetchActivity(from: string, to: string): Promise<ActivityResponse>` (`/api/stats/activity?from=&to=`).
- `activity.ts`: keeps `HEATMAP_DAYS`, `windowStart`, `levelFor`; adds `dayKey(date: Date): string`; `interface ActivityView { workspace: number | null; hidden: readonly string[] }`; `interface DayActivity { day; total; bySource: Record<string, number>; raw: Record<string, number>; byWorkspace: Record<number, number> }`; `foldActivity(resp, view, now?: Date, days?: number): Map<string, DayActivity>`; `describe(source, raw): string`; `sourcePoints(map): Record<string, number>`; `dayTooltip(day, sources, workspaceName: (id: number) => string): string`; `windowSummary(map, sources, scope: 'workspace' | 'all'): string`. `ACTIVITY_SOURCES`, `activityByDay`, `sourceTotals` are deleted.
- `viewPrefs.ts`: `interface StoredActivityView { scope: 'workspace' | 'all'; hidden: string[] }`, `DEFAULT_ACTIVITY_VIEW`, `parseActivityView(v: unknown): StoredActivityView`, `loadActivityView(): Promise<StoredActivityView>` (errors → default), `saveActivityView(v): Promise<void>` (through `createPluginSdk(coreManifest).data.user()`, key `activity-view`, value with `version: 1`).

- [ ] **Step 1: Failing tests:**
  - `foldActivity`: 91 entries oldest first, empty days 0; scope workspace 3 keeps only ws 3; `workspace: null` sums all and fills `byWorkspace`; `hidden: ['read']` removes read from totals and `bySource`; unknown cell types (not in `sources`) ignored; cells outside the window ignored.
  - `describe`: count 1 → `1 flashcard review`, 2 → `2 flashcard reviews`; seconds 900 → `15 minutes of reading`, 20 → `1 minute of reading`.
  - `dayTooltip`: `2026-11-13: 12 points — 9 flashcard reviews, 15 minutes of reading`; combined adds ` · 中文 8, 日本語 4` (names from the callback; a callback returning `Workspace 7` for an unknown id is used verbatim); empty day → `2026-11-13: no activity`.
  - `windowSummary`: `Learning activity in this workspace for the last 13 weeks: 21 points — 2 flashcard reviews, 95 minutes of reading`; `all` → `in all workspaces`; empty → `…: no activity yet`.
  - `parseActivityView`: valid value round-trips; `null`, `'x'`, `{version:2}`, `{scope:'galaxy'}`, `hidden` with non-strings → default or the valid part (non-strings dropped).
  - `fetchActivity` builds the URL and returns the body.
  - `readingTime.test.ts` passes unchanged except its import path.
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: three web gates: PASS** (the heatmap still compiles because Task 7 is next: keep `ActivityHeatmap.svelte` compiling by switching it to `foldActivity` with a provisional `{ workspace, hidden: [] }` view in this task).
- [ ] **Step 5: Commit** `feat(web): fold server activity per scope and filter`.

### Task 7: Heatmap UI — scope switch, chips, live refresh

**Files:** Modify `apps/web/src/lib/components/ActivityHeatmap.svelte`, `apps/web/src/lib/widgets/core.ts` (description: "Learning activity per day over the last 13 weeks, per workspace or across all."). Pure helpers, if any, go in `lib/activity/heatmapState.ts` with tests (e.g. `effectiveScope(stored, hasWorkspace)` → `'all'` without a workspace; `toggleHidden(hidden, type)`).

- [ ] **Step 1: Failing tests** for the helpers above.
- [ ] **Step 2: Implement the component:** one `fetchActivity(dayKey(windowStart()), dayKey(now))` plus `loadActivityView()` on mount; refetch on `onEventLogChange` (unsubscribe on destroy) and on "Try again"; keep the request-sequence guard. Header: a radio group (native `<input type="radio">` pair, label "Show activity for", options "This workspace" / "All workspaces"; "This workspace" disabled without a workspace). Chips: `<button aria-pressed>` per source with `label` and `sourcePoints` for the current scope, wrapping; reuse the chip styling of the search filters (`routes/search/+page.svelte`). All hidden → note "All activity types are hidden." Changes save through `saveActivityView` (optimistic; failure → `console.warn`). Tooltips and aria-label from Task 6. Remove the `/api/events` read and the old no-workspace state.
- [ ] **Step 3: Three web gates: PASS. Step 4: Commit** `feat(web): heatmap filters by activity type and shows all workspaces`.

### Task 8: Real-app check, docs, issue hand-over

**Files:** Modify `docs/ROADMAP.md` (#48 line: "in progress on `feature/plugin-sdk`"), `README.md` (heatmap: filters, combined view; plugins contribute activity through `events[].activity`), fixes found (each with its own test and commit).

- [ ] **Step 1:** `docker build -t qinqin:core-stats --build-arg WITH_OCR=0 <wt>`; run it on port 8087 with a fresh `<scratch>/stats-data` volume, seed, add `tester` (as in the SDK plan's Task 8). Create a zh and a ja workspace. Post events through `POST /api/events/batch` with the tester token: over the last 20 days, reviews in both, `read` events (40, 300, 1,900 s) in zh, two journal events for one entry id on one day in ja.
- [ ] **Step 2: Browser (the `run` skill), 1280 and 390 px, light and dark:** home heatmap: per-workspace cells match the posted data (tooltip of a known day reads exactly as computed by hand); switch to All workspaces → sums and the workspace line in the tooltip; hide Reading → cells and the total drop; reload → view kept; a second browser context for the same user shows the same view; no workspace selected (clear `qinqin.workspace` in localStorage) → All workspaces is selected and "This workspace" disabled; Tab/Space/arrow keys work for the switch and chips; the network panel shows one `/api/stats/activity` and no `/api/events` from the heatmap; Stats → Overview shows the same widget.
- [ ] **Step 3: Load:** insert 400k events for the tester with the same distribution as Task 4 (a small Go program or `sqlite3` script against a copy of the volume is fine; do not ship it), restart, time `curl` of the endpoint (record in the ledger; expected well under 1 s) and check the home page renders without a visible delay.
- [ ] **Step 4:** remove the container, all gates on the tip, commit `docs: activity statistics in the README and roadmap`. Hand over with the finishing-a-development-branch menu; do not merge or push.

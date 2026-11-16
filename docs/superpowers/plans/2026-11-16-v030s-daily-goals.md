# Daily Goals (issue #67) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (fresh implementer
> per task or per few tasks, independent review on the strongest model, one fix wave, whole-branch review).
> Steps use checkbox (`- [ ]`) syntax. Strictly test-first: write the test, run it, see it FAIL, implement,
> see it PASS.

**Goal:** One daily goal per workspace (activity type, new cards or flashcard study time), its progress
derived from the event log by the learner's day, a progress ring on the home page and in the flashcards
widget, a goal-reached state, an optional vacation-neutral goal streak, and a pure "goal on day D" function
for the weekly summary (#81), pinned by contract fixtures.

**Architecture:** Pure modules in `apps/web/src/lib/goals/` — `goals.ts` (the `goals:workspace` row: parse,
goal in effect, edit plan), `amounts.ts` (per-day amounts from the local review log and from activity cells),
`progress.ts` (`goalDay`, `goalDays`, `goalStreak`), `goalText.ts` and `ring.ts` (words, aria text, arc
geometry), `goalForm.ts` (settings view model). `loadGoal.ts` is the only I/O: study history
(`loadStudyHistory`) plus one `GET /api/stats/activity?workspace=` window. Thin Svelte: `GoalRing.svelte`,
core widget `DailyGoalWidget.svelte`, a ring in `FlashcardsWidget.svelte`, `GoalSettings.svelte` in Settings →
Study. Plugin data only; **no server change, no new route, no migration**.

**Tech stack:** SvelteKit 2 / Svelte 5, vitest (unit + jsdom). No new dependencies.

**Spec (binding, incl. Rulings):** `docs/superpowers/specs/2026-11-16-v030s-daily-goals-design.md`.

**Branch / worktree:** `feature/v030s-daily-goals` at `/home/user/qinqin/.claude/worktrees/daily-goals`
(`<wt>`), cut from `feature/v0.3.0-stretch`. The orchestrator merges and pushes; never push.

## Gates

- Web (read exit codes, never behind `| tail`): `npm --prefix <wt>/apps/web ci` once; per task the targeted
  `cd <wt>/apps/web && npx vitest run <paths>` (fail first, then pass), then `npm --prefix <wt>/apps/web run check`
  and `npm --prefix <wt>/apps/web test`; `run build` in Tasks 7, 9–11 and 13.
- Go: no Go change. ONE full Go gate before the last commit (the web build is embedded):
  `cd <wt>/server && flock /tmp/qinqin-go.lock env GOTOOLCHAIN=auto GOFLAGS=-buildvcs=false sh -c 'gofmt -l . ; go vet ./... && go test -count=1 -p 2 -timeout 30m ./...'`
  (`gofmt -l` prints nothing).
- Node 26 full vitest once before the last commit:
  `cd <wt>/apps/web && PATH=/home/user/qq-tools/node-v26.13.1-linux-x64/bin:$PATH npx vitest run`.
- No new route, so the route-walk, the PWA route fixture and `docs/wiki/API-Routes.md` stay as they are; if a
  reviewer asks for a route, stop and re-plan (that is a spec change).
- One commit per task, explicit `git add <files>`, conventional message ending with a blank line and exactly
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `git status` clean after each commit.

## Global constraints

- Row: `goals:workspace`, plugin `qinqin-flashcards`, workspace-scoped (never user-global), `version: 1`,
  `showStreak` boolean (default true), `history: GoalEntry[]` ascending by `from`, at most 400 entries.
- Metric strings: `activity:<type>` (type non-empty, at most 64 chars), `flashcards:new`,
  `flashcards:studyTime`. Targets: integers, counts 1…9999, minutes 1…1440; `metric: null` ⇔ `target: null`.
- Day = the learner's day (`StudyDay.dayOf`); never the study clock; never `new Date().toISOString()` dates.
- Status order: `none` → `vacation` → `met` → `open` (today) / `missed` (past). Vacation is checked before the
  amount. Days after today throw.
- Study time per review: `min(durationMs, 60_000)`, absent or invalid = 0; only valid reviews (grade 1…4, valid
  `ts`, non-empty `cardId`).
- Progress is never stored; nothing writes amounts or statuses.

## Review Focus

1. **Day bucketing**: local amounts and server cells agree on the learner's date (Tokyo 23:30, a DST day) —
   Tasks 1, 3.
2. **History semantics**: target changes never alter earlier days; same-day edits collapse; unknown keys and
   newer versions survive — Tasks 2, 11.
3. **Vacation neutrality** in `goalDay` and `goalStreak` exactly like `dailyStreak` — Task 4.
4. **Ring accessibility**: progressbar role and values, visible text equal to `aria-valuetext`, reached state
   not colour-only, reduced motion — Task 7.
5. **Workspace isolation**: the row is written with the current workspace only; activity cells of other
   workspaces are ignored; the loader re-runs on workspace switch and drops stale answers — Tasks 3, 5, 8.
6. **No change without a goal**: the flashcards widget renders exactly as before when no row exists — Task 10.

---

### Task 1: Goal contract fixtures

**Files:** Create `docs/contracts/goals/README.md`,
`docs/contracts/goals/{goal-rows,goal-amounts,goal-days,goal-streak}.json`; modify `docs/contracts/README.md`
(folder row: `goals/` with fixtures and web tests `lib/goals/{goals,amounts,progress}.test.ts`),
`docs/contracts/overview.md` (row-key table row `goals:workspace`; "Study rules (links)" gains goals; the
"Cards and study" layer lists `goals/`).

- [ ] **Step 1:** Write the README: metrics and their amounts, units and ranges, the history rule (goal of D =
  last entry with `from ≤ D`), edit plan, status table, streak rule and window, unavailable types, the 60 s cap,
  "never stored", Android notes (read `goals:workspace` with `limits:*`; use `GET /api/stats/activity?workspace=`
  for `activity:*`; local log for `flashcards:*`).
- [ ] **Step 2:** Hand-write the four fixtures in the `{"version":1,"rule":"goals/<name>","cases":[…]}` format,
  every case of the spec's fixture list. Values derived by hand from the rules (each case has a `note` when the
  derivation is not obvious); zones `UTC`, `Asia/Tokyo`, `Europe/Berlin` (DST 2026-03-29). Case shapes:
  - `goal-rows`: `{name, op: "parse", key, raw, expect: GoalsRow | null | "newer"}` and
    `{name, op: "edit", today, row: raw | null, edit: {metric, target} | null | {showStreak}, expect: raw | null}`
    (`null` = no write).
  - `goal-amounts`: `{name, op: "flashcards", zone, reviews: [{id, ts, cardId, grade, durationMs?}], expect:
    {"<day>": {newCards, studySeconds}}}` and `{name, op: "activity", workspace, cells, expect:
    {"<day>": {"<type>": raw}}}`.
  - `goal-days`: `{name, today, row, units: {"<type>": "count"|"seconds"}, vacation: Run[], days: {"<day>":
    DayAmounts}, expect: [{day, status, metric, target, amount}]}`.
  - `goal-streak`: same inputs plus `windowStart`, `expect: {current, todayMet, capped}`.
- [ ] **Step 3:** `python3 -m json.tool` each file (exit 0). Commit `docs(contracts): daily goal fixtures`.

### Task 2: `goals.ts` — the row

**Files:** Create `apps/web/src/lib/goals/goals.ts`, `apps/web/src/lib/goals/goals.test.ts`.

**Interfaces:**
```ts
export const GOALS_KEY = 'goals:workspace';
export const MAX_GOAL_ENTRIES = 400;
export type GoalMetric = `activity:${string}` | 'flashcards:new' | 'flashcards:studyTime';
export interface GoalEntry { from: string; metric: GoalMetric | null; target: number | null; [key: string]: unknown }
export interface GoalsRow { version: 1; showStreak: boolean; history: GoalEntry[]; [key: string]: unknown }
export type ParsedGoals = GoalsRow | 'newer' | null;
export function isGoalMetric(value: unknown): value is GoalMetric
export function targetRange(metric: GoalMetric, unit: 'count' | 'seconds' | null): { min: 1; max: number; unit: 'count' | 'minutes' }
export function parseGoalsRow(raw: unknown): ParsedGoals
export function goalOn(row: GoalsRow | null, day: string): { metric: GoalMetric; target: number } | null
export type GoalEdit = { metric: GoalMetric; target: number } | null | { showStreak: boolean };
/** The row to write, or null when nothing changes. Throws on a 'newer' row. */
export function planGoalEdit(row: GoalsRow | null, edit: GoalEdit, today: string): GoalsRow | null
```

- [ ] **Step 1: Failing tests:** every `goal-rows.json` case (import the JSON); plus: an entry with
  `target` 0 / 10000 / 1.5 dropped; minutes range 1…1440 for `flashcards:studyTime`; unknown keys of the row
  and of entries round-trip; the 401st entry drops the oldest; `planGoalEdit` on `'newer'` throws.
- [ ] **Step 2:** Run `npx vitest run src/lib/goals/goals.test.ts` — FAIL (module missing).
- [ ] **Step 3:** Implement. **Step 4:** PASS; `run check`, `test`. **Step 5:** Commit `feat(goals): the daily goal row`.

### Task 3: `amounts.ts` — per-day amounts

**Files:** Create `apps/web/src/lib/goals/amounts.ts`, `amounts.test.ts`.

**Interfaces:**
```ts
export const MAX_REVIEW_MS = 60_000;
export interface DayAmounts { activity: Readonly<Record<string, number>>; newCards: number; studySeconds: number }
export const NO_AMOUNTS: DayAmounts;
/** New cards (first valid review per cardId) and capped answer time, per learner day. */
export function flashcardAmounts(reviews: readonly ReviewEvent[], dayOf: (ms: number) => string): Map<string, { newCards: number; studySeconds: number }>
/** The `raw` of each type per day for one workspace; other workspaces ignored. */
export function activityAmounts(cells: readonly ActivityCell[], workspaceId: number): Map<string, Record<string, number>>
export function amountsOf(flash: ReadonlyMap<string, { newCards: number; studySeconds: number }>, activity: ReadonlyMap<string, Record<string, number>>): (day: string) => DayAmounts
```
Reuse `isValidReview` / `sortedReviews` from `lib/study/scheduler.ts` (same validity and order as the limits).

- [ ] **Step 1: Failing tests:** `goal-amounts.json`; order independence (shuffled input, same map); a card
  first reviewed yesterday and again today adds 0 new today; `durationMs` −1, NaN, string → 0; fractional
  seconds kept (`studySeconds` is ms / 1000, not rounded).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + gates. **Step 5:** Commit `feat(goals): per-day amounts from the event log`.

### Task 4: `progress.ts` — goal day and goal streak

**Files:** Create `apps/web/src/lib/goals/progress.ts`, `progress.test.ts`.

**Interfaces:**
```ts
export type GoalStatus = 'none' | 'vacation' | 'met' | 'open' | 'missed';
export type UnitOf = (activityType: string) => 'count' | 'seconds' | null;   // null: not in sources
export interface GoalDay {
  day: string; status: GoalStatus;
  metric: GoalMetric | null; target: number | null;
  /** In display units: count, or whole minutes (floor). */
  amount: number;
  /** 0…1, capped; 0 for none/vacation. */
  fraction: number;
  unavailable: boolean;
}
export function goalDay(row: GoalsRow | null, day: string, today: string, amounts: DayAmounts, vacation: readonly Run[], unitOf: UnitOf): GoalDay
export function goalDays(row: GoalsRow | null, from: string, to: string, today: string, amountsOf: (day: string) => DayAmounts, vacation: readonly Run[], unitOf: UnitOf): GoalDay[]
export function goalStreak(row: GoalsRow | null, today: string, windowStart: string, amountsOf: (day: string) => DayAmounts, vacation: readonly Run[], unitOf: UnitOf): { current: number; todayMet: boolean; capped: boolean }
```
Use `addDays` from `lib/time/studyDay.ts` and `isVacationDay` from `lib/study/vacation.ts`.

- [ ] **Step 1: Failing tests:** `goal-days.json`, `goal-streak.json`; `goalDay` throws for `day > today`;
  `goalDays` with `from > to` is `[]`; a seconds target met at exactly `target × 60` s; `amount` floors 119 s to 1;
  a property test (seeded random histories): `goalStreak.current` equals a brute-force count over `goalDays`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + gates. **Step 5:** Commit `feat(goals): goal status per day and the goal streak`.

### Task 5: Store and activity client

**Files:** Modify `apps/web/src/lib/study/store.ts` (read the `goals:workspace` row of the current workspace
into `StudyData.goals: ParsedGoals` — raw kept for unknown keys; `saveGoals(row: GoalsRow)`; header comment
lists the row), `apps/web/src/lib/study/types.ts` (`StudyData.goals?`), `store.test.ts`;
`apps/web/src/lib/api/stats.ts` (`fetchActivity(from, to, workspace?: number)` adds `&workspace=`), its test
(create `apps/web/src/lib/api/stats.test.ts` if absent).

- [ ] **Step 1: Failing tests:** a pulled `goals:workspace` row of workspace 3 appears in workspace 3's data and
  not in workspace 4's; a user-global row with that key is ignored; a tombstoned row is absent; `saveGoals`
  PUTs `/api/plugins/qinqin-flashcards/data/goals%3Aworkspace?workspace=<current>` with the row verbatim
  (unknown keys included) and throws without a current workspace; `fetchActivity` URL with and without workspace.
- [ ] **Step 2:** FAIL. **Step 3:** Implement (invalidate the study data and history caches of the workspace
  after a save, as `saveWorkspaceLimits` callers do). **Step 4:** PASS + gates. **Step 5:** Commit `feat(goals): store the daily goal row`.

### Task 6: Words and ring geometry

**Files:** Create `apps/web/src/lib/goals/goalText.ts`, `goalText.test.ts`, `apps/web/src/lib/goals/ring.ts`,
`ring.test.ts`.

**Interfaces:**
```ts
export interface MetricOption { metric: GoalMetric; label: string; unit: 'count' | 'minutes' }
export function metricOptions(sources: readonly ActivitySource[]): MetricOption[]   // reviews, new, study time, then other sources by label
export function progressText(day: GoalDay, sources: readonly ActivitySource[]): string   // "32 of 50 flashcard reviews today"
export function shortText(day: GoalDay): string                                          // "32/50"
export function ariaText(day: GoalDay, sources: readonly ActivitySource[]): string       // "Goal reached: 62 of 50 …"
export function statusLine(day: GoalDay): string | null   // "Goal reached" | "On vacation — goal paused" | "This goal's activity is no longer counted" | null
export function streakText(s: { current: number; capped: boolean }): string             // "Goal streak: 4 days", "1 day", "365+ days"
export function ringArc(fraction: number, radius: number): { circumference: number; dashOffset: number }
```

- [ ] **Step 1: Failing tests:** plural from the target (`one` when target is 1), `{n}` replacement for every
  built-in source's `describe`, minutes wording for seconds sources, built-in texts for `flashcards:*`, a source
  missing from the list falls back to the type name; `ringArc` 0 → full offset, 1 and 1.4 → 0, NaN → full offset.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + gates. **Step 5:** Commit `feat(goals): goal texts and ring geometry`.

### Task 7: `GoalRing.svelte`

**Files:** Create `apps/web/src/lib/goals/GoalRing.svelte`, `GoalRing.dom.test.ts`.

**Props:** `{ day: GoalDay; sources: ActivitySource[]; size?: 'large' | 'small' }`.

- [ ] **Step 1: Failing dom tests:** `role="progressbar"` with `aria-valuemin` 0, `aria-valuemax` target,
  `aria-valuenow` capped at target, `aria-valuetext` equal to the visible text; the SVG is `aria-hidden`; met →
  visible "Goal reached" and a check mark, class `reached`; vacation, none and unavailable → no progressbar, the
  status line only; the stylesheet has a `prefers-reduced-motion: reduce` rule that removes the transition
  (assert on the component's style text); small size shows `shortText`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement (colours from existing theme tokens; check both themes reach 3:1
  for fill and track against the card background and note the token values in the commit body).
  **Step 4:** PASS + gates + `run build`. **Step 5:** Commit `feat(web): the goal progress ring`.

### Task 8: `loadGoal.ts` — one load for both widgets

**Files:** Create `apps/web/src/lib/goals/loadGoal.ts`, `loadGoal.test.ts`.

**Interfaces:**
```ts
export interface GoalView {
  row: GoalsRow | null; newer: boolean;
  today: GoalDay; streak: { current: number; todayMet: boolean; capped: boolean } | null;
  sources: ActivitySource[]; limitsNew: number | null;   // effective workspace new limit, for the hint
}
export function loadGoalStatus(workspaceId: number, opts?: { force?: boolean; now?: number }): Promise<GoalView>
```
Reads `loadStudyHistory(workspaceId)` (goals row, reviews, vacations, limits) and `fetchActivity(windowStart,
today, workspaceId)` with `windowStart = addDays(today, -365)` when a streak is shown, else `today`; vacation
runs via `vacationRuns(data.vacations, workspaceId, today)`; concurrent calls for the same
`(workspace, today, force)` share one promise; the promise is dropped when it settles.

- [ ] **Step 1: Failing tests** (mock `loadStudyHistory` and `fetchActivity`): two concurrent calls → one fetch
  each; `showStreak: false` asks only for today; no row → `today.status 'none'`, `streak null`; a 'newer' row →
  `newer: true`, status none; vacation run on today → `vacation`; the request carries the workspace id; a fetch
  error rejects (widgets show their error line).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + gates. **Step 5:** Commit `feat(goals): load a workspace's goal status`.

### Task 9: Home widget `daily-goal`

**Files:** Create `apps/web/src/lib/widgets/DailyGoalWidget.svelte`, `DailyGoalWidget.dom.test.ts`; modify
`apps/web/src/lib/widgets/core.ts` (register `{id: 'daily-goal', title: 'Daily goal', description: 'Today's
progress towards your daily goal and the goal streak.', owner: 'core', size: 'normal', surfaces: ['stats',
'home']}`), `layout.ts` (`DEFAULT_LAYOUT` = `['activity-heatmap', 'flashcards-summary', 'daily-goal']`),
`layout.test.ts`, `registry.test.ts`, `editor.test.ts` if it pins the default.

- [ ] **Step 1: Failing tests:** dom — no goal → "Set a daily goal" link to `/settings?tab=study`; a goal → ring +
  progress text + streak line (absent with `showStreak: false`); vacation → paused text; no workspace and error
  states through `WidgetCard`; reload on workspace switch ignores a stale answer (sequence guard, as the
  flashcards widget); layout — default contains `daily-goal`, a stored layout without it stays without it.
- [ ] **Step 2:** FAIL. **Step 3:** Implement (reload on `onContextStale`). **Step 4:** PASS + gates + `run build`.
  **Step 5:** Commit `feat(web): daily goal home widget`.

### Task 10: Ring in the flashcards widget

**Files:** Modify `apps/web/src/lib/plugins/flashcards/FlashcardsWidget.svelte`; create
`apps/web/src/lib/plugins/flashcards/FlashcardsWidget.dom.test.ts`.

- [ ] **Step 1: Failing dom tests:** with a goal the small ring and, when enabled, "Goal streak: N days" sit beside
  the review streak; without a goal the widget's text content equals today's (snapshot taken in this step before
  the change, from the same mocked data); a goal-load failure leaves the rest of the widget intact (no error
  banner for the whole widget, the ring is just absent).
- [ ] **Step 2:** FAIL. **Step 3:** Implement (call `loadGoalStatus`; the widget's own load is unchanged).
  **Step 4:** PASS + gates + `run build`. **Step 5:** Commit `feat(web): goal ring in the flashcards widget`.

### Task 11: Settings → Study: daily goal

**Files:** Create `apps/web/src/lib/settings/goalForm.ts`, `goalForm.test.ts`,
`apps/web/src/lib/settings/GoalSettings.svelte`, `GoalSettings.dom.test.ts`; modify `StudySettings.svelte`
(render `GoalSettings` above the vacation section), `StudySettings.dom.test.ts` (section present).

**Interfaces:**
```ts
export interface GoalFormState { metric: GoalMetric | ''; target: string; showStreak: boolean }
export function formFrom(row: GoalsRow | null, today: string): GoalFormState
export function validateForm(s: GoalFormState, options: readonly MetricOption[]): { edit: GoalEdit } | { error: string }
export function limitHint(s: GoalFormState, newLimit: number | null): string | null   // "Your daily new-card limit is 20; raise it to reach this goal"
```

- [ ] **Step 1: Failing tests:** unit — range errors per unit ("Enter a whole number of minutes from 1 to 1440"),
  empty metric = no goal, hint only for `flashcards:new` above a finite limit; dom — options list built from the
  activity sources (one request `from=to=today`), Save writes the planned row via `saveGoals`, Save with no change
  writes nothing ("No changes"), Remove goal appends a null entry, the streak checkbox toggles `showStreak`
  only, a 'newer' row disables the form with the note, the form re-reads after a workspace switch.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + gates + `run build`. **Step 5:** Commit `feat(web): daily goal settings`.

### Task 12: Wiki, README and contracts docs

**Files:** Create `docs/wiki/Daily-goals.md`; modify `docs/wiki/_Sidebar.md` (link it; the wiki test
requires every page in the sidebar), `docs/wiki/Home.md` (link), `docs/wiki/Settings-tour.md` (Study tab: daily
goal), `docs/wiki/Stats-and-heatmap.md` (widget table row "Daily goal"), `docs/wiki/Flashcards-decks-limits-vacation.md`
(goals and vacation, the new-card limit hint), `docs/wiki/Your-data.md` if it lists stored rows, `README.md`
(features list); re-check `docs/contracts/overview.md` and `README.md` rows from Task 1 against the code.

- [ ] **Step 1:** `npx vitest run src/lib/wikiDocs.test.ts` passes before (baseline), add the page and links, run
  again (PASS). The page explains: what can be a goal, units, learner's day, target changes apply from today,
  vacation pauses the goal and the streak, reviews in the offline outbox count once sent, where the ring shows.
- [ ] **Step 2:** gates. **Step 3:** Commit `docs: daily goals`.

### Task 13: Real-app check and final gates

- [ ] **Step 1: Real-app check (no browser).** Copy `<wt>` to a scratch dir (`rsync -a --exclude node_modules
  --exclude .git`), `npm --prefix <copy>/apps/web ci && run build`, build the server from `<copy>/server`
  (`go build -o <scratch>/qinqin ./cmd/...` under the Go lock), run it with a scratch data dir on a free
  `127.0.0.1` port (not 8080/8085/8300). With Python/curl: create the first user and log in; create two
  workspaces; `PUT /api/me/time-zone` `Asia/Tokyo`; `PUT /api/plugins/qinqin-flashcards/data/goals:workspace?workspace=<A>`
  with a two-entry history; `GET /api/sync/pull` shows it with `workspaceId: A` and nothing for B; post `review`
  events (one at 23:30 Tokyo yesterday, three today) and `read` events (600 s today) via `POST /api/events/batch`;
  `GET /api/stats/activity?from=<today-365>&to=<today>&workspace=<A>` returns the expected cells. Then a temporary
  vitest file in the copy only (`QINQIN_CHECK_URL=… npx vitest run src/realapp.check.test.ts`) fetches the row,
  events and cells and asserts with the pure modules: today `open` with 3 of 5 reviews, yesterday `met` under the
  old target, a reading goal of 10 minutes `met`, a vacation row on today → `vacation`, workspace B has no goal.
  A second user cannot read A's row (404 on `GET .../data/goals:workspace?workspace=<A>`). Never commit the file.
  Kill the server and delete the copy, the binary and the data dir.
- [ ] **Step 2:** Full web gates (`run check`, `test`, `run build`), Node 26 full vitest, ONE full Go gate.
  `git status` clean.
- [ ] **Step 3:** Fill the Execution record below. Commit `docs(goals): execution record`.

## Task dependencies

1 → 2 → 3 → 4 → (5, 6) → 7 → 8 → (9, 10, 11) → 12 → 13. Tasks 9–11 touch different files and may run in any
order after 8; one implementer at a time (shared web gates).

## Contract notes (for `docs/contracts/`)

- `goals/README.md` — the rule; `goal-rows.json` (Task 2), `goal-amounts.json` (Task 3), `goal-days.json`,
  `goal-streak.json` (Task 4). Web tests only; the server is unchanged.
- `overview.md` — row `goals:workspace` (workspace, `qinqin-flashcards`, owner `lib/goals/goals.ts`, pinned by
  `goals/goal-rows.json`).
- Android: read `goals:workspace` with the `limits:*` rows; amounts for `activity:*` from
  `GET /api/stats/activity?workspace=`; `flashcards:*` from the review log by the learner's day; vacation runs as
  in `scheduler/`.

## Execution record

Built 2026-11-16, one implementer inline (no subagent reviews: the orchestrator reviews the branch). Tasks
1–12 are one commit each, Task 13 is this commit. Baseline web suite before the branch: 305 files / 4848 tests.

**Test-first notes.** Every code task was run red first: Tasks 2, 3, 4, 6, 8 failed on the missing module;
Task 5 failed 5 of 6 new store/stats tests (the tombstone and user-global tests passed trivially, since nothing
read the row yet); Task 7 and 9 failed on the missing component (Task 9 also 5 layout/registry/editor
assertions); Task 10's "without a goal" snapshot was captured from the unchanged widget ("Nothing due today ·
Level 1 · 0 XP 🔥 0 days streak · study today to start one") and the three ring tests failed; Task 11 failed on
the missing modules plus the StudySettings section test. The hand-derived fixtures of Task 1 all passed against
the first implementation (no fixture was changed afterwards).

**Rulings and deviations.**

- Ruling: `saveGoals` PUTs `/api/plugins/qinqin-flashcards/data/goals:workspace?workspace=<id>` with a raw colon,
  not `goals%3Aworkspace` as the plan wrote — every other row (`limits:workspace`, `vacation:<id>`) is written
  that way and the server accepts it (real-app check) — cost if wrong: none known; one string to change.
- Ruling: parsing accepts an `activity:*` target 1..9999 whatever the source's unit (the unit is unknown while
  parsing); Settings enforces 1..1440 minutes for seconds sources; `flashcards:studyTime` is 1..1440 when parsing
  — cost: a row written by another client with 2000 reading minutes still shows (it just cannot be met).
- Ruling: a same-day edit that returns to the goal in effect yesterday removes today's entry instead of
  replacing it (spec: "replaces"), so editing back and forth leaves no trace; a replaced entry keeps its unknown
  keys — cost: none; pinned in `goal-rows.json`.
- `planGoalEdit` takes `ParsedGoals` (throws on `'newer'`, as the plan's comment says) and also throws on an
  invalid edit or an invalid `today`.
- Ruling: on a vacation day `amount` still reports what was done (fraction 0); `capped` is true when the walk
  passes `windowStart` without a break and the run is not empty; today `none` gives `current: 0` — the plan left
  these open — cost: #81 may want a different vacation amount; pinned in the fixtures.
- Ruling: `loadGoalStatus` makes no activity request without a usable row (none or `'newer'`; `sources` is then
  `[]`), and `streak` is null when today has no goal even with `showStreak` — the widget then offers "Set a daily
  goal" and needs nothing more — cost: none.
- `goalForm.ts` gained `planForm` (goal edit and streak switch planned into one write, "No changes" when null)
  and `rangeError`, so `GoalSettings.svelte` stays thin; a metric not offered is "Choose what to count", and
  Settings keeps a goal on a removed source selectable as "<type> (no longer counted)" so its streak switch can
  still be saved or the goal removed. The target field appears once a metric is chosen.
- `progressText` always ends with "today" (both rings show only today); #81 needs its own words for past days.
  `metricOptions` leaves "Flashcard reviews" out when no source has type `review`.
- Ring colours: the app has no theme custom properties, so the ring uses the app's fixed pair (fill `#0b6bcb` /
  dark `#6cb4ff`, track `currentColor` 50 %); contrast computed by hand (fill 5.3:1 / 8.6:1, track 3.9:1 / 5.3:1
  against white / `#121212`), not measured in a browser. The reduced-motion test reads the component's
  `<style>` source.
- The 400-entry fixture case was generated by a short script (mechanical entries); all other values are hand-written.
- The home widget description uses a typographic apostrophe ("Today’s"). The README and wiki also say the
  default home layout now ends with the daily goal.
- Real-app check: `rsync` is not installed, so the copy was made with `tar` (same excludes). Users were created
  with `qinqin adduser` (not the register route).

**Real-app check (Task 13, Step 1).** Scratch copy, `npm ci` + `run build`, build embedded into
`server/internal/webdist/dist`, `go build` under the Go lock, served on `127.0.0.1:18467`. Two users (alice,
bob); alice `PUT /api/me/time-zone` Asia/Tokyo, two workspaces A and B, a two-entry goal row on A (review 1 from
today−10, review 5 from today). `GET /api/sync/pull` showed the row once with `workspaceId: A`, none for B.
Events: one review at 23:30 Tokyo yesterday, three reviews at 00:10–00:12 Tokyo today (the previous UTC date)
with `durationMs` 90 000, one `read` of 600 s, one review in B. `GET /api/stats/activity?workspace=A` gave
yesterday review 1, today review 3 and read 600 (B's review absent), so the server buckets by the Tokyo date. A
temporary `src/realapp.check.test.ts` in the copy (never committed) asserted with the pure modules: today
`open` 3 of 5; yesterday `met` 1 of 1 under the old target; 3 new cards and 180 s study time today (60 s cap); a
10-minute reading goal `met` (10 minutes); after a `vacation:*` row on today, today is `vacation`; no goal for B.
bob `GET .../data/goals:workspace?workspace=A` → 404, no token → 401. Server killed; copy, binary and data dir
deleted.

**Final gates (Task 13, Step 2).** `npm run check` exit 0 (1107 files, 0 errors, 0 warnings); `npm test` exit 0,
315 files / 4956 tests; `npm run build` exit 0; Node 26.13.1 full vitest exit 0, 315 files / 4956 tests. One full
Go gate with proxy variables unset: `gofmt -l` printed nothing, `go vet ./...` passed, 35 packages ok, the only
failure is the known environment-only `internal/ai` `TestHostnameResolvingToEmbeddedFormIsRefused` (no IPv6
sockets here); exit 1 for that reason only. No Go code changed.

**Not verified.** Nothing was rendered in a real browser (no browser automation allowed): layout of the ring,
both themes, real contrast, screen-reader announcements and reduced motion were checked only through jsdom
tests and the style source. The midnight / zone-change reload (`onContextStale`) and offline behaviour (outbox
reviews counting for `flashcards:*`) were not exercised live. Backup export and restore of `goals:workspace`
rely on the generic plugin-row export (read in `server/internal/backup/export.go`, not run). No Android client
exists to run the fixtures. The DST case is covered by fixtures only, not against the server.

### Review fixes

One fix wave after the independent review; every item test-first (the new or changed test was run red before
the change, except where noted), one commit per finding or small group. Where a fix replaces an earlier entry
above, this section wins.

1. **Offline flashcards goals** (b131947, must-fix). `loadGoalStatus` requests the activity window only when a
   goal in effect inside `[windowStart, today]` has an `activity:*` metric (`metricsBetween` in `goals.ts`).
   A failed request no longer rejects: `flashcards:*` days are still computed, `activity:*` days are
   unavailable, and `GoalView.activityError` carries the message. Ruling: with `activityError` set and
   today's goal unavailable, the home widget shows its error line with Try again and the flashcards widget leaves
   the ring out, instead of the misleading "This goal's activity is no longer counted" — the spec's Offline
   rule says an activity goal shows an error line until the route answers — cost: none. The pinned rejection
   test was replaced; new tests cover a flashcards goal with a rejecting `fetchActivity` (no request made), an
   activity goal earlier in the window, and one that ended before the window. Contract README and wiki Offline
   text updated.
2. **Capped streak text** (889cb38, must-fix). "Goal streak: N+ days" with N = `current`; contract README,
   spec and wiki updated.
3. **Workspace of a save** (2bca6b9). `saveGoals(workspaceId, row)`; GoalSettings records the workspace it read
   the row from and refuses to write when the current workspace differs ("The workspace changed; check the
   goal again."). The store test now writes to workspace 3 while 4 is current.
4. **"Goal reached" in the small ring** (d8bdaa8), visible next to "62/50" and the check mark; dom tests in
   `GoalRing` and the flashcards widget.
5. **Zone history fixture** (8eae21f). `goal-amounts.json` gains a UTC → Asia/Tokyo (from 2026-11-16T03:00Z)
   case, hand-derived by the study-day rule; flashcards cases may carry `zones`.
6. **Home only** (7c9d70d). `daily-goal` surfaces are `['home']`; the Stats table row and the wiki's "also on
   Stats" line are gone; spec updated.
7. **Settings offline** (2bca6b9). The row and the activity list load independently; when the list fails the
   built-in manifests' sources (`goals/builtinSources.ts`, from `$builtin`) are offered with a note and Try again;
   a failed row load shows its error with Try again.
8. **Future entries** (9d38829): Ruling recorded in the contract README — an entry after today is kept (a device
   ahead), takes effect on its date; fixture case "an entry after today is kept" (this case passed on its first
   run: it pins the existing behaviour).
9. **Entries this client does not understand** (9d38829) stay out of the parsed history (a module `WeakMap` keyed
   by the parsed row remembers them) and are written back verbatim after the understood entries; the 400 cap
   counts understood entries only. Fixture case plus a `planForm` test through goal and streak changes. Cost if
   wrong: a row object rebuilt by hand (not by `parseGoalsRow`) loses them — only the store's parsed object is
   written.
10. **Wiki "no longer counted"** (in 7c9d70d). While doing it I found that `GET /api/stats/activity` lists the
    rules of every *registered* plugin whatever the user's own switch (`plugins.ActivityRules` reads
    `plugin_registry`), so the wiki says the text appears when a plugin is removed from the server or renames
    its type, not when a user switches it off.
11. **Canonical merge** (07eb9cf): `loadGoal.merge.test.ts` runs the real study history (sync pull, event log,
    `canonicalCards`) with a duplicated vocab card; one new card. It passed on its first run (the merge already
    happened in the store); its sensitivity was checked by un-duplicating the card in a throwaway copy, which
    failed (`met` instead of `open`).
12. **In-flight key by user** (07eb9cf): the shared promise's key starts with `outboxUser()`; test with two users.

Gates after the fix wave: `npm run check` exit 0 (1110 files, 0 errors, 0 warnings); `npm test` exit 0, 317
files / 4974 tests; `npm run build` exit 0; Node 26.13.1 full vitest exit 0, 317 files / 4974 tests. No Go
change in the fix wave, so the Go gate was not rerun (the earlier full run stands). The real-app check was not
repeated. Still not verified in a real browser: the offline paths (the outbox, a failing activity request) were
tested with mocks only.

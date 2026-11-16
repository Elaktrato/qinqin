# Weekly Summary (issue #81) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (fresh implementer
> per task or per few tasks, independent review on the strongest model, one fix wave, whole-branch review).
> Steps use checkbox (`- [ ]`) syntax. Strictly test-first: write the test, run it, see it FAIL, implement,
> see it PASS.

**Goal:** An in-app weekly summary, Monday to Sunday in the learner's local days, of one workspace: reviews,
new cards, study and reading time, journal entries, days active with a seven-day strip (vacation marked,
neutral), the streak, words reaching mature, characters learned, daily-goal days, each compared with the
previous week (same weekday for the week in progress); a Stats tab **Week** with previous weeks browsable (52
back) and a home widget. No email, no scheduler, nothing stored.

**Architecture:** Pure modules in `apps/web/src/lib/weekly/` — `week.ts` (week of a date, seven dates, windows,
URL normalisation), `replay.ts` (sample replay timelines, mature and character crossings), `summary.ts`
(rows, strip, comparison), `weekText.ts` (labels and accessible names), `loadWeek.ts` (the only I/O: cached
study history, one 14-day `GET /api/stats/activity?workspace=` per week, the character universe on the tab).
Two small additions to existing pure modules: `scheduleTimeline` / `scheduleAt` in `study/scheduler.ts` and
`masteryFromSchedules` in `study/mastery.ts`. Reuses `lib/goals/amounts.ts` (`flashcardAmounts`,
`activityAmounts`), `lib/goals/progress.ts` (`goalDays`), `study/exp.ts` (`dailyStreak`),
`stats/wordStates.ts` (`classifySchedule`), `study/charGroups.ts` (`cellStates`, `masteryGlyphs`),
`study/vacation.ts`, `time/studyDay.ts`. Thin Svelte: `WeekStrip.svelte`, `WeekSummary.svelte`,
`routes/stats/week/+page.svelte`, `widgets/WeeklySummaryWidget.svelte`. **No server change, no new route, no
migration, no new row key.**

**Tech stack:** SvelteKit 2 / Svelte 5, vitest (unit + jsdom). No new dependencies.

**Spec (binding, incl. Rulings):** `docs/superpowers/specs/2026-11-16-v030s-weekly-summary-design.md`.

**Branch / worktree:** `feature/v030s-weekly-summary` at `/home/user/qinqin/.claude/worktrees/weekly-summary`
(`<wt>`). **Before Task 1** the branch must contain #67 (daily goals, `lib/goals/`) and #75 (frequency decks,
`study/known.ts`): `git -C <wt> log --oneline` shows both merges (the orchestrator merges the collection branch
in); if `apps/web/src/lib/goals/progress.ts` is missing, stop and report. The orchestrator merges and pushes;
never push.

## Gates

- Web (read exit codes, never behind `| tail`): `npm --prefix <wt>/apps/web ci` once; per task the targeted
  `cd <wt>/apps/web && npx vitest run <paths>` (fail first, then pass), then `npm --prefix <wt>/apps/web run check`
  and `npm --prefix <wt>/apps/web test`; `run build` in Tasks 8–11 and 13.
- Go: no Go change. ONE full Go gate before the last commit (the web build is embedded):
  `cd <wt>/server && flock /tmp/qinqin-go.lock env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy -u NO_PROXY -u no_proxy GOTOOLCHAIN=auto GOFLAGS=-buildvcs=false sh -c 'gofmt -l . ; go vet ./... && go test -count=1 -p 2 -timeout 30m ./...'`
  (`gofmt -l` prints nothing; only `internal/ai` `TestHostnameResolvingToEmbeddedFormIsRefused` may fail, IPv6).
- Node 26 full vitest once before the last commit:
  `cd <wt>/apps/web && PATH=/home/user/qq-tools/node-v26.13.1-linux-x64/bin:$PATH npx vitest run`.
- No new route: the route-walk, the PWA route fixture and `docs/wiki/API-Routes.md` stay as they are. If a
  reviewer asks for a server route, stop and re-plan (spec change).
- One commit per task, explicit `git add <files>`, conventional message ending with a blank line and exactly
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `git status` clean after each commit.

## Global constraints

- Week = seven learner dates Monday…Sunday; `isoWeekday` from the civil date only; `addDays` for arithmetic;
  never `+ 7 × 86 400 000`, never `new Date().toISOString().slice(0, 10)`.
- "State at the end of day D" = replay prefix with `ts < dayStart(D + 1)`; "before the week" = end of `Mon − 1`.
- Scope: the current workspace; mature words over live vocab cards in at least one existing deck (decks view
  overall scope); characters over the language's universe, Han languages only.
- Vacation dates: never counted in days active or the goal line; totals keep their activity; the streak is
  `dailyStreak`'s.
- Current week: dates after today are `upcoming`, never counted; comparison window = previous week up to the
  same weekday. Completed week: the whole previous week.
- `MAX_WEEKS_BACK = 52`. Nothing is written anywhere (no plugin row, no localStorage).
- Definitions are reused, never copied: `classifySchedule`, `MASTERY_THRESHOLD`, `cellStates`, `flashcardAmounts`,
  `goalDays`, `dailyStreak`, `vacationRuns`.

## Review Focus

1. **Week math**: Monday start from civil dates, DST weeks, a mid-week zone change, the Apia skipped date, the
   year boundary, URL normalisation — Tasks 1, 2.
2. **Replay equivalence**: `scheduleTimeline`'s last element equals `scheduleFor`; `scheduleAt` at a cutoff
   equals `scheduleFor` over the prefix; `masteryForChars` unchanged after the refactor — Tasks 3, 4.
3. **Definitions not forked**: mature, learned, new cards, study time, reviews, streak come from the existing
   modules — Tasks 4–6.
4. **Vacation neutrality and the in-progress comparison** — Task 6.
5. **Workspace isolation and stale answers**: cells of other workspaces ignored, sequence guard on switch,
   `onContextStale` reload — Tasks 7, 9, 10.
6. **Offline partial render**: local rows present, activity rows "Not available offline" with Retry — Tasks 7, 9.
7. **Accessibility**: tablist, `<dl>`, strip names, not colour-only, heading focus/announce — Tasks 8, 9.

---

### Task 1: Weekly contract fixtures

**Files:** Create `docs/contracts/weekly/README.md`, `docs/contracts/weekly/week-of.json`,
`docs/contracts/weekly/week-summary.json`; modify `docs/contracts/README.md` (folder row `weekly/`, web tests
`lib/weekly/{week,summary}.test.ts`), `docs/contracts/overview.md` ("Study rules (links)" gains weekly; no
row-key table change — state that the summary stores nothing).

- [ ] **Step 1:** README: the week rule (copy the spec's "What is a week?" and its Rulings verbatim), the row
  table, mature and character crossings, the comparison windows, vacation and skipped-date rules, the 52-week
  cap, "never stored", Android notes (activity route with `workspace=` for 14 days; the local log for the rest;
  timelines from its own FSRS replay; fixtures give schedules so FSRS parameters do not matter).
- [ ] **Step 2:** `week-of.json` cases `{name, note, history, day, monday, dates[7], start, end}` and
  `{name, op: "normalize", today, param, expect}`: UTC; Europe/Berlin 2026-03-23 week (DST start Sunday) and
  2026-10-26 week (DST end Sunday 2026-10-25 lies in the previous week — include both 2026-10-19 and 2026-10-26);
  a history `Asia/Tokyo` from null, then `Europe/Berlin` from 2026-11-11T12:00:00Z (Wednesday); Pacific/Apia
  2011-12-26 week (2011-12-30 skipped: `dayStart(12-30) == dayStart(12-31)`); 2026-12-28 … 2027-01-03; a Sunday
  maps to the previous Monday. Normalise: empty → current Monday, `2026-11-18` → `2026-11-16`, future →
  current, 60 weeks back → today's Monday − 52 weeks, `garbage` → current. **Derive every instant with Python
  `zoneinfo` and the study-day rule** (a scratch script in the scratch dir, not committed) and cross-check one
  value per case by hand in the `note`.
- [ ] **Step 3:** `week-summary.json` cases `{name, note, history, now, week, language, vacation: Run[], cells,
  reviews: [{id, ts, cardId, grade, durationMs?}], cards: [{id, kind, entryId, written, deckIds}], decks: [id],
  timelines: {"<cardId>": [{ts, state, stability}]}, chars: [{c, v?}], goals: row | null, units, expect}` with
  `expect = {rows, days: [{date, state, active}], streak, mature, characters, goal, compare}`. Cases: completed
  week vs whole previous week; in-progress Wednesday vs Mon–Wed; vacation Tuesday with reviews (totals count,
  days active not, strip `vacation`); all-vacation week; mature crossed / already mature / lapsed mid-week /
  deleted card / card in no deck / reverse card ignored; character crossed via a variant form; character
  already learned; a non-Han language (characters `null`); skipped Apia date; first week ("nothing to compare");
  other workspace's cells ignored; a plugin source with a non-zero week; goal met/missed/none/vacation days.
- [ ] **Step 4:** `python3 -m json.tool` each file (exit 0). Commit `docs(contracts): weekly summary fixtures`.

### Task 2: `week.ts` — week math

**Files:** Create `apps/web/src/lib/weekly/week.ts`, `week.test.ts`.

**Interfaces:**
```ts
export const MAX_WEEKS_BACK = 52;
export function isoWeekday(day: string): 1 | 2 | 3 | 4 | 5 | 6 | 7
export function weekOf(day: string): string                      // the Monday
export function weekDates(monday: string): string[]              // 7 dates
export interface WeekWindow { monday: string; start: number; end: number }   // [start, end) epoch ms
export function weekWindow(monday: string, day: StudyDay): WeekWindow
export function isSkippedDate(date: string, day: StudyDay): boolean
export function normalizeWeekParam(param: string | null, today: string): string   // a Monday within the cap
export function oldestWeek(today: string): string
export function previousWeek(monday: string): string
export function nextWeek(monday: string, today: string): string | null   // null on the current week
```

- [ ] **Step 1: Failing tests:** every `week-of.json` case (build `studyDay(history)`); `weekOf` of each weekday of
  one week; `isoWeekday('2026-11-16') === 1`; `weekDates` across a month and a year end; `nextWeek` null on the
  current week; a property test over 2000 seeded dates 1970–2037: `isoWeekday(weekOf(d)) === 1` and
  `0 ≤ daysBetweenDates(weekOf(d), d) ≤ 6`.
- [ ] **Step 2:** `npx vitest run src/lib/weekly/week.test.ts` — FAIL (module missing).
- [ ] **Step 3:** Implement. **Step 4:** PASS; `run check`, `test`. **Step 5:** Commit `feat(weekly): week of a learner date`.

### Task 3: Replay timelines in `scheduler.ts`

**Files:** Modify `apps/web/src/lib/study/scheduler.ts`, `scheduler.test.ts`.

**Interfaces:**
```ts
export interface TimelinePoint { ts: number; schedule: Schedule }
/** The schedule after each valid review of the card, in replay order; [] when none. */
export function scheduleTimeline(cardId: string, reviews: readonly ReviewEvent[], w: readonly number[], clock: StudyClock): TimelinePoint[]
/** The schedule replayed from the reviews with ts < cutoff (the last point before it); null when none. */
export function scheduleAt(timeline: readonly TimelinePoint[], cutoffMs: number): Schedule | null
```
`scheduleFor` is rewritten to return `scheduleTimeline(...).at(-1)?.schedule ?? null` (one replay code path).

- [ ] **Step 1: Failing tests:** for seeded random histories (grades, ties on `ts` broken by id, invalid grades
  mixed in, a vacation clock): last timeline point equals `scheduleFor`; for every cutoff between reviews
  `scheduleAt(timeline, cutoff)` equals `scheduleFor` over the reviews with `ts < cutoff`; cutoff before the first
  review → null; equal `ts` at the cutoff is excluded. Existing scheduler tests unchanged.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + gates (the full web suite: every consumer of
  `scheduleFor`). **Step 5:** Commit `feat(study): schedule timelines for replay at an instant`.

### Task 4: `masteryFromSchedules` in `mastery.ts`

**Files:** Modify `apps/web/src/lib/study/mastery.ts`, `mastery.test.ts`.

**Interface:**
```ts
export function masteryFromSchedules(chars: readonly string[], cards: readonly StudyCard[],
  scheduleOf: (cardId: string) => Schedule | null): Map<string, CharMastery>
```
`masteryForChars` becomes `masteryFromSchedules(chars, cards, (id) => scheduleFor(id, byCard.get(id) ?? [], now, w, clock))`
with the existing per-card grouping kept (no extra replay).

- [ ] **Step 1: Failing tests:** `masteryFromSchedules` with given schedules: mean strength, `MASTERY_KINDS` only,
  a repeated glyph counts once per card, a card without schedule skipped; and equality with `masteryForChars` on
  the existing mastery fixtures. All existing `mastery`, `charGroups`, `levelMastery`, `characterMap` tests pass
  unchanged.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + gates. **Step 5:** Commit `refactor(study): character mastery from given schedules`.

### Task 5: `replay.ts` — crossings during a week

**Files:** Create `apps/web/src/lib/weekly/replay.ts`, `replay.test.ts`.

**Interfaces:**
```ts
export interface Timelines { of(cardId: string): readonly TimelinePoint[] }
/** One timeline per reviewed card; memoised per (reviews array, weights, clock) identity. */
export function timelinesFor(reviews: readonly ReviewEvent[], w: readonly number[], clock: StudyClock): Timelines
/** Fixture form: timelines given directly. */
export function givenTimelines(map: Record<string, { ts: string; state: number; stability: number }[]>): Timelines
/** Live vocab cards in an existing deck: not mature at `before`, mature at `after` (cutoffs in ms). */
export function wordsReachingMature(cards: readonly StudyCard[], deckIds: ReadonlySet<string>, t: Timelines, before: number, after: number): number
/** Universe cells learned at `after` and not at `before` (cellStates + MASTERY_THRESHOLD). */
export function charactersLearned(chars: readonly CharRow[], cards: readonly StudyCard[], t: Timelines, before: number, after: number): number
```

- [ ] **Step 1: Failing tests:** the mature and character cases of `week-summary.json` through `givenTimelines`;
  memoisation: two calls with the same inputs replay once (spy on `scheduleTimeline`), a new reviews array replays
  again; `wordsReachingMature` ignores reverse/cloze and tombstoned cards; `charactersLearned` equals
  `sectionStats(...).learned` difference when no cell drops (property test).
- [ ] **Step 2:** FAIL. **Step 3:** Implement (use `classifySchedule`, `masteryFromSchedules`, `cellStates`,
  `masteryGlyphs`). **Step 4:** PASS + gates. **Step 5:** Commit `feat(weekly): mature words and characters learned in a week`.

### Task 6: `summary.ts` — rows, strip, comparison

**Files:** Create `apps/web/src/lib/weekly/summary.ts`, `summary.test.ts`.

**Interfaces:**
```ts
export type DayState = 'active' | 'inactive' | 'vacation' | 'upcoming' | 'skipped';
export interface WeekDay { date: string; state: DayState; reviews: number | null; points: number | null }
export interface CountRow { key: 'reviews' | 'newCards' | 'studyTime' | 'reading' | 'journal' | `activity:${string}`;
  value: number | null;        // null = activity not available (offline)
  previous: number | null; unit: 'count' | 'seconds' }
export interface WeekSummary {
  monday: string; inProgress: boolean; compareThrough: string;   // last date of the comparison window
  rows: CountRow[]; days: WeekDay[];
  daysActive: { active: number; of: number; localOnly: boolean };
  streak: number; mature: number | null; characters: number | null;
  goal: { met: number; of: number } | null; allVacation: boolean; nothingToCompare: boolean;
}
export interface WeekInputs {
  monday: string; today: string; now: number; day: StudyDay; workspaceId: number;
  reviews: readonly ReviewEvent[]; vacation: readonly Run[];
  activity: { cells: readonly ActivityCell[]; sources: readonly ActivitySource[] } | null;   // null = offline
  goals: GoalsRow | null; mature?: (before: number, after: number) => number;
  characters?: (before: number, after: number) => number;
}
export function weekSummary(input: WeekInputs): WeekSummary
```

- [ ] **Step 1: Failing tests:** every `week-summary.json` case; `activity: null` → activity rows `value: null`,
  `daysActive.localOnly: true`, no comparison for those rows; a future `monday` throws; `compareThrough` is the
  previous week's Sunday for a completed week and the same weekday for the current one; a review on a vacation
  date counts in `newCards` and not in `daysActive`; rows for sources with a zero week are absent except the
  built-in five.
- [ ] **Step 2:** FAIL. **Step 3:** Implement (`flashcardAmounts`, `activityAmounts`, `goalDays`, `dailyStreak`,
  `isVacationDay`, `isSkippedDate`). **Step 4:** PASS + gates. **Step 5:** Commit `feat(weekly): the week's summary`.

### Task 7: `weekText.ts` and `loadWeek.ts`

**Files:** Create `apps/web/src/lib/weekly/weekText.ts`, `weekText.test.ts`, `apps/web/src/lib/weekly/loadWeek.ts`,
`loadWeek.test.ts`; modify `apps/web/src/lib/api/stats.ts` only if #67's `fetchActivity(from, to, workspace?)` is
absent (then stop: the dependency is missing).

**Interfaces:**
```ts
export function weekHeading(monday: string, today: string, locale?: string): string   // "This week (16–22 November 2026)"
export function compareText(value: number, previous: number, unit: 'count' | 'seconds'): string   // "12 more than last week"
export function rowLabel(row: CountRow, sources: readonly ActivitySource[]): string
export function rowValue(row: CountRow): string            // uses formatDuration for seconds; "Not available offline"
export function dayName(day: WeekDay, locale?: string): string   // "Monday 16 November: active, 42 reviews"
export function daysActiveText(d: WeekSummary['daysActive'], inProgress: boolean): string   // "3 of 3 days so far"

export interface WeekView { summary: WeekSummary; sources: ActivitySource[]; language: string | null; activityError: boolean }
export function loadWeek(workspaceId: number, monday: string, opts?: { force?: boolean; now?: number; characters?: boolean }): Promise<WeekView>
```
`loadWeek` reads `loadStudyHistory(workspaceId)`, `fetchActivity(previousWeek(monday), min(sunday, today), workspaceId)`
(a failure sets `activityError` and passes `activity: null`), and with `characters: true` and a Han language
`loadCharacterMapData`; the widget passes `characters: false` and no mature callback.

- [ ] **Step 1: Failing tests:** texts (singular/plural, "Same as last week", seconds as "1 h 5 min", the three
  headings, every day state's name, the date label never shifted by a zone: run with `TZ=Pacific/Kiritimati` and
  `TZ=America/Adak` via `process.env.TZ` in the test); loader (mocks): one activity request of 14 dates with the
  workspace id, clipped to today in the current week; activity rejection → `activityError: true`, local rows
  present; `characters: false` never calls `fetchCharacters`; a non-Han language never calls it.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + gates. **Step 5:** Commit `feat(weekly): week texts and loading`.

### Task 8: `WeekStrip.svelte` and `WeekSummary.svelte`

**Files:** Create `apps/web/src/lib/weekly/WeekStrip.svelte`, `WeekStrip.dom.test.ts`,
`apps/web/src/lib/weekly/WeekSummary.svelte`, `WeekSummary.dom.test.ts`.

**Props:** `WeekStrip {days: WeekDay[]}`; `WeekSummary {view: WeekView; compact?: boolean; onretry?: () => void}`.

- [ ] **Step 1: Failing dom tests:** strip is an `<ol>` of 7 `<li>` with visible weekday text and accessible names
  from `dayName`; vacation / upcoming / skipped carry a distinct text marker and class (not colour only); summary is
  a `<dl>` whose terms follow the row order; comparison text visible, arrows `aria-hidden`; offline rows show "Not
  available offline" and a Retry button calling `onretry`; `compact` shows reviews, new cards, study time (flashcards
  + reading), days active, streak and the strip only; "On vacation all week" and "In progress" labels; characters row absent when
  `characters` is null and "Counting characters…" while pending.
- [ ] **Step 2:** FAIL. **Step 3:** Implement (theme tokens; note the 3:1 checks in the commit body).
  **Step 4:** PASS + gates + `run build`. **Step 5:** Commit `feat(web): week summary components`.

### Task 9: Stats → Week tab

**Files:** Create `apps/web/src/routes/stats/week/+page.svelte`, `apps/web/src/routes/stats/week/page.dom.test.ts`;
modify `apps/web/src/lib/statsTabs.ts` (`'week'`, order Overview, Week, Characters), `statsTabs.test.ts`,
`apps/web/src/routes/stats/+layout.svelte` (panel label), `apps/web/src/lib/pageTitles.dom.test.ts` if it lists
stats titles.

- [ ] **Step 1: Failing tests:** tabs for Han and non-Han languages include Week; `activeStatsTab('/stats/week')`;
  page: `?week=` normalised with `replaceState` (non-Monday, future, too old, garbage); previous link to the
  previous Monday, next link absent on the current week and absent beyond; heading `h2` with `aria-live="polite"`;
  workspace switch re-loads and a stale answer is ignored; `onContextStale` re-loads; characters render after the
  rest.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + gates + `run build`. **Step 5:** Commit `feat(web): Stats week tab`.

### Task 10: Home widget `weekly-summary`

**Files:** Create `apps/web/src/lib/widgets/WeeklySummaryWidget.svelte`, `WeeklySummaryWidget.dom.test.ts`; modify
`apps/web/src/lib/widgets/core.ts` (`{id: 'weekly-summary', title: 'This week', description: 'This week so far
compared with last week, day by day.', owner: 'core', size: 'normal', surfaces: ['stats', 'home']}`),
`layout.ts` (`DEFAULT_LAYOUT` gains `'weekly-summary'` after `'daily-goal'`), `layout.test.ts`,
`registry.test.ts`, `editor.test.ts` if it pins the default.

- [ ] **Step 1: Failing tests:** compact summary of the current week with "See the week" linking to `/stats/week`;
  no workspace / loading / error states through `WidgetCard`; offline activity → the local rows and the Retry;
  never requests characters; sequence guard on workspace switch; default layout contains it, a stored layout
  without it stays without it.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + gates + `run build`. **Step 5:** Commit `feat(web): weekly summary home widget`.

### Task 11: Performance guard

**Files:** Create `apps/web/src/lib/weekly/perf.test.ts`.

- [ ] **Step 1:** A test with 5 000 cards and 50 000 seeded reviews: building timelines once and computing 53
  weekly summaries (current + 52 back) calls `scheduleTimeline` exactly once per reviewed card (spy) and stays
  under a generous wall-clock bound (10 s on CI hardware; the bound only catches an accidental per-week replay).
  Write it, run it against a deliberately per-week-replaying stub to SEE IT FAIL, then against the real code.
- [ ] **Step 2:** gates + `run build`. **Step 3:** Commit `test(weekly): one replay for every week`.

### Task 12: Wiki, README and contracts docs

**Files:** Create `docs/wiki/Weekly-summary.md`; modify `docs/wiki/_Sidebar.md` (link; the wiki test requires every
page in it), `docs/wiki/Home.md` (link), `docs/wiki/Stats-and-heatmap.md` (the Week tab, the widget table row "This
week"), `docs/wiki/Flashcards-decks-limits-vacation.md` (vacation days in the weekly summary),
`docs/wiki/Daily-goals.md` (goal days in the week), `README.md` (features list); re-check Task 1's contract rows
against the code.

- [ ] **Step 1:** `npx vitest run src/lib/wikiDocs.test.ts` baseline PASS, add the page and links, run again (PASS).
  The page explains: Monday–Sunday in your time zone, what each number means (mature = 21 days stability, learned
  character = score 80), the in-progress comparison, vacation days, 52 weeks back, offline behaviour, no email.
- [ ] **Step 2:** gates. **Step 3:** Commit `docs: weekly summary`.

### Task 13: Real-app check and final gates

- [ ] **Step 1: Real-app check (no browser).** Copy `<wt>` to a scratch dir (`rsync -a --exclude node_modules
  --exclude .git`), `npm --prefix <copy>/apps/web ci && run build`, build the server from `<copy>/server` under the Go
  lock, run it with a scratch data dir on a free `127.0.0.1` port (not 8080/8085/8300). With Python/curl: create the
  first user, log in, create workspaces A (zh) and B; `PUT /api/me/time-zone` `Europe/Berlin`; post `review` events
  for A on this week's Monday 23:30 Berlin and last week's Monday and Tuesday, `read` events (600 s) and a `journal`
  event via `POST /api/events/batch`; a review in B; a `vacation:*` row covering this week's Tuesday; then
  `GET /api/stats/activity?from=<prev Monday>&to=<today>&workspace=<A>`. A temporary vitest file in the copy only
  (`QINQIN_CHECK_URL=… npx vitest run src/realapp.check.test.ts`) fetches the events, rows and cells and asserts with
  the pure modules: the Monday 23:30 review on Monday (not Tuesday), reviews and comparison "same weekday" numbers,
  reading minutes, journal 1, Tuesday `vacation`, B's review absent. A second user's activity for A is 404. Never
  commit the file. Kill the server, delete the copy, the binary and the data dir.
- [ ] **Step 2:** Full web gates (`run check`, `test`, `run build`), Node 26 full vitest, ONE full Go gate.
  `git status` clean.
- [ ] **Step 3:** Fill the Execution record below. Commit `docs(weekly): execution record`.

## Task dependencies

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → (9, 10) → 11 → 12 → 13. Tasks 3 and 4 touch shared study modules: run the full web
suite in both. One implementer at a time (shared web gates).

## Contract notes (for `docs/contracts/`)

- `weekly/README.md` — the week rule, rows, crossings, comparison, vacation, cap; `week-of.json` (Task 2),
  `week-summary.json` (Tasks 5, 6). Web tests only; the server is unchanged.
- `overview.md` — "Study rules (links)" gains `weekly/`; no row key (nothing stored).
- Android: week of a learner date by civil date; activity route with `workspace=` for 14 dates; local review log for
  new cards, study time, streak; its own FSRS replay for mature and character crossings (fixtures give schedules).

## Execution record

Built 2026-11-16 in one session, inline (one implementer, no subagent review waves). Before Task 1 the
collection branch `feature/v0.3.0-stretch` (#67, #75, #77, #71) was merged in (`9d916e1`).

**Adaptations to the merged #67 code**

- `GoalView.activityError` is a string: `WeekView.activityError` is `string | null` (the message) rather than a
  boolean. `metricsBetween` was not needed: the week always asks the activity route (reviews, reading and journal
  rows), so there is no "only flashcards goals" shortcut.
- `progressText` always says "today": the week has its own past-day wording (`goalText`: "Daily goal met on 2 of 6
  days", "… so far" in the current week) and its own streak wording ("Study streak at the end of the week: N
  days"); the goal streak's capped "N+ days" is not used (the week shows the review streak, `dailyStreak`, which
  is not capped).
- The daily-goal widget is home-only and `DEFAULT_LAYOUT` ends with `daily-goal`: `weekly-summary` is appended
  after it and is on both surfaces (`['stats', 'home']`), as the spec says.
- `study/known.ts` is not used at all (the spec's "no known words row" ruling), so #68's later change to it
  cannot conflict.

**Deviations (as Rulings)**

- Ruling: `isoWeekday` counts civil days from a known Monday (`daysBetweenDates('1970-01-05', day)`) instead of
  `Date.UTC(...).getUTCDay()` — the `utcGuard` test forbids `Date.UTC(` outside `studyDay.ts` and the result is the
  same civil-date rule — cost: none.
- Ruling: a plugin activity row is shown when the week **or** its comparison window is non-zero — a source that
  dropped to 0 is worth showing — cost: a "0" row for a source unused this week (in the contract README).
- Ruling: today's open goal day is left out of the goal line until met (`of = met + missed`) — "1 of 2 days" on a
  Friday morning would read as a miss — cost: the denominator grows during the day (in the contract README).
- Ruling: the home widget's "study time" is flashcards + reading together; offline (reading unknown) it shows the
  flashcard time alone, marked "(flashcards only)", without a comparison (changed in the review fix wave; first
  built as "Not available offline") — cost: one label with two meanings, disambiguated by the marker.
- Ruling: the week heading is announced by `aria-live="polite"` and focus stays on the followed link
  (`data-sveltekit-keepfocus`); the heading does not take focus — moving focus would fight keepfocus, and the
  spec's two sentences conflict — cost: a screen-reader user hears the new heading instead of landing on it.
- Superseded in the review fix wave: the widget was first on both surfaces; it is now home-only (see below).
- Ruling: the Week tab exists whenever a workspace is chosen (Overview only without one) — the summary is per
  workspace — cost: none.
- Ruling: the current week links as `/stats/week` (no parameter); normalisation also replaces an explicit
  `?week=<current Monday>` by `/stats/week` (`weekRedirect`) — one URL per week — cost: none.
- Ruling: offline, `nothingToCompare` is judged on the local reviews only — the activity cells are unknown —
  cost: "Nothing last week to compare" can show offline for a week that had only reading.
- Interface changes against the plan: `loadWeek(…, {detail})` adds mature words (the plan's `characters` option
  became a separate `loadWeekCharacters(workspaceId, language, monday)` so the page renders the rest first);
  `WeekSummary` gained `today`, `mature`/`characters` are `{value, previous}` pairs (they are compared too),
  `WeekDay` keeps `points`; `weekCutoffs` (summary.ts) is shared by the summary and the character load;
  `summaryLines` (weekText.ts) holds the row list and comparison words so the components stay thin; `week.ts`
  gained `weekHref`, `weekRedirect`, `hasPreviousWeek`; `statsTabs.ts` gained `statsPanelLabel`.
- `replayStats.timelines` (a counter in `replay.ts`, like `studyDayStats`) replaces a spy on `scheduleTimeline`:
  vitest cannot spy on an ESM import inside another module.
- Task 3's tests are in a new `study/scheduleTimeline.test.ts`; `scheduler.test.ts` is unchanged.
- `week-of.json` cases carry `skipped[]` (the dates with an empty window); the `week-summary.json` shape is
  `{…, activity: {sources, cells} | null, goals, cards?, decks?, timelines?, chars?, expect}` and a key absent
  from `expect` is not checked (the replay cases check only `mature` and `characters`).
- Task 11 found a real cost: `weekSummary` ran `flashcardAmounts` and the active-day pass over the whole log for
  every week (~300 ms per week on 50 000 reviews, 20 s for 53 weeks). It is now memoised per (reviews array,
  study day) — both are cached objects — and the 53 weeks take about 2 s. The fix is in Task 11's commit.
- Task 5's commit was amended once, locally and before anything else was built on it, to fix a test-only type
  error `svelte-check` reported after the commit (`readonly TimelinePoint[]`); from then on every commit waited for
  `run check`.

**Test-first:** every task's tests were run before the code and seen to fail (module missing or the new function
absent; Task 9/10 also failed on the changed tab/layout/registry expectations). Task 11 was seen to fail against a
per-week replay (`timelinesFor([...reviews], …)`: 265 000 replays instead of 5 000), then against the real code on
the time bound (20 s, see above), then passed.

**Real-app check (Task 13)**, scratch copy built (`npm ci`, `run build`, web build copied into
`server/internal/webdist/dist`, `go build` under the lock), server on `127.0.0.1:18381` with a scratch data dir,
driven by Python: first user (bootstrap admin) and a second user (created by the admin), workspaces A and B (zh),
`PUT /api/me/time-zone` Europe/Berlin, reviews, a `read` (600 s) and a `journal` event via `POST /api/events/batch`,
a `vacation:*` row for Friday 2026-10-23. The Berlin DST-end week 2026-10-19 was used instead of "this week's
Monday" (today was itself a Monday, so "this week's Tuesday" was still in the future). A temporary
`src/realapp.check.test.ts` in the copy read the live responses (events, plugin rows, activity cells of both
windows, the zone history) and asserted with the pure modules: the review at 2026-10-19T22:30Z (Monday in UTC,
00:30 Tuesday in Berlin) is on Tuesday and Monday is inactive; the review at 2026-10-25T22:30Z (23:30 CET after the
change) is on Sunday and the one at 23:30Z is next week; reviews 3 vs 1, new cards 3 vs 1, study time 15 vs 5 s,
reading 600 s, journal 1, Friday `vacation`, days active 4 of 6, streak 1; no cell of workspace B and B's review
absent; the current week (Monday 2026-11-16) compares with last Monday only (1 vs 2 reviews; last Tuesday's review
left out). A second user's `GET /api/stats/activity?workspace=<A>` is 404, without a token 401. 3/3 passed. The
first journal event was posted with a numeric `entryId` and the server (correctly, the journal plugin sends a
string) did not count it; it was re-posted with a string id. The server was killed and the copy, binary, data dir
and scripts deleted.

**Final gates** (the record lists the exit codes): `npm --prefix apps/web run check` 0 (0 errors, 0 warnings),
`npm --prefix apps/web test` 0 (350 files, 5396 tests), `npm --prefix apps/web run build` 0, Node 26 full vitest 0
(350 files, 5396 tests), full Go gate (proxy variables unset, under the lock): `gofmt -l` printed nothing, `go vet ./...` passed, `go test` exit 1 with 37 packages ok and only `internal/ai` `TestHostnameResolvingToEmbeddedFormIsRefused` failing (no IPv6 sockets in this sandbox, the known environment failure); no Go code changed on this branch.

**Not verified:** no browser was used (house rule): the tab, the widget and the strip were checked in jsdom only,
so layout, the 3:1 contrast values (computed by hand from the colours, see the components commit) and the real
screen-reader announcement of the heading are unverified. `aria-live` on a heading inside SvelteKit navigation was
not tried with a screen reader. The week heading's exact range text depends on the browser's ICU (tests normalise
the spaces around the dash). The 10 s performance bound was measured locally only (about 2 s), not on CI hardware.
Characters learned against a live server was not exercised (no character data seeded in the scratch server; the
crossing logic is covered by the fixtures).

**Review fixes** (one fix wave after the independent review: no MUST-FIX, the scheduler refactor verified
equivalent by the reviewer's A/B harness; SHOULD 1–5 treated as blocking, NITs 6–10 done). First
`feature/v0.3.0-stretch` (now with #68 and #83) was merged in (`dbdad0f`). One conflict in
`docs/contracts/overview.md` (both sides edited the "Cards and study" and "Reader" rows; kept both). #68's
`study/known.ts` change and the stretch changes merged without touching `scheduler.ts` or `mastery.ts`; the
study, weekly, stats and goals tests (91 files, 1537 tests) passed after the merge. The merge commit's message
ends with git's "# Conflicts:" lines after the trailer (the `--no-edit` commit kept them); it was not amended
(no amending in the fix wave). Each fix was test-first (seen to fail, then pass):

1. Memo across a reloaded history (`ab8de93`): `timelinesFor` and the summary's per-day log pass were keyed on the
   history object, which `loadStudyHistory` replaces after its 8 s TTL, so the next week link replayed
   everything. Both are now keyed by `reviewsKey` (the count and an FNV-1a hash of each event's id, ts, card and
   grade; once per array), plus the weights and clock runs for the timelines; four entries each. The perf test now
   reloads an equal history and browses three more weeks with no replay and no log pass; the replay test covers
   new content, a merge moving a review to another card, other weights and another clock. Spec ruling corrected.
2. + 10. Week page (`2c0028e`): the heading names the week whose numbers are shown (`view.summary.monday`); while
   the next week loads the old summary stays dimmed with `aria-busy="true"`, and the live heading changes only
   with the new numbers. The page reloads on `onEventLogChange` and `onStudyWrite` for its workspace (or a
   user-global write). DOM tests for both.
3. Widget home-only (`996667f`): `surfaces: ['home']`, as the daily goal; wiki Weekly-summary and
   Stats-and-heatmap updated; registry test.
4. Characters offline (`76f5d47`): a failed character load leaves the row with "Not available offline", a line
   above the rows names what is missing (`offlineText`) and Retry loads again; wiki updated; weekText, component
   and page tests.
5. + 7. Days active (`405056d`): today joins the denominator only once it is active (new fixture case in
   `week-summary.json`, contract README). NIT 7 picked "document as intended": the in-progress comparison ends with
   the whole of `today − 7`, because activity cells are whole learner days (Ruling in the contract README and
   spec).
6. `scheduleFor` hot path (`e3b4a65`): `scheduleFor` and `scheduleTimeline` share one `replay`; `scheduleFor`
   formats only the last due (test: one `toISOString` call instead of one per review — 30 before). Benchmark
   (scratch, not committed: 5 000 cards × 10 reviews, `scheduleFor` per card, five runs, ms; noisy shared machine):
   before the weekly branch 267 252 226 172 174, after Task 3 226 215 213 204 203, after this fix 177 211 184 177
   176 — back to the pre-branch cost.
8. + 9. (`e9d8842`): offline widget study time "N min (flashcards only)"; the strip `<ol>` has
   `aria-label="Days of the week"`.

Fix-wave gates: `run check` 0 (0 errors, 0 warnings), `npm test` 0 (362 files, 5663 tests), `run build` 0, Node 26
full vitest 0 (362 files, 5663 tests). No Go file changed in the fix wave, so no Go run.

**Open items:** milestones (first 100 words, 1000 reviews, streak lengths, level completions; "shown once, then a
history list") are deferred by the spec's ruling and need a follow-up issue (a stored "last seen" row per user).


### Mutation check (orchestrator, after the fix wave)

Three mutants, each killed (then reverted):
- `weekOf` returns the Sunday before instead of the Monday: 35 tests fail.
- vacation days count towards days active: 4 tests fail.
- an inactive today counts against days active: 1 test fails.

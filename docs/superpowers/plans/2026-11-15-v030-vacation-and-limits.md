# Vacation Mode and Daily Limits (issues #88, #89) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (fresh implementer
> per task, independent review on the strongest model, one fix wave, whole-branch review). Steps use
> checkbox (`- [ ]`) syntax.

**Goal:** Vacation periods that freeze the SRS (study clock, nothing due, streak neutral, marks) and daily
new/review limits per workspace with per-deck overrides, on one shared predicate and admission rule with
contract fixtures; no change for anyone without a vacation.

**Architecture:** Pure modules in `apps/web/src/lib/study/`: `vacation.ts` (rows → runs, edit plans),
`studyClock.ts` (`v`, `v⁻¹`), `studyContext.ts` (`StudyContext` + `isDueNow`), `limits.ts` (rows, counts,
admission). Every scheduler consumer takes a **required** `StudyContext`, built in `history.ts` per load and
rebuilt when the date changes. UI: Settings → Study tab, study page banner, widget, study start, heatmap
marks, #90 deck settings. Plugin data only; no server change, no migration.

**Tech stack:** SvelteKit 2 / Svelte 5, ts-fsrs 5.4.2, vitest (unit + jsdom). No new dependencies.

**Spec (binding, incl. Rulings):** `docs/superpowers/specs/2026-11-15-v030-vacation-and-limits-design.md`;
base rule `2026-11-15-v030-study-day-design.md`.

**Branch / worktree:** `feature/v030-vacation-limits` from the current tip of `feature/v0.3.0`:
`git worktree add -b feature/v030-vacation-limits .claude/worktrees/v030-vacation-limits feature/v0.3.0`; `<wt>`.
The orchestrator may split it: `feature/v030-vacation` (Tasks 1–9, item 4) and `feature/v030-limits`
(Tasks 10–13, item 4b, cut after the vacation branch merged).

**Order in v0.3.0:** items 4 and 4b, after items 1–3b. **Requires** the whole study-day plan merged
(`studyDay.ts`, `zone.ts`, the contract test helper and `docs/contracts/README.md`). Task 12's per-deck control
requires #90 merged (else its fallback). If #57 and #65 merged, their queue code takes the context in Task 5.

## Gates

- Web: `npm --prefix <wt>/apps/web ci` once, then `run check`, `test`, `run build` per task; read exit codes.
- Go: no change; ONE full Go gate (docker command from `/home/user/qinqin-v030/AGENT-RULES.md`) before the
  last commit (embed build).
- `node scripts/contracts/gen-scheduler-fixtures.mjs --check` exits 0 from Task 1 on.
- One commit per task, explicit `git add`, message ends with a blank line and
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never merge or push.

## Global constraints

- `DAY = 86_400_000`; `v(t) = t − Σ clamp(t − aᵢ, 0, nᵢ·DAY)`; `v⁻¹` = the spec's algorithm; `fᵢ = max(v(tsᵢ),
  fᵢ₋₁)`; `due = v⁻¹(dueᵥ)`; `aᵢ = day.dayStart(Sᵢ)`.
- Due: vacation date → nothing; otherwise `due ≤ now` (unchanged instant rule).
- `StudyContext` is required in production code; `UTC_CONTEXT` (identity clock, UTC day, no vacation) is for
  tests only (a guard test greps `src/**` outside tests for `UTC_CONTEXT`).
- Rows: `vacation:<ULID>` user-global; `limits:workspace`, `limits:deck:<deckId>` workspace-scoped;
  `qinqin-flashcards`; `version: 1`; integers 0…9999; `null` = unlimited; defaults 20 / 200.
- Admission is skip-and-continue; continuing cards ignore daily counts but count toward the session cap.

## Review Focus

1. **No change without vacations.** Every existing scheduler, queue, preview and optimizer test passes
   unchanged after Tasks 4–6 (only signatures gain the context); a golden test compares `scheduleFor` with
   and without the identity clock over a synthetic log (Task 4).
2. **Vacation equivalence** (`vacation-schedule.json`, plain ts-fsrs oracle) — Task 4.
3. **Optimizer consistency** — `Step.t` equals replay `elapsed_days` (`optimizer-steps.json`) — Task 6.
4. **No past rewrite.** Start now with reviews today starts tomorrow; cancel refused once started;
   `createdDay` clamp (Tasks 2, 9).
5. **Strict multi-deck skip-and-continue**, re-shows never counted, reserve backfill admitted (Tasks 10–11).
6. **Stale contexts** after midnight or a zone change (Task 7).

---

### Task 1: Scheduler contract fixtures and generator

**Files:** Create `scripts/contracts/gen-scheduler-fixtures.mjs`, `docs/contracts/scheduler/README.md`,
`docs/contracts/scheduler/{vacation-days,study-clock,vacation-schedule,optimizer-steps,due-today,streak,daily-limits,limits-rows}.json`;
modify `docs/contracts/README.md`.

- [ ] **Step 1:** Hand-write `vacation-days.json`, `study-clock.json` (incl. a zone change inside a run),
  `due-today.json`, `streak.json`, `limits-rows.json`, `daily-limits.json` and the inside-run cases of
  `optimizer-steps.json`, covering every case listed in the spec's fixture section.
- [ ] **Step 2:** The generator imports `ts-fsrs` from `apps/web/node_modules`, replays fixed histories with
  plainly shifted `Date`s (no project code, no `v`), and writes `vacation-schedule.json` and the
  without-inside-run part of `optimizer-steps.json`; each case records `dueDayShift` (n or n − 1). `--check`
  diffs instead of writing. Commit `docs(contracts): scheduler, vacation and limit fixtures`.

### Task 2: `vacation.ts` — rows, runs, edit plans

**Files:** Create `apps/web/src/lib/study/vacation.ts`, `vacation.test.ts`.

**Interfaces:**
```ts
export const VACATION_PREFIX = 'vacation:';
export interface VacationPeriod { version: 1; id: string; start: string; end: string | null; scope: 'all' | { workspaces: number[] }; createdDay: string; createdAt: string }
export interface Run { start: string; end: string }
export function parseVacation(key: string, raw: unknown): VacationPeriod | null
export function vacationRuns(periods: readonly VacationPeriod[], workspaceId: number, today: string): Run[]
export function isVacationDay(runs: readonly Run[], day: string): boolean
export function currentVacation(runs: readonly Run[], today: string): Run | null
export type VacationWrite = { put: VacationPeriod } | { delete: string };
export interface Draft { start: string | 'now'; end: string | null; scope: VacationPeriod['scope'] }
export function planCreate(existing: readonly VacationPeriod[], draft: Draft, o: { today: string; now: Date; reviewedToday: (workspaceId: number | 'all') => boolean; newId: () => string }): { writes: VacationWrite[]; startsTomorrow: boolean } | { error: string }
export function planEndEarly(period: VacationPeriod, today: string): VacationWrite
export function planCancel(period: VacationPeriod, today: string): VacationWrite | { error: string }
```

- [ ] **Step 1: Failing tests:** `vacation-days.json` (imported JSON); errors (start before today, end
  before start, more than 366 dates, empty workspace list); start now → today without reviews today,
  tomorrow with; a plain draft → one put; a draft bridging two same-scope rows → one put (earliest row,
  union) + one delete; merging with an open row stays open; end early mid-run → `end = today − 1`; end early
  on or before its first day → delete; cancel of a started period → error.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** gates PASS. **Step 5:** Commit `feat(study): vacation periods`.

### Task 3: `studyClock.ts`

**Files:** Create `apps/web/src/lib/study/studyClock.ts`, `studyClock.test.ts`.

**Interfaces:**
```ts
export interface ClockRun { a: number; n: number }
export interface StudyClock { runs: readonly ClockRun[]; v(ms: number): number; inverse(ms: number): number }
export const IDENTITY_CLOCK: StudyClock
export function studyClock(runs: readonly Run[], day: StudyDay): StudyClock
export function clockFromRuns(runs: readonly ClockRun[]): StudyClock          // for the worker
export function feedInstants(tss: readonly number[], clock: StudyClock): number[]
```

- [ ] **Step 1: Failing tests:** `study-clock.json`; properties over random runs and instants: `v`
  non-decreasing; `v(inverse(x)) = x`; `inverse(v(t)) = t` for `t` outside every `[aᵢ, aᵢ + nᵢ·DAY)`;
  identity without runs.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** gates PASS. **Step 5:** Commit `feat(study): the vacation-aware study clock`.

### Task 4: Replay through the clock

**Files:** Modify `apps/web/src/lib/study/scheduler.ts`, `scheduler.test.ts`; create
`apps/web/src/lib/study/fsrs/syntheticLog.ts` (+ test: converts `fsrs/synthetic.ts` `simulate()` steps into
`ReviewEvent`s with timestamps from a fixed start, one card per dataset card).

**Interfaces:** `scheduleFor(cardId, reviews, now, w, clock: StudyClock)` (required; tests pass `IDENTITY_CLOCK`).

- [ ] **Step 1: Failing tests:** `vacation-schedule.json` (8 decimals, exact due); golden: 2,000 synthetic
  reviews give identical schedules with `IDENTITY_CLOCK` and with the old implementation (snapshot taken
  before the change); existing tests unchanged apart from the extra argument.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** gates PASS. **Step 5:** Commit `feat(study): replay reviews on the study clock`.

### Task 5: The context in every queue and count

**Files:** Create `apps/web/src/lib/study/studyContext.ts` (+ test); modify `scheduler.ts` (`buildQueue`),
`levelQueue.ts`, `cardFlow.ts` (`deckSessionPlan`, `deckSessionItems`, `tierForCard`), `mastery.ts`,
`charGroups.ts`, `fsrs/preview.ts` (`previewChange`: due counts and `medianIntervalDays` on the clock),
`lib/stats/wordStates.ts`, `lib/stats/characterMap.ts`, and every Svelte caller (grep `scheduleFor|buildQueue|
isDue|deckSession|buildLevelQueue|tierForCard|wordStateCounts|masteryForChars|previewChange` in `src/`):
`FlashcardsWidget.svelte`, `lib/widgets/WordStatesWidget.svelte`, `routes/study/+page.svelte`,
`routes/study/session/+page.svelte`, `routes/study/scheduling/+page.svelte`, `routes/stats/characters/+page.svelte`;
their tests. Callers pass `UTC_CONTEXT`-equivalent contexts built from `currentStudyDay()` and an identity
clock until Task 7 wires real runs.

**Interfaces:**
```ts
export interface StudyContext { day: StudyDay; clock: StudyClock; vacationToday: boolean }
export const UTC_CONTEXT: StudyContext                          // tests only
export function isDueNow(schedule: Schedule, now: Date, ctx: StudyContext): boolean   // !vacationToday && due ≤ now
```

- [ ] **Step 1: Failing tests:** `due-today.json`; every queue/count returns empty/zero with `vacationToday`;
  `previewChange` due counts are 0 on a vacation day and median intervals exclude vacation days; the guard
  test for `UTC_CONTEXT` outside tests; all existing expectations unchanged.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** gates PASS. **Step 5:** Commit `feat(study): one study context for every queue`.

### Task 6: Optimizer data on the study clock

**Files:** Modify `apps/web/src/lib/study/fsrs/dataset.ts`, `evaluate.ts`, `optimize.ts` (pass-through),
`optimizer.worker.ts`, `optimizerClient.ts`, their tests; `routes/study/scheduling/+page.svelte`.

**Interfaces:** `buildDataset(reviews, clock: StudyClock)`; worker request gains `{ history: ZoneChange[];
runs: ClockRun[]; today: string; vacationToday: boolean }`, from which the worker rebuilds the context for
training, evaluation and its `previewChange` call.

- [ ] **Step 1: Failing tests:** `optimizer-steps.json`; `labelled` drops a gap shortened below a day;
  `days` stay real; the worker request is structured-clone safe (`structuredClone` round trip) and the
  rebuilt context gives the same preview as the page's.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** gates PASS. **Step 5:** Commit `feat(fsrs): optimizer data without vacation time`.

### Task 7: Vacations in the study history

**Files:** Modify `apps/web/src/lib/study/store.ts` (read user-global `vacation:*` rows; `saveVacation`,
`deleteVacation`; update the header comment and the `fetchStudyData` filter doc: the one user-global
exception), `history.ts` (`loadStudyHistory` returns `context`; rebuild on date change via a midnight timer and
`onStudyDayChange`), `store.test.ts`, `history.test.ts`; the callers from Task 5 switch to `history.context`.

- [ ] **Step 1: Failing tests:** history exposes runs for its workspace only; a vacation write invalidates
  every workspace's cached history; tombstones ignored; with fake timers the context's `vacationToday` flips at
  the local midnight that starts a run; a zone change rebuilds it.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** gates PASS. **Step 5:** Commit `feat(study): vacations in the study history`.

### Task 8: Streak neutral days, heatmap and stats marks

**Files:** Modify `apps/web/src/lib/study/exp.ts` (`dailyStreak(reviews, now, day, vacationDays)`), `exp.test.ts`,
`apps/web/src/lib/activity/activity.ts` (`DayActivity.vacation: 'all' | 'some' | null`), `activity.test.ts`,
`apps/web/src/lib/components/ActivityHeatmap.svelte` (+ dom test), `routes/stats/+page.svelte`, the widget and
session page callers of `dailyStreak`.

- [ ] **Step 1: Failing tests:** `streak.json`; fold marks per scope; hatched class and tooltip text; keyboard order unchanged.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** gates PASS. **Step 5:** Commit `feat(study): vacation days in streaks and the heatmap`.

### Task 9: Settings → Study (vacation) and the study page banner

**Files:** Modify `apps/web/src/lib/settings/tabs.ts` (+ `tabs.test.ts`: new tab `study`, label "Study"),
`routes/settings/+page.svelte`; create `apps/web/src/lib/settings/StudySettings.svelte`,
`apps/web/src/lib/settings/vacationForm.ts` (+ test), `StudySettings.dom.test.ts`; modify `routes/study/+page.svelte`
(banner, start hidden), `FlashcardsWidget.svelte` ("On vacation until 3 Jan").

**Interfaces:** `describePeriod(period, today, workspaces)` ("3 Jan – 17 Jan, all workspaces"),
`vacationBanner(run | null, today)`, `startNowNote(startsTomorrow)` ("Starts tomorrow — you already studied today").

- [ ] **Step 1: Failing tests:** texts; dom: start now (with and without reviews today), schedule (date min =
  today), until ended, scope radio + checklist, End now / Cancel (Cancel hidden for started periods); the study
  page banner on a vacation day.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** gates PASS. **Step 5:** Commit `feat(web): vacation settings and banner`.

### Task 10: `limits.ts` — rows, counts, admission

**Files:** Create `apps/web/src/lib/study/limits.ts`, `limits.test.ts`.

**Interfaces:**
```ts
export interface LimitPair { new: number | null; reviews: number | null }
export const DEFAULT_LIMITS: LimitPair
export function parseLimitRow(key: string, raw: unknown): Partial<LimitPair> | null
export function effectiveLimits(workspace: Partial<LimitPair> | null, deck: Partial<LimitPair> | null): LimitPair
export interface DayCounts { newDone: Map<string, number>; reviewDone: Map<string, number>; reviewedToday: Set<string>; firstDay: Map<string, string> }
export function dayCounts(cards: readonly StudyCard[], reviews: readonly ReviewEvent[], ctx: StudyContext, now: Date): DayCounts
export interface Candidate { cardId: string; deckIds: readonly string[]; bucket: 'continuing' | 'review' | 'new' }
export interface Admission { admitted: string[]; left: { reviews: number; new: number; unlimited: boolean } }
export function admit(candidates: readonly Candidate[], limitsFor: (deckId: string) => LimitPair, counts: DayCounts, session: { newLimit: number; reviewLimit: number }, existingDecks: ReadonlySet<string>): Admission
```

- [ ] **Step 1: Failing tests:** `limits-rows.json`, `daily-limits.json`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** gates PASS. **Step 5:** Commit `feat(study): daily limits`.

### Task 11: Limits in every queue

**Files:** Modify `scheduler.ts`, `cardFlow.ts` (incl. `dropItem`/reserve backfill through `admit`), `levelQueue.ts`,
`companions.ts` (budget from `admit`), `store.ts` (read `limits:*`; `saveWorkspaceLimits`, `saveDeckLimits`),
`history.ts` (limits in the history), tests; `routes/study/session/+page.svelte`.

- [ ] **Step 1: Failing tests:** 3 new left → 3 new despite `newLimit` 20; companions count as new; a card in a
  full second deck is skipped and the next card admitted; level session: existing cards by their decks, virtual
  by `general`; a dropped companion's replacement respects its decks' allowance; continuing cards always in and
  capped by the session `reviewLimit`; a reload after 5 reviews shows 5 fewer; re-shows change nothing.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** gates PASS. **Step 5:** Commit `feat(study): apply daily limits to sessions`.

### Task 12: Limits UI — settings, deck override, widget, study start

**Files:** Modify `StudySettings.svelte` (+ dom test; workspace limits with "Unlimited"), the #90 deck settings
component (+ its dom test), `FlashcardsWidget.svelte`, `routes/study/+page.svelte`; create
`apps/web/src/lib/study/limitsText.ts` (+ test).

- [ ] **Step 1: Failing tests:** texts ("18 reviews · 5 new left today", "Done for today — daily limit
  reached", "Today: 18 reviews and 5 new (daily limits applied)", singular forms, no-limit wording); dom: a deck
  set to unlimited reviews writes `limits:deck:<id>` with `reviews: null` and no `new`; widget numbers equal
  `admit` over all decks for real cards.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Fallback** without #90: a "Daily limits" disclosure per deck in
  the study setup's deck list, with `TODO(#90)`. **Step 4:** gates PASS. **Step 5:** Commit `feat(web): daily limit settings and what is left today`.

### Task 13: Docs, contract README and the real-app check

**Files:** Modify `README.md`, `docs/ROADMAP.md` (#88, #89), `docs/contracts/README.md`,
`docs/contracts/scheduler/README.md` (Android: read `vacation:*` and `limits:*` rows like `fsrs:*`).

- [ ] **Step 1: Real-app check (no browser):** scratch copy, image build (`WITH_OCR=0 WITH_AUDIO=0`), free port.
  curl: log in; zone `Europe/Berlin`; `PUT /api/plugins/qinqin-flashcards/data/vacation:<ulid>` (no workspace) and
  `limits:workspace?workspace=<ws>`; `GET /api/sync/pull` shows the vacation row with `workspaceId: null`; post
  cards and review events of the fixture "7-day vacation" history (past instants); then a temporary vitest file in
  the scratch copy only (`QINQIN_CHECK_URL=… npx vitest run src/realapp.check.test.ts`) loads rows and events
  from the server and asserts: nothing due on a vacation day, the post-vacation due shifted by 7 days, `admit`
  defaults 20 / 200 and honours the stored row. Never commit it. Stop and remove everything.
- [ ] **Step 2:** Full Go gate, web gates, generator `--check`. **Step 3:** Commit `docs: vacation mode and daily limits`.

## Task dependencies

1 → 2 → 3 → 4 → 5 → 6; 5 → 7 → 8 → 9 (vacation, item 4); 7 → 10 → 11 → 12 (limits, item 4b); all → 13.
Cross-plan: the whole study-day plan first; #90 before Task 12 (or its fallback); #57/#65 queue code joins Task 5.

## Contract notes (for `docs/contracts/`)

- `docs/contracts/scheduler/README.md` — clock, replay, optimizer steps, due rule, streak, limits (Tasks 1, 13).
- `vacation-days.json`, `study-clock.json` (Task 1; Tasks 2–3).
- `vacation-schedule.json`, `optimizer-steps.json` — generator (plain ts-fsrs) plus hand-written inside-run cases (Task 1; Tasks 4, 6).
- `due-today.json` (Task 5), `streak.json` (Task 8), `limits-rows.json`, `daily-limits.json` (Tasks 10–11).
- Android: read `vacation:*` (user-global) and `limits:*` rows, use the learner's day, port `v`/`v⁻¹` with
  whole-day shifts, keep instant due ness.

# Core Activity Heatmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the home heatmap out of the flashcards plugin into the core app and make it aggregate every learning activity (flashcard reviews now, reading sessions now, other plugins later), per workspace.

**Architecture:** A pure `activity` module in `apps/web/src/lib/activity/` owns a small source registry (event type → label + weight function), the per-day aggregation (moved from `lib/study/heatmap.ts`) and cell levels. A core `ActivityHeatmap.svelte` on the home page (above the plugin slot) loads `GET /api/events` for the active workspace and renders the grid with a per-source breakdown in each cell's tooltip. The reader emits a new `read` study event (one per reading burst) through the existing event log; the server stores event types verbatim, so **no backend change**. Plugins add a source by registering one entry in the registry (compile-time, like web plugins).

**Tech Stack:** SvelteKit 2 / Svelte 5, TypeScript, vitest. No new dependencies.

**Rulings taken (unattended, decided by the licence-first / best-UX / cost-no-object rule):**
- Core owns the heatmap; the flashcards widget keeps level, XP, streak, mascot and due counts but loses the grid. The streak stays flashcards-only (derived from reviews) this round.
- Cell value = activity points: `review` = 1 per review event; `read` = 1 point per started 5 minutes of reading (a `read` event carries `seconds`; `ceil(seconds/300)`, min 1 for >= 30 s, 0 below 30 s). Cell intensity levels reuse the existing quartile logic of the widget.
- Reading is tracked as `read` events `{bookId, chapter?, seconds}` posted when a reading burst ends (page hidden/blurred after >= 30 s of visible active time, book closed, route left), with an idle cut-off of 2 minutes without scroll/pointer/key input. Nothing is stored locally besides the existing pending-queue behaviour of `record` (fire-and-forget, failures swallowed).
- Unknown event types are ignored by the heatmap (lookup/view/session telemetry still not counted), so adding a source is an explicit decision.

## Global Constraints

- No backend changes, no new dependencies. Event type string for reading: `read`; add it to the web `EventType` union.
- UTC day bucketing, 91-day (13-week) window exactly as before (`HEATMAP_DAYS`); the grid markup, colours and accessibility semantics stay equivalent (move, don't redesign): role="img" with an aria-label stating total points and window, a legend.
- Per workspace; with no workspace selected the heatmap shows the existing hint.
- Existing imports of `$lib/study/heatmap` must keep compiling (re-export shim) or be updated; the old tests move with the code.
- Gates before each commit: `npm --prefix apps/web run check`, `npm --prefix apps/web test`, `npm --prefix apps/web run build`. UI has no component tests: logic in pure modules. `localStorage`/`sessionStorage` access wrapped in try/catch.
- Conventional commits, one per task. Never merge/push.

## Review Focus

- A workspace with only reading activity (no reviews) shows cells; one with neither shows an empty grid, not an error (Task 1, 3).
- Reading bursts shorter than 30 s add nothing; a tab left open and idle does not accumulate time; hidden tabs stop the clock (Task 2).
- Two `read` events in one UTC day sum; events at UTC midnight land on the right day; unparsable timestamps and malformed payloads (`seconds` missing/negative/NaN/huge) are ignored or clamped (Task 1).
- The flashcards widget still renders correctly without the grid, and the home page order is: search, activity heatmap, plugin widgets (Task 3).

---

### Task 1: Activity module (pure)

**Files:**
- Create: `apps/web/src/lib/activity/activity.ts`, `activity.test.ts`
- Move: `apps/web/src/lib/study/heatmap.ts` → `apps/web/src/lib/activity/heatmap.ts` and `heatmap.test.ts` alongside; leave `apps/web/src/lib/study/heatmap.ts` as a thin re-export so `store.test.ts`/widget imports keep working, then switch the widget import in Task 3.

**Interfaces:**
- Produces:
  ```ts
  export interface ActivitySource { type: string; label: string; unit: string; points(payload: unknown): number }
  export const ACTIVITY_SOURCES: readonly ActivitySource[]   // review: label 'Flashcard reviews', unit 'review(s)', points = 1; read: label 'Reading', unit 'min', points = readingPoints(payload)
  export function readingPoints(payload: unknown): number    // payload {seconds}: not finite / < 30 → 0; else min(ceil(seconds/300), 24)  (cap 2 h per event)
  export interface DayActivity { day: string; total: number; bySource: Record<string, number> }
  export function activityByDay(events: readonly { ts: string; type: string; payload?: unknown }[], now?: Date, days?: number): Map<string, DayActivity>   // dense over the window, oldest first, UTC; unknown types, unparsable ts, out-of-window and zero-point events ignored
  export function dayTooltip(day: DayActivity): string   // e.g. "2026-11-13: 12 points — 9 Flashcard reviews, 3 Reading (15 min)"; "… no activity" for zero
  export function levelFor(count: number, max: number): 0 | 1 | 2 | 3 | 4   // the widget's existing quartile rule, moved here unchanged
  ```
- Consumes: nothing from other tasks.

- [ ] **Step 1:** Write failing tests: `readingPoints` (NaN, negative, 29 s → 0, 30 s → 1, 300 s → 1, 301 s → 2, 99999 s → 24, non-object payload → 0); `activityByDay` (reviews + reads same day sum with correct `bySource`; dense window length 91 oldest first; UTC midnight boundary; unknown type ignored; bad ts ignored; future day ignored; zero-point read ignored); `dayTooltip` (zero, singular/plural, reading minutes); `levelFor` thresholds copied from the widget's current logic (read FlashcardsWidget.svelte for the exact rule and pin it); moved heatmap tests still pass.
- [ ] **Step 2:** Run `npm --prefix apps/web test -- activity` — FAIL.
- [ ] **Step 3:** Implement; `git mv` heatmap files, add the shim re-export.
- [ ] **Step 4:** Gates — PASS. **Commit** `feat(activity): core activity aggregation across learning sources`.

### Task 2: Reader emits `read` events

**Files:**
- Create: `apps/web/src/lib/plugins/reader/readingTimer.ts`, `readingTimer.test.ts`
- Modify: `apps/web/src/lib/events.ts` (`EventType` gains `'read'`), `apps/web/src/lib/plugins/reader/BookView.svelte` (wire the timer)

**Interfaces:**
- Produces:
  ```ts
  export const IDLE_CUTOFF_MS = 120_000
  export const MIN_BURST_SECONDS = 30
  export interface ReadingTimer { activity(now: number): void; hidden(now: number): void; visible(now: number): void; flush(now: number): number }   // flush returns the whole seconds accumulated since the last flush (0 below MIN_BURST_SECONDS: those seconds are kept and carried into the next burst)
  export function createReadingTimer(): ReadingTimer
  ```
  Time accrues between consecutive `activity` calls while visible, never more than `IDLE_CUTOFF_MS` per gap (a gap longer than the cut-off adds nothing for the idle part); `hidden` stops the clock until `visible`.
- BookView: create a timer per open book; feed `activity` from scroll/pointermove/keydown/touchstart on the reading area (throttled to once per second), `hidden`/`visible` from `visibilitychange`; on book close / route leave / `pagehide` call `flush` and, when seconds > 0, `record('read', workspaceId, { bookId, seconds })`; also flush every 5 minutes of accumulated time so a long session is not lost on a crash.

- [ ] **Step 1:** Write failing tests for the timer (idle gap capped, hidden stops accrual, visible resumes, sub-30 s carry-over, flush resets, monotonic clock misuse such as `now` going backwards adds 0).
- [ ] **Step 2:** Run `npm --prefix apps/web test -- readingTimer` — FAIL. **Step 3:** implement the timer and wire BookView (read it first to find the right mount/cleanup hooks and the workspace id source; use `record` from `$lib/events`).
- [ ] **Step 4:** Gates — PASS. **Commit** `feat(reader): record reading time as study events`.

### Task 3: Core ActivityHeatmap on the home page

**Files:**
- Create: `apps/web/src/lib/components/ActivityHeatmap.svelte`
- Modify: `apps/web/src/routes/+page.svelte` (render it above the plugin slot), `apps/web/src/lib/plugins/flashcards/FlashcardsWidget.svelte` (remove grid + legend, keep the rest; the widget still loads events for XP/streak), `apps/web/src/lib/study/heatmap.ts` (delete the shim once nothing imports it; update imports in tests), `apps/web/src/routes/settings/+page.svelte` line ~147 (copy mentions the study heatmap: reword), `README.md` (home heatmap now core and multi-source; reading events), `docs/superpowers/specs/2026-11-12-flashcards-design.md` (Heatmap section: moved to core 2026-11-13; point to this plan)

**Interfaces:**
- Consumes: `activityByDay`, `dayTooltip`, `levelFor`, `HEATMAP_DAYS`, `ACTIVITY_SOURCES` (Task 1); `StudyEvent` from `$lib/events`.
- Produces: `ActivityHeatmap.svelte` (no props): reads the active workspace like the widget does (copy its workspace subscription and `loading/error/noWorkspace` handling), fetches `/api/events?since=1970-01-01T00:00:00Z&workspace=<id>`, renders the same grid as the widget did with `dayTooltip` titles, an aria-label with the window total and per-source totals, and a legend. It listens for nothing else; it re-fetches when the workspace changes.

- [ ] **Step 1:** Implement the component by moving the widget's grid markup, styles and cell colour classes; keep dark-mode friendly colours exactly as before.
- [ ] **Step 2:** Remove the grid from the widget and delete the now-unused code (windowTotal/cells) there; ensure the widget's own events fetch still feeds XP/streak/mascot.
- [ ] **Step 3:** Update docs/copy (settings text, README, spec Heatmap section).
- [ ] **Step 4:** Gates — PASS. Quick real-app check if a Chromium driver is available under the scratchpad (playwright-core 1.52 may already be installed in `.../scratchpad/pw` from the earlier smoke run; Chromium is in `~/.cache/ms-playwright`): home page on 127.0.0.1 shows the heatmap with reviews and a `read` event posted through the API on the right day, tooltip text, no console errors, 390 px viewport without horizontal scroll; report pass/fail/not-run honestly. **Commit** `feat(activity): move the heatmap into core and aggregate reading`.

# Vacation mode and daily limits — design (issues #88, #89)

Status: Draft for review (2026-11-15), v0.3.0 work items 4 and 4b. Written unattended; every
non-obvious call is a **Ruling** (`what — why — cost if wrong`). Nothing is built. Revised after a
builder check that ran the study clock against ts-fsrs 5.4.2 (results below). **Depends on** the
learner's day (`2026-11-15-v030-study-day-design.md`) and, for the per-deck limit UI, on the decks view
(#90, item 3b). #88's design is the owner's (issue body + direction item 4); this spec makes it exact.

## Intent and why

A learner who travels for two weeks comes back to hundreds of overdue cards, a broken streak and FSRS
treating the gap as forgetting time. The only cap on a day's work is the per-session `newLimit`/
`reviewLimit` (`lib/study/session.ts`): five sessions give five times the new cards. Both features need
the learner's day, review events counted per day, and one due predicate shared by the queue, widget,
study start, decks view, optimizer preview and (later) Android.

## Goals

- Vacation periods (start, optional end; all workspaces or chosen ones) that freeze the SRS: nothing
  due, no new cards, "Vacation until …", no avalanche afterwards, streak neutral, heatmap marks.
- Scheduler and optimizer measure time since the last review **without vacation days**, from the
  unchanged event log; nothing is rewritten; ending early is a one-row edit.
- Daily new/review limits per workspace with per-deck overrides, counted from review events by the
  learner's day; Again re-shows never count; what is left today on the home widget and study start.
- **No change at all for learners without a vacation and with the default limits not reached.**
- One exact rule set with JSON fixtures in `docs/contracts/scheduler/`.

## Non-goals

Changing ts-fsrs, its parameters or its day base; past vacations; per-card-type limits; carry-over;
reminders; leech handling (#66); daily goals (#67 reuses the counts later). The server's stats service
(`server/internal/stats`, #48) needs no change: it holds no streaks, vacation marks are drawn by clients
from the vacation rows (Android does the same).

## Storage (plugin data, `qinqin-flashcards`)

**Vacation periods** — user-global rows (PUT without `?workspace=` stores `workspace_id` NULL), key
`vacation:<ULID>`:

```json
{ "version": 1, "id": "01JD…", "start": "2026-12-20", "end": "2027-01-03",
  "scope": "all", "createdDay": "2026-11-15", "createdAt": "2026-11-15T10:12:00Z" }
```

`end` may be `null` (until ended); `scope` is `"all"` (every workspace, also later ones) or
`{"workspaces": [3, 7]}` (non-empty). Unparsable rows are ignored. `store.ts`'s rule "study data never
falls back to user-global rows" gains this one explicit exception.

**Limits** — workspace rows: `limits:workspace` = `{"version":1,"new":20,"reviews":200}` (absent: 20 /
200) and `limits:deck:<deckId>` = `{"version":1,"new"?:N|null,"reviews"?:N|null}` (`general` included).
`null` = unlimited; a missing field follows the workspace; a present field overrides it, higher or
lower. Integers 0…9999.

Ruling: one row per period and per deck — plugin-data sync is last-write-wins per key — cost: more rows.
Ruling: defaults 20 new / 200 reviews (the direction's suggestion, Anki's defaults) — cost: heavy users
raise reviews once.

## Vacation days

For workspace `w` on learner day `today`, a valid period covering `w` contributes the dates `[s, e]`,
`s = max(start, createdDay)`, `e = end`, or `max(today, s)` when `end` is null. The union is merged into
**runs** of consecutive dates (adjacent runs join). Edits (pure `vacation.ts`, the UI never writes a
date before `today`):

- **Create**: `start ≥ today`; `end = null` or `start ≤ end` with at most 366 dates. **Start now** gives
  `start = today` only when no review was recorded today in a covered workspace; otherwise
  `start = today + 1` and the UI says "Starts tomorrow — you already studied today". A draft that
  overlaps or touches rows of the same scope is written as one row: the earliest such row is updated to
  the union (open end if any is open; a merged row may exceed 366 dates), the others are tombstoned; with
  no such row it is a single put. Different scopes stay separate and merge only in the union.
- **End early** on `today`: if `s < today`, set `end = today − 1`; otherwise tombstone.
- **Cancel** (only while `s ≥ today`): tombstone. A started period can only end early, so past frozen
  time is never un-frozen.

Ruling: "start now" never covers reviews already made today — freezing from midnight would replay them at
the run start and change their stability (the builder check showed it for Tokyo) — cost: an evening
"start now" after studying leaves today's remaining queue open.
Ruling: `createdDay` clamps the start — a buggy client cannot backdate a period into replayed history —
cost: one field. Ruling: an open end counts up to today; shown due dates assume it ends today — cost:
optimistic forecasts during an open vacation.

## The study clock (contract-critical)

Per workspace, run `i` (ascending) gives `aᵢ = dayStart(Sᵢ)` (UTC ms, zone history in effect) and
`nᵢ` dates; `DAY = 86 400 000`.

- **v(t)** = `t − Σᵢ clamp(t − aᵢ, 0, nᵢ·DAY)`: non-decreasing; frozen on `[aᵢ, aᵢ + nᵢ·DAY)`; later
  instants shift by exactly whole days, preserving the UTC time of day and so ts-fsrs's UTC calendar
  elapsed days.
- **v⁻¹(x)** is defined by the algorithm: `t = x`; for each run in order, if `t ≥ aᵢ` then `t += nᵢ·DAY`.
  It returns the end of a frozen interval for `x` at its start, pushes any due at or after a run start
  past it (also for scheduled runs), and satisfies `v(v⁻¹(x)) = x`.
- No runs: both are the identity, so schedules without vacations are unchanged.

**Replay.** `scheduleFor` sorts as today and feeds ts-fsrs `fᵢ = max(v(tsᵢ), fᵢ₋₁)` (the max is a no-op
for sorted input because `v` is non-decreasing; it is kept as a guard). `createEmptyCard(f₀)`,
`next(card, fᵢ, grade)`; `due = v⁻¹(dueᵥ)`; stability, difficulty, state are ts-fsrs's. A review inside a
frozen interval (an offline device) is fed at the frozen instant.

**Optimizer.** `buildDataset` uses the same `fᵢ`: `Step.t = dateDiffInDays(fᵢ₋₁, fᵢ)` — equal to the
replay's `elapsed_days` (verified); `labelled` counts `t ≥ 1` on these; `days[i]` stays
`floor(real tsᵢ / DAY)` (holdout split by real time). The worker receives serializable inputs (zone
history, runs `[{a, n}]`, today, `vacationToday`) and rebuilds the context itself, also for its preview.

Verified with ts-fsrs 5.4.2 (default parameters, short-term on): two histories with a 7-day Berlin vacation
across 2025-10-26 give bit-identical stability, difficulty, state and due to plain ts-fsrs with the
post-vacation reviews moved 7×24 h earlier and the due 7×24 h later; `Step.t` equals `elapsed_days`.

Ruling: whole-day shifts (`nᵢ·DAY`), not the runs' real length — real length differs by the DST hour or
by a zone change (up to ~17 h when the learner travels during the vacation) and would move later reviews
across UTC midnight — cost: the clock resumes up to that many hours early or late at a run's end (a review
early on the first day back may count up to one day less elapsed), and a due date can move one local date
less than the vacation (`vacation-schedule.json` states it).
Ruling: FSRS keeps ts-fsrs's UTC calendar elapsed days — local dates would reschedule every card and break
parity with ts-fsrs ports — cost: elapsed days follow UTC dates, as today.

## What is due (shared predicate)

`today = dayOf(now)`. If `today` is a vacation date of the workspace, **nothing is due and no new card is
offered** (queue, counts, widget, decks view, preview all 0; the study page shows "Vacation until 3 Jan" /
"On vacation (no end date)"). Otherwise a card is due when `due ≤ now` — unchanged.

Ruling: keep instant due ness (`due ≤ now`) instead of Anki's whole-day rule — with ts-fsrs's UTC elapsed
days a card offered from local midnight is often reviewed at 0 elapsed days (US evening review, next
morning session): the builder check measured S 1.42 / 2-day interval instead of S 3.75 / 4 days; that would
change scheduling, which #89 forbids — cost: "due" grows during the day; "left today" is computed now.

## Daily limits

For workspace `w`, `D = today`, after the canonical card merge, per deck `d` (current members; deck ids
of deleted decks are ignored): `firstDay(c) = dayOf(first valid review)`; `newDone(d) = |{c ∈ d :
firstDay(c) = D}|`; `reviewDone(d) = |{c ∈ d : firstDay(c) < D, c has a valid review on D}|`. Re-shows are
never recorded (`requeue.ts`), so they never count; reviews from every device count. `remaining(d) =
max(0, limit(d) − done(d))` (null = ∞), deck field if present else workspace field.

**Admission** — one pass over candidates in queue order, skip-and-continue:

1. **Continuing**: due cards already reviewed today (learning steps, today's new cards) — admitted without
   touching daily counts; they still count toward the session `reviewLimit`, as today.
2. **Reviews** (`firstDay < D`, none today): admitted when every (existing) deck of the card has
   `remaining reviews > 0` and the session cap is not reached; each admission decrements all its decks; a
   refused card is skipped and later cards are still considered.
3. **New** (real never-reviewed, companions, level virtual items): the same with `remaining new` and the
   session `newLimit`; a virtual item's decks are those it will join (companions: its vocab card's decks;
   level virtual items: `general`). The deck session's reserve/backfill goes through the same pass with
   the allowance left over.

Level sessions: existing cards use their own decks; virtual items use `general`. Cards left out stay due
and come back later; scheduling is untouched; on a vacation day the queue is empty, so limits pause.

**Left today** = what admission admits right now with session caps removed: `reviews left` and
`new left` counts (min of due and allowance), `null` text "no limit" only when every involved deck is
unlimited and nothing is due-capped. The widget counts real cards only (uncreated companions are not
counted, as today); the study start counts the selected decks and kinds including planned companions,
as its counts do today.

Ruling: a card must fit every deck it is in — a deck limit is a promise — cost: a card in a full deck and a
free deck waits. Ruling: show admitted counts, not "40 of 200" — with several decks of different limits a
single "of" has no meaning — cost: the learner sees the remaining work, not the limit, on the start page
(the limits are in settings).

## UI

- **Settings → Study** (new tab `study` in `lib/settings/tabs.ts`; `StudySettings.svelte` thin, logic in
  pure modules): vacation (start now / on a date, end date or "until I end it", all workspaces or a
  checklist, active and scheduled periods with End now / Cancel) and the workspace's daily limits.
- **Deck settings** (#90 deck page): per field "use workspace (20)" or own value or unlimited. Until #90 is
  merged the control sits in the study setup's deck list.
- **Home widget**: "18 reviews · 5 new left today", "Done for today — daily limit reached", or "On
  vacation until 3 Jan". **Study start**: "Today: 18 reviews and 5 new (daily limits applied)".
- **Heatmap and Stats**: vacation dates hatched with tooltip "On vacation"; in the all-workspaces view
  "all" when every workspace is on vacation, "Vacation in Japanese" otherwise.
- **Streak** (`dailyStreak`): vacation dates are skipped — they neither extend nor break a run, a review on
  one does not count; `todayDone` is true on a vacation day.
- Contexts (day, clock, `vacationToday`) are rebuilt when the date changes (a midnight timer plus
  `onStudyDayChange`), so a page left open over midnight is not stale.

## Contract fixtures (`docs/contracts/scheduler/`)

- `vacation-days.json` — periods → runs (open end, `createdDay` clamp, overlap/adjacency, scopes,
  tombstones, malformed rows) and the edit plans (start-now with and without reviews today, bridging
  merge, end early, cancel refused for a started period).
- `study-clock.json` — `v`/`v⁻¹` samples: identity, Tokyo run, Berlin run across DST, a zone change inside a
  run, a review inside a run, two runs.
- `vacation-schedule.json` — generated by `scripts/contracts/gen-scheduler-fixtures.mjs` from plain ts-fsrs
  with shifted dates (independent oracle for histories without inside-run reviews); `dueDay` may differ by
  one from the run length (stated per case).
- `optimizer-steps.json` — histories + runs → `Step.t`; inside-run cases hand-written.
- `due-today.json` — instant rule, vacation day empty, a Learning card due in 10 min not due.
- `streak.json`, `limits-rows.json`, `daily-limits.json` (overrides, field fallback, unlimited, strict
  two-deck skip-and-continue, continuing cards and the session cap, deleted deck ids, level session decks,
  reserve backfill, Tokyo 23:30 counting, vacation day empty, left-today numbers).

## Risks

- Every queue gains a context argument: made required (no silent UTC default outside tests).
- Admission is O(cards × decks per card): fine for thousands of cards.
- Android must read user-global `vacation:*` and workspace `limits:*` rows (like `fsrs:*`).

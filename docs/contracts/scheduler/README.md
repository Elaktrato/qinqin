# Scheduler contract: vacation, study clock, due, streak, daily limits

Issues #88 (vacation mode) and #89 (daily limits). Rule source:
`docs/superpowers/specs/2026-11-15-v030-vacation-and-limits-design.md`; the learner's day is
`docs/contracts/study-day/`. Every client (web, Android) implements these rules and runs the fixtures in
this folder. Fixtures win over code. Fixture format: see `docs/contracts/README.md`.

## Storage rows (plugin `qinqin-flashcards`, plugin data)

- `vacation:<ULID>` is **user-global** (no `workspace` on write, `workspaceId: null` in the sync pull):
  `{version:1, id, start, end|null, scope:"all"|{workspaces:[int,...]}, createdDay, createdAt}`. Dates are
  learner days (`YYYY-MM-DD`). An unusable row (tombstone, other version, `end < start`, empty workspace
  list, impossible date, `id` differing from the key, non-integer workspace id) is ignored.
- `limits:workspace` = `{version:1, new?, reviews?}` and `limits:deck:<deckId>` (the `general` deck
  included) = the same fields, workspace-scoped. A field is an integer 0..9999 or `null` (unlimited); a
  missing or unusable field falls back (deck -> workspace -> default 20 new / 200 reviews). Clients
  read these rows like `fsrs:*`.

## Vacation days and edits (`vacation-days.json`)

For workspace `w` on `today`, a period covering `w` (scope `all` or listing `w`) contributes the dates
`[s, e]` with `s = max(start, createdDay)` and `e = end`, or `max(today, s)` when `end` is null. Empty when
`e < s`. The union is merged into runs of consecutive dates (adjacent runs join). `create` cases plan a
new period (`start: "now"` is `today`, or `today + 1` when a covered workspace has a review today: past
frozen time is never rewritten; one row per same-scope group, the earliest row is updated and the others
deleted; at most 366 dates; error codes `start-before-today`, `end-before-start`, `too-long`,
`no-workspaces`); `edit` cases end a period early (`end = today - 1`, or delete when it starts on or after
`today`) or cancel it (only while it starts on or after `today`, else `started`).

## The study clock (`study-clock.json`)

`DAY = 86 400 000 ms`. A run of `n` dates starting at date `S` gives `a = dayStart(S)` (study-day rule, the
zone history in effect). `v(t) = t - sum(clamp(t - a_i, 0, n_i * DAY))`. `inverse(x)`: `t = x`; for each run
in ascending order, if `t >= a_i` then `t += n_i * DAY`. Shifts are whole days (not the run's real length),
so the UTC time of day is preserved. No runs: both are the identity.

## Replay (`vacation-schedule.json`)

`f_i = max(v(ts_i), f_{i-1})` is fed to ts-fsrs (`createEmptyCard(f_0)`, `next(card, f_i, grade)`, default
parameters, short-term on, fuzz off) and `due = inverse(due_v)`. Stability, difficulty and state are
ts-fsrs's. The file is **generated from plain ts-fsrs** with plainly shifted dates (no clock code), see
below. `expected` numbers compare to 8 decimals, `due` exactly; `dueDayShift` is the learner-date shift
of the due date (the run length, or one less around a DST change). A review inside a frozen interval is fed
at the frozen instant (`optimizer-steps.inside` cases).

## Optimizer steps (`optimizer-steps.json`)

`Step.t = dateDiffInDays(f_{i-1}, f_i)` (ts-fsrs UTC calendar days, equals the replay's `elapsed_days`),
`labelled` counts steps after the first with `t >= 1`. The training days (holdout split) stay the real
`floor(ts / DAY)`.

## Due and streak (`due-today.json`, `streak.json`)

On a vacation day (the learner's `today` is a date of a run of the workspace) nothing is due and no new card
is offered. Otherwise a card is due when `due <= now`: instant, not Anki's whole-day rule. Streaks skip
vacation dates: they neither extend nor break a run, a review on one does not count, `todayDone` is true on a
vacation day, and "consecutive" means the next non-vacation date.

## Limits (`limits-rows.json`, `daily-limits.json`)

Per deck `d` (current members, after the canonical merge), learner day `D`: `newDone(d)` counts cards whose
first valid review is on `D`, `reviewDone(d)` cards first reviewed before `D` that have a valid review on `D`.
Admission walks the candidates in queue order and skips what does not fit: `continuing` (due, already reviewed
today) is admitted without touching the counts but is capped by the session review limit; `review` and
`new` need every existing deck of the card to have allowance left and the session cap not reached; each
admission uses one slot of all its decks. `left` is the same pass without session caps (`reviews` includes
continuing cards); `unlimited` is true when every involved deck is unlimited in both fields (false with no
candidates); `limitedOut` counts candidates refused by a daily limit.

## Android and other clients

Read the user-global `vacation:*` rows and the workspace `limits:*` rows like `fsrs:*` (one plugin-data
pull; `vacation:*` rows arrive with `workspaceId: null`). Use the learner's day for every date here, port
`v` and `inverse` with whole-day shifts (`n * 86 400 000 ms`, never the run's real length), feed ts-fsrs
`f_i = max(v(ts_i), f_{i-1})`, map the due back with `inverse`, keep the instant due rule
(`due <= now`), and build every queue from the same admission. A client must not write a vacation date before
its own `today`.

## Regenerating the generated files

```sh
npm --prefix apps/web ci
node scripts/contracts/gen-scheduler-fixtures.mjs          # writes vacation-schedule.json, optimizer-steps.json
node scripts/contracts/gen-scheduler-fixtures.mjs --check  # exit 1 when they are out of date
```

`optimizer-steps.inside.json` (reviews inside a frozen interval) is hand-written input of the generator.

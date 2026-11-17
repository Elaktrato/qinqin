# Scheduler contract: FSRS, XP, vacation, study clock, due, streak, daily limits

Issues #88 (vacation mode) and #89 (daily limits). Rule source:
`docs/superpowers/specs/2026-11-15-v030-vacation-and-limits-design.md`; the learner's day is
`docs/contracts/study-day/`. Every client (web, Android) implements these rules and runs the fixtures in
this folder. Fixtures win over code. Fixture format: see `docs/contracts/README.md`.

## Storage rows (study namespace `qinqin-flashcards` plugin data, and the typed `limits` collection)

- `vacation:<ULID>` is **user-global** (no `workspace` on write, `workspaceId: null` in the sync pull):
  `{version:1, id, start, end|null, scope:"all"|{workspaces:[int,...]}, createdDay, createdAt}`. Dates are
  learner days (`YYYY-MM-DD`). An unusable row (tombstone, other version, `end < start`, empty workspace
  list, impossible date, `id` differing from the key, non-integer workspace id) is ignored.
- Daily limits are typed `limits` rows (`study/README.md`): `{deckId: null (the workspace) | "<deckId>"
  (the `general` deck included), new: null | {limit}, reviews: same}`, workspace-scoped. A limit is an
  integer 0..9999 or `null` (unlimited); a field that is `null` (not set) falls back (deck -> workspace ->
  default 20 new / 200 reviews). Their legacy form (old shells, backups, `limits-rows.json`) is
  `limits:workspace` / `limits:deck:<deckId>` = `{version:1, new?, reviews?}` with the same fall-back for a
  missing or unusable field.

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

## FSRS (`fsrs.json`, generated)

The scheduler is **ts-fsrs 5.4.2** (`tsFsrs` in the file), used as `fsrs({w})`: only the weights `w` are
passed, every other option is the library default. `parameters` in the file is the full
`generatorParameters()` object, i.e. exactly:

| Parameter | Value |
| --- | --- |
| `request_retention` | 0.9 |
| `maximum_interval` | 36500 (days) |
| `enable_fuzz` | false |
| `enable_short_term` | true |
| `learning_steps` | `["1m", "10m"]` |
| `relearning_steps` | `["10m"]` |
| `w` (`default_w`, FSRS-6, 21 numbers) | 0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542 |

Grades map 1 Again, 2 Hard, 3 Good, 4 Easy. States: 0 New, 1 Learning, 2 Review, 3 Relearning.

- **Weights** (`weights` cases; web `study/fsrs/params.ts` `checkWeights`, `validWeights`): a weight list is
  17, 19 or 21 JSON numbers, all finite (ts-fsrs `checkParameters`), each raw value inside
  `clampRanges[i]` (`CLAMP_PARAMETERS(2, true)`, by position, ends included). A value outside is **rejected**,
  never clipped. A valid list is migrated to 21 by ts-fsrs `migrateParameters` (19: append `0, 0.5`; 17: convert
  w4..w6 and append `0, 0, 0, 0.5`). `expect` gives `{ok: true, migrated}` or `{ok: false, reason, position?}`
  with `reason` `notNumbers` | `nonFinite` | `length` | `range` and the 1-based position. `1e999` in the file
  is Infinity: read the file with a parser that maps it so (a JSON import that makes it `null` does not test the
  rule).
- **Parameter sets** (`paramSet` cases; `parseParamSet`): an `fsrs:set:<id>` row is valid only when the key
  names its `id`, `createdAt` is a string, `source` is `optimized` or `imported`, `w` is exactly 21 numbers that
  pass the weight check, and `labelled`, `logLoss`, `baselineLogLoss` are absent or finite numbers (`null` is
  invalid). The parsed set holds the migrated weights; an invalid row is ignored.
- **Active set** (`resolve` cases; `resolveState`): sets are listed newest first (`createdAt` descending, then
  `id` descending). `fsrs:active {setId}` names the active set; a missing row, a `setId` that is not a string, or a
  `setId` naming no valid set means the default weights (`pointer` still reports a string `setId`).
- **Replay** (`replay` cases): a card's valid reviews in `(instant, id)` order (`order` lists the ids) are fed to
  `createEmptyCard(t_0)` and `next(card, t_i, grade)` with the case's weights (`"default"` = `default_w`; a
  migrated set gives the 21 migrated weights and the list it came `from`). `points` is the card after **every**
  review: `due`, `stability`, `difficulty`, `state`, `reps`, `lapses`, `scheduled_days`, `learning_steps`. The
  cases cover both learning steps, Again in learning and relearning, Hard and Easy from new, lapses after months,
  sub-day reviews of a review card, early and very late reviews, the maximum interval (ts-fsrs 5.4.2 reports
  `scheduled_days` 36502 there while stability is capped at 36500: pinned as the library does it), two reviews
  in the same instant ordered by id, a custom 21-weight set and migrated 17- and 19-weight sets. Compare `due`
  exactly and the numbers to 8 decimals. The web decodes the four members it stores (`due`, `stability`,
  `difficulty`, `state`) through `scheduleTimeline` and checks with a spy that `scheduler.ts` passes only `{w}` to
  `fsrs`.

Ruling: `fsrs.json` is generated from plain ts-fsrs, not from `scheduler.ts` — the oracle must be the library
Android ports against (the vacation fixture's precedent); the web test then proves `scheduler.ts` equals it —
cost: if ts-fsrs is upgraded the fixture is regenerated and Android must follow (a version bump is a contract
change).

Ruling: the expected values carry every member of the ts-fsrs card a port needs to step forward (`reps`,
`lapses`, `learning_steps`, `scheduled_days`), not only the four the web stores — a port that only matches the
final schedule can hide a wrong intermediate state — cost: a larger file (tens of KB).

**Upgrading ts-fsrs** is a contract change: bump the web dependency, regenerate (`gen-scheduler-fixtures.mjs`),
review the diff of `fsrs.json`, `vacation-schedule.json` and `optimizer-steps.json`, and ship the Android port of
the new version in the same release.

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

## XP and levels (`xp.json`)

Derived from the review log, never stored (web: `lib/study/exp.ts`, decoded by `exp.test.ts`; no server code).
Only reviews that count (`events/review-parse.json`: parsable `ts`, non-empty `cardId`, grade 1–4) earn XP.

- Per review: `baseXp[mode]` (vocab 10, sentence 15, writing 20, tone 8, reverse 10, cloze 15; a missing or
  unknown mode is vocab) + grade bonus (Again 0, Hard 0, Good 5, Easy 10). `byKind` sums these per kind.
- Plus `dailyBonus` 10 per distinct **learner day** (zone history, `study-day/`) with at least one counted
  review; vacation days are not excluded. The total never depends on event order.
- Level: start at level 1; going from level L to L+1 costs `100 · L` XP. `levelProgress(xp)` floors `xp`,
  treats a negative or non-finite value as 0 and returns `{level, xpInto, xpForNext}` (`levels` cases:
  boundaries 99/100, 299/300, 599/600, a million, negative, fractional, NaN, Infinity).

## Due and streak (`due-today.json`, `streak.json`)

On a vacation day (the learner's `today` is a date of a run of the workspace) nothing is due and no new card
is offered. Otherwise a card is due when `due <= now`: instant, not Anki's whole-day rule. Streaks skip
vacation dates: they neither extend nor break a run, a review on one does not count, `todayDone` is true on a
vacation day, and "consecutive" means the next non-vacation date.

## Limits (`limits-rows.json`, `daily-limits.json`)

Per deck `d` (current members, after the canonical merge: `study/canonical.json`), learner day `D`: `newDone(d)` counts cards whose
first valid review is on `D`, `reviewDone(d)` cards first reviewed before `D` that have a valid review on `D`.
Admission walks the candidates in queue order and skips what does not fit: `continuing` (due, already reviewed
today) is admitted without touching the counts but is capped by the session review limit; `review` and
`new` need every existing deck of the card to have allowance left and the session cap not reached; each
admission uses one slot of all its decks. `left` is the same pass without session caps (`reviews` includes
continuing cards); `unlimited` is true when every involved deck is unlimited in both fields (false with no
candidates); `limitedOut` counts candidates refused by a daily limit.

## Next intervals (`next-intervals.json`, generated)

Issue #101: each grade button shows when the card would come back. The preview replays the card exactly as the
schedule does (same weights, same study clock: `f_i = max(v(ts_i), f_{i-1})`), feeds `now` the same way
(`f_now = max(v(now), f_last)`), asks ts-fsrs `repeat(card, f_now)` for the four outcomes and maps each due back
with `inverse`. A card with no review yet (a virtual item) previews `createEmptyCard(f_now)`, the card the first
review creates. `expected` gives per grade 1–4 the `due` instant and `ms = due - now` (real time). Grading at
`now` and replaying must give exactly the previewed due. The file is **generated from plain ts-fsrs** with
plainly shifted dates (cases: a new card, learning steps 1 and 2, a review card on its due date and reviewed
early, a relearning card, the maximum interval, a vacation run between the last review and `now`, a custom
21-weight set). A re-show of a card already graded in the session is practice (never recorded) and shows no
interval.

## Interval text (`interval-text.json`)

The short label of an interval `ms` (hand-written cases on both sides of every edge): `ms <= 60 000` →
`lessThanMinute` (`<1m`, also for 0 and negative values: Anki shows the 1 minute step so); `< 60 min` →
`minute`, `round(ms / 60 000)`, at least 1; `< 24 h` → `hour`, rounded; `< 30 days` → `day`, rounded;
`< 365 days` → `month`, `round(days / 30)`, at least 1; else `year`, `days / 365` rounded to one decimal.
Rounding is half up. The text is the locale's narrow unit (`Intl.NumberFormat` `style: "unit"`, `unitDisplay:
"narrow"`: English `6m`, `3h`, `1d`, `1.4y`; a locale whose narrow month reads like its narrow minute, as
English `2m`, writes the month short: `2 mths`; `<1m` is the catalogue key `study.interval.under` with the
narrow 1 minute) and the screen-reader text is the relative form ("in 6 minutes"). The
fixture fixes the bucket and the value, not the string. Fixtures win over code.

## Android and other clients

Read the user-global `vacation:*` plugin rows (they arrive with `workspaceId: null`) and the typed `limits`
and `fsrsSets`/`fsrsActive` rows from one pull that names those collections. Use the learner's day for every date here, port
`v` and `inverse` with whole-day shifts (`n * 86 400 000 ms`, never the run's real length), feed ts-fsrs
`f_i = max(v(ts_i), f_{i-1})`, map the due back with `inverse`, keep the instant due rule
(`due <= now`), and build every queue from the same admission. A client must not write a vacation date before
its own `today`. Grade buttons show the next interval of each grade from the same replay (`next-intervals.json`)
with the buckets of `interval-text.json`.

## Regenerating the generated files

```sh
npm --prefix apps/web ci
node scripts/contracts/gen-scheduler-fixtures.mjs          # writes vacation-schedule.json, optimizer-steps.json, fsrs.json, next-intervals.json
node scripts/contracts/gen-scheduler-fixtures.mjs --check  # exit 1 when they are out of date
```

`optimizer-steps.inside.json` (reviews inside a frozen interval) is hand-written input of the generator.

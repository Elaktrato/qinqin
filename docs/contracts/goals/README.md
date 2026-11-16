# Goals contract: the daily goal, its amounts, day status and goal streak

Issue #67 (daily goals). Rule source: `docs/superpowers/specs/2026-11-16-v030s-daily-goals-design.md`; the
learner's day is `docs/contracts/study-day/`, vacation runs are `docs/contracts/scheduler/`. Every client
(web, Android) implements these rules and runs the fixtures in this folder. Fixtures win over code. Fixture
format: see `docs/contracts/README.md`. The server is unchanged: no Go test decodes these files.

Progress is **never stored**: nothing writes amounts or statuses; they are derived from the event log every
time.

## Storage row (plugin `qinqin-flashcards`, plugin data)

`goals:workspace`, **workspace-scoped** (written with `?workspace=<id>`, never user-global):

```json
{ "version": 1, "showStreak": true,
  "history": [ { "from": "2026-11-16", "metric": "activity:review", "target": 50 },
               { "from": "2026-12-01", "metric": "activity:read", "target": 20 },
               { "from": "2027-01-10", "metric": null, "target": null } ] }
```

Parsing (`goal-rows.json`, `op: "parse"`):

- Not an object, or `version` not an integer: no row (`null`). An integer `version` above 1: `"newer"` — no
  goal is shown and a client must not overwrite the row. `version` 1 is read as below.
- `showStreak`: a boolean, else `true`.
- `history`: an array, else `[]`. Each entry is an object with `from` (a real `YYYY-MM-DD` date), and either
  `metric: null, target: null` (no goal from that date) or a valid metric with a valid target. An invalid
  entry is dropped; the others are sorted by `from` (stable); of entries with the same `from` the later
  array position wins.
- Unknown top-level keys and unknown entry keys are kept verbatim and written back unchanged.

Metrics and targets (integers, in display units):

| Metric | Amount of a learner day | Target |
| --- | --- | --- |
| `activity:<type>` (type 1..64 characters) | the activity cell's `raw` of that workspace, type and day (`GET /api/stats/activity?workspace=`): a count, or clamped seconds for `unit: "seconds"` sources | 1..9999 when parsing; Settings offers 1..9999 for count sources and 1..1440 minutes for seconds sources |
| `flashcards:new` | cards whose first valid review (after the canonical merge) is on the day | 1..9999 |
| `flashcards:studyTime` | sum over the day's valid reviews of `min(meta.durationMs, 60000)` ms; absent or invalid (`< 0`, not a finite number) adds 0 | 1..1440 minutes |

A valid review has a parseable `ts`, a non-empty `cardId` and `grade` 1..4 (as in `scheduler/`). New cards
count card ids in the review log, not current deck members.

The goal of day `D` is the last entry with `from <= D`; before the first entry, or under a null entry, `D`
has no goal.

Edits (`goal-rows.json`, `op: "edit"`, `expect: null` = nothing is written) on the learner's `today`:

- A goal or `null` (remove): when it equals the goal in effect on `today` (same metric and target, or both
  none), nothing is written. Otherwise an entry with `from == today` is replaced (its unknown keys kept),
  else a new entry `{from: today, metric, target}` is added. If the replaced entry would then equal the goal
  in effect on `today - 1`, it is removed instead (editing back and forth on one day leaves no trace).
- `{showStreak}`: nothing is written when the value is unchanged (`true` for no row); otherwise the field is
  set (a new row `{version: 1, showStreak, history: []}` when there was none).
- A new row is `{version: 1, showStreak: true, history: [...]}`. At most 400 entries are written: the oldest
  are dropped.
- A `"newer"` row is never edited.

## Amounts (`goal-amounts.json`)

`op: "flashcards"`: the reviews of one workspace (`zone` is the learner's single zone) to
`{"<day>": {newCards, studySeconds}}` by the learner day of each review's `ts`; `studySeconds` is the capped
milliseconds / 1000, not rounded. A day appears when it has at least one valid review. Order of the input does
not matter (each card's reviews are sorted by `ts`, then `id`).

`op: "activity"`: activity cells to `{"<day>": {"<type>": raw}}` of the given `workspace`; cells of other
workspaces are ignored.

## Day status (`goal-days.json`)

For workspace `w`, learner day `D`, `today` (`units` gives each activity source's unit; a type missing there
is not in the route's `sources`):

| Status | When |
| --- | --- |
| `none` | no goal on `D` (before the first entry, null entry), or the goal's activity type is not a current source (`unavailable: true`) |
| `vacation` | `D` is a vacation date of `w` (`vacationRuns`), whatever was done |
| `met` | the amount reaches the target: `amount >= target` for counts, `seconds >= target * 60` for seconds and study time |
| `open` | `D == today` and not met |
| `missed` | `D < today` and not met |

Checked in this order (vacation before the amount). Days after `today` are not evaluated (an error).
`amount` is in display units: a count, or whole minutes (floor of seconds / 60); it is 0 for `none`. On a
vacation day `amount` still reports what was done. `metric` and `target` are the goal in effect (null for no
goal; kept for an unavailable goal). The fixture's `days` gives the amounts per day (`activity`, `newCards`,
`studySeconds`); a day not listed has none.

## Goal streak (`goal-streak.json`)

Consecutive `met` days ending today, or ending yesterday while today is `open`. Vacation days are skipped
(neither extend nor break); `none` and `missed` break. `todayMet` is true when today is `met` or `vacation`.
The walk never goes before `windowStart` (normally `today - 365`, the activity route's 366-day cap); when it
passes `windowStart` without a break and the run is not empty, `capped` is true and the run shows as "365+
days". Today `none` gives `current: 0`.

## Android and other clients

Read `goals:workspace` with the `limits:*` rows (one plugin-data pull, rows of the current workspace only;
a tombstone is absent). Amounts for `activity:*` come from `GET /api/stats/activity?from=&to=&workspace=`
(the server buckets cells by the learner's day); `flashcards:*` from the local review log by the learner's day
(`dayOf` of `study-day/`, never the study clock), so reviews still in the outbox count for those. Vacation runs
as in `scheduler/`. Use the same day status and streak rules; never store progress.

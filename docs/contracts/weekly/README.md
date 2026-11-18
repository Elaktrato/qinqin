# Weekly contract: the week of a learner date and its summary

Issue #81 (weekly summary, in-app only). Rule source: `docs/superpowers/specs/2026-11-16-v030s-weekly-summary-design.md`;
the learner's day is `docs/contracts/study-day/`, vacation runs and streaks are `docs/contracts/scheduler/`,
new cards, study time and goal days are `docs/contracts/goals/`, mature is the decks view's definition
(`docs/contracts/decks/`). Every client (web, Android) implements these rules and runs the fixtures in this
folder. Fixtures win over code. Fixture format: see `docs/contracts/README.md`. The server is unchanged: no Go
test decodes these files.

The summary is **never stored**: no row, no row key, no cached statistic. It is derived from the event log, the
activity route and the local review log every time it is shown. There is no email and no scheduler.

## What is a week?

For a learner date `D`, `weekOf(D) = D − (isoWeekday(D) − 1)` days, with `isoWeekday` 1 = Monday … 7 = Sunday
computed from the civil date (proleptic Gregorian, `Date.UTC(...).getUTCDay()`), never from an instant. The week
is the seven dates `Mon … Mon + 6` (civil-date arithmetic, `addDays`). Its window is
`[dayStart(Mon), dayStart(Mon + 7))` of the learner's zone history; an event belongs to the week when `dayOf(ts)`
is one of the seven dates, which is the same set because `dayOf` is monotone and `dayOf(t)` is the greatest `D`
with `dayStart(D) ≤ t` (study-day contract). The current week is `weekOf(today)`.

- Ruling: Monday start for every learner, whatever the browser locale — the owner says "Monday to Sunday"; ISO
  weeks are the international default and the same everywhere — cost: a learner used to Sunday weeks reads
  "Mon–Sun".
- Ruling: weeks are civil dates, not 7 × 24 h — a DST week is 167 h or 169 h, a zone change makes one day longer
  or shorter, and a skipped date (eastward move, `Pacific/Apia` 2011-12-30) is an empty window — cost: none; the
  same rule as every streak.
- Ruling: a skipped date (`dayStart(D) = dayStart(D + 1)`) is shown as "—" (no such day for you) and excluded from
  the days-active denominator — counting it would turn a flight into a missed day — cost: one extra day state.

`week-of.json`: cases `{name, note, history, day, monday, dates[7], start, end, skipped[]}` (`start`/`end` the
week window as RFC 3339 UTC instants, `skipped` the dates with an empty window) and `{name, op: "normalize",
today, param, expect}`.

### URL parameter and the 52-week cap

`/stats/week?week=YYYY-MM-DD`. `normalize(param, today)`: no parameter, an empty one, or anything that is not a
real `YYYY-MM-DD` date → `weekOf(today)`; a date → its Monday; a Monday after `weekOf(today)` → `weekOf(today)`;
one before `weekOf(today) − 52 × 7` days → that oldest Monday. `MAX_WEEKS_BACK = 52` completed weeks before the
current one are browsable, whatever the account's age.

## The summary of one week

Inputs: the workspace `w`, the week's Monday `d₁` (… `d₇`), the learner's `today` and `now`, the zone history,
the vacation runs of `w` (`vacationRuns`), the activity response of `w` for `d₁ − 7 … min(d₇, today)` (14 dates;
`null` when the route failed), the local review log (after the canonical merge), the goal row. `last =
min(d₇, today)`. A week after the current one is an error.

| Row (`key`) | Source | Definition (summed over `d₁ … last`) |
| --- | --- | --- |
| `reviews` | activity `review` | the cells' `raw` of `w` (the heatmap's count) |
| `newCards` | local review log | cards whose first valid review is on the date (`goals/`, `flashcardAmounts`) |
| `studyTime` | local review log | `min(durationMs, 60 s)` per valid review, in seconds (`goals/`) |
| `reading` | activity `read` | `raw` seconds |
| `journal` | activity `journal` | `raw` |
| `activity:<type>` | activity | every other source of the response whose week **or** comparison window is non-zero, ordered by `label` |

The five built-in rows are always present. A row's `value` and `previous` are `null` for activity rows while the
activity response is unavailable (offline); the local rows are always numbers.

Ruling: a plugin source is shown when either window is non-zero (not only the week) — a source that dropped to 0
this week is the comparison the learner wants to see — cost: a source unused this week shows "0".

Ruling: reviews, reading and journal come from the activity route, not the local log — one meaning of "reviews"
across heatmap, daily goal and week (the #67 ruling); plugin activity types appear without client changes — cost:
a review still in this device's outbox counts once it reaches the server (new cards, study time, streak and mature
words are local and include it).

### Days

Each of the seven dates has a state, in this order of precedence:

| State | When |
| --- | --- |
| `upcoming` | the date is after `today` (never counted; `reviews: null`) |
| `skipped` | `dayStart(D) = dayStart(D + 1)` |
| `vacation` | a vacation date of `w` (its numbers still count in the totals) |
| `active` | a cell of `w` with `points > 0` on the date, or a valid local review whose `dayOf(ts)` is the date |
| `inactive` | otherwise |

`reviews` of a day is the `review` cell's `raw` (0 without a cell), `null` offline or upcoming.
Days active: `active` = days in state `active`; `of` = dates `≤ last` that are neither `vacation` nor `skipped`,
and today only once it is `active` (an empty morning is not a missed day);
`localOnly: true` when the activity response is unavailable (then only local reviews make a day active).

Ruling: totals include what was done on vacation days (it happened) while the days-active line and the goal line
leave vacation days out — "neutral" means a vacation day neither counts for nor against the learner — cost:
"Active on 4 of 5 days" can sit beside reviews made on a sixth, vacation day.

`allVacation`: every date of the week is `vacation` or `skipped`, at least one `vacation`.

### Previous days (the paired bars)

`previousDays` is the seven dates `d₁ − 7 … d₁ − 1` (Monday to Sunday), each with the same shape and state
rules as `days`: `reviews` is the `review` cell's `raw`, `points` the sum of the date's cells' `points`;
`null` for both while the activity response is unavailable. All seven dates are in the past, so the state is
never `upcoming`; the other states follow the same precedence (`skipped`, `vacation`, `active`, `inactive`).
The state is active on a day with points of any activity type or with a local review — the same rule as the
week's days.

The paired bars use this whole week; the four numbers above them keep the contract's comparison window
(`previous` on each row: the same weekday for the week in progress, the whole week for a completed one).

Ruling: the paired bars measure each day's **activity points** (`WeekDay.points`, the heatmap's measure,
covering every activity type) — the mock does not name the measure and points are what "a day's study" means
everywhere else; last week's bars cover all seven days while the four numbers keep the same-days window —
cost: on a Wednesday the bars show last week's Thursday–Sunday, which the numbers do not count (the legend
says "last week", not "compared").

### Streak

`dailyStreak(reviews, end, day, vacation).current` (`scheduler/`), `end = now` for the current week, else
`dayStart(d₇ + 1) − 1 ms`. No comparison.

### Daily goal

`goalDays(row, d₁, last, today, …)` (`goals/`): `met` = days `met`; `of` = days `met` or `missed`. `none`,
`vacation`, unavailable and skipped dates are left out, and so is today while it is `open`. `null` when the week has
no goal on any day `≤ last` (or the row is from a newer version). No comparison.

Ruling: today's open goal day is not counted until it is met — "1 of 2 days" on Friday morning would otherwise read
as a miss — cost: the in-progress week's denominator grows when today's goal is reached.

### Words reaching mature

Mature: the vocab card's schedule is in Review with stability ≥ 21 days (`classifySchedule`). Scope: live vocab
cards in at least one existing deck (General or a deck that exists). A word **reached mature** in the week when its
state at the end of `last` is mature and its state at the end of `d₁ − 1` is not. "State at the end of day D" is
the schedule replayed from the card's valid reviews with `ts < dayStart(D + 1)` (the workspace's study clock and
active weights). Net crossing: a word mature on Tuesday and lapsed on Friday did not reach mature; a deleted card
counts in no week.

### Characters learned

Han languages only (`null` otherwise). A character is learned when its cell score (best of the glyph and its
variants; mean card strength over vocab, sentence, writing and tone cards whose written snapshot contains it) is
≥ 80 — Stats → Characters. **Learned in the week** = learned at the end of `last` and not at the end of `d₁ − 1`,
over the language's character universe.

### Comparison with the previous week

Every count row, mature words and characters show `previous`, the same quantity over the comparison window:

- a completed week: the whole previous week `d₁ − 7 … d₁ − 1`;
- the current (in-progress) week: the previous week up to the same weekday, `d₁ − 7 … today − 7`
  (`compareThrough`), so Wednesday never looks like a collapse.

Ruling: the in-progress window ends with the **whole** of `today − 7`, not at the same local time a week ago — the
activity cells are whole learner days (the route has no time of day), and cutting only the local rows at a time
of day would give one row two meanings — cost: on a Wednesday morning, all of last Wednesday is in the comparison.

For mature and characters the comparison window's "before" and "after" are the end of `d₁ − 8` and the end of
`compareThrough`. `nothingToCompare`: the comparison window has no activity cell of `w` with `points > 0` or
`raw > 0` and no valid local review (offline: local reviews only). Text: "12 more than last week", "3 fewer than
last week", "Same as last week", "Nothing last week to compare"; seconds rows compare in the whole minutes they
show ("5 min less than last week"). No comparison is shown for a row whose value or previous is unavailable.

`week-summary.json`: cases `{name, note, history, now, week, workspace, language, vacation, goals, activity:
{sources, cells} | null, reviews: [{id, ts, cardId, grade, durationMs?}], cards?, decks?, timelines?, chars?,
expect}`; `timelines` gives each card's schedule after each review as `{ts, state, stability}` so the file does
not depend on FSRS parameters. `expect` holds `inProgress`, `compareThrough`, `rows`, `days`, `daysActive`, `streak`,
`goal`, `allVacation`, `nothingToCompare`, `mature`, `characters`; a key absent from a case's `expect` is not
checked.

## Android notes

- Week of a learner date by civil date (`java.time.LocalDate.getDayOfWeek`), the window from `dayStart`.
- One `GET /api/stats/activity?from=<d₁ − 7>&to=<min(d₇, today)>&workspace=<w>` per shown week (14 dates).
- New cards, study time, the streak and local active days from the local review log.
- Mature and character crossings from its own FSRS replay: one timeline per reviewed card, sampled at the two
  cutoffs (the fixtures give schedules, so FSRS parameters do not matter).

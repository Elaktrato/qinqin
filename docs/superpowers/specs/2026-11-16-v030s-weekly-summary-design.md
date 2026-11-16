# Weekly summary — design (issue #81)

Status: Draft (2026-11-16), v0.3.0 stretch item 8. Written unattended; every non-obvious call is a
**Ruling** (`what — why — cost if wrong`). Nothing is built. **Depends on** the learner's day
(`docs/contracts/study-day/`), vacation (`docs/contracts/scheduler/`), the core activity statistics
(`GET /api/stats/activity`, #48), the decks view numbers (`docs/contracts/decks/`), the character map
(Stats → Characters), daily goals (#67, `lib/goals/`) and known words (#75, `study/known.ts`).

## Intent

The owner's scope decision overrides the issue body: **no email**. An in-app view of what the learner did and
worked on over one week, **Monday to Sunday in the learner's local days**: reviews, new cards, time studied and
days active, the streak, words reaching mature, characters learned, reading and journal activity, goal
progress, compared with the previous week. Previous weeks are browsable, the current week is shown as in
progress, vacation days are marked and neutral. No mail, no scheduler, computed from events.

## Goals and non-goals

- A Stats tab **Week** (`/stats/week`) with the full summary of one week and previous / next week links.
- A core widget `weekly-summary` ("This week") for home and the Stats overview: the week-to-date headline numbers,
  the seven-day strip and a link to the tab.
- Pure modules in `apps/web/src/lib/weekly/` with JSON fixtures in `docs/contracts/weekly/`.
- **No server change, no new route, no stored statistic, no new row key.**
- Non-goals: email or notifications, a scheduler, milestones, level progress, all-workspaces scope, sharing or
  export of a week, a monthly or yearly view, Android (it reads the contract later).

Ruling: milestones (first 100 words, 1000 reviews, streak lengths, level completions) are deferred — the
owner's direction lists the week's contents and leaves them out; "shown once, then in a history list" needs
a stored seen-state per user (a new row, sync, backup, a newer-version rule) that the "computed from events"
direction avoids — cost: the issue body's milestones are not delivered; a later item can derive the history
list from the same replay timelines (below) and store only "last seen".
Ruling: no "level progress" row — the owner's direction replaces it by "characters learned" and "words reaching
mature", and per-level counts already live on the decks view and the character map — cost: a learner who wants
"HSK 2: 31 → 38 of 150" this week does not get it.

## Questions and answers

**What is a week?** For a learner date `D`, `weekOf(D) = D − (isoWeekday(D) − 1)` days, with `isoWeekday`
1 = Monday … 7 = Sunday computed from the civil date (proleptic Gregorian, `Date.UTC(...).getUTCDay()`),
never from an instant. The week is the seven dates `Mon … Mon + 6` (civil-date arithmetic, `addDays`). Its
window is `[dayStart(Mon), dayStart(Mon + 7))` of the learner's zone history; an event belongs to the week
when `dayOf(ts)` is one of the seven dates, which is the same set because `dayOf` is monotone and
`dayOf(t)` is the greatest `D` with `dayStart(D) ≤ t` (study-day contract). The current week is
`weekOf(today)`.

Ruling: Monday start for every learner, whatever the browser locale — the owner says "Monday to Sunday";
ISO weeks are the international default and the same everywhere — cost: a learner used to Sunday weeks reads
"Mon–Sun".
Ruling: weeks are civil dates, not 7 × 24 h — a DST week is 167 h or 169 h, a zone change makes one day longer
or shorter, and a skipped date (eastward move, `Pacific/Apia` 2011-12-30) is an empty window — cost: none; the
same rule as every streak.
Ruling: a skipped date (`dayStart(D) = dayStart(D + 1)`) is shown as "—" (no such day for you) and excluded
from the days-active denominator — counting it would turn a flight into a missed day — cost: one extra
day state.

**What is in a summary?** For workspace `w` and week `W` (dates `d₁ … d₇`, `last = min(d₇, today)`):

| Row | Source | Definition |
| --- | --- | --- |
| Reviews | activity `review` | sum of the cells' `raw` of `w` over the week's dates (the heatmap's count) |
| New cards | local review log | `flashcardAmounts(...).newCards` summed (`lib/goals/amounts.ts`, first valid review per card) |
| Flashcard study time | local review log | `studySeconds` summed (60 s cap per review, #67) |
| Reading | activity `read` | sum of `raw` seconds |
| Journal entries | activity `journal` | sum of `raw` |
| Other sources | activity | every other `sources` entry with a non-zero week, by its `label` and `describe` |
| Days active | both | non-vacation, non-skipped dates `≤ last` with a cell of `w` with `points > 0` or a local valid review |
| Streak | local review log | `dailyStreak(reviews, end, day, vacation).current` with `end` = `now` for the current week, else `dayStart(d₇ + 1) − 1` |
| Words reaching mature | replay | below |
| Characters learned | replay | below (Han languages only) |
| Daily goal | `goalDays` (#67) | met / reached-or-missed counts over `d₁ … last`, vacation and none days left out |

Ruling: reviews, reading and journal come from the activity route, not the local log — one meaning of
"reviews" across heatmap, daily goal and week (the #67 ruling); plugin activity types appear without client
changes — cost: a review still in this device's outbox counts once it reaches the server (new cards, study
time, streak and mature words are local and include it).
Ruling: totals include what was done on vacation days (it happened) while the days-active line and the goal
line leave vacation days out — "neutral" means a vacation day neither counts for nor against the learner —
cost: "Active on 4 of 5 days" can sit beside reviews made on a sixth, vacation day; the strip shows that day as
vacation with its numbers in the tooltip text.

**Words reaching mature.** Mature is the decks view's / word states' definition: the vocab card's derived
schedule is in Review with stability ≥ 21 days (`classifySchedule`, `MATURE_STABILITY_DAYS`). Scope: the decks
view's overall scope — live vocab cards in at least one existing deck. A word **reached mature in week W** when
its state at the end of `last` is mature and its state at the end of `d₁ − 1` is not. "State at the end of day
D" is the schedule replayed from the card's valid reviews with `ts < dayStart(D + 1)` (the workspace's study
clock, the active weights — exactly `scheduleFor` over that prefix).

Ruling: net crossing (not mature before Monday, mature at the end of the week) rather than "any review of the
week that made it mature" — a word that turned mature on Tuesday and lapsed on Friday did not reach mature this
week in any useful sense; a word that was mature, lapsed long ago and is mature again counts again — cost: a
mid-week lapse hides a crossing.
Ruling: the scope is the live deck cards of today, not the cards as they were — the summary reports words the
learner still has; a deleted card's progress vanishes from all weeks — cost: past weeks can lose a count after a
deletion (the same as the decks view).

**Characters learned.** Han workspaces only (`usesHan`). A character is learned when its cell score (best of the
glyph and its variants, `cellStates`, mean card strength over `MASTERY_KINDS` cards, `MASTERY_THRESHOLD` 80) is
≥ 80 — exactly Stats → Characters and the levels' "L of N learned". **Learned in week W** = learned at the end of
`last` and not at the end of `d₁ − 1`, over the language's character universe (`fetchCharacters`).

Ruling: characters reuse the map's pipeline through a new `masteryFromSchedules(chars, cards, scheduleOf)` that
`masteryForChars` delegates to (the same refactor shape as `knownEntries(cards, scheduleOf)`) — no second
mastery formula — cost: a refactor of `mastery.ts` under its existing tests.
Ruling: no "known words" row — `knownEntries` (score ≥ 80) and "words reaching mature" (stability ≥ 21) would
show two near-identical numbers; mature is what the owner's direction names — cost: the starter decks' "known"
is not reported weekly.

**Replay once per page.** `scheduleTimeline(cardId, reviews, w, clock)` (in `study/scheduler.ts`, next to
`scheduleFor`) returns the schedule after each valid review with its instant; its last element equals
`scheduleFor`. `scheduleAt(timeline, cutoffMs)` picks the last element with `ts < cutoff` (binary search). One
timeline per reviewed card is built per loaded study history (memoised on the history object and the weights)
and every week, comparison week and the characters sample from it. Browsing to another week replays nothing.

Ruling (corrected in the review fix wave): memoise on the review log's **content** (`reviewsKey`: the count and
an FNV-1a hash of each event's id, ts, card and grade), the weights and the clock runs, not on the history object —
`loadStudyHistory` returns a new object after its 8 s TTL, so an identity memo replayed everything on the next
"Previous week"; the content key costs one hash pass per new history object and keeps four entries — cost: memory
of one schedule per review for up to four logs (~100 000 small objects for a 100 000-review learner).

**Compared with the previous week.** Each count row shows the difference to the previous week. A completed week
compares with the whole previous week. The **current (in-progress) week compares with the previous week up to the
same weekday** ("vs. Mon–Wed last week"), so Wednesday never looks like a collapse. Text: "12 more than last week",
"3 fewer than last week", "Same as last week"; "Nothing last week to compare" when the whole comparison window
has no activity and no local review (a first week, a week after a break). Arrows are decorative (`aria-hidden`); the words carry the meaning.

Ruling: same-weekday comparison for the in-progress week — a full-week baseline makes every Monday a drop —
cost: one more window computation (cheap; same timelines, same request).
Ruling: no comparison for streak (a state, not an amount) and for the goal line — cost: none.

**How far back?** Ruling: 52 completed weeks before the current one (`MAX_WEEKS_BACK = 52`), whatever the
account's age; a week with nothing in it says "No activity this week" — matches the goal streak's one-year
window, keeps the links bounded and needs no "first event" lookup (reading and journal events live only on the
server); each week costs one activity request of 14 days, far below the route's 366-day cap — cost: older weeks
are not browsable (a constant), and a new account can step back into empty weeks.

**URL and navigation.** `/stats/week?week=YYYY-MM-DD` (the Monday). No parameter = current week. A date that is
not a Monday is normalised to its week, a future week to the current week, one before the cap to the oldest
allowed week (`replaceState`, no history entry). Previous / next are links (`data-sveltekit-keepfocus`,
`noscroll`); "next" is absent on the current week. The heading reads "This week (16–22 November 2026)", "Last week
(9–15 November 2026)" or "Week of 2–8 November 2026" (`Intl.DateTimeFormat`, the browser locale, `timeZone:
'UTC'` on the civil date so no zone shifts the label).

**Loading.** One `loadStudyHistory(workspaceId)` (cached, shared with every widget) and one
`fetchActivity(prevMonday, min(sunday, today), workspaceId)` per shown week: 14 dates, the week and its comparison
week. Characters additionally use `fetchCharacters(language)` (session-cached ~13k rows) and render after the rest
("Counting characters…"). The home widget skips characters and mature words: it needs only the activity request
and the local log. Reload on workspace switch (stale answers dropped by a sequence guard) and on `onContextStale`
(midnight, zone change: the current week can change on Monday 00:00).

**Offline.** Local rows (new cards, study time, streak, mature words, characters, goal days from local metrics,
vacation marks) render from the cached study history. Activity rows show "Not available offline" with a Retry
button and are left out of the comparison; days active then counts local reviews only and says so ("from
flashcard reviews only"). Ruling: partial render instead of an error page — the local half is exact offline and
the activity route is never cached by the service worker (`docs/contracts/pwa/`) — cost: two states per row.

**Workspace scope.** The current workspace only, as daily goals and the decks view. Ruling: no "all workspaces"
switch in v1 — new cards, mature words and characters are per workspace data; mixing a Chinese and a Japanese
workspace's "characters learned" is meaningless — cost: a learner with several workspaces looks at each.

**Vacation.** `vacationRuns(data.vacations, w, today)`; a vacation date is marked in the strip ("Vacation") and
left out of days active and the goal line; it never breaks the streak (`dailyStreak` already skips it). A week
that is entirely vacation shows "On vacation all week" above its (usually empty) totals.

**The current week.** Labelled "In progress"; dates after today are shown as upcoming (no number, "Upcoming"
text) and never counted; "Days active" reads "3 of 3 days so far".

**Home widget.** Core widget `{id: 'weekly-summary', title: 'This week', size: 'normal', surfaces: ['stats',
'home']}`: reviews, new cards, study time (flashcards + reading), days active with the strip, streak, each with
the same-weekday comparison, and a link "See the week" to `/stats/week`. Ruling: appended to `DEFAULT_LAYOUT`
after `daily-goal`; stored layouts are untouched — the #67 precedent; new learners find it, nobody's arranged
home changes — cost: learners without a stored layout see one more card.

**Accessibility.** The tab joins the Stats tablist (Overview, Week, Characters) with its keyboard model. The
numbers are a `<dl>` (term = row name, description = value and comparison as text). The strip is an `<ol>` of
seven items, each with visible abbreviated weekday text and an accessible name "Monday 16 November: active, 42
reviews" / "vacation" / "upcoming" / "not active" / "no such day"; states differ by text and an icon shape, not
colour alone; colours from theme tokens, 3:1 against the card in both themes. The week heading is the page's `h2`
and receives focus after a week link is followed (keepfocus keeps the link focused; the heading has
`aria-live="polite"` so the new week is announced). No animation.

## The pure interface

`apps/web/src/lib/weekly/`: `week.ts` (week math), `replay.ts` (timeline sampling, mature crossings, character
crossings), `summary.ts` (rows, days, comparison), `weekText.ts` (labels, comparison words, accessible names),
`loadWeek.ts` (I/O only). `study/scheduler.ts` gains `scheduleTimeline` / `scheduleAt`; `study/mastery.ts` gains
`masteryFromSchedules`. Components stay thin: `WeekSummary.svelte`, `WeekStrip.svelte`, the route page and
`WeeklySummaryWidget.svelte`.

## Contract fixtures (`docs/contracts/weekly/`)

- `week-of.json` — `weekOf`, the seven dates and the week window (`dayStart` of Monday and of the next Monday) for
  UTC, a Berlin DST-start week (2026-03-23) and DST-end week (2026-10-26), a mid-week Tokyo → Berlin change, an
  Apia week with the skipped 2011-12-30, a year boundary (2026-12-28 … 2027-01-03), normalisation of a URL date
  (non-Monday, future, before the cap).
- `week-summary.json` — inputs: zone history, today, week, vacation runs, activity cells, reviews, card timelines
  given as schedules (`{ts, state, stability}`, so the file does not depend on FSRS parameters), deck membership,
  goal row; expect: every row, the strip states, the comparison (completed and in-progress), mature and character
  crossings (crossed, already mature, lapsed mid-week, deleted card, card outside every deck, a variant form
  setting the cell), skipped date, all-vacation week.

Decoded by `lib/weekly/*.test.ts`. No Go test: the server is unchanged. `docs/contracts/README.md` gains the
folder row; `overview.md` lists the rule under study rules (no row key).

## Risks

- Replaying every card for the Week tab costs the same as the decks view; the home widget avoids it.
- A plugin that renames its activity type splits a source across weeks (the old label disappears).
- Two devices offline: each shows its own local half until they sync; activity rows agree once online.

# Daily goals — design (issue #67)

Status: Draft (2026-11-16), v0.3.0 stretch item 1. Written unattended; every non-obvious call is a
**Ruling** (`what — why — cost if wrong`). Nothing is built. **Depends on** the learner's day
(`docs/contracts/study-day/`), vacation and limits (`docs/contracts/scheduler/`) and the core activity
statistics (`GET /api/stats/activity`, `server/internal/stats`). The weekly summary (#81) reuses the pure
day function defined here.

## Intent

The learner sets one target for a learner day ("50 flashcard reviews", "20 minutes of reading") and sees how
far today is, when it is reached, and how many days in a row they reached it. Owner's direction: a target
the learner sets and tracks; uses the learner's local day, honours vacation mode (neutral), sits with the
limits and streak logic. Progress is derived from the event log, never stored.

## Goals and non-goals

- One goal per workspace, set in Settings → Study next to the daily limits; a progress ring on the home page
  (new core widget) and a small ring in the flashcards widget; a "goal reached" state; an optional goal streak
  shown beside the review streak; vacation days neutral.
- A pure function "goal and progress on day D" for #81, with JSON fixtures in `docs/contracts/goals/`.
- **No change for learners who set no goal**, apart from one new home widget offering to set one.
- Non-goals: reminders or notifications, several goals at once, weekly or monthly targets, goals across all
  workspaces, celebrations or XP for reaching a goal, a goal line on the study session page, server changes.

## Questions and answers

**What can a goal measure?** The issue: "anything the core activity statistics counts"; the owner adds new
cards and minutes. So a metric is one of:

- `activity:<type>` — any type the activity route lists in `sources` (today `review` = flashcard reviews,
  `read` = reading time, `journal` = journal entries; plugin types later without client changes). The amount is
  the cell's `raw` (a count, or clamped seconds for `unit: "seconds"`) of that workspace and learner day.
- `flashcards:new` — cards whose first valid review (after the canonical merge) falls on the day.
- `flashcards:studyTime` — flashcard study time: the sum over valid reviews of the day of
  `min(meta.durationMs, 60 000)`; a review without `durationMs` adds 0.

Ruling: "minutes of study" means flashcard answer time, capped at 60 s per review — the session page already
records `durationMs`; reading has its own metric; Anki caps answer time at 60 s so an idle tab does not count an
hour — cost: reviews recorded before `durationMs` existed and long deliberate answers count less.
Ruling: "reviews" is the activity type `review` (every review event, learning steps included, as the heatmap
counts them) rather than a second, local definition — one meaning of "reviews" across heatmap, goal and #81 —
cost: a review still in this device's outbox counts once it reaches the server (see Offline).
Ruling: new cards counts card ids in the review log, not current deck members — the goal is about the day's
work; a card deleted later stays counted — cost: can differ from the limits' `newDone` after a deletion.

**One goal or several?** Ruling: one goal per workspace in v1 — a single ring and a single streak are clear;
the issue's list reads as "pick a type" — cost: a learner who wants reviews and reading picks one; a later
multi-goal row is a new key, the v1 row stays readable.

**Where is it stored?** "Per workspace and per user, stored with the user's settings": a workspace-scoped
plugin data row `goals:workspace` of `qinqin-flashcards`, next to `limits:workspace`:

```json
{ "version": 1, "showStreak": true,
  "history": [ { "from": "2026-11-16", "metric": "activity:review", "target": 50 },
               { "from": "2026-12-01", "metric": "activity:read", "target": 20 },
               { "from": "2027-01-10", "metric": null, "target": null } ] }
```

Ruling: a plugin row of `qinqin-flashcards`, not workspace settings or `qinqin-core` — it sits with the limits
and vacation rows it is read with (one sync pull, one cache, `getStudyData`), sync and backup carry it with no
new code (backup exports every plugin row, `docs/contracts/backup/`), Android reads it like `limits:*`; plugin
rows stay readable and writable while the plugin is switched off — cost: a reading-only learner's goal lives
in the flashcards plugin's data (named in the contract).

**How do past days keep their meaning after the target changes?** The row keeps a `history` of entries, each
in effect from its learner date `from` until the next entry; `metric: null` means "no goal" from that date.
The goal of day D is the last entry with `from ≤ D`; before the first entry, or under a null entry, D has no
goal. An edit on `today` replaces an entry whose `from` is `today`, otherwise appends one; an edit equal to the
goal already in effect writes nothing; `showStreak` is a plain field.

Ruling: target changes apply from today (the whole of today), never to earlier days — raising the target must
not turn yesterday's "met" into "missed" for the streak or #81 — cost: lowering the target at 23:00 makes today
met at once (accepted: it is the learner's own goal).
Ruling: at most 400 entries; on write the oldest are dropped — same-day edits collapse, so 400 covers more
than a year of daily edits — cost: days before the kept first entry lose their goal (only after >400 edit
days).
Ruling: parsing is per entry — an entry with an invalid date, metric or target is dropped; the rest is sorted
by `from` and a repeated `from` keeps the later array position; `version` must be 1; unknown top-level keys
and unknown entry keys are kept verbatim on write — cost: a corrupt entry silently vanishes.
Ruling: a row with an integer `version` above 1 shows no goal and Settings refuses to overwrite it ("set by a
newer version of qinqin") — a newer client's data is never destroyed — cost: an old client cannot edit it.

**Units and ranges.** `target` is an integer in display units: a count (1…9999) for count sources and
`flashcards:new`, minutes (1…1440) for seconds sources and `flashcards:studyTime`. Met when
`amount ≥ target` (counts) or `amount ≥ target × 60` (seconds). The ring shows whole minutes (floor).
An `activity:<type>` whose type is not in the route's `sources` (plugin removed) is **unavailable**: no ring,
the text "This goal's activity is no longer counted", and its days count as no goal.

**Which day does an event belong to?** The learner's day of its `ts` (`dayOf` of `study-day/`). The server's
cells are already bucketed that way (`studyday.History.Windows`); local amounts use `ctx.day.dayOf`. Both read
the same zone history, so a review at 23:30 in Tokyo counts for the Tokyo date on every device. The goal does
not use the study clock (whole-day vacation shifts are a scheduling matter).

**What is the status of a day?** For workspace `w`, learner day `D`, `today`:

| Status | When |
| --- | --- |
| `none` | no goal on D (before the first entry, null entry, unavailable metric) |
| `vacation` | D is a vacation date of `w` (`vacationRuns`), whatever was done |
| `met` | amount reaches the target |
| `open` | D = today and not met yet |
| `missed` | D < today and not met |

Days after today are not evaluated (an error for the pure function). Ruling: a vacation day is `vacation` even
if the learner studied — the same neutrality as `dailyStreak` (a review on a vacation day does not count) —
cost: studying on vacation does not extend the goal streak.

**Goal streak.** Consecutive `met` days ending today, or yesterday while today is `open`; `vacation` days are
skipped (neither extend nor break), `none` and `missed` break. `todayMet` is true when today is `met` or
`vacation`. Ruling: computed over a window of today and the 365 days before (one activity request, the route's
366-day cap); a run that reaches the window's first day is shown as "365+ days" (`capped: true`) — cost: no
exact count past a year, no "best goal streak". Ruling: `showStreak` (default true) only hides the line; the
review streak is unchanged and always shown — the issue calls the goal streak optional alongside it — cost: one
checkbox.

**Offline.** `flashcards:*` amounts come from the local study history (which includes reviews still in the
outbox); `activity:*` amounts come from the server. Ruling: no local estimate for activity metrics — the
manifests' activity rules are scored by the server; copying them would fork "what the statistics count" —
cost: offline, an activity goal shows the last loaded progress or an error line until the route answers.

**Limits interplay.** A `flashcards:new` target above what today's daily limits can admit cannot be reached by
studying. Settings shows "Your daily new-card limit is 20; raise it to reach this goal" when the workspace's
effective new limit (no deck overrides considered) is below the target; nothing is changed automatically. On a
vacation day the limits admit nothing and the goal is neutral, so they agree.

**Where does it show?**

- **Settings → Study**, new section "Daily goal" above Vacation: metric select (Flashcard reviews, New cards,
  Flashcard study time, then every other activity source by its `label`), target with its unit, "Show goal
  streak", Save, Remove goal; the limits hint; the newer-version note. Logic in `goalForm.ts`.
- **Home**: new core widget `daily-goal` (surfaces home and stats, size normal) — the ring, "32 of 50
  flashcard reviews today", "Goal reached" when met, "On vacation — goal paused", the goal streak line; without a
  goal "Set a daily goal" linking to `/settings?tab=study`. Ruling: added to `DEFAULT_LAYOUT` after
  `flashcards-summary`; stored layouts are untouched — new learners find the feature, nobody's custom home
  changes — cost: learners without a stored layout see one more widget.
- **Flashcards widget**: a 32 px ring with the short text "32/50" next to the review streak and, when enabled,
  "Goal streak: 4 days"; nothing when no goal is set.
- Both reload on workspace change and on `onContextStale` (midnight, zone change), and share one in-flight
  load (`loadGoalStatus`).

**Accessibility of the ring.** The ring is an SVG with `aria-hidden="true"` inside an element with
`role="progressbar"`, `aria-valuemin=0`, `aria-valuemax=target`, `aria-valuenow=min(amount, target)` and
`aria-valuetext` "32 of 50 flashcard reviews today" / "Goal reached: 62 of 50 flashcard reviews today"; the
same words are visible text, so nothing relies on colour; reached adds a visible check mark and the word
"Goal reached". The fill and track use theme tokens with at least 3:1 contrast against the card background
in light and dark themes; the fill caps at a full circle above 100 %. The arc transition is off under
`prefers-reduced-motion: reduce`. On vacation and without a goal there is no progressbar, only text.
Ruling: `role="progressbar"` over `role="img"` — screen readers announce value and range natively — cost: none.

**Text forms.** From the source's `describe` plural (`"{n} flashcard reviews"`): `{n}` becomes "32 of 50",
the plural form follows the target ("32 of 1 flashcard review" uses `one`). Seconds sources and study time
show minutes: "12 of 20 minutes of reading". Built-in texts for `flashcards:new` ("{n} new card(s)") and
`flashcards:studyTime` ("{n} minute(s) of flashcard study").

## The pure interface (also for #81)

`apps/web/src/lib/goals/`: `goals.ts` (row parse, `goalOn`, edit plan), `amounts.ts` (local amounts per day,
activity cells per day), `progress.ts` (`goalDay`, `goalDays`, `goalStreak`), `goalText.ts`, `ring.ts`,
`loadGoal.ts` (I/O only). #81 calls `goalDays(row, from, to, today, amountsOf, vacationRuns, units)` and reads
`status` and `amount` per day. No storage of progress anywhere.

## Contract fixtures (`docs/contracts/goals/`)

- `goal-rows.json` — parse (valid, wrong version, newer version, invalid entries dropped, sort and same-`from`
  rule, unknown keys kept) and edit plans (first goal, same-day replace, append, unchanged = no write, remove,
  `showStreak` toggle, 400 cap).
- `goal-amounts.json` — events → per-day `newCards` and `studySeconds` (canonical first review, invalid grade
  ignored, 60 s cap, missing `durationMs`, Tokyo 23:30 and a DST day by zone history) and activity cells →
  per-day amounts of one workspace (other workspaces ignored).
- `goal-days.json` — status per day: none before the first entry, target change from its day, null entry,
  unavailable type, seconds target, vacation day with activity, today open vs met, past missed.
- `goal-streak.json` — vacation gap, a missed day, today open counts from yesterday, a `none` day breaks, the
  365+ cap.

Decoded by `lib/goals/*.test.ts`. No Go test: the server is unchanged. `overview.md` gains the `goals:workspace`
row and `README.md` the folder row.

## Risks

- Two devices editing the goal on the same day: last write wins per key (the later edit's whole history).
- The home page issues one more activity request (a 366-day window of one workspace); the route's indexed
  per-window query keeps it cheap, and both rings share it.
- A plugin that renames its activity type orphans goals on the old type ("no longer counted").

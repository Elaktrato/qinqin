# Exam target and study plan — plan (issue #226)

Overview: `docs/superpowers/specs/2026-11-26-v090-courses-overview.md` (stage D). A learner sets a target (a level and a
date, e.g. ≈ HSK 4 by 2027-06-30); qinqin works out a daily pace and shows whether they are on track. Needs the
level lists (`hsk-words`, `jlpt-words` #219, `hsk-chars`, `jlpt-kanji`), the shared known predicate
(`lib/study/known.ts`, `knownMarks.ts`), the vacation rule (`lib/study/vacation.ts`), and for course lessons #221's
path derivation. Adds **one workspace setting** (`studyTarget`) and a shared rule with fixtures in
`docs/contracts/plan/` (expected contract 17); Android uses the same calculation because it is the web app.
Derived from the event log like the other statistics: **only the target itself is stored** (synced, backed up).
Builder: one agent, branch `feature/v090-study-plan` from `develop`. Test first in every task; one commit per task.

## The rule (pure, `apps/web/src/lib/plan/`)

Inputs: the target `{packId, level, date, createdAt}`, today and the workspace zone (study day), vacation runs,
the level lists, the learner's known predicate, the event log (reviews, `course` events), course path state.

1. **Remaining work** up to the target level: the unknown **words** (entries of the target scheme up to and
   including `level`, not known by the predicate) and, when the scheme has a character companion (HSK words →
   `hsk-chars`; JLPT words → `jlpt-kanji`), the unknown **characters**; and, if an unfinished course covers the
   target, the remaining **course lessons up to that section**.
2. **Days left** = study days from tomorrow to the target date minus vacation days (a vacation run in the future
   is treated as days off; none are assumed otherwise). A target date in the past or today → "Set a new date".
3. **Daily amount** = `ceil(remainingWords / daysLeft)` new words per study day, `ceil(remainingLessons /
   daysLeft)` lessons per day (words per lesson ≈ 6 is already inside the lesson count, the two are not added).
   Characters are shown as a side figure, not added to the load (characters are met inside words).
4. **Review load** (so the plan stays honest): `reviewsPerDay ≈ newPerDay × R`, where `R` comes from the learner's
   own history when they have at least 30 days of reviews (reviews per introduced word over the last 30 days
   divided by the days, bounded 1.5–12), else the default `R = 6` (a constant with a comment recording how it
   was chosen from FSRS defaults). A plan whose `newPerDay + reviewsPerDay` exceeds a **realism cap** (default:
   150 cards a day, adjustable) is flagged "Too ambitious: move the date to …" with the suggested date.
5. **Progress status** against the straight line from the target's `createdAt` to its date: expected learned
   fraction `e = elapsedStudyDays / totalStudyDays`, actual `a = learned / (learned + remaining at creation)`;
   `ahead` when `a − e > 0.05`, `behind` when `< −0.05`, else `on track`. Projected finishing date = today +
   `remaining / pace` where `pace` = the mean words learned per study day over the last 14 days (no projection
   with fewer than 7 days of data: "Not enough data yet").
6. **Feeding the goals:** the plan can **suggest** a daily goal (#67) and a daily new-card limit; the settings
   show "Use these numbers" and never change either silently. Multiple goals (#162) is a v1.0.0 issue: the
   suggestion targets the existing single goal and the plan notes it.

## Tasks

1. **Contract first** (`docs/contracts/plan/README.md`, `target.json`, `plan.json`, `status.json`): the setting
   shape and its parse rule (invalid → no target), remaining-work cases (no course, with a course, targets with and
   without a character companion), days left (vacation, past date, same day), daily amounts, the realism flag,
   status thresholds, projection with little data. Reviewed before code.
2. **Setting** `studyTarget` in the workspace settings (the same merge/backup path as `visualAids`; settings
   contract fixture and backup fixture updated; unknown keys kept).
3. **Pure rule** `lib/plan/plan.ts` with `plan.contract.test.ts` over the fixtures; no clock access (the day and
   zone are parameters).
4. **Loader** `lib/plan/loadPlan.ts` gathering inputs (level packs, known index through `placement/knownIndexLoad`,
   course path state when the `courses` feature is on).
5. **UI:** Settings → Study "Exam target" (a level picker over the installed schemes, a date picker, a plain
   explanation and the limits: "an estimate, not a promise"), Home widget "Target: ≈ HSK 4 by June — on track" (the
   existing widgets API), Stats card, a line in the weekly summary (`weekly/week-summary.json` case). Strings in
   `en.json`; jsdom tests per surface.
6. **"Use these numbers"** wired to the goal and the daily limit with a confirmation; a test that nothing changes
   without the click.
7. **E2E** `e2e/tests/study-plan.spec.ts` (CI only).
8. **Docs:** wiki `Study-plan`, contracts CHANGELOG (expected 17), ROADMAP.
9. **Verify:** `npm run check`, `npm test`, merge `origin/develop`, PR.

## Rulings

- Ruling: the plan **never changes the daily goal or the new-card limit by itself** — the issue says so and silent
  changes surprise learners — if wrong, a plan feels theoretical (cost: one click).
- Ruling: the review load uses the learner's own history once there are 30 days, else a constant — a plan that
  ignores reviews is unrealistic, and the learner's own number is the best evidence — if wrong, the plan
  over- or under-estimates reviews (cost: a flag the learner can ignore; the constant is named).
- Ruling: words, characters and course lessons only; **no grammar lessons** (decision 11) — today's grammar packs
  are not tagged by level — if wrong, grammar is missing from the daily amount (cost: a later extension once
  lessons carry levels).
- Ruling: **no CEFR or other-language targets in v0.9.0** — #201's languages are after v1.0; the picker lists the
  installed schemes, so they appear when their level packs do — if wrong, nothing for those languages (cost: none).
- Ruling: status thresholds ±5 % and projection after 7 days — simple, explainable, not validated against
  learners — if wrong, "behind" shows early or late (cost: constants).

## Needs human review

The numbers and wording ("on track", "too ambitious", the explanation line): the owner tries a target on their own
data. No content review. Not verified without a browser: layout of the Home widget and the Stats card.

## Done when

A learner can set ≈ HSK 4 for a date, sees a daily amount with its review load, a status and a projected date,
can apply the numbers to the goal and limit with one click, and sees the target on Home, in Stats and in the
weekly summary; the fixtures are decoded by the web tests; CI green.

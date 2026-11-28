# Grammar lesson runs (`grammar` events) and the review of grammar points

Issues #199, #277. Grammar is a core feature with a per-user switch (`features/`). Its lessons come from installed
`grammar` packs (`packages/`, `GET /api/grammar`, `GET /api/grammar/{pack}/{lesson}`). What a learner did is a study
event, like a review: **a finished lesson run is one `grammar` event** in the event log (`events/`), written through
the normal event path (`POST /api/events/batch`, the outbox, the pull, backups). The progress of a lesson is
replayed from its events; nothing is stored. Since #277 there is no progress table and no progress route
(`GET/POST /api/grammar/progress` and the table `grammar_progress` are gone, `CHANGELOG.md`).

## The event

```
{type: "grammar", payload: {point: "<packId>:<lessonId>", mode: "lesson", score: <int>, total: <int>}}
```

- `point` names the **grammar point**: the lesson of a grammar pack. `packId` matches `^[A-Za-z0-9._-]{1,128}$`,
  `lessonId` is a lesson id (`^[a-z0-9]+(-[a-z0-9]+)*$`, at most 128 characters); neither holds a `:`, so the point
  splits at its only colon. It is the key a spaced review of grammar points (#181) and a course (#218) refer to.
- `mode` is `lesson` (a finished lesson run) or `review` (a review run of a learned point, #181, "Review" below). A
  client ignores a mode it does not know.
- `score` and `total`: whole numbers with `0 <= score <= total <= 1000` — the exercises right on the first try and the
  run's number of exercises.
- Member order is part of the shape (`build`): the server stores the JSON text as sent.
- Written once per finished run (the last exercise answered), in the lesson's workspace. The web records it through the
  session's outbox (`ReviewOutbox.recordEvent`: write-ahead, retried, seen by the study history while it waits).

A client reads a stored event as a run (`parse`) only when the type is `grammar`, the payload is an object, `mode` is
`lesson` or `review`, `point` splits into a valid pack and lesson id, `score` and `total` are whole numbers in range with
`score <= total`, and `ts` parses as an instant. Anything else is not a run and counts nowhere.

## Progress (`progress`)

The **lesson** runs of a workspace are replayed in `(instant of ts, id)` order, per point (a review run has its own
number of exercises and does not change a lesson's progress):

- `best`: the run's score when the point has no earlier run or the earlier `total` differs from this run's (a
  re-import or a script conversion changed the lesson's exercises, so the scores are not comparable), else the larger
  of the earlier best and the run's score;
- `total`: the last run's `total`; `completedAt`: the last run's `ts`; `runs`: the number of runs.

A lesson is **done** when it has at least one run. The order is the event order, never the order of arrival, so a run
on another device never lowers a best score.

## What a run counts for

Every run counts, a lesson run or a review run alike:

- **Activity** (`events/activity.json`): a `distinct` rule on `point`, feature `grammar` — 1 point per grammar point
  worked on (a lesson finished or a point reviewed), counted once per point per learner day and workspace. `raw` is the same number, so a daily goal
  `activity:grammar` (`goals/`) counts distinct lessons a day. The weekly summary shows it as an activity row.
- **EXP** (`scheduler/xp.json`): 20 per run (`lessonRunXp`), whatever the score. The daily bonus stays a bonus for a
  day with a review.
- **Streak** (`scheduler/streak.json`): a learner day with a run counts like a day with a review, everywhere the streak
  is shown; also for the milestones' `streak` and `days-active` families (`milestones/reached.json`).

## Review (`review.json`, #181)

A grammar point comes back for spaced review once it is learned. The rules (fixture `review.json`, written by
`scripts/contracts/gen-grammar-review-fixtures.mjs` from plain ts-fsrs, `--check` exits 1 when it is stale):

- **Learned** (`learned`): a point is learned by its first **lesson** run with `total > 0` and
  `100 · score ≥ 80 · total` (`learnedPercent`; whole numbers, no rounding). A review run never makes a point
  learned; runs before the learned one are not part of the schedule.
- **Grade** (`grade`): each run becomes an FSRS grade: `100 · score ≥ 80 · total` → 3 Good; else
  `2 · score ≥ total` → 2 Hard; else 1 Again. Never 4 Easy.
- **Schedule** (`states`): per point, the learned run and every later run with `total > 0` (a lesson or a review),
  in `(instant of ts, id)` order, are replayed as one card's reviews exactly as a drill item's answers are
  (`drills/README.md`, "Schedule"): `createEmptyCard(t₀)`, then `next(card, tᵢ, grade)`, the **default FSRS
  weights** (never the workspace's flashcard parameters), on the **study clock** (vacation days frozen). The state
  is `due`, `stability`, `difficulty`, `state`, `learnedAt` (the learned run's `ts`), `reviews` (the runs fed after
  the learned one) and `lastReviewed` (the last of them, `null` before the first). A point with `reviews = 0` is
  **new**. A point is **due** when `due ≤ now`; a fresh point is due after FSRS's learning step (10 minutes).
- **Round** (`round`): the points a review round asks, from the **candidates** (the lessons of the installed grammar
  packs of the workspace language, in pack and lesson order; duplicates count once; a point whose lesson is gone is
  not offered): first the due points with `reviews > 0`, earliest due first, then point; then the due **new**
  points, earliest `learnedAt` first, then point, at most `newPerDay` (**5**) less `newToday`, the points (any, also
  not candidates) whose first review was on today's learner day (`study-day/`); at most `roundSize` (**20**). The
  answer also carries `due` and `new`, the counts before the round size (the Grammar page and the study modal show
  `due + new`).
- **Exercises** (`pick`): review number `n` (the point's `reviews` so far) asks at most **3** exercises
  (`exercisesPerReview`), one per example, from the lesson's examples in lesson order starting at `(3n) mod E`
  (E examples) and wrapping; with `lap = ⌊3n / E⌋`, the k-th exercise prefers a **cloze** (fill the gap with the
  lesson's authored distractors) when `n + lap + k` is even, else **word order**, and takes the other kind when the
  example cannot be the preferred one; an example that can be neither is skipped. An example can be a cloze when its
  focus is not empty, appears in its text and it has at least two distractors; it can be word order unless `noOrder`.
- **The run** (`build`): one `grammar` event when the point's exercises are answered:
  `{point, mode: "review", score, total}`, `score` the exercises right on the first try, in the point's workspace,
  through the normal event path. It counts as every run does (above): 20 EXP, the streak, one activity point per
  point a day.

Where reviews appear: the Grammar page (due points, each learned lesson's next review and last review, a review
round at `/grammar/review`), and a study session whose setup has `grammar: true` (`study/setup.json`) runs the
round after its cards. The server has no FSRS and never reads a run's mode or score: the fixture is decoded by the
web (and a second client); Go decodes the activity case.

## Old progress rows (`legacy`)

Before #277 the progress was a row per lesson: `{completedAt, best, total}`. Migration 056 and the restore of an older
backup (its rows `grammar:progress:<packId>:<lessonId>`, `backup/README.md`) turn each into **one run**: `score` the
row's `best`, `ts` its `completedAt` in whole UTC seconds, or the row's write time (`updatedAt`) when `completedAt` is
not an RFC 3339 time; a row whose ids or numbers the rules refuse, or with no usable time, is dropped. The event gets a
fresh ULID of that instant (device `migration` or `restore`).

| File | Rule | Decoded by |
| --- | --- | --- |
| `runs.json` | `build` (the payload), `parse`, `progress` (the replay), `legacy` (old rows to events), `constants` | web: `apps/web/src/lib/studycore/grammarRuns.test.ts`; Go: `server/internal/grammar/runs_contract_test.go` (`build`, `legacy`), `server/internal/db/migrate_056_test.go` (`legacy`, through the migration) |
| `review.json` | `constants`, `learned`, `grade`, `build` (the review payload), `states` (the schedule), `round` (due and new under the daily cap), `pick` (the exercises) | web: `apps/web/src/lib/studycore/grammarReview.contract.test.ts` |

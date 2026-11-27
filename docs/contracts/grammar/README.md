# Grammar lesson runs (`grammar` events)

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
- `mode` is `lesson`: a finished lesson run. A later client may write other modes (#181 plans `review`); a client
  ignores a mode it does not know.
- `score` and `total`: whole numbers with `0 <= score <= total <= 1000` — the exercises right on the first try and the
  run's number of exercises.
- Member order is part of the shape (`build`): the server stores the JSON text as sent.
- Written once per finished run (the last exercise answered), in the lesson's workspace. The web records it through the
  session's outbox (`ReviewOutbox.recordEvent`: write-ahead, retried, seen by the study history while it waits).

A client reads a stored event as a run (`parse`) only when the type is `grammar`, the payload is an object, `mode` is
`lesson`, `point` splits into a valid pack and lesson id, `score` and `total` are whole numbers in range with
`score <= total`, and `ts` parses as an instant. Anything else is not a run and counts nowhere.

## Progress (`progress`)

The runs of a workspace are replayed in `(instant of ts, id)` order, per point:

- `best`: the run's score when the point has no earlier run or the earlier `total` differs from this run's (a
  re-import or a script conversion changed the lesson's exercises, so the scores are not comparable), else the larger
  of the earlier best and the run's score;
- `total`: the last run's `total`; `completedAt`: the last run's `ts`; `runs`: the number of runs.

A lesson is **done** when it has at least one run. The order is the event order, never the order of arrival, so a run
on another device never lowers a best score.

## What a run counts for

- **Activity** (`events/activity.json`): a `distinct` rule on `point`, feature `grammar` — 1 point per lesson finished,
  counted once per lesson per learner day and workspace. `raw` is the same number, so a daily goal
  `activity:grammar` (`goals/`) counts distinct lessons a day. The weekly summary shows it as an activity row.
- **EXP** (`scheduler/xp.json`): 20 per run (`lessonRunXp`), whatever the score. The daily bonus stays a bonus for a
  day with a review.
- **Streak** (`scheduler/streak.json`): a learner day with a run counts like a day with a review, everywhere the streak
  is shown; also for the milestones' `streak` and `days-active` families (`milestones/reached.json`).

## Old progress rows (`legacy`)

Before #277 the progress was a row per lesson: `{completedAt, best, total}`. Migration 056 and the restore of an older
backup (its rows `grammar:progress:<packId>:<lessonId>`, `backup/README.md`) turn each into **one run**: `score` the
row's `best`, `ts` its `completedAt` in whole UTC seconds, or the row's write time (`updatedAt`) when `completedAt` is
not an RFC 3339 time; a row whose ids or numbers the rules refuse, or with no usable time, is dropped. The event gets a
fresh ULID of that instant (device `migration` or `restore`).

| File | Rule | Decoded by |
| --- | --- | --- |
| `runs.json` | `build` (the payload), `parse`, `progress` (the replay), `legacy` (old rows to events), `constants` | web: `apps/web/src/lib/studycore/grammarRuns.test.ts`; Go: `server/internal/grammar/runs_contract_test.go` (`build`, `legacy`), `server/internal/db/migrate_056_test.go` (`legacy`, through the migration) |

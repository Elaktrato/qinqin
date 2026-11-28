# Grammar lesson runs as study events (#277)

Milestone v0.9.0, phase 1 (foundations: before grammar review #181 and before courses use grammar lessons). Branch
`feature/v090-277-grammar-events` from `feature/v0.9.0`. Owner decisions (issue comment, plan §4): **1 activity point
per lesson finished, counted once per lesson per learner day; 20 EXP per lesson run; a finished lesson counts towards
the streak and the daily goal.**

**Goal:** a finished grammar lesson run is a `grammar` study event, written through the outbox like a review and
carried by sync and backups like every event. Lesson progress (best score, last run, done) is derived from the events.
The `grammar_progress` table and `GET/POST /api/grammar/progress` go; migration 056 turns each stored progress row
into one event. Grammar runs count in the activity heatmap, the weekly summary, goals (`activity:grammar`), EXP and
the streak.

## The event

```
type "grammar", payload {point: "<packId>:<lessonId>", mode: "lesson", score: <int>, total: <int>}
```

- `point` names the grammar point: the lesson of a grammar pack. `packId` is `^[A-Za-z0-9._-]{1,128}$`, `lessonId` a
  lesson id `^[a-z0-9]+(-[a-z0-9]+)*$` of at most 128 characters; neither holds a `:`, so the point splits at its
  only colon. It is the key a spaced review of grammar points (#181) schedules by, as `cardId` is for flashcards and
  `item` for the scripts trainer.
- `mode` is `lesson` (a finished lesson run). #181 can add `review` to the same type; a client ignores a mode it
  does not know.
- `score` and `total`: whole numbers, `0 <= score <= total <= 1000` (the exercises right on the first try, and the
  run's number of exercises).
- Written once per finished run, in the lesson's workspace, through the session's outbox (write-ahead, retried).

## Tasks

1. This plan.
2. Contract and web parsing: `docs/contracts/grammar/runs.json` (parse, progress, legacy conversion) and README;
   `lib/studycore/grammarRuns.ts` (parse, the point, the progress replay) with its test first; the payload builder in
   `lib/events/eventPayloads.ts` and the `payloads.json` case.
3. Server: the activity rule (`stats/rules.go`, `activity.json` cases), migration 056 with a frozen Go step that turns
   `grammar_progress` rows into events and drops the table, `grammar.LegacyEvent` for old backups, the routes and the
   table gone (handlers, route table, delete rules, backup export, restore, dry run, legacy-removed guard), the routes
   fixture and API docs regenerated.
4. Web: EXP (20 per run) and the streak (days with a run) in `studycore/exp.ts` with `xp.json` and `streak.json`
   cases; `StudyHistory.grammarRuns`; the callers (flashcards widget, study session, Stats summary, weekly summary,
   milestones streak and days active); the activity source and its words; the outbox records any event
   (`recordEvent`), the recently-sent list keeps grammar runs.
5. Web: the grammar pages read progress from the history (`features/grammar/progress.ts` rewritten), the practice run
   records the event and shows the derived best score.
6. Docs: contracts (grammar, events, backup, scheduler, milestones, overview, README), ContractVersion 14 and the
   CHANGELOG, record 0006, wiki pages, `docs/releases/NEXT.md`.

## Rulings

- Ruling: `grammar_progress` is **replaced**, not kept as a cache — the events are the one source, as for reviews and
  script answers; a cache would need its own invalidation on restore, on a second device's push and on a pull, and a
  table both clients write is exactly what the issue removes — cost if wrong: a progress read replays the workspace's
  grammar events on the client (a few hundred per learner; the log is already read by the widgets).
- Ruling: the payload is `{point, mode, score, total}` with `point` = `<packId>:<lessonId>` — the activity rule counts
  distinct values of one payload member, and a spaced review needs one key per grammar point; both ids contain no
  colon, so the point splits back without ambiguity — cost if wrong: a later payload change and a converter (events
  are immutable).
- Ruling: `mode: "lesson"` now, so #181 can write reviews of a point as `mode: "review"` in the same type without a
  migration; a client counts a mode it knows and ignores the rest — cost if wrong: one constant member per event.
- Ruling: **activity** is a `distinct` rule on `point` (feature `grammar`): points = raw = the distinct lessons with a
  run that learner day and workspace; repeating a lesson the same day adds nothing — the owner's "once per lesson per
  day" — cost: none.
- Ruling: **EXP** is a flat 20 per `lesson` run whatever the score (a run is a finished lesson); the daily bonus of 10
  stays a bonus for a day with a review — the owner set 20 per run, and the existing bonus is defined on reviews —
  cost if wrong: a grammar-only day gives 20, not 30.
- Ruling: **the streak** counts a learner day with a valid review **or** a valid grammar lesson run, everywhere the
  streak is shown (the flashcards widget, the study session, Stats, the weekly summary) and in the milestones' streak
  family; days active also counts a lesson day — one streak rule across the app, and a streak day that is not an
  "active day" would contradict the milestone list — cost if wrong: the streak and days-active numbers rise for a
  learner who only does grammar.
- Ruling: **the goal** needs no new metric: `activity:grammar` follows from the activity source (the goal picker lists
  every source), its amount the cell's raw (distinct lessons) — cost: none.
- Ruling: a lesson run goes through the session's **review outbox** (`ReviewOutbox.recordEvent`) — write-ahead, retry,
  merged into the study history while queued, remembered after sending — the "normal event path" of the issue; the
  scripts trainer's own pending list predates the study core and stays as it is — cost: a queued lesson run counts in
  the outbox's numbers, whose messages say "reviews" (the offline banner, the sign-out dialog); a run is queued only
  when the POST failed after the lesson loaded, rare and still sent.
- Ruling: **progress replay** keeps the old rule: runs in `(instant, id)` order; `best` is the run's score when there
  is no earlier run or the earlier best's `total` differs (a re-import or a script conversion changed the exercises),
  else the larger; `completedAt` is the last run's `ts`; `runs` counts them — the stored rule of #199, now replayed,
  so a run on another device never lowers a best score — cost: none.
- Ruling: **migration 056** writes one event per `grammar_progress` row: `ts` its `completed_at` (whole UTC seconds),
  else its `updated_at` when `completed_at` is not RFC 3339, else the row is dropped; `score` its `best`; `device`
  `migration`; a fresh ULID of that instant (crypto/rand); a row whose pack or lesson id the point rule refuses, or
  whose workspace is not the row user's, is dropped and counted in one log line; then the table is dropped. The copy
  rules are a frozen copy in `internal/db` (no live import) — the issue asks for one event per row; a messy row never
  fails the upgrade — cost: the run history before the upgrade is one run per lesson (the best one).
- Ruling: an **old backup's** `grammar:progress:<packId>:<lessonId>` row becomes the same event on restore
  (`grammar.LegacyEvent`, the same rules as the migration, decoded against the same fixture); it counts as a restored
  row (`restored.rows`), so the dry run's numbers stay what it predicts; an export writes no grammar rows any more (the
  events carry the runs) — cost: none.
- Ruling: no new table, so no delete rule, preview field or backup table entry is added; `grammar_progress` leaves the
  delete rules, the workspace delete and the dry run's count — cost: none.
- Ruling: the web keeps parsing and replay in `lib/studycore/grammarRuns.ts`, not the grammar feature — EXP, the streak
  and the milestones (core and other features) read the runs, and #181 and the courses will too; record 0004 puts
  logic more than one feature reads in the core — cost: none.

- Ruling (made while building): the dry run now also drops an old `grammar:progress:` row that does not convert to an
  event (before, it counted every such row with a workspace as restored, while the restore could refuse it) — the
  dry run must predict the restore — cost: none.
- Ruling (made while building): the practice result's "Try saving again" is gone and the failure text says "This run
  was not saved: its workspace was deleted." — with the outbox a failed POST is queued, never an error; the only run
  that is lost is one of a deleted workspace, where a retry cannot help — cost: one string changed, one removed.
- Ruling (made while building): `StudyHistory.grammarRuns` is a required member — every reader of the history then
  gets the runs; the test mocks were updated mechanically — cost: 20 test files touched.

## Execution record

Commits: plan; the event and its replay (`grammar/runs.json`, `studycore/grammarRuns.ts`); the server (activity rule,
migration 056 with its frozen step, `grammar.LegacyEvent`, routes, table, delete rules and backup paths gone or
converted); EXP, streak, activity source, outbox `recordEvent`; the grammar pages; docs and contract 14; two test
fixes found by the full suite.

Test-first, seen failing before the code: `grammarRuns.test.ts` (module missing), `eventPayloads.test.ts` (builder
count), `TestContractActivity` (4 rules, fixture 5), `TestMigration056GrammarEvents` (no events), the `exp.test.ts`
fixture cases (xp and streak), `events.test.ts` `recordEvent` and `recentSent.test.ts`, the milestones `reached.json`
case, `features/grammar/progress.test.ts`, `TestRestoreTurnsOldGrammarProgressIntoEvents` (it found the dry-run
mismatch above). Written with or after the code (not seen failing first): `TestRunsContract` (Go), the summary and
weekly streak tests, the PracticeRun DOM test, `TestGrammarProgressRoutesAreGone`, the `historyOf` test.

Honest notes: the commit `feat(study)…` left two web tests red (the goal picker's offline list and the history
helper's `toStrictEqual`), found by the full vitest run and fixed in the last commit; the server commit left the web
calling the removed routes for one commit (no test noticed: no test hits them). `GrammarBrowse` reads the progress
once per workspace load; it does not refresh on a run made in another tab.

Real-app check: the base build (contract 13) on a scratch data dir, a user, a workspace and three runs through
`POST /api/grammar/progress`, two messy rows added by hand; then this branch's build on the same data: migration 056
logged "3 grammar lesson progress rows became grammar events, 1 unreadable rows were dropped", the table was gone,
`/api/version` said 14, the old route 404, the events carried the expected points and stamps (a bad `completed_at`
took `updated_at`), and three new runs (one lesson twice, one already migrated today) gave a `grammar` cell of 3
points for the day.

Gates: Go full `./...` — 60 packages ok, only the known `internal/ai` `TestHostnameResolvingToEmbeddedFormIsRefused`
(no IPv6) fails; web `check` 0 errors (1977 files); `build` ok; full vitest on Node 26: 711 files, 14085 passed, 2
skipped; e2e 3 runs, 35 passed each; `node --test scripts/*.test.mjs` 189 passed, 1 skipped; `gen-api-docs --check`
clean.

## Local follow-up

- A hand check in a browser and on a phone with a grammar pack installed (e2e has none): finish a lesson, see "Best so
  far", the heatmap point and the 20 XP in the flashcards widget; finish it offline (the run waits in the outbox,
  counts at once, is sent on reconnect); a daily goal "Grammar lessons".

# 0005. Test conventions

## Status

Accepted

Touched by: #195. A merge from one of these issues that changes what this record names updates the record.

## Context

#197 found three kinds of drift in the test code:

- **Go databases.** Every Go test database ran all migrations from scratch. There were openDB /
  openTestDB / newTestDB / newDB copies in 26 test files, and about 80 test files called
  db.Open(filepath.Join(t.TempDir()…)) themselves.
- **Web builders.** About 40 web test files defined their own card(), review() and history() builders;
  lib/testing/reviews.ts was used by three, and lib/study/testing/ sat apart from lib/testing/.
- **Wall-clock checks.** Timing-sensitive tests failed on a loaded machine: the weekly and milestones perf tests,
  the reader readings test, the study-day perf test, the PWA icons test and the schedule timeline test.

## Decision

- **Go test databases** come from one package, `server/internal/dbtest`. `Open` (in
  `server/internal/dbtest/dbtest.go`) writes a copy of a template database to a file of the test's own in
  `t.TempDir()` and opens it with `db.Open`, which finds every migration applied. The template is migrated
  once per test process (`sync.Once`, then `VACUUM INTO` a single file, opened once so it is in WAL mode,
  kept in memory). `OpenPath` also
  returns the file's path (for a test that closes and reopens it), and `File` writes a migrated file at a
  given path without opening it (for code under test that opens the database itself, such as the serve,
  seed, recover and backup commands). Shared fixtures in `server/internal/dbtest/fixtures.go`: `User` (a
  user that cannot sign in; a test that signs in uses `auth.CreateUser`), `Workspace`, `WritePack` (a pack
  directory from a manifest and files) and `DictPack` (the tiny zh dictionary `DictWords`).
  `Counting` (`server/internal/dbtest/counting.go`) opens an existing database through a counting driver
  wrapper (`Counter`: statements and transactions), for performance tests that count instead of timing.
- **Real migration runs** stay where the migrating itself is under test: the tests of `server/internal/db`
  (the migration tests `migrate_0NN_test.go`, the frozen-step test, the schema tests of `db_test.go` with its
  own `openDB`) and of its frozen steps `server/internal/db/step032` and `server/internal/db/step038`. A
  compatibility test that needs an older schema uses `OpenThrough` in `server/internal/db`. Everything else
  uses `dbtest`; a test that opens an existing file again (after a command wrote it, or a `VACUUM INTO`
  copy) uses `db.Open` on that path, marked `// reopen` when nothing in the same function wrote it.
- **Password hashing in tests.** A test package that creates many users may lower the argon2id cost for
  its run with `SetHashCostForTests` (`server/internal/auth/auth.go`; it panics outside a test binary); the
  api tests do so in `server/internal/api/main_test.go`. At least one test of such a package, and every test
  of `server/internal/auth`, stays on the production parameters.
- **Web study builders** live in `apps/web/src/lib/testing/study.ts`: `card`, `review` and `history` take
  overrides (an undefined override keeps the default), plus `eventId` and `strongReviews`. All web test
  support lives in `apps/web/src/lib/testing/`, including the test-only legacy codec mirror
  (`apps/web/src/lib/testing/legacyCodec.ts`, still used by the study command tests to describe study
  state as old rows) and the spaceOut reference; `lib/study/testing/` is gone.
- **Web state in tests** (record [0009](0009-web-state-model.md)): a test builds a fresh app context and
  session from fakes with `apps/web/src/lib/testing/context.ts` (`testContext`, `studyContext`, `fakeDeps`,
  `fakeApi`, `memoryStorage`, `manualTimers`, `fakeWindow`, `fakeDocument`); a component test renders with
  `render(Component, { props, context: ctx.context })`, a module test passes the state objects it uses, and
  `newSession(ctx)` ends the session and starts the next one. There are no global resets; a test that fakes a
  state method spies on the class's prototype.
- **No wall-clock assertions in unit tests.** A performance test asserts operation counts (replays, log
  passes, Intl calls, publications, work units, bytes read, SQL statements and transactions) and no time
  limit; there is no separate perf project. A heavy test may declare a generous vitest timeout as a hang backstop (the PWA icons test), and a
  Go test may bound how long a cancelled, timed-out or shut-down call takes to return (a liveness check,
  not a speed check). The lexicon characters test keeps its thread-CPU budget (`QINQIN_PERF_BUDGET_MS`),
  which measures CPU time, not elapsed time.
- **Browser end-to-end tests** (#157) follow record [0007](0007-browser-end-to-end-tests.md): one Playwright
  suite in `apps/web/e2e/` against the real binary, a fresh user per test, data written through the API, no
  fixed sleeps and no retries (`apps/web/e2e/tests/conventions.spec.ts`). Its specs are `*.spec.ts`, so the
  unit-test guards above (which scan `*.test.*` files) do not apply to them; a browser test waits for
  conditions, and its timeouts are hang backstops, not speed checks.
- #197 measured the suite times before and after and recorded them in the issue and in
  `docs/superpowers/plans/2026-11-23-test-infrastructure.md`.

## Consequences

- A new Go test gets a migrated database in the time of a file write, and a new migration runs once per
  test process, not once per test. Every test still has its own database file.
- A change to a study row shape changes one builder module, not forty files.
- A loaded CI machine no longer fails a unit test on time; a real slowdown shows as more operations. A
  slowdown that no count catches (a regex or sort that turns quadratic) shows only as a test timeout.
- `dbtest` imports only `server/internal/db` and the model package, so any package's in-package tests can
  use it.

## Allowed / Not allowed

Allowed:

- `dbtest.Open(t)`, `OpenPath`, `File` and the fixtures in any Go test outside `server/internal/db`.
- `db.Open` on a database file that exists already: after `dbtest.File` or a `VACUUM INTO` copy in the
  same function, or marked `// reopen` (a file a command under test wrote).
- Builders from `apps/web/src/lib/testing/study.ts`, extended there when a test needs a new variant; a
  one-line local adapter that maps a test's positional arguments onto them.
- Counting operations (calls, rows, passes, work units) in a performance test; a timeout as a hang backstop.
- A fresh test context per test (`testContext()`), its fakes adjusted by the test.

Not allowed:

- A new `openDB` / `newDB` style copy, or a test that opens and migrates a database of its own in a new
  temporary directory (except in `server/internal/db`).
- A new local card, review or history builder that spells out the row literal in a web test file.
- A time limit (`performance.now()`, `Date.now()` differences, elapsed milliseconds) asserted in a unit test.
- An exported reset for tests (`…ForTests`) in the web app, or a test that shares app state with the next one.

## Enforcement

- `TestNoTestMigratesItsOwnDatabase` (`server/internal/dbtest/convention_test.go`) parses every Go test
  file outside `server/internal/db` and fails on a `db.Open` or `db.OpenForSeed` call that, in its top-level
  function, follows no `dbtest.File`, `dbtest.OpenPath` or `VACUUM INTO`, unless a `// reopen` comment on its
  line or the line above says it opens a file that exists (written by a command under test, for example).
  This catches a temp path, a `dir := t.TempDir()` path, a concatenated path and a local helper alike
  (`ownMigrationFindings`, with its cases in `TestOwnMigrationFindings`); on the tree before #197 it flags
  81 test files.
- `apps/web/src/lib/testing/noWallClock.test.ts` scans every web and script test file and fails on a
  measured duration (`wallClockFindings` in `apps/web/src/lib/testing/noWallClock.ts`): `performance.now()`,
  `process.hrtime`, `console.time`, `Date.now()` minus a variable (an ALL_CAPS constant is clock
  arithmetic), and an `expect` on a difference of clock reads or of variables that hold one, on a variable
  holding such a difference, or on the clock itself (a deadline). Strings and comments are skipped.
- `apps/web/src/lib/context/stateModel.lint.test.ts` fails on an exported `…ForTests` in the web app (and on
  the rest of record 0009's rules).
- `apps/web/src/lib/testing/study.test.ts` pins the builders' defaults.
  `server/internal/dbtest/dbtest_test.go` pins that the template itself, read without migrating
  (`OpenReadOnly`), has every migration and the schema of a fresh `db.Open` and is in WAL mode
  (`TestFileWritesAFullyMigratedDatabase`; a template built only through 042 fails it), that a copy carries
  the rows the migrations seed, and that the template is built once per process.
- Review: a local builder that spells out a study row (no check: the literal shapes vary too much to match
  without false positives), and Go time limits on work (the Go suite has legitimate liveness bounds, so
  there is no Go wall-clock guard).

## Open questions

- About 25 web test files still build review or card rows inline (activity heatmaps, the workspace delete,
  the events and outbox tests) without a named builder; they move to `apps/web/src/lib/testing/study.ts`
  when touched. Deliberately malformed rows (the review parser, the recent-sent and wire-row tests) stay
  literal. Decided by #197.

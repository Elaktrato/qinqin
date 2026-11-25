# Plan — test infrastructure (#197)

Issue #197 (part of #190). Branch `feature/197-test-infra` from `develop` at a2a5091b, worktree
`.claude/worktrees/197-tests`. The decision record is `docs/architecture/0005-test-conventions.md` (written for
#191); this branch builds it and sets it to Accepted. A refactor of test code: the whole suite stays green
after each commit; new code (`dbtest`, the builders, the guards) is test-first; one commit per task. Go gates
under `flock /tmp/qinqin-go.lock`; web: targeted vitest per task, full check/test/build and Node 26 vitest at
the end.

## Tasks

1. **Measure first** (no change): full Go `./...` wall time and the 10 slowest packages; full web vitest
   under Node 26. Numbers in the Execution record.
2. **`server/internal/dbtest`** (test-first): `Open(t)` copies a template database migrated once per test
   process (`sync.Once`; `VACUUM INTO` one file, kept in memory, written to `t.TempDir()` per test);
   `OpenPath`, `File`; fixtures `User`, `Workspace`, `WritePack`, `DictPack`. Tests: the copy has the schema,
   migrations and row counts of a fresh `db.Open`; two opens are isolated; the template is built once; the
   tiny pack imports with the real importer.
3. **Move the Go tests onto it**: the openDB/openTestDB/newTestDB/newDB copies and every `db.Open` of a new
   temp file; a guard test (`TestNoTestMigratesItsOwnDatabase`, test-first) fails on a new one. The two
   order-dependent api tests register their languages.
4. **Web builders**: `apps/web/src/lib/testing/study.ts` (test-first) with `card`, `review`, `history`,
   `eventId`, `strongReviews`; `lib/study/testing/` (legacy codec mirror, spaceOut reference) merges into
   `lib/testing/`; `lib/testing/reviews.ts` folds into `study.ts`; the local builders delegate.
5. **Timing tests**: drop the wall-clock limits, keep or add operation counts; a web guard test
   (`noWallClock.test.ts`, test-first) against new measured durations.
6. **Measure again**, docs: record 0005 Accepted, `docs/wiki/Development.md`, this plan.

## Rulings

- Ruling: the template is kept as bytes in memory (VACUUM INTO a scratch file once, read, scratch dir
  removed) and written to each test's `t.TempDir()` — no template file outlives the process and no TestMain
  is needed in any package — cost if wrong: a process holds one small file (about the size of an empty
  migrated database) in memory.
- Ruling: `dbtest` depends only on `internal/db` and `internal/model`; the fixtures are plain SQL (`User`
  stores a hash that is no password hash) and `DictPack` writes files without importing `dict` — so the
  in-package tests of `auth`, `dict` and every other package can use it without an import cycle — cost if
  wrong: a test that needs a sign-in user still calls `auth.CreateUser`.
- Ruling: tests that keep running real migrations: everything in `server/internal/db` (the migration tests
  `migrate_0NN_test.go`, `frozen_step_test.go`, `db_test.go` with its own `openDB`, which checks the schema a
  fresh migration produces) and its frozen steps `step032`, `step038`; plus the one template build per
  process. No test outside `internal/db` uses `OpenThrough` today — cost if wrong: none; a new compatibility
  test uses `db.OpenThrough`, which the guard does not flag.
- Ruling: tests that reopen an existing file keep `db.Open(path)` (the serve/seed/recover/backup command
  tests after the command ran, the datapkg restore of a `VACUUM INTO` copy); the fresh file they start from
  comes from `dbtest.File`. (Fix wave: the guard now flags every `db.Open` not preceded by dbtest.File,
  OpenPath or VACUUM INTO in its function unless marked `// reopen` — cost if wrong: a wrong `// reopen`
  marker is caught only in review.)
- Ruling: the trivial wrapper copies (newDB etc. whose body was only the open) are removed and their callers
  call `dbtest.Open`/`OpenPath` directly; wrappers that do more (lemmapack's overlay reset, cmd/qinqin's
  `openTestDB` registering languages, the auth `tokenDB` fixture) stay and call dbtest — cost if wrong: none.
- Ruling: `TestPluginDataRoute` and `TestSourcesImportWorkspace` register the languages of the workspaces
  they create (`lang.Register`, as the other api tests do). dbtest did not cause or fix this; the fix is a
  line each — cost if wrong: none. Other order dependences were not searched for (see Execution record).
- Ruling: the web builders are migrated in one pass for every test file with a named local card, review or
  history builder (41 files). The local functions stay as thin positional adapters (one call to
  `build.card/review/history`), because rewriting every call site of 41 files would be a much larger diff
  with the same effect: the row shape is spelled out in `study.ts` only — cost if wrong: a reader meets a
  local adapter name; changing a row shape is still one file.
- Ruling: not migrated: wire-row builders that test a codec or the sync/backup shape (`store.test.ts` server
  rows, `store.workspace.test.ts` `cardRow`, `history.test.ts`, `sync/pager.test.ts`), deliberately malformed
  rows (`reviewParse.test.ts`, `recentSent.test.ts`), StudyEvent builders of other event types, and about 25
  files that build review rows inline without a named builder (activity heatmaps, workspace delete, events,
  outbox, the perf tests' bulk arrays). They move when touched; record 0005 lists this — cost if wrong: a
  row shape change touches those files too.
- Ruling: `card()` applies an override only when its value is defined (an undefined override keeps the
  default; an optional field left undefined stays absent), so adapters can pass optional arguments through —
  cost if wrong: a test cannot build a card whose required field is undefined (none does; malformed rows are
  literal).
- Ruling: the timing tests keep only operation counts; no separate serial perf project — the counts already
  are the real checks of the weekly (replays), milestones (log passes, now asserted as exactly one), study-day
  (Intl calls) and readings (publications per chunk, new: a spy on the `pieces` setter, 2 publications for
  2 chunks of 4 000 paragraphs) tests, and a perf project would add CI config that still flakes on a loaded
  runner — cost if wrong: a slowdown no count catches (coverage tally, spaceOut, notice parsing, the FSRS
  optimizer) shows only as a vitest timeout.
- Ruling: `pwa/icons.test.ts` and `scheduleTimeline.test.ts` had no wall-clock assertion; the icons
  regeneration (about 2 s idle) failed by the default 5 s vitest timeout under load and gets an explicit
  60 s hang backstop; the schedule timeline test runs in about 0.1 s and is unchanged apart from its builder —
  cost if wrong: the schedule timeline test still flakes; then it gets a backstop too.
- Ruling (Go): a time limit on work is dropped where a count already guards it (segmentation work units —
  the #176 two-minute backstop goes, `go test -timeout` is the hang backstop —, the 30 MB login's bytes
  read, the big restore's peak heap and row counts, the large Activity log; `TestHugeLoginRejectedQuickly`
  becomes `TestHugeLoginRejectedUnread` and the stats race build-tag files go); the mail enqueue check
  becomes "all five queued and no send timeout logged yet" instead of "< 100 ms". Kept: liveness bounds (a
  cancelled, timed-out or shut-down call returns within seconds: shutdown, serve, ai fake, aozora, sources,
  mail send, OCR, the rate-limit gate) and the lexicon characters thread-CPU budget (CPU time, not elapsed)
  — cost if wrong: a large Activity slowdown is no longer caught (the benchmark stays for a human).
- Ruling: the web guard (`apps/web/src/lib/testing/noWallClock.test.ts`) scans every `*.test.{ts,mjs,js}`
  under `apps/web/src`, `apps/web/scripts` and `scripts/` for `performance.now()`, `Date.now()` minus a
  variable, `process.hrtime` and `console.time`, ignoring quoted strings and line comments; clock arithmetic
  with constants, fake timers and busy-waits pass. No Go wall-clock guard: the Go liveness bounds use the
  same `time.Since` as a speed check, so a guard would need an allow-list — cost if wrong: a new Go speed
  check is caught only in review.
- Ruling: a Go guard does check the database convention (`TestNoTestMigratesItsOwnDatabase`); a web guard
  for local builders is not added (local adapters are allowed and row literals vary too much to match without
  false positives) — cost if wrong: a new local row builder is caught only in review.

## Execution record

Timings, one run each, nothing else of mine running; other agents worked in other worktrees (load average
in brackets, at start and end; 4 cores). Go times include compiling from a warm build cache.

| Suite | Before (a2a5091b) | After |
|---|---|---|
| Go `go test -count=1 -p 2 ./...` wall | 422 s (2.0 → 3.2, peak 9.7 from another agent's svelte-check) | 252 s (2.6 → 3.7); with `go vet` first: 228 s (0.3 → 3.4) |
| Go slowest packages | api 392.4 s, auth 63.9, backup 34.7, cmd/qinqin 32.5, stats 18.1, sync 17.5, datapkg 17.4, lexicon 15.4, dict 12.8, events 11.2 | api 247.8 s, auth 28.9, cmd/qinqin 17.2, sync 14.6, stats 14.3, backup 12.9, lexicon 12.9, datapkg 10.2, grammar 8.1, library 8.0 |
| Web vitest, Node 26, wall | 165 s, Duration 163.2 s, 587 files / 12 509 tests (2.7 → 4.8) | 184 s, Duration 182.3 s, 588 files / 12 574 tests incl. develop's #191 doc tests (3.2 → 4.8) |

A fresh migration of all 43 migrations takes about 0.1–0.2 s; a dbtest copy about 0.01 s. The Go suite is
about 40 % faster (api 392 → 248 s, auth 64 → 29 s, backup 35 → 13 s). The web suite is not faster and was
not meant to be: its change removes load-dependent failures, not time (the difference is within the noise of
one run on a shared machine, plus the tests develop added).

- Task 2 test-first: the dbtest tests failed to build without the package, then passed; one test named a
  wrong table (`lx_forms`, renamed to `forms` by migration 017) and was corrected.
- Task 3: the guard test was checked against the pre-migration `internal/api/api_test.go` (it fails on it)
  and against the datapkg `VACUUM INTO` reopen (a false positive at first; the matcher now skips a path the
  test fills before opening). `TestPluginDataRoute` and `TestSourcesImportWorkspace` failed when run alone
  before the fix (422 on workspace create) and pass alone after it.
- Deviation: the Go commit (696f10ca) also carried the `git mv` of `lib/study/testing/` and the deletion of
  `lib/testing/reviews.ts`, which were already staged; the web suite does not build at that commit (imports
  of the moved files) and is green again from the next commit (9c6877b2). History was not rewritten.
- Deviation: the merge commit of `develop` into this branch has no Co-Authored-By trailer (git's default
  merge message); not amended.
- Task 4/5: the web guard failed with 21 findings (plus one false positive in `utcGuard.test.ts`, a string;
  the matcher now ignores strings and comments) before the timing tests changed and passes after. The readings
  publication count was checked to be 2 publications for 2 chunks.
- Not verified: other order-dependent Go tests (no test was run alone except the two named in the issue);
  `BookView.dom.test.ts` (4 tests) and `AccountSettings.dom.test.ts` (1 test) fail under Node 22 on
  `develop` too, alone and in the full run, and pass under Node 26 (CI's version); not investigated. The mail
  enqueue check was not shown to fail with a blocking Enqueue (it reasons from the 300 ms send timeout).

**Bisect: skip 696f10ca** (the web suite does not build there; see the deviation above).

### Review fix wave

The independent review found no must-fix and no coverage loss (identical test counts per file). Every group
was test-first, one commit each:

- go.sum (a8444eb7): the six `/go.mod` lines that running goimports with `-mod=mod` added are dropped;
  `go mod tidy -diff` exits 0 again.
- Stale template (2d4ef8ff): `TestFileWritesAFullyMigratedDatabase` reads the `File` output with
  `OpenReadOnly` (no migration) and compares its `schema_migrations` and schema with a fresh `db.Open`. The
  mutation "template built with `OpenThrough(…, "042_fonts")`" fails it (missing `043_lemma_rules`); before,
  `OpenPath`'s `db.Open` healed it in every test. The test also asserts WAL mode, which failed first (the
  `VACUUM INTO` output is a rollback-journal file); the template is now opened once with `db.Open` before
  its bytes are kept.
- Database guard (100555df): the matcher parses each test file (`go/parser`) and flags every
  `db.Open`/`OpenForSeed` whose top-level function has no `dbtest.File`, `dbtest.OpenPath` or `VACUUM INTO`
  before it and no `// reopen` marker on its line or the line above. New cases: `dir := t.TempDir()`,
  `t.TempDir() + "/x.db"`, a local helper, a closure, File in another function. On the a609a10f tree (via a
  throw-away test over `git archive a609a10f server`) it flags 81 test files, including all seven the
  review named (cmd/qinqin backup, recover, seed, serve_lemma, shutdown; stats/large_test.go — plus
  ai_env, bootstrap_env, secrets_env). Five reopen calls on this branch got `// reopen` markers.
- Counts instead of time (43878fe4): `dbtest.Counting` opens a database through a counting wrapper of the
  SQLite driver (statements, transactions). `TestActivityLargeLog` asserts the 91-day Activity runs the same
  statements as a 7-day one, at most 4 (it runs 4). The big restore (`QINQIN_BIG_TESTS=1`, renamed
  `TestBigRestoreIsBatchedAndStaysMemoryBound`) asserts at most one statement per restored row and at most
  4 transactions; it ran 1 022 689 statements for about 1 020 000 rows in 2 transactions, 57 s.
- Ruling: the counts are statement counts, not row or page counts — a statement that turns into a full scan
  is not caught — cost if wrong: such a regression shows only as a slower suite.
- Wall-clock guard (7618428b): ALL_CAPS operands are constants (`Date.now() - DAY` passes), block comments
  are skipped, and clock reads are followed through variables: an `expect` on a difference of clock reads or
  stamps, on a variable holding such a difference, or on the clock itself (deadline style) is flagged. The
  reviewer's evasions (`end - start`, `new Date().getTime()`, `+new Date()`, a deadline) are cases; the
  whole tree has no finding.
- Fixtures (2a173fd7): `dbtest.User` and `dbtest.Workspace` replace the hand-built users and workspaces of
  the auth token tests and the api token gate test. Ruling: `DictPack` has no caller yet; it is for the
  domain-package tests of #194 and the e2e seed of #157 — cost if wrong: an unused fixture.
- Hash cost (1debf6ae): `auth.SetHashCostForTests(memoryKiB, passes)` lowers the argon2id cost; the api
  `TestMain` sets 64 KiB and one pass. `TestRegisterAndLoginAtTheProductionHashCost` (api) and all auth tests
  stay on the production parameters, and `TestNoServingCodeLowersTheHashCost` checks that no non-test
  source calls the hook. Ruling: the hook is exported (the api tests are another package) and panics unless
  `testing.Testing()`, so serving code cannot lower the cost; the price is that the auth package imports
  `testing` — cost if wrong: a slightly larger binary, no behaviour change. The api package alone (test binary
  run directly, load about 3): 219.6 s wall / 409 s user before, 35.5 s wall / 21 s user after.

Timings after the wave (one run each, final gates):

| Suite | Before (a2a5091b) | After the first pass | After the wave |
|---|---|---|---|
| Go `go test -count=1 -p 2 ./...` wall | 422 s | 252 s | 113 s (2.9 → 3.5) |
| Go slowest packages | api 392.4 s, auth 63.9, backup 34.7 | api 247.8 s, auth 28.9, cmd/qinqin 17.2 | api 41.2 s, auth 22.0, cmd/qinqin 15.2, stats 14.6, sync 11.7, lexicon 11.1, datapkg 9.0, backup 7.7, grammar 6.9, library 6.0 |
| Web vitest, Node 26, wall | 165 s | 184 s | 255 s (2.8 → 9.8: the #157 agent ran beside it) |

Final gates of the wave: gofmt clean, `go mod tidy -diff` 0, `go vet ./...` and `go test ./...` green but the
known `TestHostnameResolvingToEmbeddedFormIsRefused` (no IPv6 here); web check 0 errors, Node 26 vitest 588
files passed, build ok; `check-sources` and `node --test scripts/*.test.mjs` (156 pass). The web suite's
skipped count is 2 instead of 8 because a build existed during the run (the build-id test skips without one).

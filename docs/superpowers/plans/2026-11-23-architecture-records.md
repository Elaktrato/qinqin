# Plan — architecture decision records in `docs/architecture/` (#191)

Part of #190, phase 1. Branch `docs/191-architecture-records` from `develop` at 8b632f29, worktree
`.claude/worktrees/191-adr`. Docs only: no Go, no behaviour change. Test-first: the doc check is written and
seen failing before the records and the links exist; one commit per group.

## Scope (owner, 2026-11-23)

Write the records whose decisions already exist; later issues update their own record when they land:

| Record | Decision | Status |
|---|---|---|
| 0001 error handling | #168 | Accepted (implemented, merged in 72705c92) |
| 0002 sync unreadable rows | #167 | Accepted (implemented, merged in 72705c92) |
| 0003 domain packages own their SQL | #194 | Accepted, being implemented by #194 |
| 0004 web folder rules | #195 | Accepted, being implemented by #195 |
| 0005 test conventions | #197 | Accepted, being implemented by #197 |
| 0006 core features instead of code plugins | #199 | Accepted, being implemented by #199 |

Not written now: the pack system / how to add a pack type (#192) and the web state model (#196); the README
names them as records their issues write.

## Tasks

1. **Doc check, records, index** (`apps/web/src/lib/architectureDocs.test.ts`, `docs/architecture/`). The test:
   the README exists, names `docs/contracts/` and "code structure", shows every template section and status
   value, and its relative links resolve; records are `NNNN-kebab-name.md` numbered from 0001 without gaps,
   start with `# NNNN. Title`, have exactly the sections Status, Context, Decision, Consequences,
   Allowed / Not allowed, Enforcement (optionally Open questions last), a known status, one index row with the
   same title and status, resolving links; an `Accepted` record names at least one repository path in
   backticks and every such path exists. See it fail (no folder), write the README and the six records, see it
   pass.
2. **Links** (README development section, wiki `Development.md` with a new "Architecture records" section and
   the doc-check list, wiki `Project-layout.md`). Add the link assertions to the test, see them fail, add the
   links, see the test and the existing doc checks pass.
3. **This plan**, gates, Execution record.

## Gates

`npm --prefix apps/web run check`; the full vitest under Node 26
(`cd apps/web && PATH=/home/user/qq-tools/node-v26.13.1-linux-x64/bin:$PATH npx vitest run`);
`node --test scripts/*.test.mjs`; `node scripts/gen-api-docs.mjs --check`. No Go gate (no Go touched).

## Rulings

- Ruling: records pin code structure and link the contract for the data rule instead of repeating it
  (0001 links `docs/contracts/auth/errors.json`, 0002 the "Reading rows" section of the sync contract) — one
  source per rule; a duplicated rule drifts — cost if wrong: a reader follows one more link.
- Ruling: the status "Superseded" is written `Superseded by [NNNN](NNNN-name.md)` and the test checks that the
  target exists — a superseded record without its successor is a dead end — cost if wrong: none; the form can
  be relaxed in the test.
- Ruling: an `Accepted` record's backticked repository paths (`server/…`, `apps/web/…`, `docs/…`, `scripts/…`)
  must exist; "being implemented" records are exempt, since they name planned paths (`internal/dbtest`,
  `lib/testing/study.ts`) — a record in force that names a moved or deleted file is wrong and the test says so
  in the branch that moves it (#195 moves many web files; #198 deletes legacy code) — cost if wrong: an extra
  record edit in those branches, which is the point.
- Ruling: records 0001 and 0002 describe only current, non-legacy code; the legacy pull, the legacy
  plugin-data view and their tests are left out — #198 removes the v0.3 compatibility layer and merges first —
  cost if wrong: none for the records; #198 deletes nothing they name.
- Ruling: points a deciding issue leaves open go under "Open questions" with the issue that decides them, and
  the records add no rule of their own; a few "Not allowed" items restate what the issue's moves or context fix
  (0004: loose modules at the top of `lib/`, UI in logic folders, duplicate file names) and are labelled as
  such — the owner asked not to invent decisions — cost if wrong: an implementing issue may find a record too
  thin and must add to it, which it does anyway when it lands.
- Ruling: the doc check lives in `apps/web/src/lib/` beside `wikiDocs.test.ts` and `readmeDocs.test.ts`, not
  yet in `apps/web/tests/repo/` — #195 moves every repository test there in one pass, and 0004 says so —
  cost if wrong: one more file in #195's move list.
- Ruling: the wiki links the folder with `tree/develop`, as `API-Overview.md` does for `docs/contracts/` — the
  wiki is published from `main`, but the existing links use `develop`, and records change on `develop` first —
  cost if wrong: a wiki reader sees records a release ahead of the deployed version.
- Ruling: no new wiki page; a section on Development and a row on Project layout — the records are for
  contributors and live in the repository, the wiki only points there — cost if wrong: none; `_Sidebar.md` is
  unchanged.

## Execution record

- Task 1: the test was written first and run before `docs/architecture/` existed: 7 failed, 2 passed (the two
  that pass vacuously on an empty folder). The link assertions were held back to task 2 so the first commit is
  green. After the README and records: 38 passed. Mutation check by hand: renaming a section heading and
  misspelling a path in 0001 made exactly the template and path tests fail; reverted.
- Task 2: with the link assertions added, 3 failed (README, Development, Project layout); after the links, the
  five doc checks (`architectureDocs`, `wikiDocs`, `contractsDocs`, `readmeGallery`, `readmeDocs`) passed,
  424 tests; `gen-api-docs --check` exit 0.
- Code facts in 0001 and 0002 were read from the code at 8b632f29 (`server/internal/api/errors.go`,
  `errors_static_test.go`, `errors_walk_test.go`, `apps/web/src/lib/api/apiErrors.ts`, `userError.ts`,
  `i18n/lint.ts`, `sync/pager.ts`, `sync/rows.ts`, `study/unreadable.ts`, `study/store.ts`,
  `server/internal/study/sql.go`, `server/internal/sync/page.go`, `sync.go`, `api/handlers_sync.go`) and the
  test names listed were grepped; the path test checks the paths.
- Gates (after task 2): `npm --prefix apps/web run check` exit 0 (0 errors, 0 warnings); full vitest under
  Node 26.13.1 exit 0, 588 files, 12602 passed, 8 skipped; `node --test scripts/*.test.mjs` exit 0 (157 tests,
  156 pass, 0 fail, 1 skipped); `node scripts/gen-api-docs.mjs --check` exit 0. No Go touched, no Go gate.
- #198's work in progress (its worktree at 788991e5 plus uncommitted changes) deletes
  `handlers_plugins_legacy.go`, `study/legacy.go`, `sync/legacy.go` and their tests; none is named in a
  record.
- Not verified: the records' wording of the planned decisions (0003–0006) against the owner's intent beyond
  the issue text; that #198's final branch leaves every path named in 0001/0002 in place (the path test will
  say so after the merge).

### Review fix wave (one wave, after the independent review)

- Group 1, `aab58cd6` test(docs) (items 7, 8, 12, 13). New checks in `architectureDocs.test.ts`: an Accepted
  record's backticked identifiers (`Name`, `name()`, `name(...`) must occur as a word in `server/**/*.go`,
  `apps/web/src/**/*.{ts,svelte}`, `scripts/**/*.mjs` or `docs/contracts/**/*.json`; `#anchor` links into
  Markdown files must hit a heading (`mdAnchors`, as the wiki check); an Accepted record's Enforcement must not
  say "planned", "being implemented" or "until then"; the README link must sit inside the Development section
  only; every record's Status has a `Touched by: #N, ...` line and the README says a merge from such an issue
  updates the record. Seen failing first: the Touched-by checks failed on all six records and the README (7
  failures) before the lines were added; by-hand mutations (a misspelled `errMessageFindings` in 0001, a
  broken `#reading-rows...` anchor in 0002, a "Planned by" line in 0001's Enforcement, the README link moved
  to the Licence section) each failed exactly their test; reverted. Touched by: 0001 ← #194, #195, #199; 0002
  ← #193, #195, #196; 0003 ← #194; 0004 ← #195; 0005 ← #197; 0006 ← #199. 0002 and 0004 note that
  `lib/study/UnreadableRowsNotice.svelte` is UI in a logic folder that #195 moves.
- Group 2, `50f5a731` docs(architecture) (items 1–6, 9–11): 0001 lists the real `dynamicCodeWriters`
  (`writeAIError`, `writeSMTPInputError`, `handleTestSMTP`, `requirePrincipal`, `requireAdminPrincipal`,
  `tokenGate`, `handleExportDownload`, `handleRestoreUpload`; `writePackError` writes literals), adds
  `documentedStatuses`, drops `http.Redirect` from the checked rules (the AST scan only sees `http.Error` and
  `http.NotFound`) and moves the unchecked rules to the Review line. 0002: typed rows decode with `parseRow`,
  `pluginData` with `readableRow`; the typed-list rule is narrowed to "which rows are typed or how they
  decode", with `V2_STUDY_COLLECTIONS` and `CACHEABLE_PULL_COLLECTIONS` named as scope lists with their
  pinning tests, and "derive `V2_STUDY_COLLECTIONS` from `STUDY_COLLECTIONS`" as an open follow-up (no code
  change on this docs branch). 0005: the `internal/db` migration-test exception in the rule; the open question
  marked "not addressed by #197". 0006: the order #193, #196, #199 from the owner's queue as a decision (open
  question removed); #189 cited from the queue.
- Gates after the wave: web check exit 0 (0 errors, 0 warnings); full vitest under Node 26.13.1 exit 0, 588
  files, 12619 passed, 8 skipped; `node --test scripts/*.test.mjs` exit 0 (156 pass, 0 fail, 1 skipped);
  `gen-api-docs --check` exit 0. No Go touched.
- Not verified: the records against develop after #198 merges (the coordinator asks for a merge and rerun then;
  the path and identifier checks will show any break).

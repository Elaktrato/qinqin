# Web robustness (issues #167, #173, #174) Implementation Plan

> Steps use checkbox (`- [ ]`) syntax. Strictly test-first: write the test, run it, see it fail, implement, see it
> pass. One commit per task.

**Goal:** one unreadable study row never blocks studying and is never overwritten (#167); sign-out, an expired
session and a user switch clear every per-user cache through one registry (#173); every study write names its
workspace explicitly (#174).

**Spec (binding, incl. Rulings):** `docs/superpowers/specs/2026-11-23-web-robustness-design.md`.

**Branch / worktree:** `feature/hb-web-robust`, worktree `/home/user/qinqin/.claude/worktrees/hb-web-robust`
(`<wt>`). Parallel: #168 edits `apps/web/src/lib/api/client.ts` and error display — this branch only changes the
callback `auth.ts` passes to `setUnauthorizedHandler`, not the client.

## Gates

- Web: `npm --prefix <wt>/apps/web ci` once; per task targeted `cd apps/web && npx vitest run <paths>`; `run check`
  on tasks that touch Svelte or types; before the last commit `run check`, `test`, `run build` and the full vitest
  with Node 26 (`PATH=/home/user/qq-tools/node-v26.13.1-linux-x64/bin:$PATH npx vitest run`).
- Go (Task 3 only): `cd <wt>/server && flock /tmp/qinqin-go.lock env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy -u NO_PROXY -u no_proxy GOTOOLCHAIN=auto GOFLAGS=-buildvcs=false sh -c 'gofmt -l . ; go vet ./internal/study/... ./internal/sync && go test -count=1 -p 2 -timeout 30m ./internal/study/... ./internal/sync'`;
  ONE full `./...` run before the last commit (known env failure: `internal/ai`
  `TestHostnameResolvingToEmbeddedFormIsRefused` only).
- Commits: explicit `git add <files>`, message ends with a blank line and exactly
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push. `git status` clean.

## Tasks

### Task 1 (#167): the pager checks the envelope only

- [ ] Mark the row-level cases of `docs/contracts/sync/pull-page.json` `"level": "row"`; extend
  `lib/sync/pullPage.contract.test.ts`: envelope cases are refused by `parsePullPage`; row cases decode as a page
  and `readableRow(collection, row)` refuses the offending row; every row of a valid case is readable; the events
  test uses `readableRow`. `pager.test.ts`: a page with one unreadable card row is returned whole. Run: fails.
- [ ] `lib/sync/rows.ts` `readableRow` (shapes from the old `rowOk`, typed rows via `parseRow` over
  `STUDY_COLLECTIONS`); `parsePullPage` checks arrays only; drop `TYPED`. Run: passes.

### Task 2 (#167): the study load skips, counts and protects unreadable rows

- [ ] Fixture `docs/contracts/sync/unreadable-rows.json` (spec §1). `lib/study/unreadable.contract.test.ts`: the
  page decodes; `loadStudyData(7)` returns exactly the readable rows; the report counts the unreadable ones per
  collection; `saveDeckCardTypes`/`saveDeckLimits`/`saveWorkspaceLimits`/`setActiveSet` on a protected identity
  throw `UnreadableRowError` without a push; `addCard` for the entry whose derived id is held by an unreadable
  card writes another id; `deleteDeck` of a deck whose settings are unreadable does not tombstone them. Store
  tests: one corrupt card row still yields a session's cards. Run: fails.
- [ ] `store.ts`: `StudySnapshot.unreadable`; `fetchStudyData` decodes `pluginData` with `readableRow`, collects
  unreadable identities and counts, publishes the report (`study/unreadable.ts`); `studyWrite` throws on a
  protected key; `freshCardId` treats protected card ids as taken; `loadRawStudyData` returns `unreadable`. Remove
  the misleading comment. Run: passes.

### Task 3 (#167): Go reads the fixture

- [ ] `server/internal/study/rows/unreadable_contract_test.go`: every typed row of the fixture page decodes
  (`Decode` + `Validate`) exactly when the fixture lists it as readable. Run once with a deliberately wrong
  expectation to see it fail, then the gate.

### Task 4 (#167): the notice

- [ ] `lib/study/unreadable.test.ts` (text of the report, warning without data) and a jsdom test of
  `UnreadableRowsNotice.svelte` on the study page. Run: fails. Implement; i18n key in `en.json` (+ note). Passes.

### Task 5 (#173): the session-end registry

- [ ] `lib/session/sessionEnd.test.ts`: registration order, unregister, a throwing function does not stop the
  rest, the reason is passed, the epoch moves. Run: fails. Implement. Passes.

### Task 6 (#173): every cache registers; auth calls endSession

- [ ] `lib/session/signOutIsolation.test.ts` (spec §2 test) and `auth.test.ts` cases (logout → `signOut`, 401 →
  `expired`, another tab's user → `switched`; workspace choice kept on `expired`). Run: fails.
- [ ] Register every cache of the spec list, epoch guards on caches that store after an `await`; `auth.ts` drops
  the feature imports. Run: passes.

### Task 7 (#173): the lint

- [ ] `lib/session/sessionCaches.lint.test.ts` with the allowlist; prove it flags a planted cache (a fixture
  string run through the scanner). Run against the tree.

### Task 8 (#174): explicit workspace in `store.ts`

- [ ] `lib/study/store.workspace.test.ts` (spec §3, one test per family) and a source test that `store.ts` does
  not import `workspaces`; update `store.test.ts` and the other direct callers' tests to the new signatures. Run:
  fails (type and runtime). Implement; remove `requireWorkspaceId`. Passes.

### Task 9 (#174): call sites and card actions

- [ ] `cardActions.test.ts`: the workspace is passed through and the undo after a switch restores into the
  original workspace; jsdom tests of the call sites pass the loaded workspace. Run: fails. Update `cardActions.ts`,
  `CardManager`, `DeckDetail`, `DeckList`, `DeckSettingsView`, `DeckLimitsEditor`, `StudySettings`,
  `DeckCardTypes`, `AddToStudy`, `AddToStudyButtons`, `grade.ts`, `routes/study/+page.svelte`,
  `routes/study/session/+page.svelte`. Passes; `run check`.

### Task 10: docs, real-app check, gates, Execution record

- [ ] `docs/contracts/README.md` sync row, `overview.md` (reading rows), wiki (`Troubleshooting.md`: the notice;
  `Accounts-and-sign-in.md`: what sign-out clears) if behaviour is user-visible.
- [ ] Real-app check (scratch-built server): push nothing malformed is possible through the API (strict push), so
  insert one malformed typed row and one future-version row into the scratch database directly, load the study
  data through the web code (temporary vitest against the live server), sign out / sign in as user B; kill and
  delete everything.
- [ ] Full gates; fill the Execution record.

## Execution record

(filled in after the build)

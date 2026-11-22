# Paging `GET /api/events` (issue #110) Implementation Plan

> Steps use checkbox (`- [x]`) syntax. Strictly test-first: write the test, run it, see it fail, implement,
> see it pass. One commit per task.

**Goal:** `GET /api/events` answers in pages (`limit`/`page`, `{events, more, next}`), the legacy array stays
for old clients but is streamed, the web (widgets' log, study load, plugin SDK) follows pages, the service
worker caches the pages, contract fixture and docs updated.

**Spec (binding, incl. Rulings):** `docs/superpowers/specs/2026-11-22-events-paging-design.md`.

**Branch / worktree:** `feature/sb-events-paging`, `/home/user/qinqin/.claude/worktrees/sb-events-paging` (`<wt>`).
No migration.

## Gates

- Go, under the lock, proxies unset, targeted packages:
  `cd <wt>/server && flock /tmp/qinqin-go.lock env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy -u NO_PROXY -u no_proxy GOTOOLCHAIN=auto GOFLAGS=-buildvcs=false sh -c 'gofmt -l . ; go vet ./internal/events ./internal/api && go test -count=1 -p 2 -timeout 30m ./internal/events ./internal/api'`
  ONE full `./...` before the last commit (known env failure: `internal/ai` `TestHostnameResolvingToEmbeddedFormIsRefused`).
- Web: targeted `cd apps/web && npx vitest run <paths>`; at the end `npm --prefix apps/web run check`, `test`,
  `run build`, and the full vitest with Node 26.
- `node scripts/gen-api-docs.mjs --check` exits 0 after Task 4.
- Commits end with a blank line and exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Tasks

### Task 1 — page request and token (`server/internal/events/page.go`)
- [x] Test `page_test.go`: `ParsePageRequest` (paged iff `limit` or `page`; limit 1..2000; continuation may not
  repeat `since`/`limit`; empty page invalid; bad `since` → `ErrSinceInvalid`), token round trip, a token of
  another user / garbled / wrong prefix / bad position → `ErrPageInvalid`; constants equal `sync`'s (api test).
- [x] Implement `PageRequest`, `ParsePageRequest`, `pageToken` encode/decode (`e1.`).

### Task 2 — `ListPage` keyset walk
- [x] Test on a real DB: walking with limits 1, 7, 2000 concatenates to `Since`; `since` and workspace filters;
  `more` false on the last page (look-ahead); empty log → one empty page; 4 MiB budget (a big row ships alone,
  the page before it stops early); another user's rows never appear; the continuation's workspace must equal
  the token's.
- [x] Implement `ListPage(ctx, db, user, req) (Page, error)`.

### Task 3 — `StreamSince` (legacy, streamed)
- [x] Test: bytes equal `json.Marshal(Since(...))` for empty, one, many, all-workspace and since-filtered logs; a
  writer error stops the stream with that error.
- [x] Implement `StreamSince(ctx, w, db, user, since, workspace) error`.

### Task 4 — handler
- [x] Test `handlers_events_page_test.go`: unauthenticated 401 on both forms; a paged walk over HTTP equals the
  legacy body; `Cache-Control: no-store`; legacy headers `Deprecation`/`Link`; `events_page_invalid` cases; a
  foreign workspace 404 on the first page and on a continuation; bob replaying alice's token → 400; a
  workspace-limited read token walks its workspace (continuation repeats it) and is 403 without it; constants
  equal `sync.MaxPageLimit`/`MaxPageBytes`.
- [x] Implement in `handlers_events.go`; register `events_page_invalid` in `docs/contracts/auth/errors.json`;
  regenerate `docs/wiki/API-Errors.md`.

### Task 5 — contract `docs/contracts/events/page.json`
- [x] Fixture: valid and invalid pages (shape), request cases (query → status, error). Go test
  `contract_events_page_test.go` runs the request cases and decodes the valid pages strictly.
- [x] `events/README.md` (Paging section), `contracts/README.md` row, `overview.md` (events read + "not
  specified" entry).

### Task 6 — web reader `apps/web/src/lib/eventPages.ts`
- [x] Test `eventPages.test.ts`: decodes every valid fixture page and refuses every invalid one; URL builders
  (sorted keys, continuation repeats workspace); `readAllEvents` follows pages, accepts a bare array, refuses a
  bad page, stops after `maxPages`.
- [x] Implement.

### Task 7 — callers
- [x] Tests: `events.test.ts` (log cache follows two pages), `study/store.test.ts` (study load follows pages),
  `plugins/sdk.test.ts` (list follows pages, `types` filter, combined view).
- [x] Switch `lib/events.ts`, `lib/study/store.ts`, `lib/plugins/sdk.ts` to `readAllEvents`.

### Task 8 — service worker
- [x] Tests: `classify.test.ts` (continuation with workspace cached; without workspace, with extra params or a
  bad token bypassed), `scrub.test.ts` (a page object loses its `lookup` events; bad page → null),
  `strategies.test.ts` (a two-page walk is served offline), `prepareOffline.test.ts` path.
- [x] Implement in `pwa/sw/classify.ts`, `pwa/sw/scrub.ts`; `docs/contracts/pwa/README.md`.

### Task 9 — wiki
- [x] `docs/wiki/API-Reference.md` (paged form, legacy deprecation), `Install-and-offline.md` if it names the
  log; `node scripts/gen-api-docs.mjs --check`.

### Task 10 — real-app check and final gates
- [x] Scratch build before/after, 20 000 events, curl walk vs legacy, peak RSS, two-user isolation; full gates.

## Execution record

Built 2026-11-22 on `feature/sb-events-paging` (base `91c1bc6e`), one commit per task.

- Task 1 `a99bfa9b`: test failed (undefined `PageRequest`), then passed. `since` is truncated to its whole second
  in `ParsePageRequest` (the store compares whole seconds anyway).
- Task 2 `5d2d11b5`: test failed (undefined `ListPage`), then passed first time; `scanEvent` factored out of
  `Since` (no behaviour change, `Since` tests unchanged and green).
- Task 3 `6339da72`: test failed (undefined `StreamSince`), then passed; `sinceQuery` shared with `Since`.
- Task 4 `c3fabfda`: handler test failed (array answered, no headers), then passed; `events_page_invalid` added to
  `auth/errors.json`, `API-Errors.md` regenerated. Added beyond the plan: a legacy stream that fails before its first
  byte answers 500 instead of an empty 200 (`countingWriter`). Validation order: a foreign `workspace=` is 404
  before the token is decoded (bob replaying alice's token on her workspace is 404, on his own 400).
- Task 5 `3b2fc019`: the contract tests pin behaviour built in Task 4, so they passed on first run; they were
  checked by mutation instead (a wrong reason and a 404→403 status in the fixture made both tests fail, restored).
- Task 6 `67816a97`: failed (module missing), then passed.
- Task 7 `f3451029`: the new/changed URL and paging tests in `events.test.ts`, `store.test.ts`, `sdk.test.ts`
  failed, then passed. Deviation: the strict reader refuses a non-array, non-page answer where the old code read
  "no events"; two `store.test.ts` mocks that answered `/api/events` with a pull body were fixed to answer `[]`.
  `apiErrors.test.ts` requires an i18n key per error code: `apiError.eventsPageInvalid` added to `en.json` and
  `apiErrors.ts` here (it belongs to Task 4's code).
- Task 8 `8c0f711b`: classify/scrub/strategies tests failed, then passed. Found while writing it: a saved page whose
  events were all `lookup` becomes `{events: [], more: true}`, which the strict reader refused, so offline the walk
  would break. The reader now follows an empty page with `more` (fixture case `readerAccepts: true`; the server's
  own shape check in Go still refuses it, because the server never sends one).
- Task 9 `045d716b`: wiki `API-Reference.md`; `gen-api-docs.mjs --check` 0. `Install-and-offline.md` names no
  event route, left unchanged.

Real-app check (scratch copies of `server/` at `91c1bc6e` and at the Task 9 commit, built to binaries, served on
127.0.0.1:18731 with `QINQIN_AUTO_SEED=0`, killed and deleted afterwards):

- Seed: alice (zh workspace 20 000 events, ja 300), bob (50), via `POST /api/events/batch`.
- The legacy answer of the zh workspace (4 180 471 bytes, 20 000 events) is byte-identical between the old and
  the new binary; the new one adds `Deprecation: true`. The paged walk (`limit=2000`) is 10 pages, ~0.3 s, and its
  concatenated items are byte-identical to the legacy answer; the combined view walked at `limit=500` (41 pages,
  20 300 events) equals the combined legacy answer. Same checks after adding 80 000 events (100 000 in zh,
  20 929 681 bytes): identical.
- Isolation: bob on alice's workspace 404 (first page and with alice's token), alice's token on bob's own workspace
  400, a continuation without its workspace 400, unauthenticated 401 in both forms, bob's walk holds only his 50.
- Memory: process RSS is useless here (64 MB live Go heap after start-up, so with GOGC=100 a request grows the heap
  to ~128 MB before the first GC whatever it does; SQLite page memory added the same ~69 MB anonymous RSS to every
  variant, a trivial request +0.25 MB). Measured instead the Go heap with `GODEBUG=gctrace=1 GOGC=5` (GC every
  ~3 MB, so the trace follows the live heap), fresh process per read, two runs each, peak over the read:
  20 000 events — old legacy 68 MB, new legacy 67 MB, new paged walk 67 MB (start-up live 64 MB);
  100 000 events — old legacy 93–94 MB, new legacy 67 MB, new paged walk 67 MB. The old handler grows with the log
  (+30 MB at 100 000), the new forms stay at the GC step (+3 MB) at both sizes.

Final gates:

- Web: `npm --prefix apps/web run check` exit 0 (1648 files, 0 errors, 0 warnings); `run build` exit 0;
  `npm --prefix apps/web test` (Node 22) exit 1: 5 failed / 12 085 passed / 8 skipped of 12 098 in
  `settings/AccountSettings.dom.test.ts` (1) and `features/reader/BookView.dom.test.ts` (4) — the same 5 fail with
  the base commit's `apps/web/src` checked out in this worktree, so they are not this branch's (Node 22 only:
  the Node 26 run below passes them). Node 26.13.1 full vitest exit 0: 562 files, 12 096 passed, 2 skipped.
- Go: one full run `gofmt -l .` (nothing), `go vet ./...`, `go test -count=1 -p 2 ./...`: 45 packages ok, 3 without
  tests, 1 FAIL = `internal/ai` `TestHostnameResolvingToEmbeddedFormIsRefused` only (no IPv6 sockets here, the known
  environment failure).

Not verified: the web against the real server in a browser (no browser automation here; the reader, callers and
service worker are covered by unit and worker tests); an old v0.4 PWA shell itself (its request, the legacy
`since=&workspace=` array, is covered by the byte-identity check and the classify tests); `-race` (no concurrency
changed); Android (it reads the pull, untouched).

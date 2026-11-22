# Paging `GET /api/events` (issue #110) Implementation Plan

> Steps use checkbox (`- [ ]`) syntax. Strictly test-first: write the test, run it, see it fail, implement,
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
- [ ] Test `page_test.go`: `ParsePageRequest` (paged iff `limit` or `page`; limit 1..2000; continuation may not
  repeat `since`/`limit`; empty page invalid; bad `since` → `ErrSinceInvalid`), token round trip, a token of
  another user / garbled / wrong prefix / bad position → `ErrPageInvalid`; constants equal `sync`'s (api test).
- [ ] Implement `PageRequest`, `ParsePageRequest`, `pageToken` encode/decode (`e1.`).

### Task 2 — `ListPage` keyset walk
- [ ] Test on a real DB: walking with limits 1, 7, 2000 concatenates to `Since`; `since` and workspace filters;
  `more` false on the last page (look-ahead); empty log → one empty page; 4 MiB budget (a big row ships alone,
  the page before it stops early); another user's rows never appear; the continuation's workspace must equal
  the token's.
- [ ] Implement `ListPage(ctx, db, user, req) (Page, error)`.

### Task 3 — `StreamSince` (legacy, streamed)
- [ ] Test: bytes equal `json.Marshal(Since(...))` for empty, one, many, all-workspace and since-filtered logs; a
  writer error stops the stream with that error.
- [ ] Implement `StreamSince(ctx, w, db, user, since, workspace) error`.

### Task 4 — handler
- [ ] Test `handlers_events_page_test.go`: unauthenticated 401 on both forms; a paged walk over HTTP equals the
  legacy body; `Cache-Control: no-store`; legacy headers `Deprecation`/`Link`; `events_page_invalid` cases; a
  foreign workspace 404 on the first page and on a continuation; bob replaying alice's token → 400; a
  workspace-limited read token walks its workspace (continuation repeats it) and is 403 without it; constants
  equal `sync.MaxPageLimit`/`MaxPageBytes`.
- [ ] Implement in `handlers_events.go`; register `events_page_invalid` in `docs/contracts/auth/errors.json`;
  regenerate `docs/wiki/API-Errors.md`.

### Task 5 — contract `docs/contracts/events/page.json`
- [ ] Fixture: valid and invalid pages (shape), request cases (query → status, error). Go test
  `contract_events_page_test.go` runs the request cases and decodes the valid pages strictly.
- [ ] `events/README.md` (Paging section), `contracts/README.md` row, `overview.md` (events read + "not
  specified" entry).

### Task 6 — web reader `apps/web/src/lib/eventPages.ts`
- [ ] Test `eventPages.test.ts`: decodes every valid fixture page and refuses every invalid one; URL builders
  (sorted keys, continuation repeats workspace); `readAllEvents` follows pages, accepts a bare array, refuses a
  bad page, stops after `maxPages`.
- [ ] Implement.

### Task 7 — callers
- [ ] Tests: `events.test.ts` (log cache follows two pages), `study/store.test.ts` (study load follows pages),
  `plugins/sdk.test.ts` (list follows pages, `types` filter, combined view).
- [ ] Switch `lib/events.ts`, `lib/study/store.ts`, `lib/plugins/sdk.ts` to `readAllEvents`.

### Task 8 — service worker
- [ ] Tests: `classify.test.ts` (continuation with workspace cached; without workspace, with extra params or a
  bad token bypassed), `scrub.test.ts` (a page object loses its `lookup` events; bad page → null),
  `strategies.test.ts` (a two-page walk is served offline), `prepareOffline.test.ts` path.
- [ ] Implement in `pwa/sw/classify.ts`, `pwa/sw/scrub.ts`; `docs/contracts/pwa/README.md`.

### Task 9 — wiki
- [ ] `docs/wiki/API-Reference.md` (paged form, legacy deprecation), `Install-and-offline.md` if it names the
  log; `node scripts/gen-api-docs.mjs --check`.

### Task 10 — real-app check and final gates
- [ ] Scratch build before/after, 20 000 events, curl walk vs legacy, peak RSS, two-user isolation; full gates.

## Execution record

(filled in during the build)

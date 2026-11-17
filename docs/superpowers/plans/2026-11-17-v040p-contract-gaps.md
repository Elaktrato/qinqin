# Remaining contract gaps; `overview.md` as the single Android entry point (v0.4.0 prep item 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (fresh implementer
> per task or per few tasks, independent review on the strongest model with a contract-accuracy focus, one fix
> wave, mutation checks of at least three new fixture tests). Steps use checkbox (`- [ ]`) syntax. Strictly
> test-first: write the test, run it, SEE IT FAIL, implement (here: write the fixture or extract the function),
> see it pass.

**Goal:** Every rule a second client needs for #34–#38 that is derivable from today's code is pinned in
`docs/contracts/` (README + JSON fixtures decoded by Go and/or web tests): study event envelope and payloads
(`session`, `view`, `lookup`, `read`, `journal`), review parsing and replay order, heatmap scoring, the FSRS pin,
the duplicate-card merge, deck sessions, XP, character mastery, workspace settings keys, the `qinqin-core` UI rows
and the overlay rules. `overview.md` is corrected and restructured as the single Android entry point; a guard
test keeps every fixture decoded and every folder listed.

**Architecture:** Documentation and tests. New contract folders `docs/contracts/events/`, `settings/`,
`overlays/`; new files in `scheduler/` (`fsrs.json` generated, `xp.json`), `study/` (`canonical.json`), `cards/`
(`deck-session.json`), `decks/` (`char-mastery.json`). One production refactor: `apps/web/src/lib/eventPayloads.ts`
(pure payload builders) used by the four event call sites. Go: new contract tests in `server/internal/api` and
`server/internal/stats`; no Go production change. **No route, no migration, no token rule, no pull collection,
no stored shape change, no behaviour change.**

**Tech stack:** Go 1.26 stdlib tests; SvelteKit 2 / Svelte 5, vitest; Node for the fixture generator. No new
dependencies.

**Spec (binding, incl. Rulings):** `docs/superpowers/specs/2026-11-17-v040p-contract-gaps-design.md`.

**Issue:** #109 (created by the orchestrator from the spec's Appendix A); follow-up D1 (page `GET /api/events`)
is #110. Commit bodies carry `Refs #109`.

**Branch / worktree:** `feature/v040p-contract-gaps`, worktree
`/home/user/www/github/qinqin/.claude/worktrees/contract-gaps` (`<wt>`), branched from `feature/v040p-packages`
(item 5 built). **Before Task 1:** `git -C <wt> log --oneline` shows item 5's commits;
`docs/contracts/sync/pull-page.json`, `docs/contracts/packages/` and `apps/web/src/lib/sync/pager.ts` exist. If
item 5 was merged into the collection branch in the meantime, merge the collection branch in (`--no-ff`, never
rebase) and record it. The orchestrator merges and pushes; never push.

## Gates

- Toolchain: `export PATH=/home/user/qq-tools/goroot/bin:/home/user/qq-tools/node-v26.13.1-linux-x64/bin:$PATH`.
- Web (read exit codes, never behind `| tail`): `npm --prefix <wt>/apps/web ci` once; per task the targeted
  `cd <wt>/apps/web && npx vitest run <paths>` (fail first, then pass), then `npm --prefix <wt>/apps/web run check`
  and `npm --prefix <wt>/apps/web test`; `run build` in Tasks 2 and 12.
- Go, per task that adds a Go test (from `<wt>/server`):
  `flock /tmp/qinqin-go.lock env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy -u NO_PROXY -u no_proxy GOTOOLCHAIN=auto GOFLAGS=-buildvcs=false sh -c 'gofmt -l . ; go vet <pkgs> && go test -count=1 -p 2 -timeout 30m <pkgs>'`
  (`gofmt -l` prints nothing). ONE full `./...` gate before the last commit; only `internal/ai`
  `TestHostnameResolvingToEmbeddedFormIsRefused` may fail (no IPv6 in the sandbox).
- Generator: `node <wt>/scripts/contracts/gen-scheduler-fixtures.mjs --check` exits 0 after Task 4 and at the end.
- Node 26 full vitest once before the last commit.
- No new route: the route walk, the PWA route fixture, `auth/tokens-routes.json` and `docs/wiki/API-Routes.md`
  stay unchanged (their tests confirm). If a fixture seems to need a route or a behaviour change, stop and
  record a Ruling; a genuine bug found while extracting is fixed in its own commit **before** the fixture pins it,
  with a test of its own, and named in the Execution record.
- One commit per task, explicit `git add <files>`, conventional message ending with a blank line and exactly
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `git status` clean after each commit.

## Global constraints

- **Extract, never invent.** Every expected value comes from running the current implementation (a scratch
  script, never committed) or from plain ts-fsrs (generated files), and is cross-checked by hand in the case's
  `note` (one sentence: the rule in words). A fixture is changed later only after re-deriving it from its source
  of truth (`docs/contracts/README.md`).
- **Test-first for pinning tests:** write the decoding test first and run it with the fixture absent → FAIL
  (file not found); add the fixture → PASS; then alter one expected value → FAIL, restore → PASS (record both
  runs in the Execution record). For the payload builders (Task 2) the usual cycle applies.
- Fixture format: `{"version": 1, "rule": "<folder>/<name>", "cases": [...]}` with `name` and `note` per case;
  generated files add `generator` and `tsFsrs`.
- Go tests read fixtures with `os.ReadFile` relative to the package (`../../../docs/contracts/...`); web tests
  import the JSON (`resolveJsonModule`), as the existing contract tests do.
- No production behaviour change. The only production edits: `lib/eventPayloads.ts` and its four call sites
  (Task 2), and the stale "UTC day" comment in `routes/+layout.svelte` (Task 2).
- Rulings of the spec are copied verbatim into the READMEs where they bind a client.

## Review focus (strongest model; must-fix findings block)

1. **Fidelity**: every fixture value equals today's code (reviewer re-derives five random cases per file by
   running the code); the READMEs say nothing the code does not do — all tasks.
2. **The `ts` rule**: whole-second UTC storage, `(ts, id)` order, Android sending truncated `ts` — Tasks 1, 3.
3. **`read` / `journal`** shapes and consumer clamping, distinct strings, absent `bookId` after restore;
   item 7's assumptions hold — Tasks 2, 8.
4. **FSRS oracle** is plain ts-fsrs (not `scheduler.ts`), carries intermediate state, covers learning steps,
   custom and migrated weights, same-second ties — Task 4.
5. **Decoding is real**: each test asserts every case's `expect`, not only that the file parses; the coverage
   guard is not satisfied by a mere file-name mention — Task 11.
6. **Overview accuracy and completeness**: Appendix B's audit re-run for every line; the "Not specified (on
   purpose)" list contains nothing Android needs for #34–#38 that the code already defines — Task 11.

---

### Task 1: `events/` README and the envelope fixture

**Files:** Create `docs/contracts/events/README.md`, `docs/contracts/events/envelope.json`,
`server/internal/api/contract_events_test.go`; modify `apps/web/src/lib/sync/pullPage.contract.test.ts` (or the
pager's own test: the `lookup` row case), `apps/web/src/lib/study/scheduler.test.ts` (order cases).

- [ ] **Step 1:** README sections: Envelope (`{id, workspaceId, device, ts, type, payload}`, ULID, RFC 3339 in,
  **stored as UTC whole seconds, fraction truncated**, `userId` forced, payload any JSON, absent = `null`, type
  and payload never validated by the server), Routes (`POST /api/events/batch` → `{accepted, duplicates}`, push
  `events`, `GET /api/events?since=&workspace=` inclusive, `(ts, id)` order, unpaged — read pull v2 instead;
  `DELETE /api/events/lookups`), Errors (plain-text 400 for id/ts/workspace, 404 foreign workspace, nothing
  stored; 4 MiB body), Order rule and the Android `ts` Ruling (spec Q2), Types table (spec Q3, filled in
  Task 2), Declared types (`qinqin-core`: session, view, lookup, review, read; `qinqin-journal`: journal;
  plugins declare theirs; a client records only declared types of enabled plugins).
- [ ] **Step 2: Failing test:** `contract_events_test.go` decodes `envelope.json` cases
  `{name, note, post: {events}, expect: {status, body?, stored?: [{id, ts, type, payload}]}}` and
  `{op: "list", since, workspace, expect: [ids]}` / `{op: "pull", expect: {types}}` against a test server with
  two users (reuse the helpers of `api/contract_push_test.go`). Run → FAIL (fixture missing).
- [ ] **Step 3:** Write the fixture: ms + offset `ts` → `Z` whole seconds; `.999` truncated not rounded; absent
  payload → `null`; unknown type `"x-test"` and payload `[1,"a"]` accepted; the same id twice (one accepted, one
  duplicate) and again in a second batch; bad ULID, missing `ts`, `workspaceId: 0` → 400 plain text, nothing of
  the batch stored; another user's workspace → 404, nothing stored; list order for two events in one second
  (id order) and `since` equal to an event's second (included); pull v2 `events` collection omits `lookup`.
  Derive by running the server code (the test itself in a scratch branch is fine), then note each in words.
- [ ] **Step 4:** Web: `sortedReviews` case from `envelope.json`'s order case (same second, ids out of order) in
  `scheduler.test.ts`; the pager rejects a `lookup` row (existing `rowOk`) from the fixture's pull case.
- [ ] **Step 5:** PASS; alter one `expect.ts` → FAIL; restore. Go gate `./internal/api`, web targeted + full.
  Commit `docs(contracts): study event envelope`.

### Task 2: Payload builders and `events/payloads.json`

**Files:** Create `apps/web/src/lib/eventPayloads.ts`, `apps/web/src/lib/eventPayloads.test.ts`,
`docs/contracts/events/payloads.json`; modify `apps/web/src/lib/events.ts` (`recordSessionOnce` uses
`sessionPayload()`), `apps/web/src/routes/entry/[id]/+page.svelte` (`viewPayload`),
`apps/web/src/lib/features/reader/BookView.svelte` (`readPayload`), `apps/web/src/lib/plugins/journal/store.ts`
(`journalPayload`), `apps/web/src/routes/+layout.svelte` (comment "UTC day" → "learner day"),
`apps/web/src/lib/stats/readingTime.test.ts`, `apps/web/src/lib/plugins/journal/entryDraft.test.ts`,
`apps/web/src/lib/features/reader/readingTimer.test.ts`, `docs/contracts/events/README.md` (types table),
`docs/contracts/backup/remap.json` only if a `view`/`read` case of `payloads.json` is not already covered there
(existing cases cover both: check, then leave unchanged and say so).

**Interfaces:**
```ts
export function sessionPayload(): null
export function viewPayload(entryId: number): { entryId: number }
export function readPayload(bookId: number, seconds: number): { bookId: number; seconds: number }
export function journalPayload(entryId: string): { entryId: string }
```

- [ ] **Step 1: Failing tests:** `eventPayloads.test.ts` decodes `payloads.json` `build` cases (each builder's
  output equals `expect`, `JSON.stringify` identical member order); `readingTime.test.ts` decodes `consume`
  cases of type `read` (`readingPoints`, `readSeconds`, `readingTotals` with a payload lacking `bookId` →
  counted under the unknown book); `entryDraft.test.ts` decodes `emit` cases of `journal` (`journalEventDue`:
  unchanged text, same day twice, next learner day across a zone change); `readingTimer.test.ts` decodes `emit`
  cases of `read` (29.9 s → 0 and kept, 30 s, a 10-minute gap counts 120 s, hidden time not counted, the
  remainder kept). Run → FAIL (module and fixture missing).
- [ ] **Step 2:** Write `payloads.json` (`build`, `emit`, `consume` cases for `session`, `view`, `lookup`
  (`write: false`, consumers ignore), `read`, `journal`), extracted by running the current functions.
- [ ] **Step 3:** Implement `eventPayloads.ts`; switch the four call sites (no other change; existing component
  tests stay green — `BookView`, entry page, journal editor dom tests). Fill the README types table (spec Q3
  verbatim with its Rulings, and the item 7 reconciliation: "`read` = `{bookId, seconds}`, `journal` =
  `{entryId: string}`, verified 2026-11-17").
- [ ] **Step 4:** PASS + gates + `run build`. Mutation: change `readPayload` member order or name → FAIL.
  Commit `feat(events): payload builders and the payload contract`.

### Task 3: `events/review-parse.json`

**Files:** Create `docs/contracts/events/review-parse.json`; modify `apps/web/src/lib/study/reviewParse.test.ts`,
`apps/web/src/lib/study/scheduler.test.ts`, `apps/web/src/lib/study/exp.test.ts`,
`docs/contracts/events/README.md` (Review section; the overview row keeps the shape and points here).

- [ ] **Step 1: Failing tests** decode cases `{event, parsed | null, valid}`: grade 0/5/2.5/"3" rejected; empty
  or numeric `cardId` rejected; missing/unknown `mode` → `vocab` (real kinds kept); `meta` with one bad member
  dropped whole; `durationMs` negative/NaN/Infinity; `tier` 3; extra payload members ignored; non-object payload;
  unparsable `ts` (`isValidReview` false; `parseReview` keeps it — record exactly what each does); and that
  `exp.ts`'s validity equals `isValidReview` on every case. FAIL (fixture missing).
- [ ] **Step 2:** Fixture from the code. **Step 3:** PASS; mutation (flip one `valid`) → FAIL.
  Commit `docs(contracts): review parsing`.

### Task 4: FSRS pin (`scheduler/fsrs.json`, generated)

**Files:** Modify `scripts/contracts/gen-scheduler-fixtures.mjs` (writes `fsrs.json`; `--check` covers it),
`apps/web/src/lib/study/scheduler.test.ts`, `apps/web/src/lib/study/fsrs/params.test.ts`,
`docs/contracts/scheduler/README.md` (FSRS section: version, every parameter by name and value, the clamp
ranges, migration, active set, the upgrade procedure); create `docs/contracts/scheduler/fsrs.json`.

- [ ] **Step 1: Failing tests:** `params.test.ts` decodes `weights`, `paramSet`, `resolve` cases against
  `checkWeights`/`validWeights`/`parseParamSet`/`resolveState` and asserts `DEFAULT_W` equals
  `parameters.w`; `scheduler.test.ts` replays every `replay` case through `scheduleTimeline` (identity clock,
  the case's `w`) and compares every point (`due` exactly, numbers to 8 decimals, `state`) and asserts the
  scheduler's ts-fsrs options equal `parameters` (expose nothing new: compare `generatorParameters({w})` with the
  fixture, and assert `scheduler.ts` passes only `w` — a source-text check is not acceptable; use a spy on
  `fsrs` via `vi.mock('ts-fsrs', …)` passthrough). FAIL (file missing).
- [ ] **Step 2:** Extend the generator: `tsFsrs` from the package, `parameters` = `generatorParameters()`,
  `clampRanges` = `CLAMP_PARAMETERS(2, true)`, the case lists of spec Q5 (≥ 20 replay sequences, each point
  with `{due, stability, difficulty, state, reps, lapses, scheduled_days, learning_steps}`), weight and param-set
  cases computed by calling ts-fsrs directly (`checkParameters`, `migrateParameters`) — never by importing
  `params.ts`. Run it; `--check` exit 0.
- [ ] **Step 3:** PASS. Mutation: change one `replay` stability digit → FAIL. Commit
  `docs(contracts): FSRS parameters and replay oracle`.

### Task 5: `study/canonical.json`

**Files:** Create `docs/contracts/study/canonical.json`; modify `apps/web/src/lib/study/canonical.test.ts`,
`docs/contracts/study/README.md` (Duplicate cards section; "no server code" Ruling),
`docs/contracts/scheduler/README.md` ("after the canonical merge" links it).

- [ ] **Step 1: Failing test** decodes `{cards, reviews, expect: {cards, reviews, merged}}` (spec Q6 list,
  including idempotence: `canonicalCards(expect)` returns `expect`). FAIL. **Step 2:** fixture from the code.
  **Step 3:** PASS; mutation → FAIL. Commit `docs(contracts): duplicate card merge`.

### Task 6: `cards/deck-session.json`

**Files:** Create `docs/contracts/cards/deck-session.json`; modify `apps/web/src/lib/study/cardFlow.test.ts`,
`docs/contracts/cards/README.md` (Deck sessions section: due order, new order, kind switches and burying
before limits, companions, budget, reserve, `backfillLimit`, eligibility, offline, vacation; link
`levels/` for level sessions).

- [ ] **Step 1: Failing test** decodes `plan` cases (inputs as `levels/character-level-queue.json`: `history`,
  `now`, `cards`, `reviews`, `deckIds`, `deckSettings`, `kinds`, `newLimit`, `reviewLimit`, `language`,
  `offline`, `skip`, `weights: "default"`, `vacation?`; expect `{queue: [cardId], reserve: [cardId],
  backfillLeft}`), `drop` and `bury` step cases (`dropItem`, `buryAfterAnswer`), `eligible` cases
  (`isEligible`). Build the `StudyContext` with the existing test helpers. FAIL.
- [ ] **Step 2:** Fixture from the code (spec Q7 list; at least: due ties, `createdAt` ties, `orderNew` by
  frequency, a reverse card in a deck without the switch, a `skipKinds` word, a buried sibling, round-robin with
  budget 3 over 2 words, reverse preferred over cloze, offline, vacation day, `newLimit` 0 → `backfillLeft` 30).
- [ ] **Step 3:** PASS; mutation → FAIL. Commit `docs(contracts): deck session plan`.

### Task 7: `scheduler/xp.json` and `decks/char-mastery.json`

**Files:** Create both fixtures; modify `apps/web/src/lib/study/exp.test.ts`,
`apps/web/src/lib/study/mastery.test.ts`, `apps/web/src/lib/study/charGroups.test.ts`,
`docs/contracts/scheduler/README.md` (XP section), `docs/contracts/decks/README.md` (Character mastery section).

- [ ] **Step 1: Failing tests:** `xp` cases (`xpFromReviews` with a zone history for the daily bonus, `xpByKind`,
  `levelProgress`), `mastery` cases (`masteryFromSchedules` with given schedules, `stageOf` boundaries,
  `cellStates` with variant glyphs). FAIL.
- [ ] **Step 2:** Fixtures from the code (spec Q8). **Step 3:** PASS; mutation → FAIL. Commit
  `docs(contracts): XP, levels and character mastery`.

### Task 8: `events/activity.json` (heatmap scoring)

**Files:** Create `docs/contracts/events/activity.json`, `server/internal/stats/contract_activity_test.go`;
modify `apps/web/src/lib/stats/readingTime.test.ts`, `docs/contracts/events/README.md` (Activity section:
count, measure, distinct; learner day per `study-day/`; the built-in rules listed; `raw` is what goals read).

- [ ] **Step 1: Failing tests:** Go inserts each case's events (the oracle test's helpers) and calls
  `stats.Activity` with the built-in rules and the case's zone history and window; compares cells
  `{day, workspaceId, type, points, raw}` (order-insensitive). Web decodes the `read` cases through
  `readingPoints`/`readSeconds` (per-event points and seconds). FAIL.
- [ ] **Step 2:** Fixture from the server code (spec Q9 list). Check: the web's per-event clamp equals the
  server's for every `read` case; a difference is a bug (stop, Ruling).
- [ ] **Step 3:** PASS; mutation → FAIL. Go gate `./internal/stats`. Commit `docs(contracts): activity scoring`.

### Task 9: `settings/` — workspace settings and `qinqin-core` rows

**Files:** Create `docs/contracts/settings/README.md`, `workspace-settings.json`, `core-rows.json`,
`server/internal/api/contract_settings_test.go`; modify `apps/web/src/lib/audio/settings.test.ts`,
`apps/web/src/lib/dictionaryVisibility.test.ts`, `apps/web/src/lib/features/reader/displaySettings.test.ts`,
`apps/web/src/lib/widgets/layout.test.ts`, `apps/web/src/lib/activity/viewPrefs.test.ts`.

- [ ] **Step 1: Failing tests:** web decodes `parse` cases per key (`audioAutoplay`, `audioDeviceVoice`,
  `hiddenDictionaries`, `reader` → pointer to `reader/display-settings.json`, not duplicated) and `core-rows.json`
  (`parseLayout`, `resolveLayout` with an availability set, `serializeLayout`, `parseActivityView`, the widget
  catalogue equals the registry's ids); Go decodes `merge` cases (`PUT /api/workspaces/{id}` with
  `{settings: patch}` over a stored object → the stored object; `null` deletes; nested merge; a merged object
  over 64 KiB → 413, unchanged). FAIL.
- [ ] **Step 2:** README: the keys table (key, shape, default, owner, who writes it), RFC 7396 merge, unknown keys
  kept, the 64 KiB cap; the two user-global rows with the spec Q10 Rulings. Fixtures from the code.
- [ ] **Step 3:** PASS; mutation → FAIL. Go gate `./internal/api`. Commit `docs(contracts): settings keys and core rows`.

### Task 10: `overlays/`

**Files:** Create `docs/contracts/overlays/README.md`, `overlay.json`,
`server/internal/api/contract_overlays_test.go`; modify `server/internal/overlay/overlay_test.go` (apply cases).

- [ ] **Step 1: Failing tests:** API cases `{entry, put: body, expect: {status, written, readings}}` (unknown id
  with a bad body → 404; blank `written` → 400; blank reading value → 400; `{written: "X"}`; `{readings: []}` →
  no readings; all-null → shared values and the row kept with a new `updatedAt` in pull v2; two PUTs → the later
  arrival wins); `overlay` package `apply` cases (pull row + shared entry → entry view). FAIL.
- [ ] **Step 2:** README: body, validation order, stored patch, revert, server stamp and its Ruling (spec Q11),
  the pull row (link `sync/`), apply rule for offline clients, backup (overlays are in the archive: check
  `backup/README.md` and link). Fixture from the code.
- [ ] **Step 3:** PASS; mutation → FAIL. Go gate `./internal/api ./internal/overlay`. Commit
  `docs(contracts): entry overlays`.

### Task 11: `overview.md`, `README.md`, coverage guard

**Files:** Modify `docs/contracts/overview.md` (restructure per spec Q12), `docs/contracts/README.md` (rows for
`events/`, `settings/`, `overlays/`; new files in the `scheduler/`, `study/`, `cards/`, `decks/` rows; the
fixture-format paragraph per spec Q12), `apps/web/src/lib/contractsDocs.test.ts` (coverage guard, spec Q13),
`docs/wiki/` pages only if a doc test or a page states an event rule now pinned differently (grep `read event`,
`session event`, `ts` in `docs/wiki/`).

- [ ] **Step 1: Failing test:** extend `contractsDocs.test.ts`: every `docs/contracts/**/*.json` name (allowlist
  `scheduler/optimizer-steps.inside.json`, `backup/sample-v1/**`) occurs in a `*.test.ts` under `apps/web/src` or
  a `*_test.go` under `server/` (read the trees with `node:fs`); every folder is in the README table and in the
  overview's read order. Run → FAIL (the overview's read order lacks folders).
- [ ] **Step 2:** Rewrite the overview: read order (all folders), folder table (adds `frequency/`, `lookups/`,
  `events/`, `settings/`, `overlays/`), sync model corrected (`ts` storage), new Events section, row-key table
  (`read` row → `events/`, new rows `home-layout`, `activity-view`, workspace settings keys), study-rules links
  (FSRS, XP, mastery, deck sessions, duplicate merge), Device-local state, Not specified (on purpose) with D1–D7
  and their owners (issue numbers), "Gaps" removed.
- [ ] **Step 3: Audit.** For every sentence of `overview.md` and `README.md` that states behaviour, find the code
  (path:line) and mark correct / corrected; record the table in the Execution record (Appendix B of the spec is
  the minimum). Any statement without code support is removed or fixed.
- [ ] **Step 4:** PASS; `wikiDocs.test.ts`, `contractsDocs.test.ts` green; full web gates. Commit
  `docs(contracts): overview as the single Android entry point`.

### Task 12: Real-app check, final gates, Execution record

- [ ] **Step 1: Real-app check (no browser).** Copy `<wt>` to a scratchpad dir (`rsync -a --exclude node_modules
  --exclude .git`), `npm --prefix <copy>/apps/web ci && run build`, copy the build where the server embeds it,
  `go build` under the Go lock, run with a scratch data dir and the smallest seed pack that gives entries
  (as item 5's F1) on a free `127.0.0.1` port (not 8080/8085/8300). With Python (`-I`): two users; user A
  workspace zh, `PUT /api/me/time-zone` Asia/Tokyo; `POST /api/events/batch` with every `envelope.json` case and a
  set of `read`/`journal`/`review`/`session`/`view` events; `GET /api/events` equals the fixture's stored values;
  `GET /api/stats/activity?workspace=` cells equal `activity.json`'s expectation for the same events (Tokyo
  days); pull v2 `events` has no `lookup`; `PUT /api/workspaces/{id}` merge cases; `PUT /api/entries/{id}`
  overlay cases and the pull v2 `overlays` row after a revert; user B's pull shows none of A's rows and a batch
  into A's workspace is 404. Record every request and answer summary. Kill the server, delete the copy,
  binary, data dir and scripts.
- [ ] **Step 2:** Full web gates (`run check`, `test`, `run build`), Node 26 full vitest, generator `--check`, ONE
  full Go gate. `git status` clean.
- [ ] **Step 3:** Fill the Execution record (below). Commit `docs(plan): contract gaps execution record`.

## Task dependencies

1 → 2 → 3 (the events README grows) → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12. Tasks 4–7 and 9–10 are independent
of each other in content but share the web gates; one implementer at a time. Task 11 needs every folder to exist.

## Contract notes (for `docs/contracts/`)

- `events/` — envelope, payloads (`session`, `view`, `lookup`, `read`, `journal`), review parse and order,
  activity scoring. Go: `api/contract_events_test.go`, `stats/contract_activity_test.go`; web:
  `eventPayloads.test.ts`, `readingTime.test.ts`, `readingTimer.test.ts`, `entryDraft.test.ts`,
  `reviewParse.test.ts`, `scheduler.test.ts`, `exp.test.ts`.
- `scheduler/fsrs.json` (generated), `scheduler/xp.json`; `study/canonical.json`; `cards/deck-session.json`;
  `decks/char-mastery.json` — web only (no server implementation; Rulings in the spec).
- `settings/` — web parse, Go merge. `overlays/` — Go only.
- Android: implements every rule above; sends `ts` in whole-second UTC; writes `read`/`journal` exactly; may
  omit `session`/`view`; never writes `lookup`; shares `home-layout` keeping unknown ids; knows overlay edits are
  server-stamped.

## Execution record

- Issue: #109 (events paging follow-up D1: #110). Base commit: `2dfe78a` (item 5 merged into this branch).
- Task 1 (envelope): Go `contract_events_test.go` with `envelope.json` absent → FAIL (`open
  ../../../docs/contracts/events/envelope.json: no such file or directory`); present → PASS; altered
  `stored[0].ts` (`09:00:00Z` → `09:00:00.789Z`) → FAIL; restored → PASS. Web `pullPage.contract.test.ts` +
  `scheduler.test.ts` with the fixture absent → FAIL (import); present → PASS; altered pull `types` (lookup added)
  → FAIL. Gates: `go.sh 'gofmt -l . ; go vet ./internal/api && go test -count=1 -p 2 -timeout 30m ./internal/api'`
  → gofmt empty, exit 0; `npm run check` → 0; `npm test` → 1 failure (`contractsDocs.test.ts`: no README row
  for `events/`), fixed by adding the `events/` row in this commit (targeted `contractsDocs`/`wikiDocs` → pass).
- Adaptation: the envelope fixture is step-based (`steps: [{post | list | pull, expect}]`, then `stored` = what
  `GET /api/events` lists afterwards) instead of the plan's flat `{post, expect}` / `{op}` cases: the list and
  duplicate rules need several requests against one server.
- Adaptation: the pager check decodes `envelope.json`'s pull case through `parsePullPage` (the exported entry;
  `rowOk` is private), on the valid last page of `sync/pull-page.json` with its event row's `type` replaced.
- Adaptation: `docs/contracts/README.md` gets its `events/` row in Task 1 (the existing doc test requires a
  row for every folder); Task 11 still rewrites the table.
- Ruling: the envelope fixture's first draft listed the two events of case 1 in posting order; the server lists
  them by `ts` (`10:00:00.789+01:00` is `09:00:00Z`, before `09:59:59Z`) — a fixture error, corrected; the
  server is right — cost: none.
- Task 2 (payloads): `eventPayloads.test.ts`, `readingTimer.test.ts`, `entryDraft.test.ts`,
  `readingTime.test.ts` with `payloads.json` absent → 4 files FAIL (import); with the fixture and before
  `eventPayloads.ts` existed → `eventPayloads.test.ts` FAIL (module missing), the 3 consumer files PASS (the
  fixture values were taken from the running consumers); builders added → PASS. Mutations: `readPayload` returning
  `{seconds, bookId}` → FAIL (member order); one `points` 2 → 1 → FAIL. Gates: `npm run check` 0; `npm test` 0
  (398 files, 6503 passed, 1 skipped); `npm run build` 0. `backup/remap.json` already has `read` (bookId remapped
  or removed) and `view` (entryId remapped or removed) cases: left unchanged.
- Ruling: the 5-minute flush (`FLUSH_EVERY_MS`) and the 1-second activity throttle (`ACTIVITY_THROTTLE_MS`) stay
  constants of `BookView.svelte` and are stated in `events/README.md`, not pinned by a fixture — the plan allows
  production edits only for the builders and their call sites, and the two constants decide how reading time is
  split into events, never how much counts — cost: Android could flush at another cadence (same totals, other
  event counts).

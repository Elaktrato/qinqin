# Mix card types within a session (#132) Implementation Plan

> Steps use checkbox (`- [ ]`) syntax. Strictly test-first: write the test, run it, see it fail, implement, see
> it pass. One commit per task; every message ends with a blank line and
> `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Goal:** sessions interleave card types and keep two cards of one word apart, in deck and level sessions,
with an optional "Grouped by type" setup choice; the order is a contract fixture for Android.

**Spec (binding, incl. Rulings):** `docs/superpowers/specs/2026-11-22-mix-card-types-design.md`.

**Architecture:** one pure module `apps/web/src/lib/study/sessionMix.ts` (`fnv1a32`, `mixKey`, `typeGap`,
`spaceOut`, `mixSession`, `MIX_SPREAD`, `TypeOrder`), applied by the session page after the plan; the plan
modules (`cardFlow.ts`, `levelQueue.ts`, `scheduler.ts`) and the runner edits (`requeue.ts`, `dropItem`,
`buryAfterAnswer`) are unchanged. `session.ts` gains `typeOrder`; the setup page a thin select.

**Branch / worktree:** `feature/sb-mix-types`, `/home/user/qinqin/.claude/worktrees/sb-mix-types` (`<wt>`).

## Gates

- Web: `npm --prefix <wt>/apps/web ci` once; targeted `cd <wt>/apps/web && npx vitest run <paths>` per task;
  before the last commit `npm --prefix apps/web run check`, `npm --prefix apps/web test`,
  `npm --prefix apps/web run build` (exit codes read, never piped), and the full vitest with Node 26
  (`PATH=/home/user/qq-tools/node-v26.13.1-linux-x64/bin:$PATH npx vitest run`).
- Go: not changed (the server builds no queues), so no Go gate unless a task touches `server/`.
- `src/lib/contractsDocs.test.ts` and `src/lib/wikiDocs.test.ts` after every contract or wiki change.

## Tasks

### Task 1: keys and gaps (`fnv1a32`, `mixKey`, `typeGap`)

**Files:** create `apps/web/src/lib/study/sessionMix.ts`, `sessionMix.test.ts`,
`docs/contracts/cards/session-mix.json` (`keys`, `gaps`; values from an independent scratch reference script).

- [x] Test: fixture `keys` (fnv and key per `{cardId, seed}`) and `gaps` decode — FAIL (no module).
- [x] Implement; PASS. Commit `feat(study): session mix keys and gap (#132)`.

### Task 2: `spaceOut`

- [x] Tests: no back to back for two words; the `2r - 1 >= R` step (A A A B B → A B A B A); best effort for one
  word's four types (incoming order); history from an earlier block; a property test over seeded random blocks
  (same multiset; no back to back whenever no word holds more than `ceil(R/2)`) — FAIL.
- [x] Implement; PASS. Commit `feat(study): space a word's cards apart (#132)`.

### Task 3: `mixSession` and the contract

**Files:** `sessionMix.ts`, `sessionMix.test.ts`, `session-mix.json` (`queues`), `docs/contracts/cards/README.md`
(Session mix), `docs/contracts/levels/README.md`, `docs/contracts/README.md` (cards row), `overview.md`.

- [x] Tests: fixture `queues` (grouped; mixed with due and new; one word's four types; two seeds differ;
  a deck-like session with companions; a character level); due block first; same set; grouped ignores seed —
  FAIL.
- [x] Implement; PASS; contractsDocs PASS. Commit `feat(study): mix card types within a session (#132)`.

### Task 4: `typeOrder` in the session setup

**Files:** `apps/web/src/lib/study/session.ts`, `session.test.ts`.

- [x] Tests: `sessionTypeOrder` default mixed; parse keeps `grouped`, drops an unknown value without discarding
  the setup — FAIL.
- [x] Implement; PASS. Commit `feat(study): remember the order of card types in the setup (#132)`.

### Task 5: setup select and session page

**Files:** `apps/web/src/routes/study/+page.svelte`, `page.dom.test.ts`, `routes/study/session/+page.svelte`,
`session/page.dom.test.ts`, `apps/web/src/lib/i18n/messages/en.json`.

- [x] Tests: the setup shows **Order of card types** (Mixed default), choosing Grouped stores `typeOrder:
  'grouped'`; a session with two words' vocab and writing due shows no word twice in a row (mixed) and kinds in
  groups (grouped) — FAIL.
- [x] Implement (thin: `mixSession(queue, …)` after each plan); PASS; check PASS. Commit
  `feat(web): mixed card types in study sessions (#132)`.

### Task 6: wiki

**Files:** `docs/wiki/Flashcards-study-sessions.md` (the mix, the setup choice).

- [x] wikiDocs PASS. Commit `docs(wiki): mixed card types in sessions (#132)`.

### Task 7: real-app check and gates

- [x] Seeded scratch server on a free 127.0.0.1 port; a temporary vitest reads its API data (cards, reviews)
  and runs `deckSessionPlan` + `mixSession`; kill and delete everything.
- [x] Full web gates and the Node 26 vitest. Execution record. Commit `docs(study): execution record (#132)`.

## Execution record

Built 2026-11-22 on `feature/sb-mix-types` from `91c1bc6e`. Commits: spec and plan `5065a3ee`; Task 1 `6d047668`;
Task 2 `89765359`; Task 3 `c4df0096`; Task 4 `8689a6da`; Task 5 `e070719b` (rule fix) + `fc3b1bd3`; Task 6
`54a82248`; Task 7 fix `5893e601`; this record.

Test-first: every task's tests were run and seen failing (missing module / missing function / wrong order)
before the implementation, then passing. Fixture values were produced by an independent reference script written
from the spec text in the scratchpad (FNV-1a checked against the published vectors for `a` and `foobar`), not by
the module under test; the script was deleted with the scratch data.

Deviations from the plan:

- Ruling (Task 5): wiring the page showed three existing level-session tests (level order, vocab only) failing
  about one run in three: the jitter reshuffled a block that holds a single kind. Fixed in the rule, not in the
  tests: a one-kind block keeps its incoming order (`e070719b`, spec and contract updated, two fixture cases
  added). After it the session page tests passed 10 runs out of 10.
- Ruling (Task 7): the real-app check found a 20-card new block (seed 11) ending with one card between two cards
  of one word although the gap of 3 fitted. Added the pressure step (`PRESSURE_SLACK = 2`, `5893e601`): unit
  tests (one case, one property over 500 deck-like blocks) seen failing (166 misses, then 42 with a first,
  slack-0 version) and passing; slack chosen by a scratch simulation (spec Ruling). A fixture case with the real
  queue was added; the module's output for the real API data equals it.
- `typeOrderView.ts` (choices and parse of the select) was added as its own small tested module so the setup
  page stays thin and `sessionMix.ts` has no i18n import.

Real-app check (Task 7): server built from a scratch `git archive` of the branch (Go via `GOTOOLCHAIN=auto`),
seeded with `qinqin seed` (CC-CEDICT 121,635 entries and HSK words, 44 s), one user, a zh workspace, on
127.0.0.1:18732. A temporary vitest file in the scratch copy (never in the worktree) used the app's own
`addCard` (8 vocab, 4 writing cards of real entries) and posted 5 review events 12 days in the past, then
`loadStudyData` → `deckSessionPlan` (vocab, writing, tone, sentence; UTC context) → `mixFlowQueue`: 12 cards and
5 reviews read back; the plan held 5 due and 20 new items (8 real, 12 companions); mixed for seeds 11 and 12: same
set as the plan, due block first, no word back to back, at least 3 cards between two cards of one word in the new
block (after the fix; 1 before it), the same queue on a second computation (reload); grouped: kinds in kind order,
identical for both seeds. Server killed, scratch copy, data dir and token file deleted.

Not verified: the mix in a real browser (no browser automation here; the page wiring is covered by jsdom tests);
the level-session mix against real API data (covered by the fixture and the unit tests only); Android (#38).

Gates (exit codes read):
- `npm --prefix apps/web run check` 0 (1650 files, 0 errors, 0 warnings).
- `npm --prefix apps/web test` (Node 22) exit 1: 563 files, 12,104 passed, 8 skipped, 5 failed, all in
  `lib/features/reader/BookView.dom.test.ts` (4) and `lib/settings/AccountSettings.dom.test.ts` (1). The same 5
  fail identically on the untouched base `91c1bc6e` (a detached scratch worktree with its own `npm ci`), so they
  are not from this branch; they pass on Node 26 (below), which CI uses.
- `npm --prefix apps/web run build` 0.
- Node 26.13.1 full `npx vitest run` 0: 563 files, 12,115 passed, 2 skipped.
- Go: not run; nothing under `server/` changed (the server builds no queues).

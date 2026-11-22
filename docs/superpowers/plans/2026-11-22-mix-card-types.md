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

- [ ] Test: fixture `keys` (fnv and key per `{cardId, seed}`) and `gaps` decode — FAIL (no module).
- [ ] Implement; PASS. Commit `feat(study): session mix keys and gap (#132)`.

### Task 2: `spaceOut`

- [ ] Tests: no back to back for two words; the `2r - 1 >= R` step (A A A B B → A B A B A); best effort for one
  word's four types (incoming order); history from an earlier block; a property test over seeded random blocks
  (same multiset; no back to back whenever no word holds more than `ceil(R/2)`) — FAIL.
- [ ] Implement; PASS. Commit `feat(study): space a word's cards apart (#132)`.

### Task 3: `mixSession` and the contract

**Files:** `sessionMix.ts`, `sessionMix.test.ts`, `session-mix.json` (`queues`), `docs/contracts/cards/README.md`
(Session mix), `docs/contracts/levels/README.md`, `docs/contracts/README.md` (cards row), `overview.md`.

- [ ] Tests: fixture `queues` (grouped; mixed with due and new; one word's four types; two seeds differ;
  a deck-like session with companions; a character level); due block first; same set; grouped ignores seed —
  FAIL.
- [ ] Implement; PASS; contractsDocs PASS. Commit `feat(study): mix card types within a session (#132)`.

### Task 4: `typeOrder` in the session setup

**Files:** `apps/web/src/lib/study/session.ts`, `session.test.ts`.

- [ ] Tests: `sessionTypeOrder` default mixed; parse keeps `grouped`, drops an unknown value without discarding
  the setup — FAIL.
- [ ] Implement; PASS. Commit `feat(study): remember the order of card types in the setup (#132)`.

### Task 5: setup select and session page

**Files:** `apps/web/src/routes/study/+page.svelte`, `page.dom.test.ts`, `routes/study/session/+page.svelte`,
`session/page.dom.test.ts`, `apps/web/src/lib/i18n/messages/en.json`.

- [ ] Tests: the setup shows **Order of card types** (Mixed default), choosing Grouped stores `typeOrder:
  'grouped'`; a session with two words' vocab and writing due shows no word twice in a row (mixed) and kinds in
  groups (grouped) — FAIL.
- [ ] Implement (thin: `mixSession(queue, …)` after each plan); PASS; check PASS. Commit
  `feat(web): mixed card types in study sessions (#132)`.

### Task 6: wiki

**Files:** `docs/wiki/Flashcards-study-sessions.md` (the mix, the setup choice).

- [ ] wikiDocs PASS. Commit `docs(wiki): mixed card types in sessions (#132)`.

### Task 7: real-app check and gates

- [ ] Seeded scratch server on a free 127.0.0.1 port; a temporary vitest reads its API data (cards, reviews)
  and runs `deckSessionPlan` + `mixSession`; kill and delete everything.
- [ ] Full web gates and the Node 26 vitest. Execution record. Commit `docs(study): execution record (#132)`.

## Execution record

(empty until built)

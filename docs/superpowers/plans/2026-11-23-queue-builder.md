# One queue builder for deck and level sessions (#175) Implementation Plan

> Steps use checkbox (`- [x]`) syntax. Strictly test-first: write the test, run it, see it fail, implement, see
> it pass. One commit per task; every message ends with a blank line and
> `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Goal:** one pure builder (`admitSession`, `buildSessionQueue`) used by deck sessions, level sessions and the
counts; one Study all behaviour; constants out of heavy modules; a contract fixture for Android.

**Spec (binding, incl. Rulings):** `docs/superpowers/specs/2026-11-23-queue-builder-design.md`.

**Branch / worktree:** `feature/hb-queue-builder`, `/home/user/qinqin/.claude/worktrees/hb-queue-builder` (`<wt>`),
from `feature/hardening-batch`.

## Gates

- Web: `npm --prefix <wt>/apps/web ci` once; targeted `cd <wt>/apps/web && npx vitest run <paths>` per task;
  before the last commit `npm --prefix apps/web run check`, `npm --prefix apps/web run build` (exit codes read)
  and the full vitest with Node 26.
- Go: not touched (the server builds no queue), so no Go gate.
- `src/lib/contractsDocs.test.ts` and `src/lib/wikiDocs.test.ts` after every contract or wiki change.

## Tasks

### Task 1: constants and `cap` in `limits.ts` / `types.ts`

**Files:** `limits.ts` (`NO_LIMIT`, `cap`, `limitsOf`, `existingDecksOf`), `types.ts` (`GENERAL_DECK_ID`),
`scheduler.ts`, `levelQueue.ts`, `dueCounts.ts`, `cardFlow.ts`, `session.ts`, `store.ts`, `sessionOrder.ts`,
`grade.ts`, the two study pages; tests `limits.test.ts`, new `pureImports.test.ts`.

- [x] Tests: `cap` (floor, negative, NaN, Infinity → 0), `NO_LIMIT`; the import test (no `./store`/`./session`
  import in the pure planners) — FAIL.
- [x] Move; delete `STUDY_ALL_LIMIT`, `UNCAPPED`, `UNLIMITED`, both `cap()` copies; PASS. Commit
  `refactor(study): one no-limit constant and cap in limits.ts (#175)`.

### Task 2: the builder and its contract

**Files:** create `sessionQueue.ts`, `sessionQueue.test.ts`, `docs/contracts/cards/session-queue.json`.

- [x] Tests: vacation; caps floored; Study all ignores caps, rows and the defaults; continuing only takes the
  review cap; a card needs room in every existing deck; reserve = allowance past the cap, bounded; backfill; the
  fixture decoded — FAIL (no module).
- [x] Implement; PASS. Commit `feat(study): one session queue builder (#175)`.

### Task 3: deck sessions on the builder

**Files:** `cardFlow.ts`, `cardFlow.test.ts`, `scheduler.ts` (`buildQueue` on `admitSession`).

- [x] Tests: Study all with 25 new cards and no limit rows queues 25 (today 20); reserve bounded by
  `backfillLeft`; `dayCountsCached` once — FAIL.
- [x] Implement; the deck-session fixture stays green; PASS. Commit `fix(study): deck sessions use the shared
  queue builder; Study all ignores the default limits (#175)`.

### Task 4: level sessions on the builder

**Files:** `levelQueue.ts`, `levelQueue.test.ts`, the session page.

- [x] Tests: `LevelPlan.backfillLeft` (normal and Study all); a character's removed writing kind is not planned;
  `levelPlanCounts` with `studyAll` counts what the session holds — FAIL.
- [x] Implement; the level fixtures stay green; PASS. Commit `fix(study): level sessions use the shared queue
  builder and honour removed kinds (#175)`.

### Task 5: counts and the setup page

**Files:** `dueCounts.ts`, `dueCounts.test.ts`, new `studyAll.test.ts`, `routes/study/+page.svelte`.

- [x] Tests: one Study all behaviour in both modes (same words, same counts, with and without rows); setup counts
  equal the session; `leftToday`/`dueCounts` unchanged on the existing cases — FAIL.
- [x] Implement; PASS. Commit `fix(study): counts and the Study all numbers use the shared builder (#175)`.

### Task 6: docs

- [x] `docs/contracts/cards/README.md` (Session queue, Deck sessions pointer), `levels/README.md`,
  `docs/contracts/README.md` (cards row), `overview.md`, wiki `Flashcards-study-sessions.md`; Execution record.
  Commit `docs(study): the session queue contract and Study all (#175)`.

## Execution record

Built in one session by one implementer (no per-task subagents, no separate review pass yet; an independent
review and one fix wave follow).

**Baseline (untouched branch, Node 22):** the study, flashcards, pwa and docs tests: 134 files, 2845 passed.

| Task | Commit | Test-first evidence / deviation |
|---|---|---|
| Spec + plan | `db77ce89` | — |
| 1 Constants and `cap` | `9b4b8f92` | `limits.test.ts` cap/NO_LIMIT (3) and `pureImports.test.ts` (cardFlow, levelQueue, sessionOrder, grade import `./session`/`./store`) failed, then passed. Deviation: `sessionQueue.ts` was dropped from the import list until Task 2 created it. |
| 2 Builder + contract | `393e0fe2` | `sessionQueue.test.ts` failed (no module), then passed with `session-queue.json` (14 hand-derived cases). `backfillLimit`/`skipKindsByEntry` moved here (re-exported by `cardFlow.ts`). |
| 3 Deck sessions | `acba0fe8` | 3 new tests failed: Study all queued 20 of 25 new cards (the default-limit bug), reserve 40 > 30, Study all backfill 2 000 000. Then 3 fixture expectations of `deck-session.json` and one unit assertion (`reserve.length` after the bound) changed, as the reserve Ruling says (spec updated with the exact cost). |
| 4 Level sessions | `437e1893` | 3 new tests failed (no `backfillLeft`; `levelPlanCounts` with Study all gave due 25 + fresh 25; removed writing still planned), then passed. |
| 5 Counts + setup page | `ac6a47b5` | Deviation: `studyAll.test.ts` was written after Tasks 3–4 had fixed the behaviour, so it passed at once. Red shown in a scratch worktree at `393e0fe2` (before Task 3): 6 of 9 failed (deck Study all 25 of 30; level Study all setup counts due 30 + fresh 30). The `dueCounts`/`leftToday` change is a refactor with no behaviour change, guarded by the existing `dueCounts.test.ts` (no red possible). The setup page swap (blanked context → `studyAll: true`) has no dom test; it is covered only through the planner tests. |
| Merge | (merge commit) | `feature/hardening-batch` with #168 merged in (no conflicts); `grade.ts` still takes `GENERAL_DECK_ID` from `types.ts`. |
| 6 Docs | (this commit) | `contractsDocs.test.ts`, `wikiDocs.test.ts` pass. |

**Mutation checks (by hand, each reverted; targeted sessionQueue/studyAll/levelQueue/cardFlow tests):**
Study all still consulting the limit rows → 13 failed; reserve not bounded by `backfillLeft` → 5 failed; vacation
check removed → 4 failed; caps not floored → 1 failed; level plan ignoring `skipKinds` → 1 failed.

**Gates (after the merge):** `npm run check` 0 errors; `npm run build` exit 0; full vitest under Node 26: 587 files,
12 547 passed, 2 skipped, exit 0. Go not run (no Go file touched; the server builds no queue).

**Not verified:** no real browser or real-app run (the setup page's Study all numbers and the session page's use of
`plan.backfillLeft` are checked by typecheck and the planner tests only); Android parity is only as good as the
fixture.

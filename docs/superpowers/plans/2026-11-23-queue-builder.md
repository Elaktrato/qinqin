# One queue builder for deck and level sessions (#175) Implementation Plan

> Steps use checkbox (`- [ ]`) syntax. Strictly test-first: write the test, run it, see it fail, implement, see
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

- [ ] Tests: `cap` (floor, negative, NaN, Infinity → 0), `NO_LIMIT`; the import test (no `./store`/`./session`
  import in the pure planners) — FAIL.
- [ ] Move; delete `STUDY_ALL_LIMIT`, `UNCAPPED`, `UNLIMITED`, both `cap()` copies; PASS. Commit
  `refactor(study): one no-limit constant and cap in limits.ts (#175)`.

### Task 2: the builder and its contract

**Files:** create `sessionQueue.ts`, `sessionQueue.test.ts`, `docs/contracts/cards/session-queue.json`.

- [ ] Tests: vacation; caps floored; Study all ignores caps, rows and the defaults; continuing only takes the
  review cap; a card needs room in every existing deck; reserve = allowance past the cap, bounded; backfill; the
  fixture decoded — FAIL (no module).
- [ ] Implement; PASS. Commit `feat(study): one session queue builder (#175)`.

### Task 3: deck sessions on the builder

**Files:** `cardFlow.ts`, `cardFlow.test.ts`, `scheduler.ts` (`buildQueue` on `admitSession`).

- [ ] Tests: Study all with 25 new cards and no limit rows queues 25 (today 20); reserve bounded by
  `backfillLeft`; `dayCountsCached` once — FAIL.
- [ ] Implement; the deck-session fixture stays green; PASS. Commit `fix(study): deck sessions use the shared
  queue builder; Study all ignores the default limits (#175)`.

### Task 4: level sessions on the builder

**Files:** `levelQueue.ts`, `levelQueue.test.ts`, the session page.

- [ ] Tests: `LevelPlan.backfillLeft` (normal and Study all); a character's removed writing kind is not planned;
  `levelPlanCounts` with `studyAll` counts what the session holds — FAIL.
- [ ] Implement; the level fixtures stay green; PASS. Commit `fix(study): level sessions use the shared queue
  builder and honour removed kinds (#175)`.

### Task 5: counts and the setup page

**Files:** `dueCounts.ts`, `dueCounts.test.ts`, new `studyAll.test.ts`, `routes/study/+page.svelte`.

- [ ] Tests: one Study all behaviour in both modes (same words, same counts, with and without rows); setup counts
  equal the session; `leftToday`/`dueCounts` unchanged on the existing cases — FAIL.
- [ ] Implement; PASS. Commit `fix(study): counts and the Study all numbers use the shared builder (#175)`.

### Task 6: docs

- [ ] `docs/contracts/cards/README.md` (Session queue, Deck sessions pointer), `levels/README.md`,
  `docs/contracts/README.md` (cards row), `overview.md`, wiki `Flashcards-study-sessions.md`; Execution record.
  Commit `docs(study): the session queue contract and Study all (#175)`.

## Execution record

(filled in while building)

# Flashcards Round 2 — Level Sessions and the Mastery Map — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start study sessions from level schemes (HSK/JLPT/curriculum — no deck required; finished cards land in the general deck), derive a per-character mastery score from all reviewed cards containing that character, and render the Hanzi/Kanji map grid with level filters and per-level mastery summaries.

**Architecture:** One small backend addition exposes scheme member entries (`GET /api/schemes/{id}/entries?level=`); levels already store memberships (including derived characters). The web plugin gains a level-session mode (virtual cards until first grading, then a real card in the general deck) and a mastery module that aggregates each character's reviewed cards' FSRS stabilities into a 0–100 score and five stages. The map is a plugin view at `/study/map`. No scheduling state is stored.

**Tech Stack:** existing (SvelteKit, Go, `ts-fsrs`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-12-flashcards-design.md` (Level study, Mastery map). Issue #24.

## Global Constraints

- Web deps whitelist unchanged. Go stdlib only.
- Mastery is derived only; no per-character scheduling state is written anywhere.
- Level mode: cards finished in a level session are added to the general deck (`deckIds: ['general']`); the card is created *before* its first review is recorded (so history attaches to a real card); a failed card creation blocks advancing with an inline error.
- Workspace scoping as before (plugin data + review events per workspace).
- Gates: Go `test`/`vet`; web `check`/`test`/`build`. Conventional commits.

## Mastery definition (fixed)

For character `c`, consider every reviewed vocab card whose entry's written form contains `c`. For each card, let `S` be its FSRS stability in days (from `scheduleFor`); contribution `m = clamp(log2(1+S)/log2(1+365), 0, 1)`. Character score = `round(100 × mean(m))` over those cards; no reviewed cards → score 0, stage `unknown`. Stages: `0 unknown`, `1–24 fresh`, `25–49 learning`, `50–79 mature`, `80–100 learned`. Mastery summary per level counts characters with score ≥ 80.

## Review Focus

1. **Level cards become real only on first grade** — abandoning a level session creates no cards; a graded card is created in `general` before its review event; failures don't lose the review or create orphans.
2. **Membership correctness** — level entries include derived characters; the map shows only `kind: 'character'`; words stay in sessions.
3. **Mastery aggregation** — deterministic, no NaN on malformed/missing reviews, no self-inflation from unreviewed cards.
4. **Level/workspace scoping** — schemes filtered to the workspace language; sessions from one workspace never touch another's decks/reviews.
5. **Map honesty** — a character with no reviewed cards renders as unknown; the per-level summary is truthful.

---

### Task 1: Backend — scheme member entries

**Files:**
- Modify: `server/internal/levels/levels.go` (`SchemeEntryIDs`), `server/internal/entries/store.go` (`GetMany`), `server/internal/api/handlers_levels.go`, `server/internal/api/api.go`
- Test: `server/internal/levels/levels_test.go`, `server/internal/entries/store_test.go`, `server/internal/api/handlers_levels_test.go`

**Interfaces:**
- `levels.SchemeEntryIDs(ctx, db, schemeID int64) ([]int64, error)` — all active memberships across the scheme's active levels, distinct, stable order (level ord, member id).
- `entries.Store.GetMany(ctx, ids []int64) ([]model.Entry, error)` — active entries for the ids, in input order, silently skipping missing/soft-deleted ids.
- Route `GET /api/schemes/{id}/entries` (public) → `[]model.Entry`; optional `?level=<name>` narrows to one level. Unknown/malformed scheme id → 404; unknown level name → 404; empty result → `[]`.

- [ ] **Step 1: Write failing tests** — `SchemeEntryIDs` returns words + derived characters for all levels and dedupes; `GetMany` preserves order and skips missing; handler: all members, level filter, 404 unknown scheme/level, arrays never null.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** `go test ./... && go vet ./...` — PASS.
- [ ] **Step 5: Commit** — `feat(levels): scheme member entries endpoint`

### Task 2: Card written snapshot + mastery module

**Files:**
- Modify: `apps/web/src/lib/study/types.ts` (`StudyCard.written?`), `apps/web/src/lib/study/store.ts` (`addCard(entryId, opts?: {written?: string; sentenceId?: number; deckIds?: string[]})`), `apps/web/src/lib/components/AddToStudy.svelte` (pass `written`)
- Create: `apps/web/src/lib/study/mastery.ts`
- Test: `apps/web/src/lib/study/mastery.test.ts`, update store tests

**Interfaces:**
- `StudyCard.written?: string` — snapshot of the entry's written form at add time; existing cards may lack it.
- `addCard(entryId, opts)` — idempotent per entryId (returns the existing card unchanged); stores `written` when provided; deckIds default `['general']`.
- `masteryForChar(char, cards, reviews, now)` → `{score: number; stage: 'unknown'|'fresh'|'learning'|'mature'|'learned'; reviewedCards: number}` — per the fixed definition above; cards without `written` are ignored (the map resolver supplies written forms for legacy cards).
- `masterySummary(chars, cards, reviews, now, threshold=80)` → `{mastered: number; total: number}`.

- [ ] **Step 1: Write failing tests** — no reviews → unknown/0; one `Good` → low score/fresh; longer histories (simulated spaced reviews) rank higher; average across two cards; unreviewed card contributes nothing; malformed reviews ignored; summary counts ≥ threshold; `addCard` stores written and remains idempotent.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** gates — PASS.
- [ ] **Step 5: Commit** — `feat(flashcards): per-character mastery aggregation`

### Task 3: Level session mode and queue

**Files:**
- Modify: `apps/web/src/lib/study/session.ts` (`mode`, `schemeId`, `levelName`; validation)
- Create: `apps/web/src/lib/study/levelQueue.ts`
- Test: `apps/web/src/lib/study/levelQueue.test.ts`, update session tests

**Interfaces:**
- `StudySessionConfig` gains `mode: 'decks' | 'levels'`, `schemeId: number | null`, `levelName: string | null`; defaults `mode:'decks'`, nulls; validation: levels mode requires scheme + level (and ignores decks), decks mode requires ≥1 deck.
- `buildLevelQueue({entries, cards, reviews, newLimit, reviewLimit, now})` → `LevelQueueItem{cardId: string; entryId: number; virtual: boolean}`: existing vocab cards matched by entryId (due first via `scheduleFor`); level entries without cards become virtual items (`cardId: 'level:' + entryId`) up to `newLimit`; existing cards that were added but never reviewed join the new bucket with their real card id and share `newLimit` with the virtual items; capped by `reviewLimit`/`newLimit`; words only (`kind === 'word'`).
- Tests: existing card reused (not virtual); virtual ids stable; caps; unreviewed vs due classification; non-word entries skipped.

- [ ] **Step 1: Write failing tests.** **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** gates — PASS.
- [ ] **Step 5: Commit** — `feat(flashcards): level session mode and queue`

### Task 4: Setup and runner support for level sessions

**Files:**
- Modify: `apps/web/src/routes/study/+page.svelte` (mode toggle, scheme/level selects, language filtering, counts)
- Modify: `apps/web/src/routes/study/session/+page.svelte` (level queue build; virtual card grading creates a real card first; entry fetch by entryId for virtual items)
- Test: none beyond `check`/`build` (logic covered by Task 3 tests)

**Interfaces:**
- Setup: schemes for the current workspace language (`GET /api/schemes`, filter `language`); scheme select → level select; limits; card types; Start persists config.
- Runner: in `levels` mode fetch `GET /api/schemes/{schemeId}/entries?level=<level>` and `buildLevelQueue`; for a virtual item on grade: `addCard(entryId, {written, sentenceId: firstSentenceId, deckIds:['general']})` → `recordReview(realCardId)`; inline error and no advance on creation failure.

- [ ] **Step 1: Implement** UI + runner changes.
- [ ] **Step 2: Run** `check`, `test`, `build` — PASS.
- [ ] **Step 3: Commit** — `feat(flashcards): level study sessions`

### Task 5: Mastery map page

**Files:**
- Create: `apps/web/src/routes/study/map/+page.svelte`
- Modify: `apps/web/src/routes/+layout.svelte` (nav "Map" link), `apps/web/src/routes/study/+page.svelte` (link to the map)
- Test: `mastery` summary tests already cover the math; page gated by `check`/`build`

**Interfaces:**
- Page: workspace language schemes; scheme filter (default first); level filter (All + levels); loads scheme entries (Task 1 route), keeps `kind === 'character'`; computes `masteryForChar` for each; renders a dense grid of cells (character + color by stage), `title` tooltip with score/stage; legend; per-level summary line (`mastered/total`, threshold 80) computed by fetching each level (cached); empty/error states.
- Add the "Map" link to the shell nav.

- [ ] **Step 1: Implement** page + nav.
- [ ] **Step 2: Run** gates — PASS.
- [ ] **Step 3: Commit** — `feat(flashcards): hanzi/kanji mastery map`

### Task 6: Docs, issue status, final gates

**Files:**
- Modify: `README.md` (level study + map), `docs/superpowers/specs/2026-11-12-flashcards-design.md` (Round 2 status)

- [ ] **Step 1: Update docs** (study by level, map meaning, mastery formula summary).
- [ ] **Step 2: Run** all gates (`go test ./...`, `go vet ./...`, `check`, `test`, `build`).
- [ ] **Step 3: Commit** — `docs: level study and mastery map`

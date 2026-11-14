# Flashcards Round 1 — Core Study Loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A usable Anki-like study loop: add words to a study deck from the dictionary, start a session (decks, limits, card-type opt-out), review vocab cards with Anki-style grading, FSRS scheduling derived from append-only review events, a review-driven heatmap home widget, and derived EXP/level.

**Architecture:** A compile-time web feature plugin (`qinqin-flashcards`) owning the study UI and home widget. Deck/card definitions live in the workspace-scoped plugin data store; reviews are `review` study events. Scheduling is computed by replaying a card's events through `ts-fsrs` — never stored. The Go backend changes only by registering the new plugin id instead of the old heatmap id. The old generic heatmap widget is retired; the plugin's own heatmap replaces it.

**Tech Stack:** SvelteKit 2 + Svelte 5 + TS strict; existing API client; `ts-fsrs` (new dependency); existing plugin data + events APIs; no backend logic changes.

**Spec:** `docs/superpowers/specs/2026-11-12-flashcards-design.md` (Rounds, Architecture, Data model). Rounds 2–3 are GitHub issues #24/#25.

## Global Constraints

- Web deps whitelist for this plan = previous whitelist **+ `ts-fsrs`** (MIT; note it in the first commit that adds it).
- Plugin id: `qinqin-flashcards`; data keys `deck:<id>` and `card:<id>`; workspace-scoped writes (`?workspace=<current>`).
- Review event: `{id: ULID, workspaceId, device:'web', ts, type:'review', payload:{cardId, mode:'vocab', grade:1|2|3|4}}` — authoritative, idempotent; the UI must never lose a review on a transient failure (localStorage retry queue, key `qinqin.study.pending`).
- Scheduling derived only; nothing schedule-shaped is written to plugin data. Grades: 1 Again, 2 Hard, 3 Good, 4 Easy (ts-fsrs Rating).
- Defaults: new cards/session 20, reviews/session 100; decks: implicit `general` + custom.
- EXP derived: per review `10 + {again:0, hard:0, good:5, easy:10}`; level = `floor(xp/100)+1`, per workspace.
- Gates: `npm --prefix apps/web run check`, `test`, `build`; Go `go test ./...`, `go vet ./...`. Conventional commits.

## Review Focus

1. **Scheduling determinism** — replaying the same review events yields the same due date; no derived schedule is ever written to plugin data.
2. **Reviews are never dropped** — a failed POST enqueues locally and flushes later; retried events keep their ULID (server counts duplicates, no double reviews).
3. **Workspace scoping** — decks/cards/reviews of one workspace never leak into another; sync-pull loading filters by plugin + workspace.
4. **Card content correctness** — vocab front blanks the target word in the example sentence when present; readings shown per language; back shows translations (senses) plus the front content.
5. **Retiring the old heatmap** — no dead plugin registration or orphaned widget; the home slot renders the flashcards widget from `/api/plugins` states.

---

### Task 1: Plugin registration and scaffold

**Files:**
- Modify: `server/cmd/qinqin/main.go` (built-in manifest id `qinqin-heatmap` → `qinqin-flashcards`, name "Flashcards"), `server/cmd/qinqin/main_test.go`
- Create: `apps/web/src/lib/plugins/flashcards/manifest.ts`, `apps/web/src/lib/plugins/flashcards/FlashcardsWidget.svelte` (placeholder), `apps/web/src/routes/study/+page.svelte` (placeholder)
- Modify: `apps/web/src/lib/plugins/index.ts` (register flashcards, keep heatmap temporarily)
- Test: Go main test updated

**Interfaces:**
- Manifest: `{id: 'qinqin-flashcards', name: 'Flashcards', version: '1.0', surfaces: ['home-widget']}`.
- `webPlugins` gains the flashcards entry; alias matching (`qinqin-` prefix) still works.

- [ ] **Step 1: Update the Go test** — expect `qinqin-flashcards` (not `qinqin-heatmap`) in `ListFor`. Run `go test ./cmd/qinqin/` — FAIL.
- [ ] **Step 2: Implement** the registration change; update web registry with a placeholder widget; add `/study` route skeleton.
- [ ] **Step 3: Run** `go test ./... && go vet ./...`, `npm --prefix apps/web run check` — PASS.
- [ ] **Step 4: Commit** — `feat(flashcards): register the flashcards plugin and scaffold study routes`

### Task 2: Study data layer (decks and cards)

**Files:**
- Create: `apps/web/src/lib/study/types.ts`, `apps/web/src/lib/study/store.ts`
- Test: `apps/web/src/lib/study/store.test.ts`

**Interfaces:**
- Types: `Deck{id,name,createdAt}`, `StudyCard{id,kind:'vocab',entryId,sentenceId?,deckIds:string[],createdAt}`.
- `loadStudyData(): Promise<{decks: Deck[]; cards: StudyCard[]}>` — `GET /api/sync/pull?cursor=1970-01-01T00:00:00Z` with auth; filter `pluginData` rows by `pluginId === 'qinqin-flashcards'`, active, current workspace; parse keys `deck:`/`card:`; always returns arrays.
- `createDeck(name): Promise<Deck>` (ULID id, PUT `deck:<id>` with workspace), `renameDeck`, `deleteDeck(id)` (DELETE data; cards left only in that deck move to `general`), `addCard(entryId, sentenceId?): Promise<StudyCard>` (deckIds `['general']`), `cardsInDecks(cards, ids)`.
- All writes `PUT /api/plugins/qinqin-flashcards/data/<key>?workspace=<ws>`.

- [ ] **Step 1: Write failing tests** — load parses only flashcard rows for the current workspace (ignores other plugins/workspaces/tombstones); addCard writes `card:<ulid>` with `general`; createDeck/rename; deleteDeck reassigns orphaned cards to `general`; arrays never null.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat(flashcards): study decks and cards over plugin data`

### Task 3: FSRS scheduling, queue and EXP (pure logic)

**Files:**
- Create: `apps/web/src/lib/study/scheduler.ts`, `apps/web/src/lib/study/events.ts`
- Modify: `apps/web/src/lib/events.ts` (record type union + retry queue)
- Test: `scheduler.test.ts`, `events.test.ts`

**Interfaces:**
- `scheduleFor(cardId, reviews, now): {due: string; stability: number; difficulty: number; state: number} | null` — replay reviews (sorted by ts,id) through `ts-fsrs` (`createEmptyCard`, `f.next`), `null` when the card has no reviews.
- `isDue(schedule, now): boolean`; `buildQueue({cards, reviews, deckIds, newLimit, reviewLimit, now})` — reviewed cards due first (ordered by due), then new cards, capped by limits.
- `xpFromReviews(reviews): number`; `levelFromXp(xp): number` (constants above).
- `recordReview(workspaceId, cardId, grade)` — POST event batch; on failure persist to `qinqin.study.pending`; `flushPendingReviews()` retries on boot/online. Never throws.
- Tests: replay determinism (two calls → same due); Again vs Good ordering; due filtering; queue caps and new-card exclusion of reviewed cards; XP/level; enqueue+flush keeps ULIDs and is idempotent; failed POST doesn't throw.

- [ ] **Step 1: Write failing tests** as above. **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** (add `ts-fsrs` via npm; note it in the commit). **Step 4: Run** `check`, `test` — PASS.
- [ ] **Step 5: Commit** — `feat(flashcards): fsrs scheduling, session queue and exp (ts-fsrs)`

### Task 4: Session setup page

**Files:**
- Create: `apps/web/src/routes/study/+page.svelte` (replace placeholder), `apps/web/src/lib/study/session.ts` (config store in `sessionStorage`, key `qinqin.study.session`)
- Test: `session.test.ts`

**Interfaces:**
- Config `{deckIds: string[]; newLimit: number; reviewLimit: number; cardTypes: string[]}` — card types checkbox list: `vocab` enabled; `sentence`, `writing`, `tone` disabled with "soon".
- Page: loads study data; deck multi-select (General + custom decks with create/rename/delete controls); limits inputs (defaults 20/100); Start → saves config, `goto('/study/session')`; empty deck selection or no cards shows guidance.
- Test: default config, validation (at least one deck, positive limits), round-trip through sessionStorage.

- [ ] **Step 1: Write failing tests.** **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** gates — PASS.
- [ ] **Step 5: Commit** — `feat(flashcards): session setup with decks kinds and limits`

### Task 5: Review session runner

**Files:**
- Create: `apps/web/src/routes/study/session/+page.svelte`, `apps/web/src/lib/study/cardView.ts` (front/back content builder), components for the card face
- Test: `cardView.test.ts`

**Interfaces:**
- `buildVocabFaces(entry, sentence, language)` → `{front: {written, readings, sentenceLines[]}, back: {written, readings, sentenceLines[], glosses: string[]}}`; the sentence's `hanzi` has the entry's `written` replaced with `____` when found (front and back both show the blanked line; back adds glosses from `entry.senses` grouped by dictionary name).
- Runner: loads config + study data + events (`GET /api/events?since=1970-…`, filter `type==='review'` and workspace); builds queue; shows front → Reveal → back + grade buttons (Again/Hard/Good/Easy) → `recordReview` → next; progress `n/total`; on finish, summary (reviews, XP gained, level).
- Empty queue state ("nothing due — add words or raise limits").
- Tests: face builder blanks the word (zh/ja), includes readings, back glosses include every dictionary's gloss; no sentence → no sentence block; unknown sentence id → no block.

- [ ] **Step 1: Write failing tests.** **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** gates — PASS.
- [ ] **Step 5: Commit** — `feat(flashcards): vocab review session with grading`

### Task 6: Home flashcards widget and retirement of the old heatmap

**Files:**
- Replace: `apps/web/src/lib/plugins/flashcards/FlashcardsWidget.svelte`
- Delete: `apps/web/src/lib/plugins/heatmap/` (manifest + Heatmap.svelte) — keep `heatmap/aggregate.ts` if reused (move to `src/lib/study/heatmap.ts`)
- Modify: `apps/web/src/lib/plugins/index.ts` (only flashcards), `apps/web/src/routes/+layout.svelte` if links needed
- Test: `heatmap.test.ts` (review-only aggregation)

**Interfaces:**
- Widget: due count (buildQueue against loaded data/events), review heatmap for the last 91 days from `review` events per workspace (reuse `aggregateByDay` on filtered events), EXP/level display, "Study" link to `/study`.
- Aggregation: `reviewCountsByDay(events, now)` filters `type==='review'` and aggregates counts; tests: non-review events excluded, sparse days, UTC boundaries.

- [ ] **Step 1: Write failing tests** for `reviewCountsByDay`. **Step 2: Run** — FAIL. **Step 3: Implement** widget + aggregation; remove the old heatmap plugin and its registration from the web registry. **Step 4: Run** gates — PASS.
- [ ] **Step 5: Commit** — `feat(flashcards): review-driven home widget replaces the generic heatmap`

### Task 7: Add-to-study button, docs and release gates

**Files:**
- Create: `apps/web/src/lib/components/AddToStudy.svelte`
- Modify: `apps/web/src/routes/entry/[id]/+page.svelte` (mount the button near the title), `README.md` (study section), `docs/superpowers/specs/2026-11-12-flashcards-design.md` (status note: Round 1 shipped)
- Test: store test update if needed (addCard used by the button)

**Interfaces:**
- Button states: "Add to study" → `addCard(entry.id, entry.sentences[0]?.id)`; when a card for the entry already exists, "In study deck" (disabled). Errors surface inline.
- README: how to study (add from entry, /study, deck selection, grading, heatmap/EXP).

- [ ] **Step 1: Implement** button + README + status note.
- [ ] **Step 2: Run** all gates (`check`, `test`, `build`, Go tests) — PASS.
- [ ] **Step 3: Commit** — `feat(flashcards): add-to-study button and docs`

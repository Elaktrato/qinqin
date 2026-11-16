# Level Sessions for Character-Unit Schemes (issue #57) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (fresh implementer
> per task, independent review on the strongest model, one fix wave, whole-branch review). Steps use
> checkbox (`- [ ]`) syntax.

**Goal:** `/study` → By level can study JLPT kanji, Jōyō grades and 通用规范汉字表 levels with recognition
(`vocab` kind) and writing cards on character entries, created lazily with deterministic ids, and shows
"L of N learned" per level with the Stats → Characters definition.

**Architecture:** `buildLevelQueue` becomes unit- and kind-aware (word path byte-for-byte unchanged);
`levelSessionItems` maps kinds and virtual ids; `buildVocabFaces` hides readings on the front for
character entries; a pure `levelPlanCounts` and `levelMastery` feed the setup page. Web only; no server,
no migration.

**Tech stack:** SvelteKit 2 / Svelte 5, vitest (unit + jsdom). No new dependencies.

**Spec (binding, incl. Rulings):** `docs/superpowers/specs/2026-11-15-v030-character-level-sessions-design.md`.

**Branch / worktree:** `feature/v030-character-levels` from the current tip of `feature/v0.3.0`:
`git worktree add -b feature/v030-character-levels .claude/worktrees/v030-character-levels feature/v0.3.0`; `<wt>`.

**Order in v0.3.0:** third plan of work item 1. **Requires** the study-day plan's Tasks 1
(`docs/contracts/README.md`), 6 (`lib/time/studyDay.ts`) and 7 (`currentStudyDay()`) merged into
`feature/v0.3.0` before this branch is cut. Items 4/4b later replace the due predicate and add limits
(see the vacation-and-limits plan, Tasks 5 and 11).

## Gates

- Web: `npm --prefix <wt>/apps/web ci` once, then `run check`, `test`, `run build`; read exit codes.
- Go: none per task (no server change). ONE full Go gate (`go vet ./... && go test -p 2 ./...`, docker
  command from `/home/user/qinqin-v030/AGENT-RULES.md`) before the last commit, for the embed build.
- One commit per task, explicit `git add`, message ends with a blank line and
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never merge or push.

## Global constraints

- Word-unit level sessions behave exactly as today. `LevelQueueItem.kind` is required, so the existing
  `levelQueue.test.ts` expectations (`toEqual` literals) and the `LevelQueueItem` literals in
  `cardFlow.test.ts` gain `kind: 'vocab'` mechanically — no other change to any word expectation.
- Card ids: created cards `c-vocab-<entryId>` / `c-writing-<entryId>` (`newCardId`); virtual ids
  `level:<entryId>` (recognition) and `level:writing:<entryId>`.
- Character kinds: `vocab`, `writing` only. Writing unlock: recognition card's first valid review has
  `dayOf < today` (learner's day), only when both kinds are selected.
- "Learned" = `stageOf(score) === 'learned'` from `lib/study/mastery.ts` (`MASTERY_THRESHOLD`); no new formula.
- `newLimit` counts cards.

## Review Focus

1. **Word sessions unchanged.** The only edits to existing word expectations are the added `kind: 'vocab'` (Task 2).
2. **Unlock by learner day, not UTC.** Tokyo review at 23:30 local stays locked until local midnight
   (fixture case, Task 2).
3. **One card per (kind, entry).** A virtual writing item graded on two devices yields one key
   `c-writing-<id>`; an existing card added from the entry page is reused, never duplicated (Tasks 2–3).
4. **Ineligible writing items are dropped, never created** (no stroke data) — Task 3.
5. **Setup page enables start** for a character level with due or new items (Task 5 dom test), and the
   "Nothing is due" state appears only when it is true.

---

### Task 1: Contract fixtures for character level queues

**Files:** Create `docs/contracts/levels/README.md`, `docs/contracts/levels/character-level-queue.json`,
`docs/contracts/levels/level-card-ids.json`; add the folder to `docs/contracts/README.md`.

**Interfaces (shape):**
```jsonc
{ "version": 1, "rule": "levels/characterLevelQueue", "cases": [ {
  "name": "fresh level, both kinds", "unit": "character", "kinds": ["vocab","writing"],
  "history": [{"zone":"Asia/Tokyo","from":null}], "now": "2026-11-16T03:00:00Z",
  "entries": [{"id":11,"kind":"character"},{"id":12,"kind":"character"},{"id":90,"kind":"word"}],
  "cards": [], "reviews": [], "newLimit": 3, "reviewLimit": 100, "weights": "default",
  "queue": [{"cardId":"level:11","kind":"vocab","entryId":11,"virtual":true},
            {"cardId":"level:12","kind":"vocab","entryId":12,"virtual":true}] } ] }
```

- [ ] **Step 1:** Write the spec's case list (and only it): fresh level; writing locked the same learner day (recognition
  reviewed `2026-11-16T14:30:00Z` = 23:30 JST, now `14:50Z`); unlocked next day (now `2026-11-16T15:10:00Z`
  = 00:10 JST → `level:writing:11` first in the new bucket); writing-only session (no gating); existing
  `c-vocab-11` from the entry page reused (real id, new bucket); legacy duplicate vocab cards on one entry
  (smallest id wins); due review before new; `newLimit` counting cards across kinds; word-unit scheme
  unchanged (only `kind: "word"` entries, vocab only); `kinds: ["tone"]` on a character level → empty; a
  character without stroke data (in the queue, flagged `"dropInSession": true`).
  `level-card-ids.json`: `level:11` → `c-vocab-11`, `level:writing:11` → `c-writing-11`. Every
  recognition review used for the unlock is grade 4 (Easy), so the card is not due again minutes later
  (ts-fsrs short-term steps would otherwise put it first as a due review); each case states the full
  expected queue and reserve. The case list must equal the spec's fixture list.
- [ ] **Step 2:** `python3 -m json.tool` on each file. Commit `docs(contracts): character level queue fixtures`.

### Task 2: Unit- and kind-aware `buildLevelQueue`

**Files:** Modify `apps/web/src/lib/study/levelQueue.ts`, `apps/web/src/lib/study/levelQueue.test.ts`.

**Interfaces:**
```ts
export type LevelUnit = 'word' | 'character';
export interface LevelQueueItem { cardId: string; entryId: number; virtual: boolean; kind: StudyCardKind }
export interface BuildLevelQueueOptions { /* existing */ unit?: LevelUnit; kinds?: readonly StudyCardKind[]; studyDay?: StudyDay; reserve?: number }
// returns LevelQueueItem[] as today; buildLevelPlan(opts) → { queue: LevelQueueItem[]; reserve: LevelQueueItem[] } is the session's entry point
export const CHARACTER_KINDS: readonly StudyCardKind[]  // ['vocab', 'writing']
export function virtualLevelId(kind: StudyCardKind, entryId: number): string
```
`unit` defaults to `'word'` and `kinds` to `['vocab']`. The function stays pure: it never calls
`currentStudyDay()`; callers pass `studyDay`, and when it is absent the unlock rule uses UTC
(`studyDay([])`).

- [ ] **Step 1: Failing tests:** the Task 1 fixture file (imported JSON) (weights `"default"` →
  `DEFAULT_W`); existing word cases unchanged; `kind` is `'vocab'` on every word item.
- [ ] **Step 2:** `npm --prefix <wt>/apps/web test -- levelQueue` → FAIL. **Step 3:** Implement (spec
  "Queue"). **Step 4:** web gates PASS. **Step 5:** Commit `feat(study): level queues for character schemes`.

### Task 3: Session items and lazy card creation for character kinds

**Files:** Modify `apps/web/src/lib/study/cardFlow.ts` (`levelSessionItems`), `cardFlow.test.ts`,
`apps/web/src/lib/study/types.ts` (`StudyCard.entryKind?: 'character'`), `apps/web/src/lib/study/store.ts`
(`addCard` accepts and stores `entryKind`; parse keeps it), `apps/web/src/lib/study/grade.ts` (pass
`entryKind` and no `sentenceId` for character entries), `grade.test.ts`, `store.test.ts`,
`apps/web/src/lib/study/companions.ts` (+ test: skip sentence/tone for `entryKind === 'character'`, writing
only after an earlier-day review of the vocab card; takes `studyDay` and `reviews`).

**Interfaces:** `levelSessionItems(items: readonly LevelQueueItem[], cards: readonly StudyCard[], kinds:
readonly StudyCardKind[]): FlowItem[]` — maps each item's `kind`; drops items whose kind is not in `kinds`;
virtual items carry `kind`, `deckIds: ['general']`, `written` unset (the entry provides it).

- [ ] **Step 1: Failing tests:** a `level:writing:11` item becomes `{kind:'writing', virtual:true}`;
  `gradeItem` on it calls `addCard(11, {kind:'writing', written:'学', entryKind:'character', deckIds:
  ['general'], sentenceId: undefined})`; a character vocab item stores no `sentenceId` even when the entry
  has sentences; `entryKind` survives a store round trip; companions skip tone/sentence for character cards
  and plan writing only after an earlier-day review. (The `newCardId` and existing `gradeItem` kind/written
  behaviour already pass today: keep them as pinning tests; the drop of ineligible writing items is tested in
  Task 7.)
- [ ] **Step 2:** FAIL (the new cases). **Step 3:** Implement. **Step 4:** gates PASS. **Step 5:** Commit `feat(study): session items for character cards`.

### Task 4: Character recognition face

**Files:** Modify `apps/web/src/lib/study/cardView.ts`, `cardView.test.ts`,
`apps/web/src/lib/plugins/flashcards/cards/VocabCard.svelte` (required: render `back.readings` after the
reveal; today it renders only `front.readings`); create `apps/web/src/lib/plugins/flashcards/cards/VocabCard.dom.test.ts`.

**Interfaces:** `buildVocabFaces(entry, sentence, language)` — `VocabBackFace` gets its own `readings`
(grouped by type for characters); for `entry.kind === 'character'`: `front.readings = []`,
`front.sentenceLines = []`, `back.readings` = every reading; word entries unchanged (back readings equal
front readings, so the word card renders as before).

- [ ] **Step 1: Failing tests:** unit (character front has no readings, back has on/kun or pinyin, glosses
  grouped); dom: before reveal only the glyph is in the card region, after reveal readings and meanings
  appear; a character with no senses shows readings only without an empty gloss block.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** gates PASS. **Step 5:** Commit `feat(study): recognition face for character cards`.

### Task 5: Setup page counts and warnings

**Files:** Modify `apps/web/src/lib/study/levelQueue.ts` (`levelPlanCounts`), `levelQueue.test.ts`,
`apps/web/src/routes/study/+page.svelte`; create or extend `apps/web/src/routes/study/page.dom.test.ts`.

**Interfaces:** `levelPlanCounts(opts: Omit<BuildLevelQueueOptions, 'newLimit' | 'reviewLimit'>): { due:
number; fresh: number; items: number; unitLabel: 'words' | 'characters' }`; `levelTypeWarnings(unit,
kinds): string[]`.

- [ ] **Step 1: Failing tests:** counts for a fresh character level = characters × 1 (writing locked);
  `items` = due + fresh before the caps (what the label "N characters" does NOT use: it uses the entry count);
  `unitLabel`; unit-aware `guidance` (writing-only character level → no guidance, Start enabled; copy says
  "characters"); warnings ("Character levels study recognition and writing cards." for tone/sentence;
  the word warning unchanged); dom: selecting JLPT N5 (mocked scheme `unit: 'character'`, entries of kind
  `character`) shows "N characters", a non-zero new count and an enabled start button; a word scheme
  behaves as before.
- [ ] **Step 2:** FAIL. **Step 3:** Implement (the page passes `unit` from the scheme, `kinds`,
  `currentStudyDay()`). **Step 4:** gates PASS. **Step 5:** Commit `feat(study): set up character level sessions`.

### Task 6: "L of N learned" per level

**Files:** Create `apps/web/src/lib/study/levelMastery.ts`, `levelMastery.test.ts`; modify
`apps/web/src/routes/study/+page.svelte` (level picker), its dom test.

**Interfaces:** `levelMastery(levels: readonly SchemeLevelMembers[], cards, reviews, now, w):
Map<string, { learned: number; total: number }>` — `SchemeLevelMembers` is `{levelId, name, chars: Set<string>}`
from `fetchSchemeCharacters` (`lib/api/schemes.ts`); one `masteryForChars` call over the union; `learned` =
stage `learned`; shown as option text "N4 — 3 of 80 learned".

- [ ] **Step 1: Failing tests:** a character with one card of stability ≥ the threshold's equivalent counts
  learned; duplicates inside a level counted once; empty level 0/0; dom: picker shows "3 of 80 learned"
  from `fetchSchemeCharacters` (mocked). Dom tests follow the mock pattern of
  `routes/entry/[id]/page.dom.test.ts` (create `routes/study/page.dom.test.ts`; mock `getSchemes`,
  `getSchemeEntries`, `fetchSchemeCharacters`, `loadStudyData`, the workspaces store, `currentStudyDay`,
  sessionStorage).
- [ ] **Step 2:** FAIL. **Step 3:** Implement (memoised per history load). **Step 4:** gates PASS.
  **Step 5:** Commit `feat(study): show learned characters per level`.

### Task 7: Session runner wiring

**Files:** Modify `apps/web/src/routes/study/session/+page.svelte` (the scheme lookup in `levelEntriesRequest`
returns the scheme's `unit`; pass `unit`, `kinds`, `currentStudyDay()`; use `buildLevelPlan` and the deck
session's reserve/`dropItem` path so dropped items are replaced; read `loadIneligible`); create
`apps/web/src/routes/study/session/page.dom.test.ts` (mock `getEntry`, `addCard`, `recordReview`,
`flushPendingReviews`, the stroke loader).

- [ ] **Step 1: Failing test:** with a mocked character scheme the session shows the glyph-only front for
  the first item and the readings after the reveal; grading Good calls `addCard` and posts one review with
  `cardId` `c-vocab-<id>`; with an earlier-day review the first new item is the writing item (asserted via
  the card's kind label or the queue, not by driving the writing pad); a writing item whose character has
  no stroke data is skipped and the next reserve item shown; a writing-only session starts.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** gates PASS. **Step 5:** Commit `feat(study): run character level sessions`.

### Task 8: Docs and the real-app check

**Files:** Modify `README.md` (study section: character levels, writing unlocks the next day),
`docs/ROADMAP.md` (#57 done; #42's "Open" note resolved), `docs/contracts/README.md`.

- [ ] **Step 1: Real-app check (no browser):** scratch copy, image build (`WITH_OCR=0 WITH_AUDIO=0`), seed
  with the bundled packs, free 127.0.0.1 port. curl: `GET /api/schemes` shows `jlpt-kanji` with `unit:
  "character"`; `GET /api/schemes/<id>/entries?level=N5` returns `kind: "character"` entries; log in, create
  a Japanese workspace, `PUT /api/plugins/qinqin-flashcards/data/card:c-vocab-<id>?workspace=<ws>` with the
  card row the store would write (copy the shape from `store.ts`) and `POST /api/events/batch` a review for
  it; then run the pure modules against the live data with a temporary vitest file in the scratch copy only
  (`QINQIN_CHECK_URL=http://127.0.0.1:<port> npx vitest run src/realapp.check.test.ts`: fetch entries,
  cards and events, call `buildLevelQueue` with `unit: 'character'`, assert the queue holds the reviewed
  card only when due and `level:<id>` items for the rest, and `level:writing:<id>` only after a review dated
  the previous learner day). Never commit that file. Stop and remove everything.
- [ ] **Step 2:** Full Go gate, web gates. **Step 3:** Commit `docs: character level sessions`.

## Task dependencies

1 → 2 → 3 → 7; 2 → 5 → 6; 4 independent after 1; all → 8. Cross-plan: study-day Tasks 1, 6, 7 first.
Vacation-and-limits Task 5 later passes the study context into `buildLevelQueue` (no queue on vacation
days), Task 11 applies the daily limits (existing cards by their decks, virtual items by `general`).

## Contract notes (for `docs/contracts/`)

- `docs/contracts/levels/README.md` — unit/kind rules, unlock rule, ordering, id shapes (Task 1).
- `docs/contracts/levels/character-level-queue.json` (Task 1; web Task 2; Android later).
- `docs/contracts/levels/level-card-ids.json` (Task 1; web Task 3).
- Android must use `newCardId(kind, entryId)` for character cards and the learner's day for the unlock.

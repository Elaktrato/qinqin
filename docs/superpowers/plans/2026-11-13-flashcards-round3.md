# Flashcards Round 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the remaining flashcard exercises (Word Salad, writing quiz, tone swipe), make card-type opt-out real, and polish EXP with streaks and mascot hooks.

**Architecture:** Pure, unit-tested logic modules in `apps/web/src/lib/study/` (kinds and event shape, companion planning, tokenising and tiers, pinyin tones, stroke-quiz grading, EXP/streak/mascot) behind a runner restructured into one component per card kind that reports a *suggested grade*; the learner confirms with the existing four grade buttons. No backend change: events are stored verbatim.

**Tech Stack:** SvelteKit 2 / Svelte 5, TypeScript, vitest, `ts-fsrs`, `hanzi-writer` (all already installed). Existing endpoints: `POST /api/segment`, `GET /api/entries/{id}`.

**Spec:** `docs/superpowers/specs/2026-11-12-flashcards-design.md` (section "Round 3 design decisions" is binding). Branch `feature/flashcards-round3`, stacked on `feature/yomitan-lookup`.

## Global Constraints

- No new dependencies, no new data files, no backend changes (a backend change needs a recorded ruling). Stroke data stays the already bundled `hanzi-writer-data` served from `/hanzi/U<HEX>.json`.
- Card shape stays `{id, kind, entryId, written?, sentenceId?, deckIds, createdAt}` with `kind ∈ vocab | sentence | writing | tone`; `written` is always snapshotted; plugin data keys `deck:<id>` / `card:<id>`, plugin id `qinqin-flashcards`; review event `{cardId, mode, grade, meta?}` with `mode = card.kind` and `meta = {tier?, mistakes?, hints?, durationMs?}`.
- Companion cards are created lazily on first grade (virtual until then); deck sessions only; dedupe by `(kind, entryId, sentenceId)`; ineligible companions are skipped silently and never created. `tone` is Chinese-only; kana-only words get no `writing` card.
- Tier from FSRS stability `S` (days): `S` null or `< 4` → T0; `< 21` → T1; else T2. Suggested grades never include Easy automatically; thresholds exactly as in the spec section.
- XP: base `vocab 10, sentence 15, writing 20, tone 8` + grade bonus `{1:0,2:0,3:5,4:10}` + 10 for the first review of each UTC day; level `L→L+1` costs `100·L` XP; streak = consecutive UTC days with a review. All derived from events, per workspace, never stored.
- Mastery counts all card kinds through `written` with the existing formula; the opt-out (`cardTypes`) is honoured by the queue; at least one type must be selected; `vocab` is not mandatory.
- UI tasks have no component tests (the repo has none): put logic in pure modules; verify with `npm --prefix apps/web run check`, `test`, `build` and a real-app browser run at the end.
- Gates before each commit batch: `npm --prefix apps/web run check`, `npm --prefix apps/web test`, `npm --prefix apps/web run build`; Go gates only if Go code is touched (it should not be). Conventional commits; one commit per task. `localStorage`/`sessionStorage` accesses wrapped in try/catch as elsewhere.

## Review Focus

- A session with only `tone` (or only `sentence`) selected builds a queue and never shows vocab cards (Task 2, 7).
- Abandoning a session before grading a companion creates no card; grading creates exactly one, and the next session does not plan it again (Task 2).
- A word with no Han characters, no sentences, or no stroke data is skipped without crashing, and an empty queue shows the empty state (Task 2, 5, 7).
- Sentence tokenising: Japanese text with punctuation (`宿題をした。`), mixed Latin text, a tokenizer failure (401/413/network) falling back to per-character tokens, astral characters (Task 3).
- Pinyin edge cases: `ü`/`lǚ`, neutral-tone syllables, apostrophes (`xī'ān`), erhua, polyphone entries with several pinyin readings (Task 4).
- Keyboard handling: the writing canvas and token tapping must not trigger the global 1–4 grade keys or Space reveal by accident (Task 7).

---

### Task 1: Card kinds, event shape and a shared review parser

**Files:**
- Modify: `apps/web/src/lib/study/types.ts`, `store.ts`, `events.ts`, `grade.ts`, `scheduler.ts` (re-exports only if needed), tests `store.test.ts`, `events.test.ts`, `grade.test.ts`
- Create: `apps/web/src/lib/study/reviewParse.ts`, `reviewParse.test.ts`
- Modify (replace the four `asReview` copies): `apps/web/src/routes/study/+page.svelte`, `routes/study/session/+page.svelte`, `routes/study/map/+page.svelte`, `lib/plugins/flashcards/FlashcardsWidget.svelte`

**Interfaces:**
- Produces:
  ```ts
  export type StudyCardKind = 'vocab' | 'sentence' | 'writing' | 'tone'
  export const CARD_KINDS: readonly StudyCardKind[]
  export interface ReviewMeta { tier?: 0 | 1 | 2; mistakes?: number; hints?: number; durationMs?: number }
  export interface ReviewPayload { cardId: string; mode: StudyCardKind; grade: ReviewGrade; meta?: ReviewMeta }
  // reviewParse.ts
  export function parseReview(event: StudyEvent): ReviewEvent | null   // keeps the REAL mode (unknown/missing mode → 'vocab'), validates grade 1..4 and cardId, keeps meta when well-formed
  export function cardKey(kind: StudyCardKind, entryId: number, sentenceId?: number): string
  // store.ts
  export function addCard(entryId: number, opts?: { kind?: StudyCardKind; written?: string; sentenceId?: number; deckIds?: string[] }): Promise<StudyCard>  // default kind 'vocab'; dedupe by cardKey
  // events.ts
  export function recordReview(workspaceId: number, cardId: string, grade: ReviewGrade, mode?: StudyCardKind, meta?: ReviewMeta): Promise<void>  // mode default 'vocab'
  ```
  `parseCard` accepts all four kinds (unknown kinds still rejected); `gradeItem`'s `RecordReview` gains the mode and meta arguments; a virtual item passes its kind and `sentenceId` to `addCard`.

- [ ] **Step 1: Write failing tests**: `parseReview` keeps real modes, defaults a missing mode to `vocab`, rejects bad grades/cardIds, keeps valid meta and drops malformed meta; `cardKey` distinguishes kinds and sentence ids; `addCard` dedupes per `(kind, entryId, sentenceId)` (a `sentence` card for the same entry does not collide with the vocab card; two sentences of one entry create two cards); `parseCard` accepts the four kinds; `recordReview` writes the given mode and meta (and `vocab` by default); `gradeItem` forwards mode/meta and the kind/sentence id on creation.
- [ ] **Step 2: Run** `npm --prefix apps/web test -- study` — FAIL.
- [ ] **Step 3: Implement**; replace the four `asReview` copies by `parseReview`; make the old `ReviewPayload.mode` literal widen without breaking existing stored events.
- [ ] **Step 4: Run** the three gates — PASS. **Commit** `feat(flashcards): card kinds, event meta and a shared review parser`.

### Task 2: Queue honours card types; lazy companion planning

**Files:**
- Modify: `apps/web/src/lib/study/session.ts`, `scheduler.ts`, `grade.ts`, `levelQueue.ts` (kind filter stays vocab), tests `session.test.ts`, `scheduler.test.ts`, `grade.test.ts`
- Create: `apps/web/src/lib/study/companions.ts`, `companions.test.ts`

**Interfaces:**
- Consumes: Task 1 types and `cardKey`.
- Produces:
  ```ts
  // session.ts: CARD_TYPES all `available: true`; validateConfig requires >= 1 selected type from CARD_KINDS and no longer requires vocab; DEFAULT_CONFIG.cardTypes = ['vocab']
  // scheduler.ts
  export function buildQueue(args: { cards; reviews; deckIds; newLimit; reviewLimit; now; kinds?: StudyCardKind[] }): StudyCard[]   // kinds filters real cards (default: all)
  // companions.ts
  export const COMPANION_PREFIX = 'companion:'
  export interface CompanionItem { cardId: string; kind: 'sentence' | 'writing' | 'tone'; entryId: number; written: string; deckIds: string[]; virtual: true }
  export function planCompanions(args: { cards: StudyCard[]; kinds: StudyCardKind[]; deckIds: string[]; newBudget: number }): CompanionItem[]
  // one virtual item per vocab card (in the chosen decks, with a `written` snapshot) that has no card of that kind yet, ordered by the vocab card's createdAt, at most `newBudget` items in total across kinds (round-robin by kind); `cardId` = `companion:<kind>:<entryId>`
  export function isCompanionId(id: string): boolean
  ```
  The new-card budget is shared: real new cards first, then companions fill what is left (`newLimit` is per session over everything).

- [ ] **Step 1: Write failing tests**: `buildQueue` with `kinds` returns only those kinds (due and new); `planCompanions` skips vocab cards that already have the kind, respects deck filter and `newBudget`, round-robins kinds, ignores kinds not requested, is empty for an empty `kinds`; `validateConfig` rejects an empty type list and accepts `['tone']` alone; a session with only `['tone']` plans no vocab items; `gradeItem` on a companion item creates the card with the right kind/`written` and records the review with that mode; a second `planCompanions` after creation no longer plans it.
- [ ] **Step 2: Run** `npm --prefix apps/web test -- study` — FAIL.
- [ ] **Step 3: Implement** (pure functions; no I/O).
- [ ] **Step 4: Run** the gates — PASS. **Commit** `feat(flashcards): card-type opt-out and lazy companion planning`.

### Task 3: Word Salad logic

**Files:**
- Create: `apps/web/src/lib/study/wordSalad.ts`, `wordSalad.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SaladTier = 0 | 1 | 2
  export function tierFor(stability: number | null): SaladTier
  export interface MatchSpan { start: number; end: number }   // code-point offsets (the segment API shape)
  export function tokenize(language: string, text: string, matches: MatchSpan[]): string[]
  // zh/ja: matched spans become tokens, uncovered runs split per character (whitespace dropped), trailing punctuation (。、，！？… 」』） etc.) attached to the previous token; other languages: split on whitespace, punctuation stays attached
  export function splitWithin(tokens: string[]): string[]          // T2: every token into single characters (code points), keeping attached punctuation with its character
  export function shuffleTokens<T>(items: T[], seed: string): T[]  // deterministic (seeded) shuffle; never returns the identity order when length >= 2 and a different order exists
  export function isCorrect(answer: string[], solution: string[]): boolean
  export function suggestSaladGrade(args: { wrongChecks: number; revealed: boolean }): ReviewGrade  // 0 wrong, !revealed → 3; 1–2 wrong → 2; revealed or >= 3 wrong → 1
  export async function loadTokens(language: string, text: string, segment: (lang: string, text: string) => Promise<MatchSpan[]>): Promise<string[]>  // calls the injected segment fn; on ANY error returns the per-character fallback tokenisation
  ```
  Wire `segment` to `segmentBatch` (`apps/web/src/lib/api/segment.ts`) in the UI task; this module takes it injected.

- [ ] **Step 1: Write failing tests**: tier thresholds (null, 3.9, 4, 20.9, 21); `tokenize` for `宿題をした。` with spans for 宿題/を/した → `['宿題','を','した。']`; uncovered gaps per character; whitespace dropped; an English sentence splits on spaces with punctuation attached; astral characters are one token; `splitWithin` keeps punctuation attached; `shuffleTokens` is deterministic per seed, differs from the identity order, and keeps the multiset; `isCorrect`; the grade suggestion table; `loadTokens` falls back to per-character on a rejecting segment fn and on overlapping/out-of-range spans (sanitised).
- [ ] **Step 2: Run** `npm --prefix apps/web test -- wordSalad` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the gates — PASS. **Commit** `feat(flashcards): word salad tokenising, tiers and grading`.

### Task 4: Tone logic

**Files:**
- Create: `apps/web/src/lib/study/tones.ts`, `tones.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Tone = 1 | 2 | 3 | 4 | 5            // 5 = neutral
  export interface Syllable { text: string; plain: string; tone: Tone }
  export function parsePinyin(value: string): Syllable[]    // tone-marked pinyin ("xué xí", "nǚ'ér", "lǜ"), space/apostrophe separated; ü and v handled; no mark → tone 5; erhua "r" folded into the previous syllable
  export function toneFromGesture(dx: number, dy: number, minDistance?: number): Tone   // screen coordinates (y down): short movement = 5 (tap); mostly up = 1; up-right = 2; down-then-up is NOT derivable from one vector so accept an optional `path: {x,y}[]` overload: a path that goes down then up = 3; down-right = 4
  export function checkTones(chosen: Tone[], candidates: Syllable[][]): { correct: boolean; wrong: number }   // best-matching candidate with the same syllable count; no such candidate → correct false, wrong = chosen.length
  export function suggestToneGrade(wrong: number): ReviewGrade   // 0 → 3, 1 → 2, else 1
  export function eligibleForTone(language: string, pinyinReadings: string[]): boolean
  ```

- [ ] **Step 1: Write failing tests**: `parsePinyin` on `xué xí`, `nǚ'ér`, `lǜ`, `ma` (neutral), `zhōng guó`, erhua `huār`, uppercase and extra spaces; `toneFromGesture` for tap, up, up-right, down-right and the path overload for the dip; `checkTones` with one candidate, polyphone candidates (`háng` / `xíng` both accepted), a syllable-count mismatch; grade suggestions; `eligibleForTone` false for ja and for an empty list.
- [ ] **Step 2: Run** `npm --prefix apps/web test -- tones` — FAIL.
- [ ] **Step 3: Implement** (table of tone marks; no regex-only hacks for `ü`).
- [ ] **Step 4: Run** the gates — PASS. **Commit** `feat(flashcards): pinyin tone parsing, gestures and grading`.

### Task 5: Writing quiz logic and shared stroke data

**Files:**
- Create: `apps/web/src/lib/study/writing.ts`, `writing.test.ts`, `apps/web/src/lib/study/strokeData.ts`, `strokeData.test.ts`
- Modify: `apps/web/src/lib/components/StrokePlayer.svelte` (use the shared `strokeUrl`)

**Interfaces:**
- Produces:
  ```ts
  // strokeData.ts
  export function strokeUrl(ch: string): string                 // `/hanzi/U<UPPERHEX>.json` (same as StrokePlayer today)
  export async function loadStrokeData(ch: string, fetchFn?: typeof fetch): Promise<unknown | null>   // null on 404/network error; cached per character
  // writing.ts
  export function isHan(ch: string): boolean                    // \p{Script=Han}
  export function writableChars(written: string): string[]       // distinct Han characters in order of first appearance
  export interface CharOutcome { char: string; mistakes: number; strokes: number; revealed: boolean }
  export function suggestWritingGrade(outcomes: CharOutcome[]): ReviewGrade   // no mistakes and no reveal → 3; any reveal → 1; mistakes <= 25% of total strokes → 2; else 1
  export async function usableChars(written: string, load?: (ch: string) => Promise<unknown | null>): Promise<string[]>   // writableChars filtered by available stroke data
  export function quizOptions(): { showHintAfterMisses: number; leniency: number; drawingWidth: number }   // showHintAfterMisses 3; documented defaults
  ```

- [ ] **Step 1: Write failing tests**: `strokeUrl` for 学 and an astral char; `loadStrokeData` caches and returns null on 404; `isHan`/`writableChars` (kana and Latin skipped, repeats removed); `suggestWritingGrade` table incl. reveal, 25 % boundary and empty outcomes; `usableChars` drops chars whose data is missing.
- [ ] **Step 2: Run** `npm --prefix apps/web test -- writing strokeData` — FAIL.
- [ ] **Step 3: Implement**; refactor `StrokePlayer` to the shared helper without behaviour change.
- [ ] **Step 4: Run** the gates — PASS. **Commit** `feat(flashcards): writing quiz logic and shared stroke data`.

### Task 6: EXP, streaks, mascot hooks, mastery for all kinds

**Files:**
- Create: `apps/web/src/lib/study/exp.ts`, `exp.test.ts`, `apps/web/src/lib/study/mascot.ts`, `mascot.test.ts`
- Modify: `apps/web/src/lib/study/scheduler.ts` (XP moves to `exp.ts`; keep re-exports so existing imports work), `mastery.ts`, `mastery.test.ts`, `scheduler.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const BASE_XP: Record<StudyCardKind, number>        // vocab 10, sentence 15, writing 20, tone 8
  export function xpFromReviews(reviews: ReviewEvent[]): number   // base by mode + grade bonus + 10 for each UTC day's first review
  export function levelProgress(xp: number): { level: number; xpInto: number; xpForNext: number }   // cost L→L+1 = 100*L
  export function levelFromXp(xp: number): number
  export function dailyStreak(reviews: ReviewEvent[], now: number): { current: number; best: number; todayDone: boolean }   // consecutive UTC days; current counts back from today (or yesterday when today has none yet)
  // mascot.ts
  export type MascotMood = 'sleepy' | 'happy' | 'proud' | 'cheering'
  export function mascotState(args: { level: number; streak: number; todayDone: boolean }): { stage: 1 | 2 | 3 | 4; mood: MascotMood; assetPath: string }   // stage by level (1–4, 5–9, 10–19, 20+); mood: !todayDone && streak > 0 → sleepy ("don't lose your streak"), todayDone && streak >= 7 → proud, streak >= 30 → cheering, else happy; assetPath `/mascot/<stage>-<mood>.svg`
  ```
  `mastery.masteryForChars` counts reviewed cards of ALL kinds via `card.written` (cards without a snapshot are skipped as before).

- [ ] **Step 1: Write failing tests**: XP by mode and grade, the first-review-of-day bonus once per UTC day (two reviews same day, different days, across the UTC midnight boundary), `levelProgress` boundaries (0 → level 1; 100 → level 2; 300 → level 3; exact boundary), streak (gap breaks it; today empty keeps yesterday's streak alive; best tracked; empty list), mascot table; mastery counts a writing card and a sentence card for their `written` characters and ignores a card without a snapshot; legacy vocab-only results unchanged.
- [ ] **Step 2: Run** `npm --prefix apps/web test -- study` — FAIL.
- [ ] **Step 3: Implement**; update existing imports of `xpFromReviews`/`levelFromXp`.
- [ ] **Step 4: Run** the gates — PASS. **Commit** `feat(flashcards): richer EXP, streaks, mascot hooks and all-kind mastery`.

### Task 7: Card components, runner restructure and setup page

**Files:**
- Create: `apps/web/src/lib/plugins/flashcards/cards/VocabCard.svelte`, `SentenceCard.svelte`, `WritingCard.svelte`, `ToneCard.svelte`, `apps/web/src/lib/study/cardFlow.ts`, `cardFlow.test.ts`
- Modify: `apps/web/src/routes/study/session/+page.svelte`, `apps/web/src/routes/study/+page.svelte`, `apps/web/src/lib/study/cardView.ts` (only if the vocab face needs it)

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces:
  ```ts
  // cardFlow.ts (pure)
  export interface FlowItem { cardId: string; kind: StudyCardKind; entryId: number; virtual: boolean; card: StudyCard | null; written?: string }
  export function pickSentence(sentences: { id: number }[], carded: Set<number>): { id: number } | null   // first sentence without a card
  export function isEligible(kind: StudyCardKind, entry: EntryLike, ctx: { language: string; usableChars?: string[]; hasSentence: boolean }): boolean
  // Card component contract (Svelte 5): props { item, entry, onDone(result: { suggested: ReviewGrade | null; meta: ReviewMeta }) }; the runner shows the four grade buttons (suggested one preselected), keys 1–4 grade, Space/Enter reveals only in vocab cards; cards that handle their own keys call event.stopPropagation or the runner's isInteractive guard covers their focusable controls
  ```
  The runner replaces its single hard-coded vocab template with a dispatch on `item.kind`, fetches entries lazily (as today), resolves companions (sentence picking, eligibility; ineligible items are dropped from the queue and never created), passes `mode`/`meta` to `gradeItem`, shows tier and kind badges, and still shows the summary (XP via the new `exp.ts`, level progress bar, streak). The setup page lists the four types as selectable (no "soon" tags), explains each in one line, warns when a selected type has no eligible content, and persists the opt-out; `tone` is hidden for non-Chinese workspaces and `writing` for kana-only languages is not hidden (words without Han characters are skipped at runtime).
  - `SentenceCard`: tokens from `loadTokens(language, sentence.hanzi, segmentBatch→spans)`; tier from the card's stability (compute with `scheduleFor`); T0 translation visible; T1 translation behind a reveal-cloze; T2 `splitWithin`; tap-to-place token bank with undo, a check button, wrong-check counter, reveal; shuffle seeded by `card.id + reviewCount`.
  - `WritingCard`: `hanzi-writer` (dynamic import, client only) quiz per character with `quizOptions()`, data via `loadStrokeData`, mistakes/stroke counts collected into `CharOutcome[]`, a reveal-character button, progress dots over the characters, outline hidden after the first miss streak per hanzi-writer defaults.
  - `ToneCard`: one pad per syllable with the swipe gesture (pointer events with the path overload) and 1–5 buttons/keys, a contour glyph preview, check button, shows the correct pinyin after checking.

- [ ] **Step 1: Write failing tests** for `cardFlow.ts` (`pickSentence` skips carded sentence ids and returns null when none left; `isEligible` per kind: sentence needs a sentence, writing needs `usableChars.length > 0`, tone needs zh + pinyin readings, vocab always).
- [ ] **Step 2: Run** `npm --prefix apps/web test -- cardFlow` — FAIL.
- [ ] **Step 3: Implement** the pure module, the four card components and the runner/setup changes.
- [ ] **Step 4: Run** `npm --prefix apps/web test`, `run check`, `run build` — PASS. Real-app smoke is part of Task 9.
- [ ] **Step 5: Commit** `feat(flashcards): sentence, writing and tone cards in the session runner`.

### Task 8: Widget, summary and add-to-study polish

**Files:**
- Modify: `apps/web/src/lib/plugins/flashcards/FlashcardsWidget.svelte`, `apps/web/src/routes/study/session/+page.svelte` (summary section only), `apps/web/src/lib/components/AddToStudy.svelte`
- Create: `apps/web/src/lib/plugins/flashcards/Mascot.svelte`

**Interfaces:**
- Consumes: `levelProgress`, `dailyStreak`, `mascotState`, `xpFromReviews` (Task 6).
- Produces: `Mascot.svelte` props `{ level: number; streak: number; todayDone: boolean; size?: number }`: renders `<img src={assetPath}>` when the asset exists (probe once with `fetch(assetPath, {method:'HEAD'})`, cached) else a neutral inline-SVG placeholder tinted by mood, with an accessible label such as "Study buddy, stage 2, sleepy"; no art is bundled.

- [ ] **Step 1:** wire the widget (level progress bar, streak count with a flame glyph, mascot) and the summary (XP earned this session by kind, level progress, streak); `AddToStudy` copy: "Added to study — sentence, writing and tone cards appear automatically in sessions that include them" and adds nothing else (companions stay lazy).
- [ ] **Step 2: Run** `npm --prefix apps/web test`, `run check`, `run build` — PASS. **Commit** `feat(flashcards): level progress, streak and mascot hooks in the widget and summary`.

### Task 9: Docs and final verification

**Files:**
- Modify: `README.md` (Studying section: card types, tiers, grading suggestions, streak/XP, opt-out, lazy companions, keyboard map), `docs/superpowers/specs/2026-11-12-flashcards-design.md` (status line "Round 3 shipped 2026-11-13" and an Implementation notes subsection with limitations: tone Chinese-only, no pitch accent, writing needs Han characters and bundled stroke data, companions only in deck sessions, mascot art not bundled)

- [ ] **Step 1:** write the docs from the real code (verify keys, thresholds and numbers against the implementation).
- [ ] **Step 2:** run all web gates once, then a real-app browser run (127.0.0.1 only; fresh seeded data dir under the scratchpad with the default `plugins/data`; headless Chromium via playwright-core as in earlier runs; register a user through the API; add three Chinese words and one Japanese word to study through the UI or API; run each session type): setup page lists four selectable types and the opt-out works (a `tone`-only session never shows vocab); Word Salad T0 and a forced T1/T2 card (create review history through the events API to raise stability) incl. tokens tapped to correct and wrong; writing quiz: draw a stroke correctly and a wrong one (mistake counted), the reveal button; tone card: gesture and key input, polyphone word accepted; summary shows XP by kind, level progress and streak; the widget shows the mascot placeholder; nothing created for an abandoned companion. Report pass/fail/not-run per check and never claim an unrun check. **Commit** `docs: flashcards round 3`.

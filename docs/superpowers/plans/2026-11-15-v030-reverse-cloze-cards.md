# Reverse and cloze cards (issue #65, v0.3.0 item 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (the owner always
> runs plans subagent-driven: a fresh implementer per task, an independent review on the strongest model,
> one fix wave per branch, a whole-branch review at the end). Steps use checkbox (`- [ ]`) syntax.

**Goal:** two opt-in-per-deck card kinds (reverse: meaning → word; cloze: an example sentence with the
word blanked), sibling burying until the learner's next day, deterministic ids, card management and
mastery rules for them, with contract fixtures for Android.

**Spec:** `docs/superpowers/specs/2026-11-15-v030-reverse-cloze-cards-design.md` (read it first; its
rulings are binding). **Order:** this item is built **before** the decks view
(`2026-11-15-v030-decks-view.md`), and **after item 1 (#84 study day, #57 character level sessions) is merged into `feature/v0.3.0`**
(it uses `lib/time/studyDay.ts` / `lib/time/zone.ts`, `readContract`, and #57's `buildLevelQueue`). If item 1 is not merged when Task 5 starts, stop and
report: do not invent a day function.

**Architecture:** web only, no migration, no new route. Pure modules in `apps/web/src/lib/study/`
(`siblings.ts`, `cloze.ts`, `reverse.ts`, `deckSettings.ts`), thin Svelte cards in
`apps/web/src/lib/plugins/flashcards/cards/`, store changes in `store.ts`, fixtures in
`docs/contracts/cards/`.

**Tech stack:** SvelteKit 2 / Svelte 5, vitest (unit + `*.dom.test.ts` jsdom project), ts-fsrs. No new
dependencies.

**Worktree:** `<wt>` = `/home/user/www/github/qinqin/.claude/worktrees/v030-reverse-cloze`, created with
`git worktree add -b feature/v030-reverse-cloze .claude/worktrees/v030-reverse-cloze feature/v0.3.0`
from the then-current tip. Run `npm --prefix <wt>/apps/web ci` once.

## Gates

- Web (every task): `npm --prefix <wt>/apps/web run check`, `npm --prefix <wt>/apps/web test`,
  `npm --prefix <wt>/apps/web run build`. Read each exit code; never pipe them through `tail`.
- Go: only in the final task (no Go change is planned): the full gate from `AGENT-RULES.md`
  (`go vet ./... && go test -p 2 ./...` in `golang:1.26`, own user, shared caches). Then `git status`
  clean and `find <wt> -user root` empty.
- Each task ends green with exactly one commit (conventional message, blank line,
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`), `git add` of explicit paths only.
  Never merge, never push.
- Test-first: write the test, run it and **see it fail for the expected reason**, implement, see it pass.

## Global constraints

- Existing decks must not change: with no `deckcfg:` row, every queue, count, score and XP figure is
  identical to `feature/v0.3.0`. Every task that touches planning keeps the existing tests untouched
  and green (they are the regression net); new behaviour gets new tests.
- Kind order everywhere: `vocab, sentence, writing, tone, reverse, cloze`.
- Ids only `[a-z0-9-]` (plugin-data key and URL segment): `c-reverse-<entryId>`, `c-cloze-<entryId>`.
- `dayOf` is always injected (`(ms: number) => string`); no module in this plan calls `Intl` or
  `Date#toISOString().slice(0, 10)` for a day.
- Component logic lives in pure modules; Svelte files only wire state and events.
- CI runs Node 26: jsdom tests use `src/lib/testing/domSetup.ts`; no Node-24-only behaviour.

## Review Focus

1. **No change for existing decks.** A workspace without `deckcfg:` rows: `deckSessionPlan`,
   `buildQueue`, `masteryForChars`, `wordStateCounts`, `xpFromReviews` give exactly the old output
   (Task 6 has an explicit "no config" equivalence test over the existing fixtures).
2. **Burying predicate.** Vocab + writing answered the same day stay unburied; vocab answered buries
   reverse and cloze of the same entry; reverse answered buries all siblings; the next learner day
   lifts it; re-shows never bury and are never removed (Task 5 fixture).
3. **Ids across devices.** Two `addCard('reverse', 1201)` racing write one key; a cloze card's id never
   contains a sentence id; changing the sentence list keeps the card and its reviews (Task 1/7 fixtures).
4. **One key, two actions.** A digit that picks a cloze choice never also grades; Enter during IME
   composition in a typing field neither checks nor reveals (Tasks 10–12 jsdom tests).
5. **skipKinds survives merges and undo.** Duplicate vocab rows union their `skipKinds`; undo of a
   sibling removal restores both the vocab row and the sibling row (Tasks 2, 14).
6. **Mastery not inflated.** Reverse/cloze reviews with high stability leave character scores and word
   states unchanged (Task 4).

---

### Task 1: The two kinds, ids and the contract fixture loader

**Files:**
- Modify: `apps/web/src/lib/study/types.ts` (`StudyCardKind` + `'reverse' | 'cloze'`, `CARD_KINDS` in the
  global order, `export type OptInKind = 'reverse' | 'cloze'`, `export const OPT_IN_KINDS: readonly OptInKind[]`),
  `apps/web/src/lib/study/exp.ts` (`BASE_XP.reverse = 10`, `BASE_XP.cloze = 15`; `xpByKind` zero record),
  `apps/web/src/lib/study/cardFlow.ts` (`sessionCounts` zero record), `apps/web/src/routes/study/+page.svelte`
  and `apps/web/src/routes/study/session/+page.svelte` (the `Record<StudyCardKind, string>` label maps:
  "Reverse", "Cloze"; key hints from the spec)
- Create: `docs/contracts/cards/card-ids.json`, `docs/contracts/cards/README.md`,
  `apps/web/src/lib/study/cardIds.contract.test.ts`
- Modify: `docs/contracts/README.md` (item 1's index: one line for `cards/`), the hard-coded
  `STUDY_KINDS` list in `routes/study/session/+page.svelte` (the type checker does not flag it)

**Interfaces:**
- Fixtures are read with item 1's `readContract(path)` from `apps/web/src/lib/testing/contracts.ts`
  (do not create a second loader) and use item 1's format `{"version":1,"rule":"…","cases":[…]}`.
- `card-ids.json`: `{"version":1,"rule":"card-ids","cases":[ { "kind", "entryId", "sentenceId"?, "id", "cardKey", "virtualId"? } ]}`
  covering vocab 1201 → `c-vocab-1201` / `vocab:1201`; sentence 1201 s 77 → `c-sentence-1201` /
  `sentence:1201:77`; reverse 1201 → `c-reverse-1201` / `reverse:1201` / `companion:reverse:1201`;
  cloze 1201 with sentenceId 77 → `c-cloze-1201` / `cloze:1201` (sentence ignored) /
  `companion:cloze:1201`; writing and tone likewise.
- `README.md`: the id table and rules from the spec (≤ 40 lines), the fixture format of each file in
  this directory (filled in by later tasks).

- [ ] **Step 1: Failing test** `cardIds.contract.test.ts`: for every case, `newCardId(kind, entryId) === id`,
  `cardKey(kind, entryId, sentenceId) === cardKey`; `parseReview` keeps `mode: 'reverse'` and `'cloze'`;
  `CARD_KINDS` equals the global order; `BASE_XP` has all six. Run: fails (unknown kinds).
- [ ] **Step 2: Implement**; `npm run check` reports every exhaustive `Record<StudyCardKind, …>` — fill each.
- [ ] **Step 3: Gates**; commit `feat(study): reverse and cloze card kinds with id fixtures`.

### Task 2: `skipKinds` on vocab rows

**Files:** Modify `apps/web/src/lib/study/types.ts` (`StudyCard.skipKinds?: StudyCardKind[]`),
`apps/web/src/lib/study/store.ts` (`parseCard` keeps a deduplicated, known-kinds-only, non-vocab
`skipKinds` array; drops it when empty), `apps/web/src/lib/study/canonical.ts` (`mergeInto` unions it);
tests in `store.test.ts`, `canonical.test.ts`.

- [ ] **Step 1: Failing tests:** a row with `skipKinds: ['reverse','reverse','bogus','vocab']` parses to
  `['reverse']`; a row without it has no field; two duplicate vocab rows `['reverse']` + `['cloze']`
  merge to `['reverse','cloze']` (kind order) on the survivor.
- [ ] **Step 2: Implement. Step 3: Gates;** commit `feat(study): per-word skipped card kinds`.

### Task 3: Deck settings rows (`deckcfg:`)

**Files:**
- Create: `apps/web/src/lib/study/deckSettings.ts`, `apps/web/src/lib/study/deckSettings.test.ts`
- Modify: `apps/web/src/lib/study/store.ts` (`fetchStudyData` collects `deckcfg:` rows into
  `StudyData.deckSettings: Record<string, DeckSettings>`; `loadStudyDataWith` passes it through;
  new `saveDeckCardTypes`; `deleteDeck` tombstones `deckcfg:<id>` after the deck row, ignoring 404),
  `apps/web/src/lib/study/types.ts` (`StudyData.deckSettings?`), `store.test.ts`

**Interfaces:**
```ts
export const DECKCFG_PREFIX = 'deckcfg:';
export interface DeckSettings { deckId: string; cardTypes: OptInKind[]; extra: Record<string, unknown> }
export function parseDeckSettings(key: string, raw: unknown): DeckSettings | null; // key must equal deckcfg:<deckId>
export function serializeDeckSettings(s: DeckSettings, updatedAt: string): Record<string, unknown>; // {...extra, deckId, cardTypes, updatedAt}
export function enabledKinds(settings: Record<string, DeckSettings> | undefined, deckIds: readonly string[]): Set<OptInKind>; // union over the given decks
// store.ts
export async function saveDeckCardTypes(deckId: string, cardTypes: readonly OptInKind[]): Promise<DeckSettings>;
```
- `extra` holds every unknown field verbatim (forward compatibility; 4b's limits use their own `limits:deck:` rows); `cardTypes` keeps known
  opt-in kinds only, in kind order. `saveDeckCardTypes` re-reads the row, keeps `extra`, PUTs.

- [ ] **Step 1: Failing tests:** parse/serialize round-trip keeps `{"limits":{"new":5}}`; a key/deckId
  mismatch is null; `general` works; `enabledKinds` unions; store: `saveDeckCardTypes` PUTs
  `deckcfg:general` with the preserved extra (mock `api` as `store.test.ts` does); `deleteDeck('d1')`
  DELETEs `deck:d1` then `deckcfg:d1` and a 404 on the latter is not an error.
- [ ] **Step 2: Implement. Step 3: Gates;** commit `feat(study): per-deck card type settings`.

### Task 4: Mastery ignores reverse and cloze; `cardScore`

**Files:** Modify `apps/web/src/lib/study/mastery.ts`; tests in `mastery.test.ts`.

**Interfaces:** `export const MASTERY_KINDS: readonly StudyCardKind[] = ['vocab','sentence','writing','tone'];`
`export function cardScore(stability: number): number` (= `Math.round(100 * cardStrength(stability))`).
`masteryForChars` skips cards whose kind is not in `MASTERY_KINDS` and sums `cardStrength` exactly as
before (the per-character mean still rounds once at the end — do not round per card).

- [ ] **Step 1: Failing tests:** adding a `reverse` and a `cloze` card with the same `written` and a long
  Easy history leaves every `CharMastery` equal to the result without them; `cardScore(0) === 0`,
  `cardScore(365) === 100`, `cardScore(109) === 80`, `cardScore(108) === 79` (the band edge lies at
  a stability of about 108.1 days; `cardScore(21) === 52`). Existing tests untouched.
- [ ] **Step 2: Implement. Step 3: Gates;** commit `feat(study): mastery counts only the existing kinds`.

### Task 5: Burying (`siblings.ts`) and its fixture

**Files:** Create `apps/web/src/lib/study/siblings.ts`, `apps/web/src/lib/study/siblings.test.ts`,
`docs/contracts/cards/burying.json`; modify `cardFlow.ts`, `cardFlow.test.ts` (`buryAfterAnswer`); append
the format to `docs/contracts/cards/README.md`.

**Interfaces:**
```ts
export function buries(answered: StudyCardKind, other: StudyCardKind): boolean; // OPT_IN on either side
export interface Buried { cardIds: Set<string>; keys: Set<string> } // keys = `${kind}:${entryId}` (for virtual items)
export function buriedNow(input: { cards: readonly StudyCard[]; reviews: readonly ReviewEvent[]; now: Date;
  dayOf: (ms: number) => string }): Buried;
export function answeredEntriesToday(...same input): Map<number, StudyCardKind[]>; // entry -> kinds answered today
// in cardFlow.ts, next to dropItem (siblings.ts must not import cardFlow: no cycle):
export function buryAfterAnswer(plan: DeckSessionPlan, index: number, answered: { kind: StudyCardKind; entryId: number; cardId: string }): { plan: DeckSessionPlan; buried: number };
```
- `siblings.ts` imports only `types.ts`; `buryAfterAnswer` lives in `cardFlow.ts` (it needs
  `DeckSessionPlan` and the `dropItem` backfill) and is tested in `cardFlow.test.ts`.
- `buryAfterAnswer` runs on the queue `applyGrade` returned (a re-show may have been inserted) with
  `index` = the answered position (`step.index - 1`).
- `buriedNow`: only reviews whose card is in `cards` (deleted cards do not bury); a card is never buried by
  its own reviews; for every entry with answers today, every other card / kind of that entry with
  `buries(answeredKind, kind)` is buried.
- `buryAfterAnswer`: removes items after `index` with the same entry, another `cardId`, `reshow === undefined`
  and `buries(answered.kind, item.kind)`; each removed virtual item is backfilled exactly like `dropItem`
  (next reserve item appended while `backfillLeft > 0`). Items before `index + 1` are untouched.
- `burying.json`: `{"version":1,"rule":"burying","cases": [ { "name", "now", "today", "cards": [...], "reviews": [{"cardId","ts","day","grade"}], "buriedCardIds": [...], "buriedKeys": [...] } ]}`.
  The test's `dayOf` maps each review `ts` to its `day` and `now` to `today` (time-zone rules belong
  to `docs/contracts/study-day/`). Cases: vocab answered today buries reverse+cloze, not writing;
  writing answered buries reverse; reverse answered buries vocab, sentence, writing, tone, cloze;
  answered yesterday buries nothing; a review of a deleted card buries nothing; two entries do not
  interact; Again counts as answered.

- [ ] **Step 1: Failing tests** (fixture cases + `buryAfterAnswer`: a later reverse of the answered word is
  removed and the next reserve item takes its slot; a pending re-show of the same card stays; a removed
  real card frees nothing; legacy pair vocab→writing untouched). See them fail.
- [ ] **Step 2: Implement. Step 3: Gates;** commit `feat(study): bury reverse and cloze siblings until the next day`.

### Task 6: Session planning with deck kinds, skips and burying

**Files:** Modify `apps/web/src/lib/study/companions.ts` (`CompanionKind` gains reverse/cloze; new
options), `apps/web/src/lib/study/cardFlow.ts` (`DeckSessionOptions` gains `deckSettings?`, `dayOf?`;
`allowedReal`), `apps/web/src/lib/study/levelQueue.ts` (`BuildLevelQueueOptions.excludeEntries?: ReadonlySet<number>`:
entries skipped entirely — neither their card nor a virtual item; build on item 1's #57 unit-aware version);
tests in `companions.test.ts`, `cardFlow.test.ts`, `levelQueue.test.ts`.

**Interfaces:**
```ts
planCompanions({ cards, kinds, deckIds, newBudget, deckSettings?, exclude? }): CompanionItem[]
// deckSettings: reverse/cloze planned only for vocab cards with an enabling deck in deckIds ∩ card.deckIds;
// skipKinds honoured for every companion kind; exclude: Set<number> of entry ids (in queue or answered today)
// that get no opt-in item; at most one opt-in item per entry, reverse preferred (cloze when reverse
// exists, is skipped, not enabled or in `skip`); `skip` (the ineligible memory) is honoured for all kinds.
// Also raise the internal plan size in deckSessionPlan from `cards.length * 3` to `cards.length * 5`
// (five companion kinds), or the reserve tail is cut.
export function allowedReal(card: StudyCard, ctx: { sessionDecks: readonly string[];
  deckSettings?: Record<string, DeckSettings>; skipByEntry: Map<number, Set<StudyCardKind>> }): boolean;
```
- `deckSessionPlan`: **pre-filter `cards`** (drop real cards that fail `allowedReal` or are buried —
  `buriedNow` when `dayOf` is given) and call `buildQueue` on the rest, so nothing disallowed uses a
  limit slot and `freshCount` is computed from what is really queued; then plan companions with `exclude` = the entries of every remaining
  real queue item plus the entries answered today (an opt-in item conflicts with any sibling); legacy
  companions keep their current rules except that a virtual companion whose `kind:entryId` is in
  `Buried.keys` is dropped. The budget arithmetic stays as today. Without `deckSettings` nothing
  opt-in is planned or queued.
- Level sessions: the runner passes `excludeEntries` = entries with a buried vocab card (computed by
  `buriedNow`), applied inside `buildLevelQueue` before its limits.
- `levelSessionItems`: drops items whose card id or `vocab:<entryId>` key is buried.

- [ ] **Step 1: Failing tests:** (a) **equivalence**: for every existing `cardFlow.test.ts` scenario,
  calling with `deckSettings: {}` and a `dayOf` returns deep-equal plans to calling without them (one
  table-driven test); (b) reverse enabled on deck A: planned for A's words, not for B's; a word in A and B
  with B in the session only gets none; (c) `skipKinds: ['reverse']` → none; (d) a word whose vocab card is
  due in this queue gets no virtual reverse; (e) answered today → no opt-in item, real reverse dropped;
  (f) reverse and cloze both enabled → one opt-in item per entry, round-robin across entries;
  (g) a real reverse card in a deck with reverse switched off is not queued, but its history is kept;
  (h) level session: vocab card buried by a reverse answered today is neither queued nor turned into a
  virtual `level:` item, and the next level word takes its slot; (i) a disallowed real reverse card does
  not use a `reviewLimit` slot (limit 1, one disallowed + one allowed due card → the allowed one is
  queued); (j) reverse answered today drops the word's virtual writing companion.
- [ ] **Step 2: Implement. Step 3: Gates;** commit `feat(study): plan reverse and cloze per deck with burying`.

### Task 7: Cloze logic (`cloze.ts`) and its fixture

**Files:** Create `apps/web/src/lib/study/cloze.ts`, `cloze.test.ts`, `docs/contracts/cards/cloze.json`;
append the format to the contracts README.

**Interfaces:**
```ts
export interface Span { start: number; end: number } // code points, half-open
export function blankSpans(text: string, entry: { id: number; written: string; forms?: readonly { text: string }[] },
  matches: readonly { start: number; end: number; entries: readonly { id: number }[] }[]): Span[];
export function eligibleSentences<S extends { id: number; hanzi: string }>(sentences: readonly S[], spansOf: (s: S) => Span[]): S[];
export function sentenceForShowing<S>(eligible: readonly S[], recordedReviews: number): S | null; // eligible[n mod len]
export type ClozePart = string | { gap: true };            // a string run, or an extra (non-answer) gap
export interface ClozePrompt { before: ClozePart[]; after: ClozePart[]; answer: string }
export function clozePrompt(text: string, spans: readonly Span[]): ClozePrompt;
export type ClozeMode = 'choose' | 'type';
export function clozeMode(input: { tier: SaladTier; answer: string; entryForms: readonly string[]; distractors: readonly string[] }): ClozeMode;
export function pickDistractors(input: { answer: string; sentence: string; candidates: readonly string[]; seed: string }): string[]; // ≤3, same length first, never in sentence, deterministic via shuffleTokens
export function acceptedClozeAnswers(answer: string, entry: { written: string; forms?: readonly { text: string }[]; variants?: readonly { written: string }[] }): Set<string>;
export function normalizeAnswer(text: string): string; // NFC, trim, remove all whitespace
export function suggestClozeGrade(r: { correct: boolean; gaveUp: boolean }): ReviewGrade; // Good or Again
```
- `cloze.json`: `{"version":1,"rule":"cloze","cases": [ { "name", "entry", "sentences": [{"id","hanzi"}], "matchesBySentence": {"<id>": [...]}, "reviews": n, "eligibleIds": [...], "shownId", "spans": [[s,e]...], "before", "after", "answer" } ]}` (`before`/`after` as `ClozePart` arrays).
  Cases: 喜欢 (1201) in 我喜欢喝茶，他也喜欢。 — spans [[1,3],[8,10]], before `["我"]`, after
  `["喝茶，他也", {"gap":true}, "。"]`;
  食べる (5001) in パンを食べました。 with a segmenter match [3,8] → answer 食べました, mode type;
  no segmenter match → literal fallback; a sentence without the word is not eligible; rotation with
  eligible [11,12,15]: reviews 0 → 11, 1 → 12, 4 → 12; after 12 is retired eligible [11,15], reviews 1 → 15
  (same card id `c-cloze-<id>` in every case); a surrogate-pair character before the word (code points,
  not UTF-16).

- [ ] **Step 1: Failing tests** (fixture + distractor rules + normalisation + `clozeMode` falls back to
  type for an inflected answer or fewer than 3 distractors). **Step 2: Implement. Step 3: Gates;**
  commit `feat(study): cloze sentence choice, blanks and answers`.

### Task 8: Reverse logic (`reverse.ts`) and faces

**Files:** Create `apps/web/src/lib/study/reverse.ts`, `reverse.test.ts` (`buildReverseFront` lives
here; the back reuses `cardView.buildVocabFaces` unchanged).

**Interfaces:**
```ts
export interface ReverseFront { pos: string[]; glosses: string[] } // first sense group's pos and up to 3 glosses; falls back to `senses`
export function buildReverseFront(entry: Entry): ReverseFront;
export function acceptedReverseAnswers(entry: Pick<Entry, 'written' | 'forms' | 'variants'>): Set<string>; // normalizeAnswer'd
export function suggestReverseGrade(r: { typed: string; accepted: Set<string>; readingShown: boolean }): ReviewGrade | null;
// '' → null; accepted → readingShown ? 2 : 3; otherwise 1
```
- [ ] **Step 1: Failing tests** (glosses capped at 3, written form never in the front, variants accepted,
  whitespace-only typed → null). **Step 2: Implement. Step 3: Gates;** commit `feat(study): reverse card logic`.

### Task 9: Eligibility

**Files:** Modify `apps/web/src/lib/study/cardFlow.ts` (`EligibilityContext` gains optional `hasCloze?`;
`EntryLike` gains **optional** `kind?` and `glossCount?` so existing call sites and tests compile;
`isEligible('reverse')` = `entry.kind === 'word'` and `glossCount > 0`; `isEligible('cloze')` = `ctx.hasCloze === true`;
`rememberDrop(item, written, opts?: { transient?: boolean })` returns false when `transient`), `cardFlow.test.ts`.

- [ ] **Step 1: Failing tests** (positive cases fail first; the negative ones already pass through
  `default: false` and stay as regression tests): a word entry with glosses → reverse eligible; cloze with
  `hasCloze: true` → eligible; a character entry → reverse ineligible; `rememberDrop(…, {transient: true})`
  for a virtual cloze is false.
- [ ] **Step 2: Implement. Step 3: Gates;** commit `feat(study): eligibility of reverse and cloze cards`.

### Task 10: Shared `ClozeChoice`

**Files:** Move `apps/web/src/lib/plugins/grammar/ClozeChoice.svelte` and `clozeKeys.ts` (+ test) to
`apps/web/src/lib/components/ClozeChoice.svelte`, `apps/web/src/lib/components/clozeKeys.ts`; update the
grammar imports (`PracticeRun.svelte`); create `apps/web/src/lib/components/ClozeChoice.dom.test.ts`.
Add an optional `gapLabel` prop (visually hidden text inside each gap, default "blank") and accept
`before`/`after` as `string | ClozePart[]` (grammar keeps passing strings; parts render extra gaps as
gap elements with the hidden label).

- [ ] **Step 1: Failing jsdom test:** renders before/gap/after with `lang`; parts with an extra gap
  render two gap elements, each with the hidden label; key `2` picks the second choice,
  calls `onResult` once and the keydown event is `defaultPrevented`; a second key does nothing; the gap
  has the hidden "blank" text; feedback is in `role="status"`. **Step 2: Move and implement.**
  **Step 3: Gates** (grammar tests still green); commit `refactor(web): share the cloze choice component`.

### Task 11: `ReverseCard.svelte`

**Files:** Create `apps/web/src/lib/plugins/flashcards/cards/ReverseCard.svelte`,
`ReverseCard.dom.test.ts`. Props like `VocabCard` (`item`, `entry`, `revealed`, `onDone`, `audio?`) plus
`language`. Logic only through `reverse.ts` and `buildVocabFaces` for the back.

- [ ] **Step 1: Failing jsdom test:** front shows glosses, not the written form; Show reading reveals the
  reading and later suggests Hard for a right answer; typing the word and pressing Enter (not composing)
  calls `onDone({suggested: 3})`; a `keydown` Enter with `isComposing: true` does nothing; wrong → 1;
  empty + Show answer → `suggested: null`; the field has a visible label and `lang`.
- [ ] **Step 2: Implement. Step 3: Gates;** commit `feat(flashcards): reverse card`.

### Task 12: `ClozeCard.svelte`

**Files:** Create `apps/web/src/lib/plugins/flashcards/cards/ClozeCard.svelte`, `ClozeCard.dom.test.ts`.
Props: `item`, `entry`, `sentence`, `prompt: ClozePrompt`, `mode: ClozeMode`, `choices: string[]`,
`accepted: Set<string>`, `language`, `done`, `onDone`. Choose mode renders `ClozeChoice`; type mode one
labelled field + Check + Show answer; translation always visible; the sentence's reading only when done.

- [ ] **Step 1: Failing jsdom test** for both modes (right/wrong/gave up → suggested 3/1/1, never 4; IME
  Enter ignored; focus lands in the field in type mode; reading hidden until done).
- [ ] **Step 2: Implement. Step 3: Gates;** commit `feat(flashcards): cloze card`.

### Task 13: Runner wiring

**Files:** Modify `apps/web/src/routes/study/session/+page.svelte` (pass `deckSettings` and
`currentStudyDay().dayOf` into `deckSessionPlan`, `buriedNow` into `levelSessionItems`; `resolveItem`
cases `reverse` (eligibility) and `cloze` (segment each candidate sentence once via `segmentBatch`,
`eligibleSentences`, `sentenceForShowing(reviewCountFor(...))`, `clozePrompt`, distractors from the
session's vocab cards' `written`); after a **recorded** grade call `buryAfterAnswer` and, when it removed
items, set the status line "N related card(s) buried until tomorrow"; render `ReverseCard`/`ClozeCard`;
audio for reverse after the reveal like vocab; `onKeydown` and `revealVocab` handle Space/Enter before
`done` for reverse as for vocab, via a helper `revealsOnKey(kind)`; a cloze item stores its sentence id and
mode on the `FlowItem` (`clozeSentenceId`, `clozeMode`, like `tier`) so an Again re-show shows the same
sentence; segment results are cached per sentence id for the session, at most 8 sentences per entry;
a failed segment request drops the item with `rememberDrop(…, {transient: true})`). Extract any new
decision into `cardFlow.ts` with a unit test first (e.g. `clozeDistractorPool(cards, deckIds, entryId)`,
`revealsOnKey`, `clozeReshowState`).

- [ ] **Step 1: Failing unit tests** for each extracted helper. **Step 2: Implement** the wiring.
- [ ] **Step 3: Gates;** commit `feat(study): run reverse and cloze cards in sessions`.

### Task 14: Remove or restore one sibling kind of a word

**Files:** Modify `apps/web/src/lib/study/store.ts`; tests in `store.test.ts`.

**Interfaces:**
```ts
export async function dropSiblingCards(ids: readonly string[]): Promise<StudyCard[]>;
// non-vocab ids only (vocab ids → Error); tombstones each row and its duplicates, then rewrites the
// entry's vocab row(s) with the kinds added to skipKinds; returns the previous rows (vocab rows
// included) for restoreCards; PartialCardsError like deleteCards.
export async function skipKind(entryId: number, kind: StudyCardKind): Promise<StudyCard[]>;
// adds the kind to the vocab row(s) without any card existing; returns previous rows for undo.
export async function unskipKind(entryId: number, kind: StudyCardKind): Promise<StudyCard[]>;
// removes the kind from the vocab row(s); returns previous rows for undo.
```
- Undo of all three is `restoreCards(rows)` **without** `onlyLive` (the sibling row is a tombstone).
- A stray sibling with no vocab row: `dropSiblingCards` only tombstones it.
- [ ] **Step 1: Failing tests:** dropping `c-reverse-7` tombstones it and writes `c-vocab-7` with
  `skipKinds: ['reverse']`; `restoreCards(result)` brings both back; deleting the word `c-vocab-7`
  (existing `deleteCards`) also tombstones `c-reverse-7` and `c-cloze-7`; moving it moves them;
  dropping a vocab id throws.
- [ ] **Step 2: Implement. Step 3: Gates;** commit `feat(study): remove one card kind of a word`.

### Task 15: Setup page, widget counts and the deck switch

**Files:**
- Create: `apps/web/src/lib/study/DeckCardTypes.svelte` (Reverse/Cloze switches for one deck; calls
  `saveDeckCardTypes`), `DeckCardTypes.dom.test.ts`, `apps/web/src/lib/study/dueCounts.ts`, `dueCounts.test.ts`
- Modify: `apps/web/src/lib/study/scheduler.ts` (`BuildQueueOptions.scheduleOf?`), `apps/web/src/lib/study/session.ts` (`CARD_TYPES` + reverse/cloze; `validateConfig` already accepts them through `CARD_KINDS`),
  `apps/web/src/lib/study/cardTypesMemory.ts` (`extraTypeChoices` per workspace:
  `parseExtraChoices/withExtraChoice/loadExtraChoices/rememberExtraChoice`, and
  `defaultExtraTypes(enabled: Set<OptInKind>, choices) -> OptInKind[]`), `apps/web/src/routes/study/+page.svelte`
  (deck rows get `DeckCardTypes`; Reverse/Cloze checkboxes only when a selected deck enables them,
  defaulting from `defaultExtraTypes`; unchecking records the choice), `FlashcardsWidget.svelte`
  (counts through `dueCounts`)

**Interfaces:**
`export function dueCounts(input: { cards; reviews; deckIds; kinds; deckSettings?; now; w; dayOf?; newLimit?: number; reviewLimit?: number; scheduleOf?: (cardId: string) => Schedule | null }): { due: number; fresh: number }`
— the planner's pre-filter (`allowedReal`, burying), then `buildQueue` with the given limits (default
unlimited). The **home widget** switches to it, passing its current caps (`config.reviewLimit`,
`config.newLimit`) so its numbers stay identical without config. The **setup summary keeps**
`deckSessionItems` + `sessionCounts` (it counts virtual companions; that stays). `scheduleOf` is
passed through to `buildQueue` (an optional lookup added there in this task, default = replay as today),
so the decks view can reuse one schedule index.
`export function effectiveKinds(remembered: StudyCardKind[] | null, enabled: Set<OptInKind>, choices: ExtraChoices): StudyCardKind[]`
(in `cardTypesMemory.ts`): the remembered existing kinds (opt-in entries ignored; vocab when none) plus each
enabled opt-in kind not unchecked in `choices`. Widget, setup page and (3b) decks view all use it.

- [ ] **Step 1: Failing tests:** `dueCounts` with the widget's caps equals the old widget computation
  without config (table test over the widget's scenarios); `buildQueue` with a `scheduleOf` lookup gives
  the same queue as without; `effectiveKinds` cases; a buried
  reverse is not due; checkboxes appear only for enabled kinds and start checked unless the stored
  choice says off; `DeckCardTypes` toggling writes `cardTypes` and shows an error inline on failure.
- [ ] **Step 2: Implement. Step 3: Gates;** commit `feat(study): deck switches and session choice for reverse and cloze`.

### Task 16: Real-app check, docs, hand-over

**Files:** Modify `docs/ROADMAP.md` (#65: "built on `feature/v030-reverse-cloze`"), `README.md` (flashcards
paragraph: the two kinds, per-deck switch, burying), `docs/contracts/cards/README.md` (complete), fixes
found (each with its own failing test and commit).

- [ ] **Step 1: Build** from a copy: `cp -r <wt> <scratch>/rc-src` (scratch = the session scratchpad),
  `docker build -t qinqin:v030-rc --build-arg WITH_OCR=0 --build-arg WITH_AUDIO=0 <scratch>/rc-src`; pick
  a free port P (`ss -ltn`; never 8080, 8085, 8300); `docker run -d --name qinqin-v030-rc -p 127.0.0.1:P:8080
  -v <scratch>/rc-data:/data qinqin:v030-rc`; `docker exec qinqin-v030-rc qinqin seed --packs /opt/qinqin/packs`;
  `docker exec -e QINQIN_PASSWORD=rc-test-123 qinqin-v030-rc qinqin adduser --username tester --admin`.
- [ ] **Step 2: API (curl/Python only):** log in (`POST /api/auth/login`), create a zh workspace, find a
  word with sentences (`GET /api/search?q=喜欢`, `GET /api/entries/<id>`), PUT `card:c-vocab-<id>` and
  `deckcfg:general` `{"deckId":"general","cardTypes":["reverse","cloze"],"updatedAt":…}`, PUT
  `card:c-reverse-<id>`, POST a review event with `mode: "reverse"`; `GET /api/sync/pull?...` returns all
  three rows; `POST /api/segment` on one of the entry's sentences returns a match with the entry id
  (confirms the cloze blank source on real data, record the result). PUT `deckcfg:general` from a second
  token of another user → 404/403 (user isolation of plugin data, existing rule).
- [ ] **Step 3: Built bundle:** `curl /study/session` serves the SPA; grep the built JS for `c-cloze-`
  (the id format shipped). UI behaviour is covered by the jsdom tests; list in the report what only a
  human can check (touch typing with an IME, screen reader reading the gap).
- [ ] **Step 4:** `docker rm -f qinqin-v030-rc`, remove `<scratch>/rc-*` (with an alpine container if
  root-owned), full Go gate once, web gates, `git status` clean, `find <wt> -user root` empty; commit
  `docs: reverse and cloze cards`. Hand over (finishing-a-development-branch menu); do not merge or push.

## Contract notes

Running list for item 7 (`docs/contracts/`); every file below is created by this plan:
- `docs/contracts/cards/card-ids.json` — card ids, `cardKey`s, virtual ids per kind (Task 1).
- `docs/contracts/cards/burying.json` — the burying predicate and `buriedNow` (Task 5); days precomputed,
  zone rules live in `docs/contracts/study-day/`.
- `docs/contracts/cards/cloze.json` — eligible sentences, blank spans (code points), rotation, prompt
  text (Task 7).
- Interaction with item 4b (`docs/superpowers/specs/2026-11-15-v030-vacation-and-limits-design.md`): burying
  removes cards **before** 4b's admission (`admit`), so a buried card never consumes a daily limit and
  is not counted as due; 4b's `isDueToday` replaces "due ≤ now" inside `buildQueue`, which this plan's
  pre-filter feeds unchanged. Fixtures of both must agree on that order (note for item 7).
- `docs/contracts/cards/README.md` — the rules: one cloze card per entry, sentence-independent ids,
  `deckcfg:<deckId>` row `{deckId, cardTypes, updatedAt, …unknown fields kept}`, `skipKinds` on vocab
  rows, mastery kinds (`vocab, sentence, writing, tone`), XP values, "old clients read unknown review
  modes as vocab and ignore unknown card kinds".

## Rulings added by this plan

- Ruling: the per-deck switch first appears on the `/study` deck rows (`DeckCardTypes`), and the decks
  view (3b) reuses the same component in deck settings — item 3 must be usable and testable on its own
  before 3b exists — cost if wrong: one more place to remove later.
- Ruling: if item 1 is not merged when Task 5 starts, the implementer stops — a stand-in UTC day would
  ship the very bug #84 fixes into burying — cost if wrong: a short wait.
- Ruling: no runner-level jsdom test for the 1,100-line session page; its new decisions are extracted
  into tested helpers and the cards have their own jsdom tests — cost if wrong: wiring bugs surface in
  review or the owner's hand check (listed in the handoff).

## Rulings added after the builder check

- Ruling: filters (switch off, skipped, buried) run **before** `buildQueue`/`buildLevelQueue` apply their
  limits — otherwise a disallowed card uses a slot and the session comes out short — cost if wrong: none.
- Ruling: one opt-in item per entry and session, reverse preferred, cloze when reverse cannot be
  planned — deterministic and never blocks a kind for more than a session — cost if wrong: cloze cards
  of words that also have reverse start a day later.
- Ruling: the home widget keeps its caps through `dueCounts(newLimit, reviewLimit)` and the setup summary
  keeps counting virtual companions — existing numbers stay identical — cost if wrong: none.
- Ruling: one `effectiveKinds` function decides which kinds count everywhere (remembered existing kinds +
  enabled, not unchecked opt-in kinds) — two memories would make the widget and the decks view disagree —
  cost if wrong: one function.
- Ruling: an Again re-show of a cloze card keeps its sentence and answer mode; the rotation advances only
  with recorded reviews — cost if wrong: none.
- Ruling: a failed segment request is transient (not remembered as ineligible) — cost if wrong: the word
  is checked again next session.
- Ruling: fixtures use item 1's loader and format (`readContract`, `{"version":1,"rule","cases"}`) —
  one contract convention for Android — cost if wrong: none.

## Rulings and deviations made while building (after #84, #86 and #57 were on `feature/v0.3.0`)

- Ruling: the learner's day is the existing `StudyDay` object (`studyDay: Pick<StudyDay, 'dayOf'>` in
  `buriedNow`, `studyDay?: StudyDay` in `deckSessionPlan`/`dueCounts`, UTC `studyDay([])` when absent),
  not a bare `dayOf` function, and there is no `readContract` loader: fixtures are imported as JSON like
  `levelQueue.test.ts` does, with rule names `cards/cardIds`, `cards/burying`, `cards/cloze` — one
  convention with the other contracts — cost if wrong: none.
- Ruling: `EntryLike` has no `glossCount`; reverse eligibility uses the existing optional `senses` list
  (`kind === 'word'` and at least one sense) — cost if wrong: none.
- Ruling: `deleteDeck` tombstones `deckcfg:<id>` only when the pull contained such a row (and still ignores
  a 404), so decks that never had a switch cause no extra request and the existing delete tests stay
  untouched — cost if wrong: none.
- Ruling: `StudyData.deckSettings` is absent (not `{}`) when a workspace has no `deckcfg:` row, so every
  existing `loadStudyData` result is byte-identical — cost if wrong: callers use `data.deckSettings ?? {}`.
- Ruling: after #57 the level planner has two paths (`buildWordPlan`, `buildCharacterPlan`);
  `excludeEntries` is applied in both. A word buried by a reverse/cloze answer is dropped as a whole
  entry (`buriedLevelEntries`: any buried vocab or writing card/key), which is exact because such an answer
  buries every kind of the word. `levelSessionItems` takes the `Buried` set as an optional 4th argument.
  Level sessions still never plan reverse or cloze themselves (`CHARACTER_KINDS` and word levels are
  unchanged) — cost if wrong: none.
- Ruling: `planCompanions` also takes `skip` (the ineligible memory) so the "cloze when reverse is
  remembered ineligible" preference is decided during planning; `deckSessionPlan` keeps its old post-filter
  for the legacy kinds, and the planner size is `cards.length * 5` — cost if wrong: none.
- Ruling: `ClozeChoice` ignores digit keys once it has an answer, without `preventDefault`; otherwise the
  runner could never grade with 1-4 after a pick, since it honours `defaultPrevented` — cost if wrong: none.
- Ruling: an Enter in an empty reverse field does nothing (only the Show answer button or Space/Enter
  outside the field reveals without an answer), so an accidental Enter never gives up the card — cost if
  wrong: one more click.
- Deviation: the next cloze item's segmentation is NOT prefetched. The runner loads an entry only when the
  item comes up, so there is nothing to segment earlier; the first showing of a cloze card waits for at
  most 8 parallel `POST /api/segment` calls (cached per sentence for the session) — cost if wrong: a short
  "Loading card…" before a cloze card; a prefetch would first need entry prefetching.
- Deviation: the new-kind tests live in `deckKinds.test.ts` (planning, burying in deck and level sessions)
  next to the existing ones instead of being appended to `companions.test.ts`/`levelQueue.test.ts`.
- Deviation: no Go was changed, so the full Go gate was not run for this branch (rule: only if Go changed).
- Interfaces for the decks view (#90): `effectiveKinds(remembered, enabled, choices)`,
  `defaultExtraTypes`, `loadExtraChoices` (`lib/study/cardTypesMemory.ts`); `enabledKinds(settings, deckIds)`,
  `parseDeckSettings`, `DeckSettings` (`lib/study/deckSettings.ts`); `saveDeckCardTypes` and the
  `deckcfg:<deckId>` rows (`StudyData.deckSettings`); `DeckCardTypes.svelte` (per-deck switches);
  `dueCounts` (`lib/study/dueCounts.ts`, accepts `scheduleOf`); `dropSiblingCards`, `skipKind`,
  `unskipKind` (`store.ts`; undo = `restoreCards(rows)` without `onlyLive`); `buriedNow`,
  `answeredEntriesToday`, `buries` (`siblings.ts`); `MASTERY_KINDS`, `cardScore` (`mastery.ts`);
  `allowedReal`, `skipKindsByEntry` (`cardFlow.ts`).

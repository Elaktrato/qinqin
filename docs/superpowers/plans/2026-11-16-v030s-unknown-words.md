# Unknown Words and Text Coverage in the Reader (issue #68) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (fresh implementer
> per task or per few tasks, independent review on the strongest model, one fix wave, whole-branch review).
> Steps use checkbox (`- [ ]`) syntax. Strictly test-first: write the test, run it, SEE IT FAIL, implement,
> see it pass.

**Goal:** The reader marks words new / learning / known (toggle), shows chapter and book coverage with a
list of the most frequent unknown words, adds all or selected unknown words to a deck in one click, and
offers a manual "I know this word" mark that creates no card — on one known predicate shared with smart
hiding (#78) and starter decks (#75).

**Architecture:** Web only, plus one Go change in the backup remap. Pure modules: `study/known.ts`
(extended: `KnownIndex`, `familiarity`), `study/knownMarks.ts` (rows), `plugins/reader/wordRanges.ts`
(per-paragraph state ranges), `plugins/reader/coverage.ts` (tally, coverage, unknown list),
`plugins/reader/bookCounter.ts` (on-demand whole-book tally), `plugins/reader/wordActions.ts` (add and mark
plans). `ReadingsController` becomes the single per-chapter match source. Thin UI: Display toggle, rendered
classes, a Words rail tab, a popup toggle. Rows: new key `known:<entryId>`; setting `reader.highlightWords`.

**Tech stack:** SvelteKit 2 / Svelte 5, vitest (unit + jsdom); Go 1.26 (`GOTOOLCHAIN=auto`) for the backup
package. No new dependencies. No new route, no migration.

**Spec (binding, incl. Rulings):** `docs/superpowers/specs/2026-11-16-v030s-unknown-words-design.md`.

**Branch / worktree:** `feature/v030s-unknown-words` at `.claude/worktrees/unknown-words` (`<wt>`).
**Requires:** #75 (`feature/v030s-frequency-decks`, provides `study/known.ts` and `frequency/known.json`)
and #77 (notes) merged into `feature/v0.3.0-stretch`. Before Task 1 (it edits `frequency/known.json`): `git merge --no-ff
feature/v0.3.0-stretch` into this branch (or rebase the docs commit onto it — never rewrite pushed history)
and check that `known.ts` still has the `knownEntries(cards, scheduleOf)` shape quoted in the spec; if #75's
fix wave changed it, adapt Task 2's signatures and note it in the Execution record.

## Gates

- Web: `npm --prefix <wt>/apps/web ci` once; per task `npm --prefix <wt>/apps/web run check`, targeted
  `cd <wt>/apps/web && npx vitest run <paths>`, and on UI tasks also `npm --prefix <wt>/apps/web test` and
  `run build`; read the exit codes (never behind `| tail`). Before the last commit the full vitest with
  Node 26: `cd <wt>/apps/web && PATH=/home/user/qq-tools/node-v26.13.1-linux-x64/bin:$PATH npx vitest run`.
- Go (Task 4 and the final run), proxy variables unset, under the shared lock:
  `cd <wt>/server && flock /tmp/qinqin-go.lock env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy -u NO_PROXY -u no_proxy GOTOOLCHAIN=auto GOFLAGS=-buildvcs=false sh -c 'gofmt -l . ; go vet ./internal/backup/... && go test -count=1 -p 2 -timeout 30m ./internal/backup/...'`;
  `gofmt -l` prints nothing. ONE full `./...` run before the branch's last commit (known environment
  failure: only `internal/ai` `TestHostnameResolvingToEmbeddedFormIsRefused`). No `-race` (no concurrency
  change).
- No route changes: the route walk, PWA route fixture and `docs/wiki/API-Routes.md` must stay untouched;
  if any of them changes, stop and explain.
- One commit per task, explicit `git add`, conventional message ending with a blank line and exactly
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push, merge (except the base merge above)
  or tag. `git status` clean after every task.

## Global constraints

- `Familiarity = 'new' | 'learning' | 'known'`; per match by `entries[0].id`. known = mark, or best reviewed
  vocab `cardScore ≥ threshold`; learning = a live vocab card; else new.
- Reader threshold = `display.smartThreshold`; everyone else `MASTERY_THRESHOLD` (80). The mark ignores
  thresholds. Decks view numbers ignore marks.
- Row `known:<entryId>`, plugin `qinqin-flashcards`, workspace-scoped, `{version:1, entryId, createdAt}`,
  key number = `entryId` (positive integer), unmark = tombstone.
- Setting `reader.highlightWords: boolean`, default `false`; unknown keys kept on write.
- Token = match with a word character (zh: `\p{Script=Han}` or 々〆; ja: that or hiragana/katakana other than
  a lone `ー`); unmatched = maximal word-character runs outside matches; coverage = `floor(100·known/tokens)`,
  `null` without tokens; book = summed counts; list = not-known types by count desc, then first occurrence
  `(chapter, paragraph, start)`.
- Matches: one `ReadingsController` per book page, always `readings: true`, LRU 6 keyed
  `bookId:chapter:variant`; states and coverage never trigger a request.
- Only new and learning words get classes; nothing inside a user highlight.

## Review Focus

1. **One definition of known:** reader colour, smart hiding and starter-deck skipping call the same
   `familiarity`/`isKnownEntry`; the reader passes `smartThreshold` to both of its uses; the existing
   `smart-readings.json` and `frequency/known.json` cases pass unchanged (Tasks 2, 5).
2. **No change with the feature off:** `highlightWords: false` and the Words panel closed → no extra
   requests, no extra DOM pieces, every existing reader test unchanged (Tasks 7–9).
3. **DOM contract:** `dom.ts` selection offsets identical with and without state classes, inside ruby,
   across runs, next to highlights (Task 8).
4. **Coverage rule:** tokens vs unmatched, floor, book = summed counts, ties in the list (Task 10).
5. **Writes:** add twice writes nothing; mark/unmark tombstones exactly the selected keys; bulk writes in
   200-row pushes with `dataSkipped` treated as failure; the book's workspace, never the current one when
   they differ (Tasks 3, 12, 14).
6. **Backup:** `known:` rows exported with their entry ref, remapped on restore, dropped when unresolved
   (Task 4).

---

### Task 1: Contract fixtures and READMEs

**Files:** Create `docs/contracts/reader/word-states.json`, `docs/contracts/reader/coverage.json`; modify
`docs/contracts/reader/README.md` (sections "Word states and the manual mark", "Coverage"; link
`frequency/` for the shared predicate), `docs/contracts/reader/smart-readings.json` (cases with `marks`),
`docs/contracts/reader/display-settings.json` (`highlightWords` in `defaults`, in every `expect`, plus cases:
`true` kept, `"yes"` falls back to `false`), `docs/contracts/backup/remap.json` (cases: `known:41` with
entry 41 → 1041 becomes `known:1041` with `entryId: 1041`; unresolved entry dropped; a `known:` row whose key
number differs from `entryId` is restored unchanged), `docs/contracts/backup/README.md` (remap sentence),
`docs/contracts/overview.md` (row-key table: `known:<entryId>`; `reader` settings shape gains
`highlightWords`), `docs/contracts/frequency/known.json` and `frequency/README.md` (cases with `marks`: a
marked entry without card is known; a marked entry with a low score is known; an unmarked tombstone is not).

`word-states.json` shape:
```json
{"version":1,"rule":"reader/word-states","threshold":80,
 "cases":[{"name":"…","entries":[3,1],"scores":{"1":90},"carded":[1,3],"marks":[],"threshold":80,"expect":"learning"}],
 "rowCases":[{"name":"…","key":"known:12","data":{"version":1,"entryId":12,"createdAt":"2026-11-16T00:00:00.000Z"},"expect":12}]}
```
Cases: mark without card → known; mark beats score 10 → known; score = threshold → known; threshold − 1 with
card → learning; unreviewed card → learning; nothing → new; second candidate mastered → by the first;
custom threshold 60; non-vocab cards excluded (via `carded` built from vocab only — say so in the README).
Row cases: valid; key number ≠ `entryId` → null; `known:0`, `known:-3`, `known:1.5`, `known:abc` → null;
missing `version` → null; extra fields kept irrelevant → valid.

`coverage.json` shape: `{lang, paragraphs: string[], matches: SegmentMatch-like[][], states: {entryId:
state}, expect: {tokens, known, learning, new, types: {new, learning}, unmatched, percent, unknown:
[{entryId, count}]}}`. Cases: zh punctuation and digits excluded (`你好，2024年。`); Latin match excluded; Han
numeral counted; ja kana-only particle counted, lone `ー` not a word character; an unmatched Han run counted
once; two paragraphs, one entry inflected twice → one type count 2; floor (`7 of 8` → 87); no tokens →
`percent: null`; ties in the list by first occurrence; astral Han character outside matches counts as one
unmatched run; book case: two chapters summed, not averaged (`1/1` and `1/9` → 20, not 55).

- [ ] **Step 1:** Write the fixtures and READMEs (hand-computed expectations, each case a one-line
  `name` saying the rule it pins). **Step 2:** `node -e` parse every touched JSON file; existing decoding
  tests (`smartReadings.test.ts`, `displaySettings.test.ts`, `remap_test.go`, #75's `known.test.ts`) are
  expected to FAIL now on the new cases — run them and record which fail. **Step 3:** Commit
  `docs(contracts): word states, coverage and known mark fixtures`.

### Task 2: `study/known.ts` — `KnownIndex` and `familiarity`

**Files:** Modify `apps/web/src/lib/study/known.ts`, `known.test.ts`; create
`apps/web/src/lib/study/wordStates.contract.test.ts` (decodes `reader/word-states.json` `cases`).

**Interfaces:**
```ts
export type Familiarity = 'new' | 'learning' | 'known';
export interface KnownIndex {
	scores: ReadonlyMap<number, number>; // entry -> best cardScore of reviewed vocab cards
	carded: ReadonlySet<number>;         // entries with a live vocab card
	marks: ReadonlySet<number>;          // manual known marks
}
export const EMPTY_KNOWN_INDEX: KnownIndex;
export function knownIndex(cards: readonly StudyCard[], scheduleOf: (cardId: string) => Pick<Schedule, 'stability'> | null, marks?: Iterable<number>): KnownIndex;
export function familiarity(entryId: number, index: KnownIndex, threshold = MASTERY_THRESHOLD): Familiarity;
export function isKnownEntry(entryId: number, index: KnownIndex, threshold = MASTERY_THRESHOLD): boolean;
export function knownEntries(cards, scheduleOf, marks?: Iterable<number>): Set<number>; // #75 shape kept
```
- [ ] **Step 1: Failing tests:** `word-states.json` cases; `frequency/known.json` incl. the new mark cases;
  `knownEntries` without marks equals its #75 result on the old cases. **Step 2:** FAIL. **Step 3:**
  Implement; `knownEntries` = `isKnownEntry` over `knownIndex`. Keep the header rule ("extend, never fork").
  **Step 4:** gates PASS (incl. #75's starter-deck tests). **Step 5:** Commit
  `feat(study): word familiarity with the manual known mark`.

### Task 3: `known:` rows in the study store

**Files:** Create `apps/web/src/lib/study/knownMarks.ts`, `knownMarks.test.ts`; modify
`apps/web/src/lib/study/store.ts` (+ `store.test.ts`), `apps/web/src/lib/study/types.ts`.

**Interfaces:**
```ts
export const KNOWN_PREFIX = 'known:';
export interface KnownMarkRow { version: 1; entryId: number; createdAt: string }
export function parseKnownMark(key: string, raw: unknown): number | null;   // entry id
export function knownMarkRow(entryId: number, now: Date): { key: string; data: KnownMarkRow };
// store.ts
StudyData.known?: number[]                       // absent without live rows
export async function setKnownMark(workspaceId: number, entryId: number, on: boolean): Promise<void>; // PUT or DELETE
export async function setKnownMarks(workspaceId: number, entryIds: readonly number[], on: boolean, opts?): Promise<void>; // pushStudyRows
pushStudyRows rows gain `deleted?: true` -> `deletedAt` = the stamp, `data` = the last value or `{}`
```
- [ ] **Step 1: Failing tests:** `rowCases` of `word-states.json`; `fetchStudyData` collects live marks of
  the workspace only (other workspace, other plugin, tombstone ignored) and leaves `known` absent without
  rows (existing equality tests unchanged); `setKnownMark` PUTs/DELETEs `known:<id>` with `workspace=<id>`
  and notifies `onStudyWrite`; `setKnownMarks` sends 450 ids as 200/200/50 with `deletedAt` for `on:
  false`; a response with `dataSkipped: 1` throws `PartialPushError`. Read `server/internal/sync/sync.go`
  (deletedAt ordering, ~line 160–260) and name in the test comment the Go test that covers a pushed
  tombstone; if none exists add one in `server/internal/sync` (then this task also runs the Go gate for
  `./internal/sync/...`). **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** gates PASS. **Step 5:**
  Commit `feat(study): manual known marks as plugin rows`.

### Task 4: Go — backup export and restore of `known:` rows

**Files:** Modify `server/internal/backup/remap.go` (`PluginRow`: `known:` prefix — when the key number
equals `data.entryId`, rewrite both through the entry map, drop when unresolved; otherwise unchanged),
`server/internal/backup/export.go` (`writePluginData`: note the entry of a `known:` row in `refs`),
`server/internal/backup/plan.go` (dropped `known:` rows count in `Unresolved.DroppedRows`),
`remap_test.go`, `export_test.go` (or the existing export test file).

- [ ] **Step 1: Failing tests:** the new `remap.json` cases; an export with a `known:` row lists its entry
  in `refs/entries.json`; a dry-run report counts a dropped `known:` row. **Step 2:** FAIL (Go gate above).
  **Step 3:** Implement (a `knownKeyPrefix` const beside `cardKeyPrefix`). **Step 4:** Go gate PASS.
  **Step 5:** Commit `feat(backup): remap manual known marks on restore`.

### Task 5: Smart hiding through the shared predicate

**Files:** Modify `apps/web/src/lib/plugins/reader/smartReadings.ts`, `smartReadings.test.ts`,
`readings.svelte.ts`, `BookView.svelte` (index building only).

- `MasteryIndex` becomes `KnownIndex`; `isKnown(match, index, threshold)` = `isKnownEntry(entries[0].id,
  index, threshold)`; `masteryIndex` is removed (callers use `knownIndex`), so there is one score loop.
- BookView: the index loads when `readings === 'smart' || highlightWords || wordsPanelOpen` (Task 9 adds
  `highlightWords`, Task 13 the open panel; here only smart), from `loadStudyHistory` (cards, schedules) plus `data.known`.
- [ ] **Step 1: Failing tests:** the new `marks` cases of `smart-readings.json` (a marked word with no card
  is concealed; a marked first candidate conceals, a marked second candidate does not); old cases decode
  with `scores` → `KnownIndex{scores, carded: ∅, marks: ∅}`. **Step 2:** FAIL. **Step 3:** Implement.
  **Step 4:** gates PASS (`npx vitest run src/lib/plugins/reader`). **Step 5:** Commit
  `refactor(reader): smart hiding uses the shared known predicate`.

### Task 6: Setting `highlightWords` and the Display panel

**Files:** Modify `apps/web/src/lib/plugins/reader/displaySettings.ts` (+ test), `DisplayPanel.svelte`,
`DisplayPanel.dom.test.ts`.

- [ ] **Step 1: Failing tests:** `display-settings.json` (all cases incl. new ones); `displayPatch` writes
  `highlightWords` and keeps unknown keys; jsdom: checkbox "Mark words by how well I know them" sends
  `{highlightWords: true}`; legend with "New: solid underline", "Learning: dotted underline" shown when on;
  threshold slider visible with readings `never` + highlighting on, hidden with both off; slider text "A
  word counts as known from a memory score of 80". **Step 2:** FAIL. **Step 3:** Implement. **Step 4:**
  gates PASS incl. `test` and `build`. **Step 5:** Commit `feat(reader): word highlighting setting`.

### Task 7: `wordRanges.ts` and the paragraph plan

**Files:** Create `apps/web/src/lib/plugins/reader/wordRanges.ts`, `wordRanges.test.ts`; modify
`chapterPlan.ts`, `chapterPlan.test.ts`.

**Interfaces:**
```ts
export interface WordRange { start: number; end: number; state: 'new' | 'learning' }
export function wordRanges(matches: readonly SegmentMatch[], index: KnownIndex, threshold: number, lang: string): WordRange[];
// chapterPlan
planParagraph(runs, drawn, pieces, showBookRuby, words?: readonly WordRange[])
PlanSeg.word?: 'new' | 'learning'; PlanSeg.wordEnd?: boolean
```
- `wordRanges`: tokens only (the coverage word-character rule, shared helper `isWordToken(surface, lang)`
  exported from `coverage.ts`'s future home — put it in `wordRanges.ts` now and let Task 10 import it);
  known words produce nothing.
- `planParagraph`: word edges become cuts only where the range is clear of every drawn highlight; each seg
  inside a range carries `word`; the last seg of a range carries `wordEnd`. Without `words` the output is
  identical to today (deep-equal test over the existing cases).
- [ ] **Step 1: Failing tests:** ranges per state; known skipped; punctuation match skipped; plan with a
  ja reading piece inside a new word (`食べました`: ruby seg 食 + seg べました both `new`, only the last has
  `wordEnd`); a word across two runs; a highlight over half a word drops that word's classes; no `words` →
  unchanged plan. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** gates PASS. **Step 5:** Commit
  `feat(reader): word state ranges in the paragraph plan`.

### Task 8: Rendering the states

**Files:** Modify `apps/web/src/lib/plugins/reader/ChapterText.svelte` (prop `words?: ReadonlyMap<number,
WordRange[]>`; class `w-new` / `w-learning` and `w-end` on the existing `<span data-o>` / `<ruby>` piece;
CSS tokens `--word-new`, `--word-new-line`, `--word-learning`, `--word-learning-line` for light and dark;
the gap via `background-size: calc(100% - 0.12em)` on `.w-end`; `@media (forced-colors: active)` fallback to
`text-decoration`), `ChapterText.dom.test.ts`, `dom.dom.test.ts`.

- [ ] **Step 1: Failing tests:** jsdom: classes on the right pieces, none for known words, none inside a
  `mark[data-h]`; `selectionSpan`/`rangeForSpan` round trips give identical offsets with and without
  `words` (plain run, generated ruby, book ruby run, next to a highlight); the `<rt>` text is never inside a
  word class's text node offsets. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** gates PASS incl.
  `test` and `build`. Note in the Execution record that the underline contrast was computed from the token
  colours (3:1), not seen in a browser. **Step 5:** Commit `feat(reader): draw new and learning words`.

### Task 9: One match source for readings, states and coverage

**Files:** Modify `apps/web/src/lib/plugins/reader/readings.svelte.ts`, `readings.test.ts`,
`BookView.svelte`, `BookView.dom.test.ts`.

**Interface changes:**
```ts
ReadingsInput.want: { readings: boolean; words: boolean }   // words = highlightWords (Task 13 adds || wordsPanelOpen)
ReadingsController.matches: ReadonlyMap<number, SegmentMatch[]>   // $state.raw, per paragraph
ReadingsController.progress: { done: number; total: number }      // paragraphs with text
ReadingsController.words: ReadonlyMap<number, WordRange[]>        // empty unless want.words && highlightWords
update(display, index, want)
```
- The controller stops only when neither is wanted; readings `never` with words wanted keeps loading but
  yields book-ruby pieces only (the `never` rule of `annotateParagraph`). The segment function is always
  `segmentWithReadings`.
- BookView: index and matches wanted as in Task 5 plus `highlightWords`; pass `words` to `ChapterText`.
  (Task 13 adds `wordsPanelOpen` = rail tab `words` shown and open, to both conditions.)
- [ ] **Step 1: Failing tests:** controller with a fake segment: readings never + words → requests made,
  `pieces` holds only book pieces, `words` filled; neither → no request; switching readings on after words
  → no new request (same key); `update` with a new index recomputes `words` without a request; progress
  counts paragraphs. jsdom BookView: highlighting off and panel closed → the fake segment is never called.
  **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** gates PASS incl. `test`, `build`. **Step 5:** Commit
  `feat(reader): load chapter matches for word states`.

### Task 10: `coverage.ts`

**Files:** Create `apps/web/src/lib/plugins/reader/coverage.ts`, `coverage.test.ts`.

**Interfaces:**
```ts
export interface TypeTally { entryId: number; count: number; lemma: string; reading?: string; first: { chapter: number; p: number; start: number } }
export interface ChapterTally { types: Map<number, TypeTally>; tokens: number; unmatched: number }
export function tallyChapter(chapter: number, lang: string, texts: readonly string[], matches: ReadonlyMap<number, readonly SegmentMatch[]>): ChapterTally;
export function mergeTallies(tallies: Iterable<ChapterTally>): ChapterTally;
export interface Coverage { tokens: number; known: number; learning: number; new: number; types: { new: number; learning: number }; unmatched: number; percent: number | null }
export function coverageOf(tally: ChapterTally, stateOf: (entryId: number) => Familiarity): Coverage;
export function unknownList(tally: ChapterTally, stateOf: (entryId: number) => Familiarity): (TypeTally & { state: 'new' | 'learning' })[];
```
- [ ] **Step 1: Failing tests:** every `coverage.json` case; a timing test builds 30 000 synthetic matches
  over 300 paragraphs, runs tally + coverage + list, asserts < 1 000 ms (loose, never flaky) and prints the
  measured time (`console.info`) for the Execution record (budget 50 ms). **Step 2:** FAIL. **Step 3:**
  Implement (single pass, no per-token allocation beyond the map entry). **Step 4:** gates PASS.
  **Step 5:** Commit `feat(reader): text coverage rule`.

### Task 11: `bookCounter.ts` — on-demand whole-book tally

**Files:** Create `apps/web/src/lib/plugins/reader/bookCounter.ts`, `bookCounter.test.ts`.

**Interface:**
```ts
export function createBookCounter(opts: {
	getChapter: (n: number, signal: AbortSignal) => Promise<{ paragraphs: Run[][] }>;
	segment: SegmentFn; displayRuns: (p: Run[]) => Run[]; lang: string; concurrency?: number;
}): {
	tallies: ReadonlyMap<number, ChapterTally>;      // by chapter, for one key prefix bookId:variant
	put(n: number, tally: ChapterTally): void;       // the open chapter's tally from the reader
	count(chapters: number, onProgress: (done: number, total: number) => void): Promise<{ failed: number[] }>;
	abort(): void;
};
```
- Uses `chunkParagraphs`/the same segment fn; skips chapters already tallied; a failed chapter is listed and
  retried by the next `count`; abort stops further requests; the BookView owner recreates it on variant
  change.
- [ ] **Step 1: Failing tests** (fakes): 3 chapters → 3 tallies, progress 1..3; a pre-`put` chapter is not
  fetched; a failing chapter in `failed` and retried next time; abort mid-way → no request after abort;
  never more than `concurrency` segment calls in flight. **Step 2:** FAIL. **Step 3:** Implement.
  **Step 4:** gates PASS. **Step 5:** Commit `feat(reader): count the words of a whole book`.

### Task 12: `wordActions.ts` — add and mark plans

**Files:** Create `apps/web/src/lib/plugins/reader/wordActions.ts`, `wordActions.test.ts`.

**Interfaces:**
```ts
export async function addWords(o: { workspaceId: number; entryIds: readonly number[]; target: { id: string; name: string };
	now: Date; bases: (ids: number[]) => Promise<EntryBase[]>; raw: () => Promise<{ decks; cards; knownAt }>;
	push: typeof pushStudyRows }): Promise<{ created: number; joined: number; skipped: number; missing: number }>;
export async function markWords(o: { workspaceId: number; entryIds: readonly number[]; on: boolean; set: typeof setKnownMarks }): Promise<{ undo: () => Promise<void> }>;
export function allNew(list: readonly { entryId: number; state: 'new' | 'learning' }[]): number[];
```
- `addWords`: bases in chunks of 500 (`api/entryBases.ts`), items in the given order with `written` from
  the base (entries the server no longer has are counted `missing` and skipped), `planAddToDeck` +
  `addPlanRows` + `push`; `existingDeck` from the raw decks.
- [ ] **Step 1: Failing tests:** order preserved in `createdAt`; a learning word joins; a second call with
  the same input writes nothing (`push` not called or called with zero rows — pick "not called");
  General target writes no deck row; `markWords` undo tombstones exactly the marked ids; `allNew` keeps
  list order and drops learning. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** gates PASS.
  **Step 5:** Commit `feat(reader): add and mark unknown words in bulk`.

### Task 13: The Words rail tab

**Files:** Create `apps/web/src/lib/plugins/reader/WordsPanel.svelte`, `WordsPanel.dom.test.ts`,
`apps/web/src/lib/plugins/reader/wordsPanel.ts` (+ test: view model — figures text, list paging 50, selection
set, button labels and counts); modify `railState.ts` (+ test: `RailTab` gains `words`, stored value kept),
`ReaderRail.svelte`, `BookView.svelte` (`wordsPanelOpen` joins the match and index conditions of Tasks 5
  and 9; the open chapter's tally is `put` into the book counter).

- Texts: "You know 87% of the words in this chapter", "1,234 of 1,420 words · 46 different new words · 12
  learning", "3 passages are not in the dictionary", "Counting… 5 of 12 parts", "Some parts could not be
  counted. Try again", Book: "Count the whole book" → "Chapter 12 of 40" (Cancel) → "You know 82% of the
  words in this book"; list scope radio "This chapter / Whole book" (book only after counting); rows:
  checkbox labelled by the lemma, reading, `×12`, chip "New"/"Learning"; deck select (General first, then
  decks by `createdAt`); buttons "Add selected (N)", "Add all new words (M)", "I know these (N)"; result
  line with Undo for marks; errors via `apiErrorMessage`. Numbers with `toLocaleString`.
- Coverage figures are hidden for languages other than `zh`/`ja` ("Word counts are available for Chinese
  and Japanese books").
- [ ] **Step 1: Failing tests:** view model; jsdom with fakes: progress then figure; selection and both add
  buttons call `addWords` with the right ids and deck; "I know these" then Undo; book count progress and
  cancel; keyboard: every control reachable, the list is a `<ul>` of labelled checkboxes. **Step 2:** FAIL.
  **Step 3:** Implement. **Step 4:** gates PASS incl. `test`, `build`. **Step 5:** Commit
  `feat(reader): words panel with coverage and unknown words`.

### Task 14: "I know this" in the popup

**Files:** Modify `apps/web/src/lib/plugins/reader/AddToStudyButtons.svelte`,
`AddToStudyButtons.dom.test.ts`; `EntryCard.svelte` only if the state line needs a slot.

- Toggle button "I know this" (`aria-pressed`), initial state from `getStudyData(ws).known`; click →
  `setKnownMark(ws, entryId, !pressed)`; failure restores the state and shows the error; the state line
  ("New word" / "Learning" / "Known — memory score 85" / "Known — marked by you") only when
  `highlightWords` is on (passed down as a prop).
- [ ] **Step 1: Failing tests:** pressed state from data; click writes `known:<id>` in the book's workspace
  (not the current one when they differ); second click tombstones; error path; state line texts.
  **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** gates PASS incl. `test`, `build`. **Step 5:**
  Commit `feat(reader): mark a word as known from the popup`.

### Task 15: Docs, wiki, README and the real-app check

**Files:** Modify `docs/wiki/Reader.md` (sections "Word highlighting", "Words panel and coverage", "I know
this word"; the coverage definition in two sentences), `docs/wiki/Your-data.md` (known marks are synced,
in the backup, remapped on restore), `docs/wiki/Flashcards-decks-limits-vacation.md` (starter decks skip
words marked known), `README.md` (reader feature list), `docs/contracts/reader/README.md` ("Real-app
check" results and Android notes: same row, same predicate, same coverage rule), `docs/ROADMAP.md` only if
it lists #68 under planned work (the orchestrator closes the issue).

- [ ] **Step 1: Real-app check (no browser):** scratch copy in your scratchpad, build the web app and the
  server with the embedded build, seed `cedict` + `hsk-words` and `jmdict`, run on a free 127.0.0.1 port
  (never 8080, 8085, 8300). curl/Python: two users; a zh workspace and book of ~30 000 code points (built
  from public-domain text already in the repo's fixtures or generated from CC-CEDICT headwords); time one
  4 000-code-point `POST /api/segment {readings:true}` (budget 400 ms) and the 8 chunks with 2 in flight
  (budget 2 s); feed the real matches to `tallyChapter`/`coverageOf` through a temporary vitest file in the
  scratch copy only (never committed) and record the figure and time; push `known:` rows for 3 entries and a
  tombstone for one via `POST /api/sync/push`, pull and see 2 live; user B sees none and cannot push into
  A's workspace (404); export A's backup, check `refs/entries.json` lists the 3 entries, restore it on the
  same server and see the 2 live marks. Kill the server, delete the scratch copy.
- [ ] **Step 2:** Full Go gate `./...`, web `check`/`test`/`build`, Node 26 full vitest, `git status` clean.
  **Step 3:** Commit `docs: unknown words and coverage`.

## Task dependencies

1 → 2 → 3 → (4 ∥ 5); 5 → 6 → 7 → 8 → 9; 7 → 10 → 11; 3, 10 → 12 → 13; 3, 9 → 14; all → 15. Task 4 (Go) can
run beside Tasks 5–8.

## Contract notes (for `docs/contracts/`)

- `reader/word-states.json` (Tasks 2, 3), `reader/coverage.json` (Task 10), `reader/smart-readings.json`
  marks cases (Task 5), `reader/display-settings.json` `highlightWords` (Task 6), `frequency/known.json`
  marks cases (Task 2), `backup/remap.json` `known:` cases (Task 4, Go).
- `overview.md` row-key table gains `known:<entryId>`; `docs/contracts/README.md` needs no new folder row
  (reader exists) — update its description of `reader/` to name the two new fixtures.
- Android: same row and parse rule, same predicate with the reader's threshold, same token rule and floor,
  first candidate only.

## Execution record

Built 2026-11-16 by one implementer (no subagent review wave ran inside this build; the orchestrator
reviews). Base: `git merge --no-ff feature/v0.3.0-stretch` (2d76e55, brings #67, #75, #77), then one
commit per task, 5907cc7 … this commit.

### Adaptations to the merged code

- #75's `knownEntries(cards, scheduleOf)` was unchanged; it gained an optional third `marks` argument and
  is now `isKnownEntry` over `knownIndex` (Task 2). `scheduleOf` accepts `Pick<Schedule, 'stability'>`.
- Starter decks actually skip marked words: `decksData.svelte.ts` keeps `data.known` and
  `StarterDeckDetail.svelte` passes it to `knownEntries` (Task 3; the plan named no file for it), with a
  jsdom test.
- Backup (Task 4) follows #77's final structure instead of a separate path: `entryKeyedID` /
  `entryKeyedPrefix` recognise `qinqin-core note:` and `qinqin-flashcards known:` rows alike; the
  canonical-key and JSON-integer `entryId` checks, the winner pre-pass (`RegisterNote`, slot now keyed
  by row kind so a note and a mark on one entry never compete) and the export ref are shared.
  Ruling: invalid `known:` rows (key not canonical, `entryId` missing, a string or different, `data` not
  an object) are dropped on restore and counted in `droppedRows`, as #77 does for notes — the plan's
  fixture case "restored unchanged" became "dropped" — cost if wrong: a hand-made row is lost on restore.
  Ruling: two archive marks landing on one target keep one row (newest), never a blocking collision —
  cost if wrong: none, both mean the same. No per-entry `knownMarks` counter was added to the dry-run
  report (its shape is unchanged); dropped marks show in `droppedRows` only.
- Web parse of a mark additionally requires `version: 1` (fixture case "missing version"); the Go remap
  does not check `version` (as for notes). A version-less row is therefore ignored by the web but
  restored by a backup.

### Deviations and rulings while building

- Task 1 committed contract cases whose decoding tests fail until Tasks 2–6 (as the plan designs it):
  between Task 1 and Task 6 `displaySettings.test.ts` (15 contract cases) failed; every other task gate
  was green.
- Task 3: `setKnownMark(ws, id, false)` tolerates a 404 (nothing to unmark). `pushStudyRows` rows take
  `deleted: true` → `deletedAt` = the row's stamp. The server side of a pushed tombstone is covered by
  `sync_test.go` `TestPushEventsAndLWW` and `sync_review_test.go` `TestPushLWWUsesClientEditTime`; no new
  Go test. A tombstone for a row the server does not hold is `dataSkipped` (so a `PartialPushError`).
- Task 6: the word-state colour tokens and classes (`--word-new`, `--word-new-line`, `--word-learning`,
  `--word-learning-line`, `.w-new`, `.w-learning`, `.w-end`, forced-colours fallback) live in `app.css`,
  not in `ChapterText.svelte`: the Display legend draws the same samples.
- Task 9: `ReadingsInput.want` and `update(…, want)` are optional (default: readings unless `never`,
  words when highlighting is on), so existing callers are unchanged. BookView tracks the two booleans,
  not an object, so a display change that keeps them does not restart a load; switching readings on with
  highlighting already on only re-applies the rule (tested: no new request).
- Task 11 ruling: a chapter with any failed chunk is not tallied and is listed in `failed` (retried by the
  next count) — a partial tally would understate the book — cost if wrong: one failed request costs that
  chapter's figure until the retry.
- Task 12: `bases` is `loadEntryBases` (a Map; it already chunks by 500 with 2 in flight) instead of an
  `EntryBase[]` function. `markWords` takes the live marks and writes only ids whose mark changes, so its
  Undo never unmarks a word marked earlier and never sends a tombstone the server would skip.
- Task 13: the rail state block moved above the display section of `BookView.svelte` (the index and match
  conditions read `wordsPanelOpen`). `ReadingsController.key` was added so the panel never tallies a
  previous chapter's matches. The Words tab shows for every book; for languages other than zh/ja it says
  "Word counts are available for Chinese and Japanese books".
- Task 14: "I know this" is shown in every popup that has a workspace, whatever the highlighting setting;
  the state line only with highlighting on. The `stateLine` prop is threaded BookView → PopupStackView →
  PopupFrameView → EntryCard → AddToStudyButtons; that plumbing is type-checked but has no dedicated test.

### Test-first notes

Every task's tests were run and seen failing before the implementation (missing module, missing export
or wrong result), then passing — with these exceptions: `wordsPanel.ts` (Task 13) was written before its
test was run; the failure was then shown by moving the module away; the `readings.key` assertion
(Task 13) and the `dom.dom.test.ts` hand-markup case (Task 8, `dom.ts` ignores classes) passed at once.
Two real bugs were caught by the new tests: Undo in the Words panel (cleared before use) and a Go test
that used a valid row as its "invalid" example.

### Measured budgets

The build machine has 4 cores shared with two other builders; load average was 4–9 during the checks.

| Step | Budget | Measured |
| --- | --- | --- |
| one 4 000-code-point chunk, `readings: true` (real server, round trip) | ≤ 400 ms | 393–548 ms, median 427 ms at load 3.3; 559–868 ms at load 9 (without `readings`: 680–820 ms at load 9 — segmentation, not the overlay, is the cost) — **not met** |
| 30 082-code-point chapter, 8 chunks, 2 in flight | ≤ 2 s | 5.1–5.6 s (3 runs, load 9) — **not met on this machine** |
| states + coverage + list, 30 000 synthetic tokens (vitest, Node 22) | ≤ 50 ms | 14–19 ms (3 runs); recompute from a kept tally 0.1 ms |
| same, on the real matches of the 30 082-cp text (12 617 tokens, 5 245 types) | ≤ 50 ms | 13.3 ms; recompute 3.2 ms |
| whole-book count, 10 × 30 082 code points, 2 in flight | ≤ 60 s | 56.4 s (load 5 → 4) |

Reproducible: `coverage.test.ts` prints its timing (`--reporter=verbose`); the server timings came from a
Python driver against the real-app server (not committed). The segment route itself is #78's and was not
changed here; the miss is recorded, not fixed (a server-side speed-up of `/api/segment` is outside #68).

### Real-app check (API only, no browser)

`git archive HEAD` into the scratchpad, `go build ./cmd/qinqin` (bare build, no embedded UI), `seed` with
`cedict`, `hsk-words`, `jmdict`; users alice (admin) and bob with random passwords on stdin (0 hits for
either in the server log); `serve` on 127.0.0.1:18761. A Python driver (`python3 -I`): zh workspace; a
30 082-code-point text from CC-CEDICT headwords in 8 chunks (timings above); `known:` rows for 3 entries
pushed (`dataAccepted: 3`), one tombstoned by a `deletedAt` push (`dataAccepted: 1`); the full pull shows
exactly the 2 live marks; bob's pull has none, bob's push and PUT into alice's workspace are 404; export:
the 2 live marks in `plugin-data/`, both entries in `refs/entries.json` (the tombstoned mark is not
exported, so its entry is not referenced — the plan expected 3); restore on the same server: ready, no
blocking, `droppedRows: 0`, apply → done, the 2 marks back with the same keys. The real matches were fed to
`tallyChapter`/`coverageOf`/`unknownList` through a temporary vitest file in the scratch copy (never
committed): 12 617 tokens, 0 unmatched runs (headword text), percent 25 with synthetic states. Server
killed, scratch copy, data dir and driver deleted.

### Gates before the last commit

- Web: `check` 0 (1 165 files, 0 errors, 0 warnings), `test` 0 (340 files, 5 351 tests), `build` 0;
  Node 26.13.1 full vitest 0 (340 files, 5 351 tests).
- Go: full `./...` once, proxy variables unset, under the lock: `gofmt -l` printed nothing, `go vet` clean,
  35 packages ok, 1 failing test: `internal/ai` `TestHostnameResolvingToEmbeddedFormIsRefused` ("address
  family not supported by protocol", the known IPv6-less sandbox failure); nothing else failed. The
  backup package gate (Task 4) passed on its own.
- No route changed: route walk, PWA route fixture and `docs/wiki/API-Routes.md` untouched.

### Open follow-up: the segment route budgets

The two missed budgets (one 4 000-code-point chunk ≤ 400 ms, a 30 000-code-point chapter ≤ 2 s) are the
cost of the existing `POST /api/segment` (#78): the same chunk without `readings` took as long. This item
did not change the route; speeding up segmentation (or a server-side tally) is an open follow-up.

### Review fixes (the one fix wave)

Base: `git merge --no-ff feature/v0.3.0-stretch` (57941b1, brings #71; the only conflict was the area
table of `docs/contracts/overview.md`, both rows kept). Each fix test-first unless noted:

1. **Selection survived a chapter or book change** (cca2fd8). `WordsPanel` takes `resetKey`
   (`bookId:chapter:variant:workspace`); a change clears the selection, result, Undo, paging and scope;
   an add or mark that finishes after the key changed shows nothing. Actions use only selected words still
   in the list. Two panel tests and a BookView chapter-change test failed first (the latter against a fixed
   key); a BookView book-switch test passed before the fix too (the panel remounts while the new book
   loads) and stays as a guard.
2. **Index of the previous workspace / 0 % flash** (with 3, 7, 8 in 128a1da). On a workspace change the
   index and decks reset; the panel shows "Loading your cards…" (no figure, no actions) until the index
   is loaded, and "Could not load your cards…" with Try again on failure.
3. **Overlapping reloads.** `latestLoad.ts` applies only the newest load and turns reloads asked for during
   a batch into one reload after it; the panel's add and mark (and Undo) run in a batch. Unit tests, and a
   BookView test: a 250-word add (2 pushes) reloads the cards once.
4. **Clock skew in bulk marks** (a9d044a). `setKnownMarks` reads `loadRawStudyData` first and stamps each
   row after the server's time for its key (`knownAt`), as `addWords` does; test with a server time in
   2099.
5. **O(P²) publication** and 6. **part count predicate** (7970dce). `total` is computed once per run with
   the loader's `trim() !== ''`; paragraphs of a chunk are published together (one microtask per chunk);
   `matches` are copied out only when the words or the panel want them. 4 000 one-word paragraphs: 2 502 ms
   before, 64 ms after; a U+FEFF / U+3000 paragraph is no longer a part that never loads.
7. **Index only for zh/ja**: a BookView test with an English book (no `loadStudyHistory` call).
9. **User-global `known:` row** (09d9e27): dropped on restore and counted; `remap.json` case, backup README.
12. **Linear walk** (beea06a): word ranges are sorted once and walked with one pointer. A refactor: the new
    500-word out-of-order test passes before and after; the existing plan and render tests are unchanged.
    `splitRunsByHighlights`' own per-segment `cuts.find` (#78) is left as it is.

Gates after the fixes: web `check` 0 (1 184 files, 0 errors), `test` 0 (348 files, 5 441 tests),
`build` 0, Node 26 vitest 0 (348 files, 5 441 tests); backup gate 0; full Go `./...` once (proxy unset, under the lock): `gofmt -l` empty, `go vet` clean, 36 packages ok, two
failures: the known IPv6 `internal/ai` `TestHostnameResolvingToEmbeddedFormIsRefused`, and
`library/sources/aozora` `TestAozoraCatalogWaiterHonorsContext` with "TempDir RemoveAll cleanup: directory
not empty" (a cleanup race in code this branch never touched; the package then passed `-count=5`). Not
investigated further.

### Not verified

- Nothing was seen in a browser: the underline/tint rendering (background layers, the 0.12em gap, a
  `<ruby>` piece's background reaching over its `<rt>`), the forced-colours fallback and the Words tab
  layout on a phone. The underline contrast was computed from the token colours against assumed page
  colours (#fff light, #121212 dark): new 5.85:1 page / 5.00:1 tint, learning 5.49 / 4.87 (light); new
  8.85 / 6.65, learning 9.13 / 6.68 (dark); text on the tints ≥ 13.7:1.
- Screen-reader output of the popup toggle and state line (only the DOM roles and names are tested).
- Japanese in the real-app check (only zh text was segmented; ja is covered by unit fixtures).
- The whole-book count was timed with repeated segment requests, not through `bookCounter.ts` in a
  browser (its chapter fetching and abort are unit-tested with fakes).

### Mutation check (orchestrator, after the fix wave)

Three mutants, each killed (then reverted):
- `familiarity` ignores manual marks: 8 tests fail.
- `familiarity` never answers `learning`: 8 tests fail.
- coverage percent rounded instead of floored: 2 tests fail.

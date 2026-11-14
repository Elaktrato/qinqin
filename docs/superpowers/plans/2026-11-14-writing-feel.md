# Writing and Tone Card Feel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hanzi-writer's quiz in the writing card with our own forgiving matcher (position/size tolerant, joined strokes, snap), and give the tone card the same snap feel with character-only pads.

**Architecture:** Pure modules in `apps/web/src/lib/writing/` (stroke data → unit coordinates, geometry, matcher, per-character quiz state) tested against committed JSON fixtures built from the bundled stroke data; a `WritingPad.svelte` renders guide grid, ink canvas and snapped SVG outlines; `WritingCard` drives it. Tone gets a shape classifier, a snap animation and a character-label mapping.

**Tech Stack:** SvelteKit 2 / Svelte 5, TypeScript, vitest. Stroke data: `hanzi-writer-data` (already bundled, served as `/hanzi/U<HEX>.json`). `hanzi-writer` stays only for `StrokePlayer`.

**Spec:** `docs/superpowers/specs/2026-11-14-writing-feel-design.md`

## Global Constraints

- No new dependencies, no new data files beyond the fixture JSON (derived from the already bundled stroke data).
- Card contract unchanged: `WritingCard`/`ToneCard` props `{item, entry, (chars), done, onDone}`; `onDone({suggested, meta})` with `suggestWritingGrade(outcomes)` / `suggestToneGrade(wrong)`; `meta.mistakes`, `meta.hints`; review event shape unchanged.
- Coordinates: stroke data uses a 1024 box with y up and baseline offset 900. Unit coordinates are `u = x / 1024`, `v = (900 − y) / 1024` (v grows downward). SVG outlines render in `viewBox="0 0 1024 1024"` inside `<g transform="translate(0 900) scale(1 -1)">`.
- Matcher starting values (all in `params.ts`): resample 32 points; centroid offset ≤ 0.3; scale ratio 0.5–2.0; direction cosine ≥ 0.5; shape distance ≤ 0.2; join gap ≤ 0.2; max join 3; ink shorter than 0.02 is ignored (no mistake).
- Snap morph 120–160 ms; miss flash/fade ~250 ms; hint glow after 3 misses on one stroke, then the outline stays for that character (one auto hint per character); manual Hint button = 1 hint per press. `prefers-reduced-motion`: no morph, no fade, instant.
- Keyboard isolation as today: pointer drawing on `[data-card-input]` never triggers the runner's 1–4 / Space.
- Gates before every commit: `npm --prefix apps/web run check`, `npm --prefix apps/web test`, `npm --prefix apps/web run build`. Conventional commits, one per task. Never merge or push.

## Review Focus

- A fast writer drawing the next stroke while the previous snap animation is still running: the new stroke is accepted and judged against the right next stroke (Task 4).
- Multi-touch / palm: a second pointer while drawing is ignored, not merged into the ink (Task 4).
- A character whose stroke data fails to load mid-word: the existing "could not load" path with Continue still works (Task 4).
- A join attempt over a pair that does not flow (口's 横折 + 横): it is a miss, and the single-stroke reading of the same ink is still tried (Task 2).
- Tone card with erhua (花儿) and with a non-Han character in the written form: pads fall back to toneless pinyin, and the aria-labels never reveal the pinyin when pads show characters (Task 5).

---

### Task 1: Stroke data and geometry

**Files:**
- Create: `apps/web/src/lib/writing/strokes.ts`, `strokes.test.ts`, `geometry.ts`, `geometry.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Pt = { x: number; y: number }            // unit coords, y down
  export interface CharStrokes { char: string; medians: Pt[][]; outlines: string[] }  // outlines = raw SVG path strings
  export function parseStrokeData(char: string, json: unknown): CharStrokes | null  // null on malformed data
  export function toUnit(p: readonly [number, number]): Pt                          // x/1024, (900 − y)/1024
  // geometry.ts
  export function pathLength(points: readonly Pt[]): number
  export function resample(points: readonly Pt[], n: number): Pt[]                  // n evenly spaced along length; a single point → n copies
  export function centroid(points: readonly Pt[]): Pt
  export function rmsRadius(points: readonly Pt[], c?: Pt): number
  export function dist(a: Pt, b: Pt): number
  export function joinPaths(paths: readonly (readonly Pt[])[]): Pt[]               // concatenation, end of i connected straight to start of i+1
  ```

- [ ] **Step 1: Failing tests:** `toUnit([512, 388])` → `{x: 0.5, y: 0.5}`; `parseStrokeData('了', realJson)` gives 2 medians and 2 outlines (load `node_modules/hanzi-writer-data/了.json` with `fs`); malformed input (missing medians, mismatched lengths, non-numeric points) → `null`; `resample` of a 2-point line to 5 points gives evenly spaced points and keeps both ends; `pathLength` of a unit square path = 4; `joinPaths` of 了's medians has length = sum of both + the 0.05 gap (±0.01).
- [ ] **Step 2:** Run `npm --prefix apps/web test -- writing` — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Gates — PASS. Commit `feat(writing): stroke data in unit coordinates and path geometry`.

### Task 2: Matcher, params and shared fixtures

**Files:**
- Create: `apps/web/src/lib/writing/params.ts`, `matcher.ts`, `matcher.test.ts`, `apps/web/scripts/make-writing-fixtures.mjs`, `apps/web/src/lib/writing/fixtures/strokes.json`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  ```ts
  export const MATCH = { resample: 32, maxOffset: 0.3, minScale: 0.5, maxScale: 2.0, minCos: 0.5, maxShape: 0.2, maxGap: 0.2, maxJoin: 3, minInk: 0.02 } as const
  export type MatchResult =
    | { kind: 'match'; strokes: number[]; score: number }    // indices covered, e.g. [0, 1] for a join
    | { kind: 'miss'; reason: 'direction' | 'shape' | 'placement' }
    | { kind: 'ignored' }                                     // ink shorter than minInk
  export function matchStroke(ink: readonly Pt[], medians: readonly Pt[][], next: number): MatchResult
  ```
- Algorithm (the part the signature does not fix): candidates are `[next]` and, for k = 2..maxJoin while `next+k−1 < medians.length` and every consecutive gap ≤ `maxGap`, the joined `[next..next+k−1]`. Per candidate: resample ink and candidate to `resample` points; **direction**: ink start nearer candidate start than candidate end, and cosine of (end − start) vectors ≥ `minCos`; **placement**: centroid distance ≤ `maxOffset`, `rmsRadius` ratio ink/candidate within `[minScale, maxScale]` (use path length ratio instead when the candidate's radius < 0.01, i.e. a dot); **shape**: map ink into the candidate frame (subtract ink centroid, scale by radius ratio, add candidate centroid), mean point distance divided by candidate path length ≤ `maxShape`; score = shape distance. Best score wins; ties prefer fewer strokes. Report the miss reason of the single-stroke candidate.
- The fixture script reads `node_modules/hanzi-writer-data/{了,子,糸,纟,红,口,十,人,永,我,好}.json`, writes medians (unit coords) and deterministic cases (seeded PRNG, e.g. mulberry32 seed 1) to `fixtures/strokes.json`: `{chars: {[char]: Pt[][]}, cases: [{name, char, next, ink: Pt[], expect: {kind, strokes?, reason?}}]}`. Cases: every stroke of every char drawn from its median with ±0.01 noise; shifted by 0.15; scaled ×0.6 and ×1.6 around its centroid; reversed (miss `direction`); the next-but-one stroke drawn instead of the next (miss); a random zig-zag scribble across the box (miss); a dot drawn for a long stroke (miss); a correct stroke shape placed in the opposite quadrant, offset 0.45 (miss `placement`); 了 strokes 0+1 as one path (match `[0,1]`); 子, 糸, 纟 and 红 strokes 0+1 as one path (each match `[0,1]`); 口 strokes 1+2 joined (miss for the join; result is a miss); a 0.01-long tap (ignored). Committed output is what tests read; the Kotlin port (#38) reuses the same file.

- [ ] **Step 1:** Write the script and generate `fixtures/strokes.json`; write `matcher.test.ts` iterating every case and asserting `kind` (and `strokes` / `reason` when given). Add unit tests: `MATCH` values equal the spec's starting values.
- [ ] **Step 2:** Run `npm --prefix apps/web test -- matcher` — FAIL.
- [ ] **Step 3:** Implement `matchStroke`.
- [ ] **Step 4:** All fixture cases pass without loosening a threshold beyond the spec's starting values; if one fails, report it rather than tuning. Gates — PASS. Commit `feat(writing): forgiving stroke matcher with joined strokes and shared fixtures`.

### Task 3: Per-character quiz state

**Files:**
- Create: `apps/web/src/lib/writing/quiz.ts`, `quiz.test.ts`

**Interfaces:**
- Consumes: `MatchResult` (Task 2).
- Produces:
  ```ts
  export interface QuizState { total: number; next: number; done: number[]; mistakes: number; mistakesOnStroke: number; autoHinted: boolean; outline: boolean; manualHints: number; complete: boolean }
  export type QuizEffect = { snap: number[] } | { miss: true; glow?: number } | { none: true }
  export function startQuiz(total: number): QuizState
  export function applyResult(state: QuizState, result: MatchResult): { state: QuizState; effect: QuizEffect }
  export function requestHint(state: QuizState): { state: QuizState; glow: number }   // manualHints + 1
  export function outcomeOf(char: string, state: QuizState, revealed: boolean): CharOutcome   // from $lib/study/writing
  export function hintsOf(state: QuizState): number   // manualHints + (autoHinted ? 1 : 0)
  ```
- Rules: a match advances `next` past the covered strokes and resets `mistakesOnStroke`; a miss adds 1 to `mistakes` and `mistakesOnStroke`; the 3rd miss on one stroke returns `glow: next` and sets `autoHinted` and `outline` (only once per character); `ignored` changes nothing; `complete` when `next === total`; results after `complete` are ignored.

- [ ] **Step 1:** Failing tests: a join advances by 2 and the effect snaps `[0,1]`; three misses on one stroke → glow + outline, a fourth does not glow again and `hintsOf` stays 1; two manual hints + auto hint → `hintsOf` = 3; `outcomeOf` reports `{char, mistakes, strokes: total, revealed}`; after completion further results are ignored; `ignored` is a no-op.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** Gates — PASS. Commit `feat(writing): per-character quiz state with hints`.

### Task 4: Writing pad and card

**Files:**
- Create: `apps/web/src/lib/plugins/flashcards/cards/WritingPad.svelte`
- Modify: `apps/web/src/lib/plugins/flashcards/cards/WritingCard.svelte` (drop hanzi-writer), `docs/superpowers/specs/2026-11-12-flashcards-design.md` (Implementation notes: writing as rebuilt)

**Interfaces:**
- Consumes: Tasks 1–3, `loadStrokeData` (`$lib/study/strokeData`), `suggestWritingGrade` (`$lib/study/writing`).
- Produces: `WritingPad` props `{ strokes: CharStrokes; size: number; onComplete: (outcome: CharOutcome, hints: number) => void; revealSignal: number; hintSignal: number }` (incrementing a signal triggers reveal / hint); `WritingCard` props unchanged.

- [ ] **Step 1:** `WritingPad`: square pad of `size` px (root carries `data-card-input`, `role="img"` and the existing "Draw character N of M" label) with a faint cross + diagonal guide grid; a canvas ink layer redrawn per animation frame from coalesced pointer events (primary pointer only, mouse main button only, `touch-action: none`, pointer capture); an SVG layer with snapped outlines. On pointer up: `matchStroke` → `applyResult`; `snap` → fade the ink and fade in the covered outlines over 140 ms (instant under reduced motion); `miss` → ink turns red and fades over 250 ms; `glow` → the glowing stroke outline pulses once with a dot at its median start; `outline` → all outlines at low opacity for the rest of the character. A new stroke may start while a snap animates (animations never block input). Reveal: outlines fade in one after another 150 ms apart (instant under reduced motion), then `onComplete(outcomeOf(..., true), hints)`.
- [ ] **Step 2:** `WritingCard`: keep its markup (masked word, readings, glosses, dots, feedback, error/Continue path) but load `parseStrokeData(ch, await loadStrokeData(ch))` per character and render `WritingPad`; buttons **Hint** and **Reveal character**; aggregate outcomes and hints; finish with `onDone({ suggested: suggestWritingGrade(outcomes), meta: { mistakes, hints } })`; keep `NEXT_CHAR_DELAY_MS` between characters. Remove the hanzi-writer import and `captureListeners` use here (keep the helper if other code still uses it, else delete it with its test).
- [ ] **Step 3:** Update the flashcards design's Implementation notes (writing paragraph) to describe the new pad.
- [ ] **Step 4:** Gates — PASS. Real-app check: build, run the server from a scratchpad copy of the tree on a free 127.0.0.1 port with a seeded scratch data dir, start a deck session with Writing selected, draw 了 in one motion (snaps both strokes), draw 好 sloppily offset (accepted), draw a stroke backwards (miss), miss one stroke three times (glow + outline), Reveal; check no console errors. Kill what you started. Commit `feat(flashcards): forgiving writing pad with snapping and joined strokes`.

### Task 5: Tone card feel and character-only pads

**Files:**
- Modify: `apps/web/src/lib/study/tones.ts` (+ `tones.test.ts`), `apps/web/src/lib/study/cardFlow.ts` (+ test), `apps/web/src/lib/plugins/flashcards/cards/ToneCard.svelte`, `docs/superpowers/specs/2026-11-12-flashcards-design.md` (Implementation notes: tone)

**Interfaces:**
- Produces:
  ```ts
  // cardFlow.ts
  export function tonePadLabels(written: string, syllableCount: number): string[] | null
    // Han characters of `written` when every character is Han and their count equals syllableCount; otherwise null
  // tones.ts
  export function toneFromGesture(path: readonly GesturePoint[], minDistance?: number): Tone   // shape rules below (vector overload kept for keys/tests)
  ```
- Shape rules (owner's tone shapes, replacing "up = 1"): shorter than `minDistance` (24 px) → 5; a dip (down ≥ min, then up ≥ min, lowest point interior) → 3; otherwise by the start→end vector with y up: within ±25° of horizontal (either direction) → 1 (flat); rising → 2; falling → 4.
- [ ] **Step 1:** Failing tests: `tonePadLabels('学生', 2)` → `['学','生']`; `tonePadLabels('花儿', 1)` → `null`; `tonePadLabels('T恤', 2)` → `null`; flat right and flat left → 1; 45° up-right and straight up → 2; 45° down-right and straight down → 4; dip → 3; tap → 5; update the existing direction tests to the new rules.
- [ ] **Step 2:** FAIL. **Step 3:** Implement.
- [ ] **Step 4:** `ToneCard`: larger pads (10rem); each pad shows the character from `tonePadLabels` (fallback: toneless pinyin as today); aria-labels say `Syllable 2: no tone yet` without the pinyin when characters are shown; on pointer up the trace fades and the recognised tone's contour draws in over 120 ms (instant under reduced motion), then focus moves to the next syllable; swiping a pad again replaces its tone; Check, buttons and keys 1–5 unchanged; after Check each pad shows the correct toned pinyin.
- [ ] **Step 5:** Update the flashcards design's "Swipe directions as built" note to the new shape rules. Gates — PASS. Real-app check of a tone session (学生 shows characters; 花儿 shows pinyin; flat swipe = tone 1). Commit `feat(flashcards): tone pads with characters and snapping contours`.

### Task 6: Owner feel check and tuning

- [ ] Hand the branch to the owner for a touch-device session (writing and tone). Collect what felt too strict or too loose; adjust only `params.ts` values (and the tone angle band), regenerate nothing unless a case's expectation genuinely changes; re-run gates. Commit `tune(writing): thresholds from the owner's feel check`.

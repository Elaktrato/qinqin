# FSRS Optimizer (issue #44) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The owner always runs plans subagent-driven, but they must say "start" before anyone dispatches an implementer.

**Goal:** Per-workspace FSRS-6 parameter sets, optimised in the browser from the review log, with a fit comparison, a due-date preview, import/export and one-click revert; scheduling stays a pure function of review events plus the active weights.

**Architecture:** Pure modules in `apps/web/src/lib/study/fsrs/` (params, model generic over an arithmetic interface, a scalar reverse-mode tape, dataset, evaluation, optimizer, preview), the optimizer in a Web Worker, parameter sets as `qinqin-flashcards` plugin data rows `fsrs:set:<ulid>` and `fsrs:active`, a required `w` argument on `scheduleFor`/`buildQueue` so the compiler finds every caller, and a `/study/scheduling` page.

**Tech Stack:** SvelteKit 2 + Svelte 5 (runes), vitest, ts-fsrs 5.4.2 (MIT, existing). No new dependencies. No server change.

**Spec:** `docs/superpowers/specs/2026-11-15-fsrs-optimizer-design.md`. Read it fully, plus `docs/superpowers/specs/2026-11-12-flashcards-design.md` (event-sourced scheduling).

**Worktree:** `<wt>` = `/home/user/www/github/qinqin/.claude/worktrees/fsrs-optimizer`, branch `feature/fsrs-optimizer` from `develop`. Run `npm --prefix <wt>/apps/web ci` once.

## Gates

- Web: `npm --prefix <wt>/apps/web run check`, `npm --prefix <wt>/apps/web test`, `npm --prefix <wt>/apps/web run build`.
- Go is untouched; run `docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e GOCACHE=/tmp/gocache -e GOPATH=/tmp/gopath -v <wt>:/src -w /src/server -e GOTOOLCHAIN=auto -e GOFLAGS=-buildvcs=false golang:1.26 sh -c "go vet ./... && go test ./..."` once before the final review (the web build is embedded).
- Every task ends green and with one commit on `feature/fsrs-optimizer`; message `feat(study): …` and, after a blank line, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never merge or push.

## Global Constraints

- Scheduling is derived: no schedule, due date or stability is ever stored; review events are never written, edited or deleted by this feature.
- `DEFAULT_W` is ts-fsrs `default_w` (21 numbers). With no active set every result is bit-identical to today's.
- Weights are valid only if `checkParameters(migrateParameters(w))` succeeds, every value is finite and within `CLAMP_PARAMETERS(2, true)`; anything else reads as "no set" (defaults).
- Thresholds: `MIN_LABELLED = 400`, `LOW_DATA_LABELLED = 1000`. Training constants: `LR = 0.04`, `EPOCHS = 5`, `BATCH_ITEMS = 512`, `GAMMA = 1`, seed `1`, `PRETRAIN_MIN_CARDS = 8`, S0 search in `[0.1, 100]`.
- Apply is possible only when `candidate.logLoss < active.logLoss` on the same dataset (imports are exempt but still previewed).
- Plugin data keys: `fsrs:set:<ulid>` → `ParamSet`, `fsrs:active` → `{setId: string | null, changedAt: string}`; plugin id `qinqin-flashcards`; workspace-scoped.
- Style: `store.ts` keeps its own style (double quotes, two spaces); new files use tabs and single quotes like `lib/plugins/index.ts`. Svelte 5 runes, touch targets ≥ 44 px, everything works by keyboard.

## Review Focus

- Several reviews of one card on the same UTC day, or two with the same timestamp: replay and training must follow the `t = 0` short-term path exactly as ts-fsrs does (Task 3 parity test covers same-day and equal-timestamp cases).
- The active set changes on another device while a study session is open: the session keeps the weights it loaded; nothing crashes; the next load uses the new set (Task 2 test: parse picks the pointer, unknown pointer → defaults).
- The workspace switches while optimising: the result is tied to the workspace captured at start and Apply writes there or refuses (Task 9 test on `canApply` with a workspace mismatch).
- Pasted strings with spaces, newlines, a trailing comma, brackets, 17 or 19 numbers, or a non-number: parsed or rejected with a message (Task 1 table test).
- Worker construction fails or the worker throws: a message, no write, the active set unchanged (Task 7 client test with a throwing factory).

---

### Task 1: Parameter sets and the weight string

**Files:**
- Create: `apps/web/src/lib/study/fsrs/params.ts`, `apps/web/src/lib/study/fsrs/params.test.ts`

**Interfaces:**
- Produces:
  - `DEFAULT_W: readonly number[]`
  - `interface ParamSet { id: string; w: number[]; createdAt: string; source: 'optimized' | 'imported'; labelled?: number; logLoss?: number; baselineLogLoss?: number }`
  - `interface FsrsState { sets: ParamSet[]; active: ParamSet | null; w: readonly number[] }`
  - `SET_PREFIX = 'fsrs:set:'`, `ACTIVE_KEY = 'fsrs:active'`
  - `checkWeights(raw: unknown): { ok: true; w: number[] } | { ok: false; error: string }` — 17/19/21 finite numbers; raw values compared with `CLAMP_PARAMETERS(2, true)` (indices shared with the migrated result must be unchanged by `migrateParameters`, which clips silently); first bad index named 1-based: `'Weight 6 is outside 0.001–4.'`
  - `validWeights(raw: unknown): number[] | null` (= `checkWeights` ok → migrated 21 weights, else `null`)
  - `parseParamSet(key: string, raw: unknown): ParamSet | null` (key must equal `SET_PREFIX + id`)
  - `resolveState(sets: ParamSet[], activeRaw: unknown): FsrsState` (sets sorted newest first)
  - `parseWeightString(s: string): { ok: true; w: number[] } | { ok: false; error: string }`
  - `formatWeights(w: readonly number[]): string` (comma-space separated, 4 decimals, as Anki)
  - `weightsKey(w: readonly number[]): string`

- [ ] **Step 1: Write the failing tests**: `validWeights(DEFAULT_W)` equals `DEFAULT_W`; 19 numbers migrate to length 21; `NaN`, length 20, `w[4] = 11` → `null`. `parseWeightString` table: `"0.2, 1.3, …"` (21), `"[0.2,1.3,…]"`, newline-separated, trailing comma → ok; `"abc"` → `{ok:false, error:'Not a list of numbers.'}`; 18 numbers → `error: 'Expected 17, 19 or 21 numbers, got 18.'`; 21 numbers with `w[5] = 9` → `error: 'Weight 6 is outside 0.001–4.'` (not clipped). `resolveState` with an active pointer to a missing id → `active: null, w: DEFAULT_W`; `{setId: null}` → defaults; a valid pointer → that set's `w`. `parseParamSet('fsrs:set:B', {id:'A',…})` → `null`. `formatWeights(DEFAULT_W)` round-trips through `parseWeightString`.
- [ ] **Step 2: Run** `npm --prefix <wt>/apps/web test -- fsrs/params` — FAIL (module missing).
- [ ] **Step 3: Implement** with ts-fsrs `default_w`, `migrateParameters`, `checkParameters`, `CLAMP_PARAMETERS`.
- [ ] **Step 4: Run** the tests — PASS; run all gates.
- [ ] **Step 5: Commit** `feat(study): FSRS parameter sets and weight strings`.

### Task 2: Store rows for parameter sets

**Files:**
- Modify: `apps/web/src/lib/study/store.ts` (fetchStudyData, new writes), `apps/web/src/lib/study/types.ts` (`StudyData.fsrs?: FsrsState`)
- Test: `apps/web/src/lib/study/store.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces: `StudyData.fsrs?: FsrsState` (always set by `fetchStudyData`, so `StudyHistory.fsrs` is present after `loadStudyData`); `saveParamSet(workspaceId: number, set: Omit<ParamSet, 'id' | 'createdAt'>): Promise<ParamSet>`; `setActiveSet(workspaceId: number, setId: string | null): Promise<void>`; `deleteParamSet(workspaceId: number, id: string): Promise<void>` (refuses the active id with `Error('Cannot delete the active parameters.')`); `activeWeights(data: Pick<StudyData, 'fsrs'>): readonly number[]` (→ `DEFAULT_W` when absent).

- [ ] **Step 1: Failing tests** in `store.test.ts` using its existing fetch mock: a pull with `fsrs:set:A`, `fsrs:set:B`, `fsrs:active {setId:'B'}` → `fsrs.active.id === 'B'`, `fsrs.w` = B's; a tombstoned active row → defaults; rows of another workspace ignored; `saveParamSet` PUTs `fsrs:set:<ulid>` with the `?workspace=` query and fires `onStudyWrite`; `setActiveSet(ws, null)` PUTs `{setId: null, changedAt}`; deleting the active id rejects without a request.
- [ ] **Step 2: Run** `npm --prefix <wt>/apps/web test -- study/store` — FAIL.
- [ ] **Step 3: Implement**: collect `fsrs:` rows in the same loop as decks/cards; `resolveState` at the end.
- [ ] **Step 4: Run** — PASS; all gates.
- [ ] **Step 5: Commit** `feat(study): store FSRS parameter sets as plugin data`.

### Task 3: Own FSRS-6 model with ts-fsrs parity

**Files:**
- Create: `apps/web/src/lib/study/fsrs/model.ts`, `apps/web/src/lib/study/fsrs/model.test.ts`

**Interfaces:**
- Produces:
  - `interface Num<T> { c(x: number): T; add(a: T, b: T): T; sub(a: T, b: T): T; mul(a: T, b: T): T; div(a: T, b: T): T; pow(a: T, b: T): T; exp(a: T): T; log(a: T): T; min(a: T, b: T): T; max(a: T, b: T): T; value(a: T): number }`
  - `numberNum: Num<number>`
  - `interface Step { t: number; g: 1 | 2 | 3 | 4 }` (t = UTC days since the previous review, 0 for the first)
  - `retrievability<T>(N: Num<T>, w: T[], t: number, s: T): T`
  - `replay<T>(N: Num<T>, w: T[], steps: readonly Step[], onItem?: (r: T, y: 0 | 1, index: number) => void): { s: T; d: T }` — calls `onItem` for every step after the first with `t ≥ 1`, before updating.
  - `daysBetween(a: string, b: string): number` (ts-fsrs `dateDiffInDays` semantics)

- [ ] **Step 1: Failing test** `matches ts-fsrs on random histories`: seeded PRNG, 200 cards × 1–30 reviews with gaps 0–60 days (include same-day pairs and equal timestamps), replay with `numberNum` and `DEFAULT_W` and with one perturbed weight set; compare `s`, `d` with `fsrs({w}).next()` replay (as `scheduler.ts` does) — relative error `< 1e-6`. Also `retrievability` equals ts-fsrs `forgetting_curve(w, t, s)` within 1e-8.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the formulas exactly as the spec's "The model" section (clamps via `min`/`max`, no rounding; `D0(4)` inside mean reversion is NOT clamped — only the first review's D is).
- [ ] **Step 4: Run** — PASS; all gates.
- [ ] **Step 5: Commit** `feat(study): FSRS-6 model generic over arithmetic`.

### Task 4: Scalar reverse-mode tape

**Files:**
- Create: `apps/web/src/lib/study/fsrs/tape.ts`, `apps/web/src/lib/study/fsrs/tape.test.ts`

**Interfaces:**
- Produces: `class Tape { variable(x: number): Var; backward(out: Var): void; grad(v: Var): number; reset(): void }`, `type Var` (opaque index), `tapeNum(tape: Tape): Num<Var>`. Storage in growable `Float64Array`s (values, adjoints, up to two parents and local derivatives per node); `min`/`max` pass the gradient to the chosen operand; `pow(a, b)` differentiates both.

- [ ] **Step 1: Failing tests**: for each op, gradient vs. central finite difference (h = 1e-6) within 1e-5 relative on 50 random inputs; the gradient of the full BCE loss of `replay(tapeNum, …)` over 20 random cards vs. finite differences on all 21 weights within 1e-4; `reset()` then reuse gives identical results.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS; all gates.
- [ ] **Step 5: Commit** `feat(study): scalar autodiff tape for the FSRS optimizer`.

### Task 5: Dataset and evaluation

**Files:**
- Create: `apps/web/src/lib/study/fsrs/dataset.ts`, `apps/web/src/lib/study/fsrs/evaluate.ts`, tests beside them

**Interfaces:**
- Consumes: Task 3, `ReviewEvent` (`types.ts`).
- Produces: `interface Dataset { cards: { cardId: string; steps: Step[] }[]; labelled: number }`; `buildDataset(reviews: readonly ReviewEvent[]): Dataset` (valid reviews only — same guard as `scheduler.ts`'s `isValidReview`, exported from there; sorted by time then id; cards ordered by id); `evaluate(w: readonly number[], data: Dataset): { logLoss: number; rmseBins: number }` (20 equal-width R bins, count-weighted; R clamped to [1e-6, 1 − 1e-6] in the BCE).

- [ ] **Step 1: Failing tests**: a card reviewed once → no labelled item; reviews Good day 0, Good day 0 (same day), Again day 3 → one labelled item with `y = 0`; invalid grades skipped; `evaluate` on a dataset whose outcomes match R exactly in expectation (synthetic, 20k items) → `rmseBins < 0.02`; `logLoss` for a single item with R = 0.9, y = 1 equals `-ln 0.9`.
- [ ] **Step 2–4:** FAIL → implement → PASS; all gates.
- [ ] **Step 5: Commit** `feat(study): FSRS dataset and fit metrics`.

### Task 6: Synthetic histories and the optimizer

**Files:**
- Create: `apps/web/src/lib/study/fsrs/synthetic.ts`, `apps/web/src/lib/study/fsrs/optimize.ts`, `apps/web/src/lib/study/fsrs/optimize.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, 4, 5.
- Produces:
  - `simulate(opts: { w: readonly number[]; cards: number; days: number; seed: number }): Dataset` — each card starts on a random day, the next review is on the scheduler's interval (round(S·intervalModifier), ≥ 1, retention 0.9), recall sampled from R, grade Again on failure else Hard/Good/Easy with probabilities 0.15/0.75/0.10.
  - `optimize(data: Dataset, opts?: { onProgress?: (done: number, total: number) => void; shouldStop?: () => boolean }): OptimizeResult`
  - `type OptimizeResult = { ok: true; w: number[]; logLoss: number; rmseBins: number; labelled: number; lowData: boolean } | { ok: false; reason: 'too-few' | 'stopped'; labelled: number; needed?: number }`

- [ ] **Step 1: Failing tests**: `data.labelled = 399` → `{ok:false, reason:'too-few', needed: 1}`; `wTrue` = defaults with w8, w9, w10, w11 changed by ±30 % (clamped): `simulate({w:wTrue, cards:600, days:365, seed:7})`, `optimize` from defaults → `logLoss < evaluate(DEFAULT_W).logLoss` and `≤ evaluate(wTrue).logLoss × 1.02`; same input twice → `toEqual` weights; every output weight within `CLAMP_PARAMETERS(2, true)`; `shouldStop` returning true after the first batch → `reason:'stopped'`; 3,000 labelled items finish in `< 20_000` ms; `lowData` true below 1,000.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**: pretrain w0..w3 (golden-section per first grade with ≥ `PRETRAIN_MIN_CARDS` cards having a second review at t ≥ 1), freeze them; seeded shuffle of cards per epoch; batches of whole cards until ≥ `BATCH_ITEMS` labelled items; per batch build the loss on a reset tape (mean BCE + `GAMMA·Σ((w−d)/σ)²·batch/total`, σ = clamp range / 4), Adam update w4..w20, clamp; `onProgress` per batch; `evaluate` at the end.
- [ ] **Step 4: Run** — PASS; all gates.
- [ ] **Step 5: Commit** `feat(study): FSRS optimizer with pretraining and Adam`.

### Task 7: Worker and client

**Files:**
- Create: `apps/web/src/lib/study/fsrs/optimizer.worker.ts`, `apps/web/src/lib/study/fsrs/optimizerClient.ts`, `apps/web/src/lib/study/fsrs/optimizerClient.test.ts`

**Interfaces:**
- Consumes: Task 6.
- Produces: worker protocol `{type:'run', data: Dataset}` in, `{type:'progress', done, total} | {type:'result', result: OptimizeResult} | {type:'error', message}` out; `runOptimizer(data: Dataset, opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal; createWorker?: () => Worker }): Promise<OptimizeResult>` — default factory `new Worker(new URL('./optimizer.worker.ts', import.meta.url), { type: 'module' })`; abort terminates the worker and resolves `{ok:false, reason:'stopped'}`.

- [ ] **Step 1: Failing tests** with a fake Worker object: progress forwarded as a fraction; result resolves; `error` message rejects with `Error(message)`; factory throwing → rejects `Error('The optimizer could not start in this browser.')`; abort calls `terminate()`.
- [ ] **Step 2–4:** FAIL → implement → PASS; all gates (the build must emit the worker chunk).
- [ ] **Step 5: Commit** `feat(study): run the FSRS optimizer in a worker`.

### Task 8: Weights reach every scheduling caller

**Files:**
- Modify: `apps/web/src/lib/study/scheduler.ts` (`scheduleFor(cardId, reviews, now, w)`, `BuildQueueOptions.w`, both **required**; memoised `fsrs({w})` per `weightsKey`), `lib/study/cardFlow.ts`, `lib/study/levelQueue.ts`, `lib/study/mastery.ts`, `lib/stats/wordStates.ts`, `lib/plugins/flashcards/FlashcardsWidget.svelte`, `routes/study/+page.svelte`, `routes/study/session/+page.svelte`, and whatever else `npm run check` reports
- Test: `scheduler.test.ts`, the touched modules' tests

**Interfaces:**
- Consumes: Task 2 (`activeWeights`).
- Produces: every function that schedules takes `w: readonly number[]` from its caller; pages pass `activeWeights(history)`.

- [ ] **Step 1: Failing tests**: `scheduleFor(…, DEFAULT_W)` equals the current snapshot values for a fixed history; with a weight set whose w8 is doubled the due date is later; two calls with equal arrays reuse one instance (spy via exported `schedulerCacheSize()`).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**, then fix every caller `npm run check` lists; existing tests pass `DEFAULT_W`.
- [ ] **Step 4: Run** all gates — PASS.
- [ ] **Step 5: Commit** `feat(study): schedule with the workspace's active FSRS weights`.

### Task 9: Preview and the apply gate

**Files:**
- Create: `apps/web/src/lib/study/fsrs/preview.ts`, `apps/web/src/lib/study/fsrs/preview.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 8.
- Produces: `previewChange(o: { cards: readonly StudyCard[]; reviews: readonly ReviewEvent[]; from: readonly number[]; to: readonly number[]; now: Date }): Preview` with `Preview = { dueNow: [number, number]; due7: [number, number]; due30: [number, number]; medianIntervalDays: [number, number]; moved: { cardId: string; written: string; before: string; after: string }[]; surge: boolean }` (10 largest absolute moves; `surge` when after > 2 × before and after − before > 50); `canApply(o: { candidate: { logLoss: number } | null; activeLogLoss: number; startedWorkspace: number; currentWorkspace: number | null; source: 'optimized' | 'imported' }): { ok: true } | { ok: false; reason: string }`.

- [ ] **Step 1: Failing tests**: identical weights → equal pairs and empty `moved`; a doubled w8 → `medianIntervalDays[1] > [0]`; surge flag at 30 → 81 (true) and 30 → 70 (false); `canApply` refuses worse log loss ("Your current parameters already fit better.") and a workspace mismatch ("The workspace changed. Optimise again."), allows imports regardless of log loss.
- [ ] **Step 2–4:** FAIL → implement → PASS; all gates.
- [ ] **Step 5: Commit** `feat(study): preview due-date changes of new FSRS weights`.

### Task 10: Scheduling page, docs

**Files:**
- Create: `apps/web/src/routes/study/scheduling/+page.svelte`, `apps/web/src/lib/plugins/flashcards/scheduling/OptimizePanel.svelte`, `PreviewPanel.svelte`, `SavedSets.svelte`, `ImportExport.svelte`
- Modify: `apps/web/src/routes/study/+page.svelte` (a "Scheduling: …" link under Limits), `docs/superpowers/specs/2026-11-12-flashcards-design.md` (non-goal line → points to the new spec), `docs/ROADMAP.md` (#44 on develop)

**Interfaces:**
- Consumes: Tasks 1, 2, 5, 7, 9.

- [ ] **Step 1:** Build the page per the spec's sketch: load `loadStudyData(ws)` (uncached), `buildDataset`, show threshold text ("N more reviews needed" / low-data note), Optimise → `runOptimizer` with `<progress>` and Cancel, result metrics for active vs. candidate, `PreviewPanel`, Apply (`saveParamSet` then `setActiveSet`, gated by `canApply`) and Discard; `SavedSets` with Use / Delete / Use defaults; `ImportExport` (paste → `parseWeightString` → preview → Apply; Copy active via `formatWeights`). After any pointer change an undo toast restores the previous pointer (reuse the undo pattern of `lib/components/CardManager.svelte`).
- [ ] **Step 2: Run** all gates — PASS.
- [ ] **Step 3: Real-app check.** Start the server and `npm --prefix <wt>/apps/web run dev`; create a fresh workspace; with a throwaway script in the session scratchpad (never committed) create 300 `card:` rows and post ~3,000 review events generated with the `simulate()` logic through `PUT /api/plugins/qinqin-flashcards/data/card:<id>?workspace=<id>` and `POST /api/events/batch`. Verify: the page shows the review count; Optimise completes with progress and the page stays responsive; metrics and preview appear; Apply changes the home widget's due count; Undo and "Use defaults" restore it; import of `formatWeights(DEFAULT_W)` shows an empty preview; a workspace with 50 reviews shows the disabled button and the missing count; keyboard-only run-through works.
- [ ] **Step 4: Commit** `feat(study): scheduling page with FSRS optimiser, preview and revert`.

## Builder rulings (tasks 1–5, unattended)

- **Ruling: `checkWeights` returns the raw numbers; `validWeights` and `parseWeightString` return the migrated 21** — an import is stored as 21 weights, one shape in plugin data — cost if wrong: none. Stored rows must have exactly 21 weights.
- **Ruling: `deleteParamSet` reads the pull to find the active set, then refuses before any DELETE** — the active id lives only in the data — cost if wrong: one extra read.
- **Ruling: `scheduler.ts` also exports `sortedReviews`** next to `isValidReview`, so the dataset sorts exactly as replay does — cost if wrong: none.
- **Ruling: `Tape` also has `value(v)`** (used by `tapeNum`) — cost if wrong: none.
- **Ruling: the stability floor after a lapse follows ts-fsrs (`min(max(S/e^{w17·w18}, 0.001), S'_fail)`)** — equals the spec's formula, written as ts-fsrs computes it — cost if wrong: none.

## Builder rulings (tasks 6–10, unattended)

- **Ruling: training schedule changed (`BATCH_ITEMS` 512 → 64, `EPOCHS` 5 → 10; LR, GAMMA, seed unchanged) — optimizer fell short of the 2% target at 25 Adam steps** — measured on `wTrue` histories (log loss ratio to `wTrue`; 600 cards seeds 1/2/7/9, 2000 cards seed 7): before 1.0170/1.0206/1.0249/1.0268/1.0182, after 0.9986/1.0116/1.0107/1.0041/1.0125; cost if wrong: more compute (25–140 ms in Node per fit, 3,231 items in 42 ms). The test file asserts all five cases.
- **Ruling: a 17/19-number import fills the weights ts-fsrs adds (w19 = 0, below the FSRS-6 range) by clipping only those indices into range** — found in the real-app check: the stored set was rejected on read-back and Apply silently kept the defaults; typed values are still rejected, never clipped — cost if wrong: none (fix commit `fix(study): keep migrated Anki imports inside the FSRS-6 ranges`).
- **Ruling: `scheduleFor` keeps at most 16 memoised `fsrs({w})` instances (oldest dropped)** — preview and imports create throw-away sets — cost if wrong: a rebuild of one instance.
- **Ruling: preview counts are cumulative (`due within 7/30 days` includes what is due now) and the median interval is due minus last review in days** — spec wording is open — cost if wrong: wording only.
- **Ruling: `canApply` also refuses an optimised result without a candidate; the workspace check comes before the log-loss check** — cost if wrong: none.
- **Ruling: `/study/scheduling` loads uncached `loadStudyData` and evaluates the active set on the main thread (a few ms for 20,000 items)** — cost if wrong: none.
- Real-app check (built server, headless Chromium, synthetic 500 cards / 2,466 reviews in a copy; 1,966 labelled): the Worker ran under the embedded build (no CSP error), optimise 300 to 560 ms with a `<progress>`, Apply moved the study setup's due count 258 to 152, Use defaults and Undo restored 258, an Anki 19-number import (258 to 233) applied, the defaults import showed an empty preview, a 26-review workspace showed 'Optimise' disabled with '374 more reviews needed', Tab/Enter alone ran optimise and Discard, Cancel worked.
- **Ruling (review wave): the apply gate is honest about what was measured.** The log is split by time: the candidate is fitted on the earlier 80 % of the labelled items, scored against the current weights on the latest 20 % (never fitted), then refitted on everything. A log under 2,000 labelled items is applied only if the candidate's per-item gain on that tail is more than twice its standard error; a larger log must fit the whole log better and not lose more than 0.001 per item on the tail. The screen names which numbers are 'on your earlier reviews (used for fitting)' and which are 'on your most recent reviews, not used for fitting' — cost if wrong: two fits (about 1.7x compute; 20,000 items in under half a second in Node) and some small logs are refused that a luckier split would have accepted.
- **Ruling (review wave): initial stabilities are smoothed.** Each fitted w0..w3 is pulled towards its default in log space by 16 pseudo-cards (per-grade minimum raised from 8 to 15 cards), then pooled so w0 <= w1 <= w2 <= w3 — cost if wrong: slower convergence of w0..w3 on logs that really differ.
- **Ruling (review wave): determinism is per engine.** Same input on the same JS engine gives identical weights; the stored set is what syncs, nothing is recomputed on another device — cost if wrong: none.
- Small-log numbers (90 cards, 200 days, 449 to 637 labelled items; log loss on 3,000 fresh cards; seeds 3..7). Defaults: 0.3508 / 0.3544 / 0.3562 / 0.3551 / 0.3571. Before the wave: 0.3553 / 0.3811 / 0.3604 / 0.3590 / 0.3631 (seed 4 had w0..w3 = 0.10 / 100 / 0.34 / 100). After: 0.3505 / 0.3587 / 0.3568 / 0.3552 / 0.3588, and Apply is refused for all five (the gate sees no clear gain); a log whose true weights differ clearly from the defaults is still offered (test 'still offers a fit that is clearly better').

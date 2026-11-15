# FSRS Optimizer — Design ([#44](https://github.com/Elaktrato/qinqin/issues/44))

Date: 2026-11-15
Status: designed unattended (owner rule: licensing first, then the best experience for the
learner even at higher implementation cost); waiting for the owner's review. Builder check done
(see the end).

## Intent

Flashcards schedule with ts-fsrs default parameters (FSRS-6, 21 weights). Defaults fit an average
Anki user, not this learner: someone who forgets hanzi quickly gets intervals that are too long,
someone with good recall reviews too often. Like Anki, the learner should be able to fit the
parameters to their own review history, see what would change before it changes, and go back.
The flashcards design keeps its rule: **scheduling is a pure function of review events plus
parameters**; nothing scheduled is stored, and no past review event is ever changed.

## Goals

- Optimise the 21 FSRS-6 weights from one workspace's review log, in the browser, in seconds for
  thousands of reviews and without blocking the page.
- Show the fit (log loss and RMSE, current vs. candidate) and a preview of how due dates move
  before anything is applied.
- Store parameter sets as plugin data; switching sets is instant and reversible; the default
  parameters are always one click away.
- Import and export a parameter string (Anki's comma-separated weights) so a learner can bring
  parameters from Anki or another device.

## Non-goals

- Desired retention (stays ts-fsrs's 0.9), learning steps, maximum interval and fuzz settings.
- A review simulator, a workload chart, or "optimal retention".
- Per-deck or per-card-kind parameter presets: one active set per workspace.
- Automatic re-optimisation. The learner presses the button.
- Server-side optimisation, Android parity (v0.4.0 reads the same plugin data later).

## Anti-goals

- A change to past review events, or any stored schedule.
- Applying parameters that fit the learner's history worse than the current ones.
- Freezing the page while optimising, or losing the current set when something fails.
- A new runtime dependency with a licence the repository cannot ship, or an app-wide header change
  (cross-origin isolation) just for one settings page.

## Constraints found in the code

- `apps/web/src/lib/study/scheduler.ts` replays each card through one module-level `fsrs()`
  instance; `scheduleFor` is called from `scheduler.buildQueue`, `mastery.ts`, `cardFlow.ts`,
  `levelQueue.ts` and `lib/stats/wordStates.ts`. Every one of them must see the active weights.
- ts-fsrs 5.4.2 (MIT, already a dependency) ships the FSRS-6 formulas, `default_w`,
  `CLAMP_PARAMETERS`, `migrateParameters`, `checkParameters`, `forgetting_curve` and
  `dateDiffInDays` (UTC calendar days), but **no optimizer**.
- Study data comes from one sync pull of `qinqin-flashcards` plugin data
  (`store.ts: loadStudyDataWith`), workspace-scoped; keys outside `deck:`/`card:` are ignored today.
- Reviews are `review` events `{cardId, mode, grade 1..4}` merged to canonical card ids
  (`canonical.ts`); timestamps are RFC 3339 instants.

## Approaches

1. **fsrs-browser** (npm `fsrs-browser` 6.6.0, BSD-3-Clause, fsrs-rs compiled to WebAssembly,
   338 KB wasm + 33 KB JS). Reference-quality parameters, identical to Anki's. But its memory is
   `WebAssembly.Memory({shared: true})` and it trains on a rayon thread pool
   (`wasm-bindgen-rayon`), so the page must be **cross-origin isolated** (COOP `same-origin` + COEP
   `require-corp`; Safari has no `credentialless`). That is an app-wide header change served by
   the Go SPA handler, needs a full document load for the page, constrains every later cross-origin
   resource (audio packs #43, AI photos), and cannot run in vitest, so the optimizer path would be
   untested.
2. **`@open-spaced-repetition/binding`** (MIT, napi-rs native addon for Node). Our server is Go
   and the client is a browser: unusable. No Go FSRS optimizer exists (go-fsrs schedules only).
3. **Own TypeScript optimizer** (chosen). The FSRS-6 forward pass is ~40 lines; a small
   reverse-mode autodiff (scalar tape) gives exact gradients; Adam with the same objective as
   fsrs-rs (binary cross-entropy of predicted recall) runs in a Web Worker. No dependency, MIT like
   the rest of the app, unit-testable against synthetic histories with known parameters, portable
   to Kotlin later.

- **Ruling: own TS optimizer (approach 3)** — no licence notice to carry, no cross-origin isolation,
  fully testable; the acceptance gate below caps the downside of a slightly weaker fit — cost if
  wrong: parameters a little worse than Anki's; fsrs-browser can replace the `optimize()` function
  behind the same interface without touching storage or UI.

## The model (must match ts-fsrs exactly)

`lib/study/fsrs/model.ts` implements the memory-state recursion once, generic over an arithmetic
interface (`Num<T>`: `add, sub, mul, div, pow, exp, log, min, max, const`) so the same code runs
on plain numbers (evaluation, preview) and on tape variables (gradients).

- First review with grade `g`: `S = max(w[g-1], 0.1)`, `D = clamp(w4 − e^{(g−1)·w5} + 1, 1, 10)`.
- Later review, `t = dateDiffInDays(lastReview, review)` (UTC days, as ts-fsrs), `R = (1 + f·t/S)^{−w20}`
  with `f = 0.9^{−1/w20} − 1`:
  - `t = 0` (same day): `S' = S · k` with `k = S^{−w19} · e^{w17·(g−3+w18)}`, and `k = max(k, 1)`
    when g ≥ 2;
  - `g = 1`: `S' = min(w11·D^{−w12}·((S+1)^{w13}−1)·e^{w14·(1−R)}, S / e^{w17·w18})`, floored at 0.001;
  - `g ≥ 2`: `S' = S·(1 + e^{w8}·(11−D)·S^{−w9}·(e^{w10·(1−R)}−1)·(w15 if g=2)·(w16 if g=4))`;
  - `D' = clamp(w7·D0(4) + (1−w7)·(D + (−w6·(g−3))·(10−D)/9), 1, 10)` where `D0(4) = w4 − e^{3·w5} + 1`
    is **not** clamped (with the defaults it is about −4.77; ts-fsrs clamps only the first review's D);
    S clamped to [0.001, 36500].
- **Ruling: no 8-decimal rounding in the own model** — rounding has no gradient; differences stay
  below 1e-6 relative, pinned by a test against `fsrs().next` — cost if wrong: none observable.

## Training data and objective

- Per canonical card, reviews sorted as `scheduler.ts` sorts them (time, then id). Every review
  after the first with `t ≥ 1` is one **labelled item**: `y = grade > 1`, predicted `R` from the
  state before it. Same-day reviews update the state but are not labelled (as fsrs-rs).
- Loss: mean BCE over labelled items + `GAMMA · Σ((w_i − d_i)/σ_i)²·(batch/total)`, `d` = defaults,
  `σ_i` = (clamp range of w_i)/4, `GAMMA = 1`.
- **Pretrain** w0..w3 (initial stabilities): for each first grade with ≥ 8 cards that have a second
  review at `t ≥ 1`, golden-section search of `S0 ∈ [0.1, 100]` minimising the BCE of those second
  reviews; otherwise the default. w0..w3 are then frozen; w4..w20 train with Adam (lr 0.04,
  β 0.9/0.999, 5 epochs, batches of whole cards ≈ 512 labelled items, seeded shuffle `PRNG(1)`),
  clamped to `CLAMP_PARAMETERS(2, true)` after every step.
- **Ruling: deterministic training** (fixed seed, card order by id before the seeded shuffle) —
  the same history gives the same weights on the same JS engine (floating-point results can differ
  between engines); the stored set is what syncs, nothing is recomputed on another device — cost if
  wrong: none.
- **Thresholds:** fewer than **400** labelled items → the button is disabled with "N more reviews
  needed". 400–999 → allowed, with a "little data: the fit may move a lot later" note.
- **Ruling: 400 labelled items** (Anki's documented floor) — cost if wrong: a threshold constant.

## Evaluation and the acceptance gate

`evaluate(w, dataset)` returns `logLoss` (mean BCE) and `rmseBins` (items binned by predicted R
into 20 equal bins, RMSE of mean predicted vs. observed recall weighted by bin count). The result
screen shows both for the active set and for the candidate.

- **Ruling: offer "Apply" only if the candidate's log loss is lower than the active set's** on the
  same data (Anki's rule); otherwise "Your current parameters already fit better" and nothing can
  be applied — cost if wrong: a learner cannot force a worse set (they still can by import).
- **Ruling: the comparison is in-sample, as in Anki** — a held-out split halves the data of small
  logs; the regulariser toward the defaults and the 400-item floor limit overfitting, and the gate
  exists to catch a failed optimisation, not overfitting — cost if wrong: a low-data learner may
  get a set that fits their past better than their future; the low-data note says so.

## Preview

Before applying, `previewChange(cards, reviews, wFrom, wTo, now)` replays every reviewed card under
both sets and shows: due now (before → after), due within 7 and 30 days, median interval of the
reviewed cards, and the 10 cards whose due date moves most (word, before, after). A line warns
that mastery scores and Word Salad tiers recompute too (they use stability). If "due now" more
than doubles and grows by over 50 cards, a warning says so.

## Storage (plugin data, `qinqin-flashcards`, workspace-scoped)

- `fsrs:set:<ulid>` → `{id, w: number[21], createdAt, source: 'optimized' | 'imported',
  labelled?: number, logLoss?: number, baselineLogLoss?: number}`.
- `fsrs:active` → `{setId: string | null, changedAt}`; `null` or a missing row means the defaults.
- **Ruling: sets are per workspace** — reviews and languages are per workspace — cost if wrong:
  a later "copy to workspace" button.
- **Ruling: applying or reverting writes only `fsrs:active`**; sets are never overwritten, so any
  earlier set stays one click away; deleting a non-active set is allowed — cost if wrong: none.
- **Ruling: out-of-range weights are rejected, never silently clipped.** `migrateParameters` clips
  quietly, so validation compares the raw numbers with `CLAMP_PARAMETERS(2, true)` (for 17/19
  numbers, the migrated result must equal the raw values on the indices they share). An import
  names the first bad weight ("Weight 6 is outside 0.001–4."); a stored row that fails (wrong
  length, non-finite, out of range) is ignored. An active pointer to a missing or invalid set means
  defaults — cost if wrong: a learner with hand-edited Anki weights must fix them first.
- Two devices changing `fsrs:active` at once: the later write wins (sync keeps one row).

## Threading the weights through

`StudyData` gains `fsrs: FsrsState = {active: ParamSet | null, sets: ParamSet[], w: readonly number[]}`
parsed from the same pull. `loadStudyData`/`loadStudyHistory` already return reviews merged to
canonical card ids, so training, preview and scheduling see the same cards.
- **Ruling: `w` is a required argument** of `scheduleFor(cardId, reviews, now, w)` and
  `BuildQueueOptions.w` — a default would let one forgotten caller (the home widget's due count,
  `FlashcardsWidget.svelte`, which reads `loadStudyHistory`) silently disagree with the session; the
  compiler lists every caller — cost if wrong: a wider diff. They select a memoised `fsrs({w})` instance per weight string (all other
options stay ts-fsrs defaults, as today: fuzz off, short-term on). Every caller passes `history.fsrs.w`. Without a set the behaviour is bit-identical to today.

## UI

A **Scheduling** page at `/study/scheduling`, linked from the study setup page ("Scheduling:
default parameters" / "optimised on 2026-11-20"):

```
Scheduling                               [workspace: 中文]
Active: Optimised 2026-11-20 · 2,140 reviews     [Use defaults]
──
Optimise   1,280 reviews since then              [Optimise]
  ███████░░░ training… 70 %                       [Cancel]
Result     log loss 0.312 → 0.287   RMSE 4.1 % → 2.6 %
Preview    due now 34 → 41 · next 7 days 210 → 188 · median interval 9 d → 11 d
           银行 due 25 Nov → 3 Dec … (10 rows)
           [Apply]  [Discard]
──
Saved sets   Optimised 2026-11-20 (active) · Imported 2026-11-02  [Use] [Delete]
Import / export   [paste 17, 19 or 21 numbers]  [Import]   [Copy active]
```

After Apply or Use, a toast "Parameters changed. [Undo]" restores the previous pointer.
Optimising runs in `optimizer.worker.ts`; progress is posted per batch; Cancel terminates the
worker. A worker error shows a message and changes nothing. Keyboard and screen reader friendly;
the progress bar is a `<progress>` with a text label.

- **Ruling: import accepts Anki's string** (17/19 FSRS-4.5/5 weights migrated by ts-fsrs
  `migrateParameters`, 21 FSRS-6) and must pass `checkParameters`; an imported set shows the
  same preview before it becomes active — cost if wrong: small parser.

## Performance target

10,000 labelled items finish in under 15 s in a Web Worker on a mid-range laptop. A vitest checks
3,000 synthetic items finish in under 20 s in Node (generous, catches accidental quadratic work).

## Testing

- Model parity: random histories, own `memoryState` vs. ts-fsrs `next()` within 1e-6 relative.
- Tape: gradients of each op against finite differences.
- Synthetic histories (`fsrs/synthetic.ts`): simulate cards under a known `wTrue` (seeded,
  intervals from the scheduler, recall sampled from R). The optimizer starting at defaults must
  lower log loss below the defaults' and come within 2 % of `wTrue`'s log loss; same input twice →
  identical weights.
- Gate, thresholds, preview counts, storage parsing, import parsing, revert.

## What is left to the builder

Component split inside the page, copy wording beyond the strings above, exact progress cadence.

## Builder check

A fresh subagent read this document against the code. Its five points were settled here: the
unclamped D0(4) in mean reversion (a factual error, fixed), the home widget as a caller (required
`w`), silent clipping by `migrateParameters` (reject instead), in-sample comparison (kept, as
Anki), and canonical ids (already merged by `loadStudyData`). None needed the owner.

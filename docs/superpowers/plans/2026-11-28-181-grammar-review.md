# #181 — spaced review of grammar points (2026-11-28)

Milestone v0.9.0, phase 5. Branch `feature/v090-181-grammar-review` from `feature/v0.9.0` (35037f35, ContractVersion
29). Builds on #277 (grammar runs are `grammar` events, `docs/contracts/grammar/runs.json`) and the study core from
#278. This builder does **not** hold the text-heavy slot: no content beyond UI strings, no teacher reviews.

## What (issue and owner decisions)

- A grammar point (`<packId>:<lessonId>`) is **learned** when its lesson is finished with at least **80 %**; from then
  on it has a spaced review schedule (FSRS, derived from events like flashcards).
- A **review run** uses the lesson's own examples: fill the gap with the authored distractors, and word order;
  **different examples each time** where the lesson has them.
- Reviews are **events** (#277): a `grammar` event with `mode: "review"`, so EXP, the streak, the heatmap and goals
  count them as #277 counts lesson runs.
- The **Grammar page** shows which points are due and when each was last reviewed.
- A **study session can include them** (a setup choice), with their own limit of **5 new grammar points a day**.
- The shared rules (the learned threshold, the review grade, due derivation, the daily new cap, the examples a review
  picks) are a contract: `docs/contracts/grammar/review.json`, contract 30.

## Tasks

1. This plan.
2. The review rules, test first: `lib/studycore/grammarReview.ts` (learned, grade, point states replayed through
   `scheduleTimeline`, the review round with the daily new cap, the examples a review picks) and the fixture
   `docs/contracts/grammar/review.json`, written by an oracle from plain ts-fsrs
   (`scripts/contracts/gen-grammar-review-fixtures.mjs`, `--check`). `parseGrammarRun` reads `mode: "review"`; lesson
   progress (best score) replays lesson runs only (`runs.json` cases); the activity fixture pins that a review run
   counts like a lesson run (a distinct point a day; Go decodes it). ContractVersion 30, CHANGELOG.
3. The Grammar page: a "Grammar review" section (due count, Review now, the next review), each learned lesson's row
   says due / next review and when it was last reviewed; the review round at `/grammar/review` (one point after
   another, its exercises, the run recorded through the outbox); the lesson result says when a point became learned.
   DOM tests first.
4. Sessions: the study setup row gains `grammar` (default `false`, `study/setup.json`), the study modal offers
   "Grammar review" while the grammar feature is on, with the count due; a session started with it runs the
   grammar review round after its cards (also when no card is due), and its summary counts the points and their EXP.
5. Phone width (`phone-width.spec.ts` gains `/grammar/review`), an e2e of a review, docs (grammar contract README,
   wiki, `docs/releases/NEXT.md`).

## Rulings

- Ruling: **learned** = a lesson run (mode `lesson`) with `total > 0` and `100 · score ≥ 80 · total` (whole numbers,
  no rounding); the first such run is the point's `learnedAt`. A review run never makes a point learned — the owner's
  rule names the lesson; a stray review of an unlearned point (an old client, a deleted-and-reinstalled pack) must not
  start a schedule — cost if wrong: one more case in the fixture.
- Ruling: **grammar review reuses the drills' per-item schedule** (`docs/contracts/drills/README.md`, "Schedule"):
  the point's runs from `learnedAt` on, in `(instant of ts, id)` order, are replayed as one card's reviews through
  `scheduleTimeline` with the **default FSRS weights** on the **study clock** (vacation days frozen); its own rule
  is only how a run becomes a grade — one schedule rule for every non-card item, and a second client reuses its
  drills code; the workspace's flashcard parameters are fitted to cards, not to grammar — cost if wrong: a point's
  intervals are the default FSRS ones, not personal ones.
- Ruling: **every run from `learnedAt` on feeds the schedule**, lesson runs included (the learned run is the first
  review, so a fresh point is due after FSRS's learning step, as a drill item answered Good is); runs with
  `total = 0` are skipped — practising the whole lesson again is a review of the point; one rule, no mode switch —
  cost if wrong: a lesson re-run moves the due like a review does.
- Ruling: **a run's grade**: `100 · score ≥ 80 · total` → 3 Good; else `2 · score ≥ total` → 2 Hard; else 1 Again;
  never Easy — the learned threshold is the "right" bar, so the same number means the same thing in both places; a
  review has at most three exercises, so 3/3 Good, 2/3 Hard, 1/3 and 0/3 Again; Easy would need a confidence the
  learner never states — cost if wrong: intervals grow a little slower than a self-rated Easy would make them.
- Ruling: **reviewed** means a run fed after the learned one (either mode): `reviews` counts them and
  `lastReviewed` is the last one's `ts` (null before the first). A learned point with no review yet is **new**.
- Ruling: **the daily new cap** (5): a learner day may start the reviews of at most 5 new points. `newToday` counts
  the points whose first review (the first run after `learnedAt`) falls on today's learner day (StudyDay, the
  learner's zone history); the round offers at most `max(0, 5 − newToday)` new points. Points that already had a
  review are not capped — the owner's limit is on new points; reviews of reviewed points keep their schedule, like
  flashcard reviews beyond the new limit — cost if wrong: a learner with many due reviewed points has a long round;
  the round size (below) bounds one sitting.
- Ruling: **the review round**: from the candidate points (the lessons of the installed packs of the workspace
  language, in pack and lesson order; a point whose lesson is gone is not offered): first the **due reviewed** points
  (`due ≤ now`), earliest due first, then point; then the **due new** points, earliest `learnedAt` first, then point,
  at most the cap left; at most **20** points (`roundSize`, the drills' round size) — due first is the flashcard
  rule; 20 keeps a session's grammar block short — cost if wrong: a learner reviews in two sittings.
- Ruling: **a review's exercises** (`pick`): at most **3** exercises, one per example, from the lesson's examples in
  lesson order starting at `(3 · n) mod E` (n the point's reviews so far, E the number of examples) and wrapping;
  the k-th exercise prefers a cloze when `n + k` is even, else word order, and takes the other kind when the example
  cannot be the preferred one (a cloze needs a focus found in the text and two distractors, as the lesson's; word
  order needs `noOrder` unset); an example that can be neither is skipped — the next review starts three examples
  further on, so a lesson with six or more examples shows new sentences each time, and the kinds alternate — cost if
  wrong: a lesson with few examples repeats them (unavoidable).
- Ruling: **counting**: a review run is a `grammar` run: 20 EXP (`lessonRunXp`), the streak, and the activity rule
  `distinct` on `point` (one point per grammar point worked on a learner day, lesson or review) — the server and the
  counting code are unchanged; the event type and the rule are #277's, `mode` was left open for this — cost if
  wrong: a review and a lesson run of one point on one day are one activity point.
- Ruling: **lesson progress** (the best score on the Grammar page and in courses) replays **lesson runs only** — a
  review has another number of exercises, which `applyRun` would read as a changed lesson and reset the best — cost
  if wrong: none; the review state is its own derivation.
- Ruling: **sessions run grammar review as a block after the cards**, not as a card kind mixed into the queue: a
  review is a multi-step run of a lesson (fill the gap, then word order) that needs the lesson from the server and
  segmentation, not a one-face card; the card queue, card ids, limits, eligibility (#288) and the session mix keep
  their contracts. The planning-time eligibility of a point is that its lesson is installed (`GET /api/grammar` of
  the workspace language); the block reads the lesson when it reaches the point and skips a point whose lesson is
  gone — cost if wrong: grammar is not interleaved with cards (a later change can mix blocks).
- Ruling: the setup choice is a member `grammar` (boolean, default `false`) of the synced `study-setup` row, shown
  in the study modal only while the grammar feature is on; a session whose setup has it but whose grammar feature is
  off runs no block — a setup choice, as the owner said, on every device like the rest of the setup — cost if wrong:
  one more member to read.
- Ruling: the review round is its own components (`lib/features/grammar/review/`), not a change to
  `PracticeRun.svelte` — #222's lesson player uses the lesson code in parallel; separate files keep both merges clean
  — cost if wrong: two components render a cloze and a word order (a later refactor can share one step component).
- Ruling: the review fixtures are **web fixtures** (Go decodes the activity case): the server has no FSRS and never
  reads a run's mode or score, as with the drills' `schedule.json` and `pick.json`; a second client (Android) runs
  the web app — cost if wrong: a native client decodes them later.

## Pending review (text-heavy slot not held)

No content is written: every sentence a review shows is the lesson's own (already reviewed with the grammar packs).
The new UI strings (en only; `de`/`ja` catalogues do not exist yet in v0.9.0, #144/#145 translate last) need no
teacher review. Nothing queued.

## Local follow-up

- Android shell (#181): open the Grammar page and a review round in the APK on an emulator or phone; the back button
  from `/grammar/review` returns to `/grammar`, the word-order tiles and the fill-the-gap choices work by touch, the
  keyboard does not pop up. Commands: `cd apps/android && ./gradlew assembleDebug`, install, open Grammar.

## Execution record

(filled in as the tasks land)

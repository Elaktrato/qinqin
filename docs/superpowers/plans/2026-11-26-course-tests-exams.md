# Unit tests and section exams — plan (issue #224)

Overview: `docs/superpowers/specs/2026-11-26-v090-courses-overview.md` (stage C, after #222's player). Design: courses
design §7. Needs #221 (events `unit-test`, `section-exam`, `skip`, `placement`; the path derivation applies a
passed test) and #222 (a test is a lesson type in the player). Builds on the level check and placement
(#82, #74, merged in v0.8.0): the seeded sampler and the question-card plumbing. Contract: none if #221 already
holds the event kinds and `passMark` fields (it does); otherwise the test-composition rule goes into
`docs/contracts/courses/tests.json` (expected contract 15). Builder: one agent, branch `feature/v090-course-tests`.
Test first in every task; one commit per task.

## Decision (owner, 2026-11-26: overview decision 2)

The level check (#82) and placement (#74) are **self-reported** ("do you know this word?"). A test that lets a
learner skip a unit must be **graded**: a learner who clicks "I know" on everything would otherwise skip the
whole course. So tests ask real questions; the level check's *sampler* (seeded, stratified) is reused, its
*answer model* is not. The owner chose graded questions for unit tests and section exams; self-report stays for
placement (#74) and the level check (#82).

## Shape

- **Unit test:** 10–15 mixed items from the unit: word items (about 60 %), grammar items (about 25 %) and reading
  items (about 15 %). Pass mark from `checkpoints.unitPassMark` (default 0.8). Passing unlocks the next unit;
  taken early and passed, it unlocks and **skips** everything before it (marks those units' words known, one
  batch, `source: "course"`).
- **Section exam:** 30–40 items drawn evenly from the section's units by the level check's stratified sampler,
  same mix; pass mark `sectionPassMark` (default 0.85). Passing skips the section's units.
- **Items:**
  - *word:* "meaning of this word" multiple choice (4 options: the correct gloss plus 3 distractors of the same
    part of speech and level), or "pick the word for this meaning", seeded per (workspace, test id, attempt) so a
    retry differs but a reload does not;
  - *grammar:* the exercises of the unit's grammar lessons (existing exercise data, scored);
  - *reading:* cloze of the unit's text (blank a word the learner has met, 4 options from the text's other words
    and the level), 2–3 per test. No authored comprehension questions (Ruling 3).
- **Kind feedback:** the result shows the score, what to review (the lessons whose items were missed, linking to
  them) and "Try again"; failing never takes progress away; retries are free and reseeded.
- **Placement (#74)** may place a learner by running the section exams in order (an optional "Take the real
  exam" step after the self-report) — the placement flow itself is unchanged by default.

## Tasks

1. **Pure test builder** (`lib/course/tests/build.ts`): `buildUnitTest(course, unit, seed)` and
   `buildSectionExam(course, section, seed)` → items with options and the answer; table tests: determinism per
   seed, different seeds differ, the mix proportions, distractors share part of speech and are not the answer,
   a unit with too few words falls back to fewer items, no item twice.
2. **Scoring and the result rule** (`score.ts`): pass/fail against the mark, the review list; table tests.
3. **Distractor source:** a helper over the entries cache (`lib/study/entriesCache.ts`) that picks same-POS,
   same-level glosses; test with fixtures; a missing gloss makes the item unavailable (never a blank option).
4. **Player integration:** a `test` lesson type in #222's machine (steps: items, result); jsdom test of a full
   run, a pass (the event `unit-test {passed: true}` and the skip batch), a fail (no state change), a retry.
5. **Skip on pass-early:** the batch of known marks for skipped units through the declaration helpers (#74);
   Undo through the roadmap; the derivation (#221 `path.ts`) already unlocks; a contract test exercises "pass a
   later test → earlier units skipped".
6. **Roadmap wiring:** the unit-test circle (the check-badge circle at the end of each unit) and the section-exam
   wall of #222 become live; a locked unit's test and any section's exam are available any time (test out). Passing a
   section exam opens the wall and unlocks the next section (the section gate of #221's `path.ts`); failing changes
   nothing and the wall stays closed; the result screen offers "Try again" and links to the lessons to review.
7. **E2E** `e2e/tests/course-tests.spec.ts` (written here, run in CI only): take a unit test, fail, retry, pass.
8. **Docs:** wiki `Courses` (tests, skipping, undo), the contracts README if a fixture was added, ROADMAP.
9. **Verify:** `npm run check`, `npm test`, merge `origin/develop`, PR; core emulator job passes.

## Rulings

- Ruling 1: tests are **graded multiple choice**, not self-report — a test out must be earned — if wrong (the owner
  wants self-report), a learner can skip freely (cost: wasted effort for a feature that can be reduced to the
  existing question card).
- Ruling 2: the pass marks live in the course pack (`checkpoints`), 80 % and 85 % by default — tuning needs no
  release — if wrong, the marks are too hard or too easy (cost: a pack edit).
- Ruling 3: the reading part is a **cloze over the unit's text**, not authored comprehension questions — authored
  questions would double the content to write and review (#223) — if wrong, comprehension is not tested
  (cost: a later authored-question field in the text format).
- Ruling 4: distractors come from the dictionary's glosses at the same level and part of speech — no extra
  data — if wrong, distractors are sometimes too easy or ambiguous (cost: a "report this question" is **not**
  built; the seeded builder can exclude a word via a skeleton list).
- Ruling 5: retries are free and reseeded — "kind feedback" in the issue — if wrong, a learner brute-forces a
  test (cost: nothing is lost; the known marks are undoable).

## Needs human review

Question quality: the owner takes a few tests per language in the player (distractors, ambiguous glosses, the
cloze). No native-speaker review is planned; distractors are the likeliest source of a bad question.

## Done when

A learner can pass a later unit test and see the earlier units skipped with their words known, fail a test
and retry without losing anything, and undo a skip; the seeded builder is deterministic under test; CI green.

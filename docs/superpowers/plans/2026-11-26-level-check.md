# Level check — plan (issue #82, experimental)

Design: `docs/superpowers/specs/2026-11-26-level-check-design.md`. Web only: no server code, no contract change.
Builds on the placement test (#74): the seeded generator, the level loader and the question card are shared.
Test first in every task; one commit per task.

1. **Share the generator**: export `pick` from `lib/placement/placement.ts`.
2. **Pure level check** (`lib/placement/levelCheck.ts` + table tests): `planCheck` (coverage by the shared known
   predicate, per level and total, seeded sample of the not-yet-known) and `checkEstimate` (readiness, Wilson
   range, band, per-level share, next level).
3. **Question card** (`SelfAssessQuestion.svelte`): extracted from `PlacementTest.svelte`, which uses it
   unchanged in behaviour (its jsdom tests stay green).
4. **Known index loader** (`knownIndexLoad.ts`): the workspace's index for the shared predicate.
5. **UI** (`LevelCheck.svelte`, Settings → Study): target picker, limits wording, "Experimental" chip, question
   flow, result (coverage, estimate and range, band, per level, what to study next as a level session);
   i18n keys under `settings.levelCheck.*`; jsdom test.
6. **E2E** (`e2e/tests/level-check.spec.ts`): limits shown, estimate, nothing written, study button starts a
   session. Written here, run in CI only (no local browser).
7. **Docs**: wiki "Settings tour", ROADMAP.
8. **Verify**: vitest, `npm run check`, then fetch and merge `origin/feature/v0.8.0`; PR into `feature/v0.8.0`.

## Review fixes (v0.8.0)

Branch `fix/v080-web-correctness` (web correctness findings 2, 3, 8, 9, 10, 11, 12 of the independent review). Each
finding verified in the code first, test-first.

- Ruling: the level-check sample is stratified by level, evenly shared (a small level gives all it has, the rest
  goes to the others), seeded per level — a single pooled yes-rate over a uniform sample applied to every level sent a
  learner who knew HSK 1-3 and checked HSK 4 back to "Start with HSK 1" — if wrong, an uneven level mix is asked
  (cost: a slightly wider range for the biggest level, never a wrong level).
- Ruling: each level gets its own rate and 90 % Wilson range; a level with fewer than 3 answers
  (`MIN_LEVEL_ANSWERS`) borrows the pooled rate and the result says so ("estimated from all levels together") — an
  honest range per level with 20 questions needs a floor, and silently pooling is what caused the bug — if wrong,
  a level with 2 answers is judged on the pool (cost: the next-step pointer is less sharp for schemes with 7+ levels).
- Ruling: `next` is the lowest level whose per-level point estimate (data-known entries plus own rate times the
  not-yet-known) is under 90 % — the data-known coverage already counts in it — if wrong, a level at 88 % with a wide
  range is pointed at (cost: one extra level of review, which is cheap).
- Ruling: when every not-yet-known entry was asked the result is exact: no "Likely between", no range, a line says
  "Exact" — a range around a complete count is false precision — if wrong, nothing but a missing range line.

Cross-references: placement plan (declaration fixes) and writing-systems, hints and starter-mode plans (their own
"Review fixes (v0.8.0)" sections).

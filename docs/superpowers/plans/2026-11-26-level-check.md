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

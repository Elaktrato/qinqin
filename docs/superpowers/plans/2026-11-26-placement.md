# Placement test and "I already know this" — plan (issue #74)

Design: `docs/superpowers/specs/2026-11-26-placement-design.md`. Web only: no server code, no new key family.
Test first in every task; one commit per task.

1. **Known marks carry a declaration** (`lib/study/knownMarks.ts`): optional `batch` / `source` / `scope`
   on the existing `known:<entryId>` row; `parseKnownBatch`; the read model collects `knownBatches`
   (`lib/study/readModel.ts`, `types.ts`, `data.ts`).
2. **Declaration rules** (`lib/placement/declare.ts`, pure): the entries a range declaration newly marks, the
   batch list, the undo plan.
3. **Placement algorithm** (`lib/placement/placement.ts`, pure): seeded PRNG, bisection over levels, early stop,
   result; table tests.
4. **Commands** (`lib/study/commands/keyed.ts`): `declareKnown` / `undoDeclaration` over the keyed push
   with the batch fields.
5. **Level loading** (`lib/placement/levels.ts`): a scheme's levels as entry lists from the session cache.
6. **UI**: `KnownSettings.svelte` (Settings → Study: range declaration, declarations with undo, the test),
   `PlacementTest.svelte`, `PlacementOffer.svelte` on Home; i18n keys; jsdom tests; e2e spec.
7. **Contracts and docs**: `reader/` README and fixture cases, `CHANGELOG` `(contract 5)`, `ContractVersion`,
   `version.json`, wiki page, ROADMAP.
8. **Verify**: vitest, `npm run check`, Go tests for the version/contract guard; PR into `feature/v0.8.0`.

## Review fixes (v0.8.0)

Branch `fix/v080-web-correctness`; rulings are in [level-check.md](2026-11-26-level-check.md) (stratified sample) and here for the declarations (#74).

- Ruling: a declaration is blocked until the learner's existing marks loaded successfully (loading and error states, a retry button) — a declaration built on an empty `marked` re-stamps the learner's own marks with its batch id and Undo then deletes them — if wrong, the learner waits for one reload before declaring.
- Ruling: the confirm buttons (range and placement test) are disabled while `declare()` runs, and `declare()` itself returns early when busy — a double tap wrote two batches — if wrong, a second tap is ignored, harmless.
- Ruling: a failed declaration keeps its batch id in memory and the retry reuses it (same ids, same scope and source), with "Saving n of m" progress from `setKnownMarks`' `onProgress` — a retry after a partial 50-push run made a second batch, so Undo of one left the other — if wrong (page reloaded in between), a second batch is made, as before.
- Ruling: a scheme that resolves to zero entries disables Mark and the placement test and says so — the test on zero entries is a dead end — if wrong, a scheme with data cannot be declared (it is not: the check is the loaded level list).

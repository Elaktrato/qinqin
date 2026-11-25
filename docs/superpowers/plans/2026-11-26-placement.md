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

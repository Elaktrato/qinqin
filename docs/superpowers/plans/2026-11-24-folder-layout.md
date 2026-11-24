# Plan — web folder layout rules and the moves to match (#195)

Issue #195 (the last issue of phase 3 of #190). Branch `feature/195-folder-layout` from `develop` at c9a61718,
worktree `.claude/worktrees/195-layout`. A pure move: paths, two renames and one dead-file deletion; no behaviour
change, every test keeps passing, the e2e suite needs no spec change. Owner direction (2026-11-24): no backwards
compatibility, so nothing stays behind at an old path (no re-export shims). Record
[0004](../../architecture/0004-web-folder-rules.md) becomes `Accepted` with the real rule and its guard test.

## Survey (c9a61718)

The issue was written before #193, #196, #199, #185, #186 and #189. What is there now under `apps/web/src/lib`:

- **34 top-level `.ts` files** (16 modules, 18 tests), of which 7 are tests of the repository itself (docs, README,
  wiki, licence texts, bundle size), not of a module.
- **`lib/components`** (19 components, 2 helper modules, `map/` with 3): an import graph (every `import`, dynamic
  import and `vi.mock` in `src/`, test files and `testing/` harnesses not counted) shows that only `AiTag`,
  `Flag`, `PlayButton`, `ReadingText` and `clozeKeys.ts` are used by two or more features. `ReadingTable` and
  `ClozeChoice`, named as shared by the issue, are now used by one feature each (flashcards, grammar).
  `ActivityHeatmap` is built from `lib/activity`'s pieces only.
- **UI in logic folders:** `study/DeckCardTypes.svelte` and `study/UnreadableRowsNotice.svelte` (both on the
  flashcards study page), `i18n/Msg.svelte` (the generic rich-text message component).
- **Same component name twice:** `components/EntryEditor.svelte` (the dictionary entry editor) and
  `features/journal/EntryEditor.svelte` (the journal's). Two test stubs are both called `EmptyStub.test.svelte`.
- **Dead:** `lib/listbox.ts` is imported only by its own test (searched `listbox` across `src/`: the other hits
  are ARIA role text).
- `lib/features/` holds the four switchable core features (record 0006: `index.ts` lists them) plus the switch
  code and `FeaturePage.svelte`; the other feature folders (`entry`, `stats`, `settings`, `widgets`, ...) sit
  at the top of `lib/`.
- The vitest projects include only `src/**`; the generated `.svelte-kit/tsconfig.json` includes `../test/**`
  (singular), not `../tests/**`.

## Moves (old path → new path), one commit per area

Paths are under `apps/web/src/lib/` unless they start with `tests/`. A test moves with its module.

### 1. Repository tests → `apps/web/tests/repo/`

| Old | New |
|---|---|
| `architectureDocs.test.ts`, `contractsDocs.test.ts`, `readmeDocs.test.ts`, `readmeGallery.test.ts`, `wikiDocs.test.ts` | `tests/repo/` (same names) |
| `bundleSize.test.ts`, `thirdPartyLicenses.test.ts` | `tests/repo/` (same names) |

Plus: the vitest `unit` project includes `tests/**/*.test.ts`; `svelte.config.js` adds `../tests/**/*.ts` to
the generated tsconfig (`kit.typescript.config`) so `npm run check` type-checks them.

### 2. Loose modules → owning folders

| Old | New |
|---|---|
| `auth.svelte.ts`, `auth.test.ts`, `authCleanup.dom.test.ts`, `authTabs.dom.test.ts` | `auth/` |
| `events.ts`, `events.test.ts` | `events/index.ts`, `events/index.test.ts` |
| `eventPages.ts`, `eventPayloads.ts`, `ulid.ts` (+ tests) | `events/` |
| `routeAccess.ts`, `legacyRoutes.ts`, `pageTitle.ts` (+ tests), `pageTitles.dom.test.ts`, `routeTitles.test.ts` | `routing/` |
| `workspaces.svelte.ts`, `workspaceCache.ts`, `workspaceDelete.ts`, `workspaceGone.ts`, `dictionaryVisibility.ts` (+ tests) | `workspace/` |
| `languages.ts`, `languages.test.ts` | `languages/index.ts`, `languages/index.test.ts` |
| `languageProfiles.ts`, `languageProfiles.test.ts` | `languages/profiles.ts`, `languages/profiles.test.ts` |
| `coverage.ts`, `format.ts` (+ tests) | `languages/` |
| `app.ts`, `notices.svelte.ts` (+ test) | `frame/` |
| `licenses.ts` (+ test) | `sources/` |
| `searchFilters.ts` (+ test) | `search/` |
| `statsTabs.ts` (+ test) | `stats/` |
| `listbox.ts`, `listbox.test.ts` | deleted (dead) |

### 3. Components and UI in logic folders → owners

| Old | New |
|---|---|
| `components/AddToStudy`, `Badges`, `badgeText.ts`, `Readings`, `Senses`, `Sentences`, `StrokePlayer` (+ tests) | `entry/` |
| `components/EntryEditor.svelte` (+ test) | `entry/EntryEditForm.svelte` (renamed) |
| `components/CardManager.svelte`, `study/DeckCardTypes.svelte` (+ tests) | `features/flashcards/decks/` |
| `study/UnreadableRowsNotice.svelte` (+ test) | `features/flashcards/` |
| `components/ReadingTable.svelte` (+ test) | `features/flashcards/cards/` |
| `components/ClozeChoice.svelte` (+ test) | `features/grammar/` |
| `components/map/*` | `stats/map/` |
| `components/ActivityHeatmap.svelte` (+ tests) | `activity/` |
| `components/Logo.svelte` (+ test) | `frame/` |
| `components/WorkspaceCreateForm`, `WorkspaceLabel`, `DeleteWorkspaceDialog` (+ tests) | `workspace/` |
| `i18n/Msg.svelte` (+ test) | `ui/` |

Left in `lib/components`: `AiTag`, `Flag`, `PlayButton`, `ReadingText`, `clozeKeys.ts`.

### 4. The guard and the record

`apps/web/tests/repo/folderRules.test.ts`, record 0004 `Accepted`, the wiki (Project-layout, Development).

## Rulings

- Ruling: `lib/features/` keeps only the switchable core features (flashcards, reader, journal, grammar); every
  other feature folder (`entry`, `stats`, `settings`, `widgets`, `workspace`, ...) stays at the top of `lib/` —
  record 0006 and the feature-switch contract already give `lib/features/` that meaning, and moving twenty
  folders under it would rewrite most imports for no gain in clarity — cost if wrong: one more move of whole
  folders, mechanical.
- Ruling: `lib/widgets` is a feature folder (the home page and the Stats overview board) — it owns its widgets
  and their registry; a widget of one feature lives with that feature (`FlashcardsWidget`) — cost if wrong: none
  beyond the guard's classification.
- Ruling: `ActivityHeatmap` goes to `lib/activity/`, not `lib/widgets/` as the issue said — it is composed only of
  `lib/activity`'s month, week and garden views and its state; the widget board only places it — cost if wrong:
  one file move.
- Ruling: `ReadingTable` and `ClozeChoice` leave `lib/components` (to flashcards' `cards/` and to grammar) though
  the issue named them as shared — today each is used by one feature only; `clozeKeys.ts` (the cloze keyboard
  model) stays, since grammar's `ClozeChoice` and flashcards' `ClozeCard` both use it — cost if wrong: a move
  back when a second feature takes one up, which the guard then demands.
- Ruling: a feature of an importer is its folder under `lib/` (`lib/features/<f>` counts as `<f>`); a route
  counts as the feature it shows (`routes/study`, `routes/flashcards` → flashcards; `routes/+layout.svelte` →
  frame; `routes/+page.svelte` → widgets; `routes/login`, `register`, `reset`, `account` → account; the rest by
  their first segment) — closes the record's open question; the map lives in the guard and a new route folder
  without an entry fails it — cost if wrong: a wrong entry lets a one-feature widget stay shared, review catches.
- Ruling: tests and `testing/` harnesses do not count as users (for the `lib/components` and `lib/ui` checks) and
  `*.test.svelte` stubs are exempt from the folder and unique-name checks — a test may import anything, and
  the UI gallery harness (`lib/ui/testing/Gallery.svelte`) shows real domain widgets such as `Flag` — cost if
  wrong: a domain import into `lib/ui` hidden in a harness, which ships nothing.
- Ruling: `lib/ui` may import only `lib/ui`, `lib/i18n` and `lib/theme` (plus packages) — the building blocks
  show translated labels and read the design tokens; everything else in `$lib` is domain — cost if wrong: a
  needed generic helper must first move into `lib/ui`.
- Ruling: the logic-only folders are `api`, `audio`, `auth`, `context`, `events`, `fonts`, `i18n`, `languages`,
  `lookups`, `packages`, `radicals`, `routing`, `session`, `study`, `sync`, `theme`, `time`, `writing` — shared
  layers below the features; a feature folder may mix UI and logic — cost if wrong: a UI piece that belongs to a
  layer has to live in `lib/ui` or a feature.
- Ruling: `Msg.svelte` moves from `lib/i18n` to `lib/ui` — it is the generic rich-text building block, with no
  domain knowledge, and `lib/i18n` becomes logic-only — cost if wrong: thirty import lines, mechanical.
- Ruling: `events.ts` becomes `events/index.ts` and `languages.ts` becomes `languages/index.ts`, so `$lib/events`
  and `$lib/languages` keep naming them, like `$lib/i18n` and `$lib/features`; `languageProfiles.ts` is renamed
  `languages/profiles.ts` — the folder already says "language" — cost if wrong: renames only.
- Ruling: `ulid.ts` goes to `lib/events/` — its header says it generates event ids; the other users (deck and
  plan ids) take it from there — cost if wrong: one move.
- Ruling: `dictionaryVisibility.ts` goes to `lib/workspace/` (it reads a workspace setting); `coverage.ts` and
  `format.ts` (reading labels) to `lib/languages/`; `licenses.ts` to `lib/sources/`; `app.ts` (the app name)
  and `notices.svelte.ts` (the shell's notice) to `lib/frame/` — each sits with what it describes; with that the
  top of `lib/` has no loose `.ts` at all and the guard's allow-list is empty — cost if wrong: one move each.
- Ruling: the dictionary `EntryEditor` is renamed `EntryEditForm`; the journal's `EntryEditor` keeps its name —
  the issue's choice; the journal's is the editor of a journal entry — cost if wrong: a rename.
- Ruling: cross-folder imports of moved code use `$lib/...`; an import inside one folder (or into its subfolders)
  stays relative, like the code around it — the rewrite is a codemod over every import, dynamic import and
  `vi.mock`, then a search for paths in strings (lint lists, `readFileSync`, `?raw` imports) — cost if wrong:
  style only.
- Ruling: the repository tests keep the `unit` vitest project (plain node), so CI's `npm test` runs them with no
  workflow change — cost if wrong: none.

## Execution record

- **Baseline** (c9a61718, Node 26, no build present): 612 test files, 12872 passed and 8 skipped (12880).
- **Guard first.** `folderRules.ts` and `folderRules.test.ts` were written before any move and run against the
  tree as it was: the real-tree checks failed with 19 single-feature files in `lib/components`, 3 components in
  logic folders, the `EntryEditor.svelte` pair and 49 loose files at the top of `lib/`; the `lib/ui` check
  passed from the start (its one domain import is the gallery harness, exempt by Ruling). The planted-tree
  cases passed. The guard was kept out of the tree until the moves were done, so every commit stays green. On
  the finished tree each of the six real-tree checks was made to fail once by a planted violation (a `lib/ui`
  import of `$lib/api/client`, a component used by one feature, a component in `lib/study`, a second
  `Flag.svelte`, a loose `lib/planted.ts`, a route folder `routes/quiz`), then the plants were removed.
- **Codemod.** The moves ran through a script (outside the repository) that `git mv`s each file and rewrites
  every static import, dynamic import, side-effect import, `vi.mock`/`vi.doMock`/`vi.importActual` and
  `?raw` import whose target or importer moved; a second pass rewrote path mentions in strings and docs
  (`lib/<old>` → `lib/<new>`, exact file names) outside `docs/superpowers/` (past plans keep the paths of
  their day). A check of all 384 `vi.mock`-family paths after the moves found none stale.
- **Found by the tests, fixed by hand:** `routing/routeTitles.test.ts` resolved `src/routes` from `__dirname`
  one level too shallow after its move; the UTC guard's allow-list key `/src/lib/events.ts` (not caught by the
  path pass because of its leading slash); the UI lint's `pending.json` lists must stay sorted, and two moved
  paths sorted differently.
- **Extra changes:** the doc checks (`architectureDocs`, `contractsDocs`) and `noWallClock.test.ts` now scan
  `apps/web/tests/` too, since the repository tests left `src/`; the `noWallClock` root was added in the last
  commit, not with the move of the tests (no test there measures time, so nothing was missed in between).
  `svelte.config.js` did not need a change: the generated tsconfig already includes `../tests/**`.
  One Go comment (`server/internal/lang/profile.go`) named the moved profile table; `go vet` and the
  `internal/lang` tests ran.
- **Counts after** (Node 26, build present): 612 files, 12888 passed and 2 skipped (12890). The difference:
  the 6 tests of the deleted `listbox.test.ts` (one file) go, the 13 tests of `folderRules.test.ts` (one file)
  come, record 0004 being `Accepted` adds 3 doc-check cases, and the bundle-size check that skips without a
  build ran (8 skipped before, 2 after). After the moves alone (bd6e4588, 003c60af): 611 files, 12872 passed and
  2 skipped (12874 = 12880 − 6).
- **Node 22** (the local default) fails 5 tests of `AccountSettings.dom.test.ts` and `BookView.dom.test.ts` on
  the untouched develop too; the gates used Node 26, as CI does.
- **Other gates** on the last commit: `npm run check` 0 errors (1753 files), build passes, `node --test
  scripts/*.test.mjs` 156 passed and 1 skipped, `gen-api-docs --check` clean, e2e (`npm run e2e -- --trace off`)
  17 passed in each of 3 runs with no spec changed. Not verified: the app in a browser by hand, and CI itself.

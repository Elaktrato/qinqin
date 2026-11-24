# 0004. Web: folder rules

## Status

Accepted

Touched by: #195. A merge from one of these issues that changes what this record names updates the record.

## Context

`apps/web/src/lib/components` was a grab-bag: most of it was used by one feature only. About 20 loose modules
sat at the top of `lib/`, beside about 30 tests of the repository itself (contract docs, README, wiki, licences,
bundle size). Some UI sat in logic folders (`DeckCardTypes` and `UnreadableRowsNotice` in `lib/study`, `Msg` in
`lib/i18n`), and two different files were called `EntryEditor.svelte` (#195). #195 decided the rule below and
moved the code to match it (`docs/superpowers/plans/2026-11-24-folder-layout.md` has the full table of moves).

## Decision

Under `apps/web/src/lib/`:

- **`lib/ui`**: generic building blocks with no domain knowledge (`Button`, `Dialog`, `Tabs`, `Msg`, ...). It
  imports only itself, `lib/i18n` (translated labels) and `lib/theme` (the design tokens).
- **`lib/frame`**: the app chrome (top bar, phone bar, drawer, menus, `Logo`, the page frame, the shell's
  notices, the app's name in `app.ts`).
- **Feature folders**: everything owned by one feature, UI and logic. The four switchable core features live
  under `lib/features/<feature>` (flashcards, reader, journal, grammar: the features of record
  [0006](0006-core-features-instead-of-code-plugins.md), each with a switch); every other feature folder sits
  at the top of `lib/`: `account`, `activity`, `admin`, `entry`, `goals`, `milestones`, `notes`, `pwa`,
  `search`, `settings`, `sources`, `stats`, `weekly`, `widgets` (the home and Stats overview board) and
  `workspace`.
- **Logic-only folders**: the shared layers below the features, with no component: `api`, `audio`, `auth`,
  `context`, `events`, `fonts`, `i18n`, `languages`, `lookups`, `packages`, `radicals`, `routing`, `session`,
  `study`, `sync`, `theme`, `time`, `writing`.
- **`lib/components`**: only domain widgets shared by two or more features (today `AiTag`, `Flag`,
  `PlayButton`, `ReadingText` and the cloze keyboard model `clozeKeys.ts`). A route counts as the feature it
  shows (`routes/study` and `routes/flashcards` are flashcards, `routes/+layout.svelte` is the frame,
  `routes/+page.svelte` the widget board, `routes/login`, `register` and `reset` are account; the others by
  their folder name); tests and `testing/` harnesses are not users.
- **Nothing loose at the top of `lib/`**: every module sits in the folder of what it describes.
- **One name per component**: no two components under `lib/` share a file name (the dictionary entry editor is
  `lib/entry/EntryEditForm.svelte`, the journal's is `lib/features/journal/EntryEditor.svelte`).
- **Repository tests** (the docs, the README, the wiki, the shipped licence texts, the bundle size, these folder
  rules) live in `apps/web/tests/repo/`, outside `src/`; the vitest `unit` project runs them.

Imports across folders use `$lib/...`; inside one folder they stay relative.

## Consequences

- A file's folder says who owns it; a component used by one feature lives with that feature.
- A widget that gains a second feature moves to `lib/components`; one that loses it moves back, and the guard
  says so.
- A generic piece a layer needs to render goes to `lib/ui`; a domain one to its feature.
- A new route folder names its feature in the guard's table.
- Record [0007](0007-browser-end-to-end-tests.md)'s suite in `apps/web/e2e/` is outside `src/`, so these rules
  do not apply to it.

## Allowed / Not allowed

Allowed:

- `lib/ui` imported from anywhere.
- A feature folder importing `lib/ui`, `lib/components`, the logic folders and another feature's public piece
  (the widget board shows `StageBar` from `lib/stats/map` and the widget the flashcards manifest names).
- A test, a `*.test.svelte` stub or a `testing/` harness next to the code it tests; the UI gallery harness
  (`apps/web/src/lib/ui/testing/Gallery.svelte`) shows real domain widgets.

Not allowed:

- `lib/ui` importing a feature folder, `lib/components` or a domain module.
- A file in `lib/components` used by only one feature.
- A component in a logic-only folder.
- Two components with the same file name.
- A loose module at the top of `lib/` (the guard's allow-list, `LOOSE_ALLOWED`, is empty).
- A re-export left at an old path after a move.

## Enforcement

- `apps/web/tests/repo/folderRules.test.ts` runs the checks of `apps/web/tests/repo/folderRules.ts` on the real
  tree and shows each failing on a planted tree: `uiImportFindings` (the allow-list `UI_MAY_IMPORT`),
  `sharedComponentFindings` (features by `ownerOf`, routes by `ROUTE_FEATURES`), `logicFolderFindings`
  (`LOGIC_FOLDERS`), `duplicateNameFindings`, `looseFileFindings` and `unmappedRouteFindings` (a route folder
  missing from `ROUTE_FEATURES`). It also fails when a logic folder or an allowed loose file it names is gone.
- Review: whether a new folder is a feature or a logic layer (the guard knows only the listed logic folders),
  whether a component is generic enough for `lib/ui`, and the import style.

## Open questions

None. Resolved in #195: `lib/widgets` is a feature folder (the board); a route counts as the feature it shows,
through the guard's table.

# 0004. Web: folder rules

## Status

Accepted

Touched by: #278 (the study core). A merge from an issue that changes what this record names adds it here and
updates the record.

## Context

`apps/web/src/lib/components` was a grab-bag: most of it was used by one feature only. About 20 loose modules
sat at the top of `lib/`, beside 7 tests of the repository itself (contract docs, README, wiki, licences,
bundle size). Some UI sat in logic folders (`DeckCardTypes` and `UnreadableRowsNotice` in `lib/study`, `Msg` in
`lib/i18n`), and two different files were called `EntryEditor.svelte` (#195). #195 decided the rule below and
moved the code to match it (`docs/superpowers/plans/2026-11-24-folder-layout.md` has the full table of moves).
`lib/study` then still held two things under one name: the flashcard-only code and the study data every feature
reads. #278 split it (`docs/superpowers/plans/2026-11-27-278-study-core.md` has the module map).

## Decision

Under `apps/web/src/lib/`:

- **`lib/ui`**: generic building blocks with no domain knowledge (`Button`, `Dialog`, `Tabs`, `Msg`, ...). It
  imports only itself, `lib/i18n` (translated labels) and `lib/theme` (the design tokens).
- **`lib/frame`**: the app chrome (top bar, phone bar, drawer, menus, `Logo`, the page frame, the shell's
  notices, the app's name in `app.ts`).
- **Feature folders**: everything owned by one feature, UI and logic. The four switchable core features live
  under `lib/features/<feature>` (flashcards, reader, journal, grammar: the features of record
  [0006](0006-core-features-instead-of-code-plugins.md), each with a switch); every other feature folder sits
  at the top of `lib/`: `account`, `activity`, `admin`, `aids` (the visual aids: tone colours, pictures, anatomy), `entry`, `goals`, `lookups` (the lookup history and
  its page), `milestones`, `notes`, `placement` (the placement test and "I already know this", #74), `pwa`, `search`, `settings`, `sources`, `starter` (Starter mode's settings, offer and add button, #214), `stats`, `weekly`, `widgets` (the
  home and Stats overview board) and `workspace`.
- **Logic-only folders**: the shared layers below the features, with no component: `api`, `audio`, `auth`,
  `context`, `events`, `exercises`, `fonts`, `i18n`, `languages`, `native`, `packages`, `radicals`, `routing`,
  `session`, `studycore`, `sync`, `theme`, `time`, `writing`.
- **The study core** (`lib/studycore`, with `lib/exercises`): what every feature reads of studying. The study
  cache and its read model (`data`, `cache`, `readModel`, `rows`, `plan`, the shapes and parsers of the card,
  deck, limit and FSRS rows), the event log and the review outbox (`events`, `outbox`, `outboxStore`), the generic
  writes (`commands/write`, `commands/keyed`), the derived FSRS schedules (`scheduler`), mastery and known words
  (`mastery`, `known`, `knownMarks`, `charGroups`, `mapGrid`, `levelMastery`, `levelAttribution`), the learner's day
  (`studyClock`, `studyContext`, `currentContext`), vacations and EXP. `lib/exercises` holds the exercise rules
  flashcards share with grammar, scripts and the drills: `cloze`, `wordSalad`, `tones`, `writing`. The flashcards
  feature (`lib/features/flashcards`) holds what only flashcards do: `session/` (the queue, the session mix and
  order, grading, requeue, due counts), `setup/` (the study setup and modal state), `fsrs/` (the optimizer and the
  preview), `commands/` (cards, decks, limits and FSRS sets; `commands/cards` is also the "add to deck" entry point
  of the reader and the entry page), `face/` (hints), beside its UI. **The core never imports the flashcards
  feature or its routes**; flashcards and every other feature import the core. A feature that studies something
  else (a drill, a course, grammar review) reads the core and keeps its own rules in its own folder; logic two such
  features share goes to the core or `lib/exercises`, never through flashcards.
- **The other top folders** are `ui`, `frame`, `components`, `features` (the parent of the switchable
  features, holding their switches and `FeaturePage`), `testing` (the shared test support) and `assets`
  (fonts and the logo). Every top folder of `lib/` is in exactly one of these classes.
- **`lib/components`**: only domain widgets shared by two or more features (today `AiTag`, `Flag`,
  `PlayButton`, `ReadingText` and the cloze keyboard model `clozeKeys.ts`). A user is a feature folder, a
  switchable feature, the frame (the app chrome shows `Flag` beside the workspace's label), or a route that
  shows one of them (`routes/study` and `routes/flashcards` are flashcards, `routes/+layout.svelte` is the
  frame, `routes/+page.svelte` the widget board, `routes/login`, `register` and `reset` are account; the others
  by their folder name). A logic folder, `lib/ui`, `lib/features` itself, a file at the top of `src` (the
  hooks, the service worker), a route of a logic folder (`routes/p`, the old plugin URLs), a test, the shared
  test support (`lib/testing`, `lib/ui/testing`) and a commented-out import are not users.
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
  (the widget board shows `StageBar` from `lib/stats/map` and the widget the flashcards manifest names; the reader
  adds a word to a deck with flashcards' `commands/cards`; the settings pages save the flashcard limits with its
  `commands/settings`).
- Flashcards importing the study core and `lib/exercises`.
- A test of the study core importing flashcards (the data tests write their rows through the flashcards
  commands).
- A test or a `*.test.svelte` stub next to the code it tests, importing anything; the UI gallery harness
  (`apps/web/src/lib/ui/testing/Gallery.svelte`) shows real domain widgets. A feature's own `testing/` harness
  (`apps/web/src/lib/entry/testing/`) is checked like the feature.

Not allowed:

- `lib/ui` importing a feature folder, `lib/components` or a domain module.
- A file in `lib/components` used by only one feature.
- A component in a logic-only folder.
- Two components with the same file name.
- A loose module at the top of `lib/` (the guard's allow-list, `LOOSE_ALLOWED`, is empty).
- A re-export left at an old path after a move.
- A shipped file in `lib/studycore` or `lib/exercises` importing `lib/features/flashcards`, `routes/study` or
  `routes/flashcards`.

## Enforcement

- `apps/web/tests/repo/folderRules.test.ts` runs the checks of `apps/web/tests/repo/folderRules.ts` on the real
  tree and shows each failing on a planted tree: `uiImportFindings` (the allow-list `UI_MAY_IMPORT`),
  `sharedComponentFindings` (users by `ownerOf`: `FEATURE_FOLDERS`, the switchable features, the frame, routes by
  `ROUTE_FEATURES`), `logicFolderFindings` (`LOGIC_FOLDERS`), `duplicateNameFindings`, `looseFileFindings`,
  `unmappedRouteFindings` (a route folder missing from `ROUTE_FEATURES`), `unclassifiedFolderFindings` (a top
  folder in none of `LOGIC_FOLDERS`, `FEATURE_FOLDERS` and `STRUCTURE_FOLDERS`), `studyCoreImportFindings` (a
  shipped file of `STUDY_CORE_FOLDERS` importing `FLASHCARDS`) and `unresolvedImportFindings`
  (a `$lib/` or relative import of a shipped file that names no file, so no import is silently left out of the
  checks). Imports are read with comments stripped (`stripComments`), static, dynamic (a plain or template
  string), side-effect and re-export alike; a `.js` ending names the `.ts` file. It also fails when a folder
  or an allowed loose file it names is gone, or a folder is in two classes.
- Review: whether a new folder is a feature or a logic layer (the guard only demands that it is classified),
  whether a component is generic enough for `lib/ui`, the import style, and whether new study logic belongs to the
  core (read by more than one feature) or to its feature.

## Open questions

None. Resolved in #195: `lib/widgets` is a feature folder (the board); a route counts as the feature it shows,
through the guard's table.

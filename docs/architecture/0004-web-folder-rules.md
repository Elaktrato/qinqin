# 0004. Web: folder rules

## Status

Accepted, being implemented by #195

Touched by: #195. A merge from one of these issues that changes what this record names updates the record.

## Context

`apps/web/src/lib/components` is a grab-bag: most of it is used by one feature only. About 20 loose modules sit
at the top of `lib/`, beside about 30 tests of the repository itself (contract docs, README, wiki, licences,
bundle size). Some UI sits in logic folders (`study/DeckCardTypes.svelte`), and two different files are called
`EntryEditor.svelte` (#195).

## Decision

Under `apps/web/src/lib/`:

- **`lib/ui`**: generic building blocks with no domain knowledge.
- **`lib/frame`**: the app chrome.
- **Feature folders** (`lib/features/<feature>`, `lib/entry`, `lib/stats`, ...): everything owned by one
  feature.
- **`lib/components`**: only domain widgets shared by two or more features (`PlayButton`, `ReadingText`,
  `ReadingTable`, `ClozeChoice`, `Flag`).

#195 moves the code to match, with `git mv` (history kept) and rewritten imports, and no behaviour change:

- the entry pieces (`AddToStudy`, `Badges`, `Readings`, `Senses`, `Sentences`, `StrokePlayer`, the dictionary
  `EntryEditor` renamed `EntryEditForm`) to `lib/entry/`;
- `CardManager` and `DeckCardTypes` to `lib/features/flashcards/decks/`;
- `components/map/*` to `lib/stats/map/`, `ActivityHeatmap` to `lib/widgets/`;
- `Logo` to `lib/frame/`; `Workspace*` and the loose workspace modules to `lib/workspace/`;
- the loose modules into `lib/routing/`, `lib/events/`, `lib/auth/` and the feature folders;
- the repository tests to `apps/web/tests/repo/`; the dead `lib/listbox.ts` is deleted.

## Consequences

- A file's folder says who owns it; a component used by one feature lives with that feature.
- A widget that gains a second feature moves to `lib/components`; one that loses it moves back.
- The moves touch many imports, so #195 runs when no other web branch is open.
- `lib/study/UnreadableRowsNotice.svelte` (from #167, record [0002](0002-sync-unreadable-rows.md)) is also a UI
  component in a logic folder; #195 moves it with the others.
- The repository tests move to `apps/web/tests/repo/`, among them this folder's own check
  (`architectureDocs.test.ts`); #195 updates the path named in this folder's README.

## Allowed / Not allowed

Allowed:

- `lib/ui` imported from anywhere.
- A feature folder importing `lib/ui`, `lib/components` and shared logic.

Not allowed:

- `lib/ui` importing a feature folder.
- A file in `lib/components` used by only one feature.
- What #195 moves away from: new loose modules at the top of `lib/`, UI components in logic folders, two
  components with the same file name for different things.

## Enforcement

Planned by #195: a test that fails when anything in `lib/ui` imports a feature folder, or when something in
`lib/components` is used by only one feature. Until then: review.

## Open questions

- `lib/widgets/` exists and receives `ActivityHeatmap` in #195's moves, but the rule does not name it: whether
  it counts as a feature folder or as a shared folder is decided in #195.
- What counts as "a feature" for the `lib/components` check (feature folders only, or also route folders under
  `src/routes/`). Decided in #195.

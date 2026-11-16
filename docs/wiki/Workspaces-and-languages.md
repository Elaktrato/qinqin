# Workspaces and languages

A workspace is one study space with its own language, decks, cards, study history and Reader library. Keep Chinese and Japanese apart, or split one language in several named workspaces (for example two Chinese ones, "Novels" and "HSK").

## Names and flags

- The name is optional, unique per language, at most 40 characters, and may not contain control or invisible characters (joiners and emoji tag sequences are allowed).
- Without a name a workspace shows its language; several unnamed workspaces of one language are numbered ("Chinese", "Chinese 2").
- The picker shows a flag per language: China for `zh`, Japan for `ja`, Spain for `es`, a globe for every other language.

## Default workspaces

The first time you open the app with no workspace you get one unnamed workspace per language that has installed dictionary data. If you already have a workspace nothing is added.

## Creating, renaming, deleting

Use the workspace picker in the header, or Settings, Workspaces (create, rename, delete).

- The language list contains the built-in Chinese and Japanese packs, languages an administrator registered, and languages with installed data. A language without a dictionary is marked "(no dictionary installed)".
- A non-administrator can only choose a known language; an unknown code is refused with "ask the administrator to add it". Administrators register data-only languages (a language manager in Settings for administrators, backed by `POST /api/admin/languages`).
- **Delete** is offered while you have more than one workspace. The dialog lists what goes: library books with bookmarks and highlights, flashcards and decks, recorded reviews and the rest of the study history. You confirm by typing the workspace's label. Your own entry edits, your own example sentences and plugin on/off switches stay.
- Your last workspace cannot be deleted. If you delete a workspace in one browser tab, another tab that still shows it notices on its next request, shows a notice and falls back to your first workspace; reviews queued offline for it are dropped.

## Hidden dictionaries

A workspace can hide some dictionaries of its language from entries and lookups. This is a filter in the browser (the server still returns them).

## Language-specific features

The Characters tab of Stats (the mastery map) exists only in Chinese and Japanese workspaces. Tone cards are only offered in Chinese workspaces. Reader import sources are matched to the workspace language: Aozora Bunko for Japanese, Project Gutenberg for Chinese and others (see [Reader](Reader)).

## Related

[Settings tour](Settings-tour), [Stats and heatmap](Stats-and-heatmap).

# Workspaces and languages

A workspace is one study space with its own language, decks, cards, study history, Reader library, journal, grammar progress and statistics. Keep Chinese and Japanese apart, or split one language into several named workspaces (for example two Chinese ones, "Novels" and "HSK").

## Names and flags

- The name is optional, unique per language ("Another workspace of this language already has that name"), at most 40 characters, and may not contain control or invisible characters (joiners and emoji tag sequences are allowed).
- Without a name a workspace shows its language; several unnamed workspaces of one language are numbered ("Chinese", "Chinese 2").
- The workspace menu, the phone drawer and Settings show a flag per language: China for `zh`, Japan for `ja`, Spain for `es`, a globe for every other language. A single unnamed workspace shows only its flag.

## Default workspaces

The first time you open the app with no workspace you get one unnamed workspace per language that has installed dictionary data. If you already have a workspace nothing is added. Without any dictionary installed, the page asks you to create your first workspace and says that there is no language to choose yet.

## Switching

The flag in the top bar opens the workspace menu: every workspace with its flag, language and name, a check on the current one, and **Manage workspaces**. On a phone the workspaces are the row of flags at the top of the menu drawer. See [Finding your way](Finding-your-way#the-workspace-flag). Every page then shows the chosen workspace: Search searches its language, Decks shows its decks, the Reader its library, Stats its numbers.

## Creating, renaming, deleting

Settings → Workspaces (`/settings`) lists your workspaces, marks the current one, and shows chips such as "No dictionary" or "No level lists" for a workspace whose language lacks them. The menu's **Manage workspaces** and the drawer's **+** open it.

- **New workspace**: pick a language and, optionally, a name ("e.g. Novels"), then **Create workspace**. The language list contains the built-in Chinese and Japanese, languages an administrator registered, and languages with installed data; a language without a dictionary is marked "(no dictionary installed)". You can choose only a known language; an administrator adds others (Settings → Data, see [installing packs](Admin-data-packs)).
- **Rename** changes the name.
- **Delete** is offered while you have more than one workspace ("Your only workspace cannot be deleted; create another one first"). The dialog counts what goes, on every device: the books in its library with their bookmarks and highlights, its flashcards and decks, its recorded reviews and the rest of its study history. You confirm by typing the workspace's label. Your other workspaces are not touched, and it cannot be undone. Kept, because they belong to you rather than to a workspace: your own entry edits, your own example sentences, plugin on/off switches and other account-wide settings.
- If you delete a workspace in one browser tab, another tab that still shows it notices on its next request, shows "This workspace was deleted — switched to …" and falls back to your first workspace; reviews queued offline for it are dropped with a notice.

## Per-workspace settings in Settings → Workspaces

- **Dictionaries shown in this workspace**: hide some dictionaries of the language from entries and lookups. This is a filter in the app (the server still sends them).
- **Audio for this workspace**: **Play audio on reveal** (pronunciation after a flashcard's answer) and **Use device voice when no recording exists**.

## Language-specific features

- The **Characters** tab of Stats (the mastery map), character level sessions, the radical and part lookup and stroke order exist only in Chinese and Japanese workspaces.
- **Tone** cards are only offered in Chinese workspaces.
- The **Reader** takes Chinese and Japanese books; its import sources are matched to the workspace language: Aozora Bunko for Japanese, Project Gutenberg for Chinese and Japanese texts (see [Reader](Reader)).
- **Starter decks** need a frequency list for the language, **level decks** and level badges a level list, and **Grammar** a grammar pack ([Grammar lessons](Grammar-lessons)). Which of these exist depends on what the administrator installed; the Sources page lists them.

## For client implementers

Languages come from `GET /api/languages` (`{code, name, installed, kind}`); list them all, flag or filter on `installed`, and label languages from the code. Workspace routes, hidden dictionaries (`settings.hiddenDictionaries`) and the language administration routes are in [API routes](API-Routes).

## Related

[Settings tour](Settings-tour), [Stats and heatmap](Stats-and-heatmap).
